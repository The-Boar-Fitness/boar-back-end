// app/controllers/sui.controller.js
const db = require("../models");
const Sui = db.sui;
const ZkLoginAccount = db.zkLoginAccount;
const axios = require('axios');
const crypto = require('crypto');

// Configuration for zkLogin
const PROVER_URL = process.env.PROVER_URL || 'https://prover-dev.mystenlabs.com/v1'; // Use dev prover for testing
const MAX_EPOCH_GAP = 2; // Max epochs the ephemeral key is valid for

/**
 * Handle zkLogin authentication
 */
exports.handleZkLogin = async (req, res) => {
    try {
        if (!req.body.idToken) {
            return res.status(400).send({ success: false, message: "ID token cannot be empty" });
        }

        // Extract all parameters from request
        const { idToken, accessToken, nonce, googleUserId, email } = req.body;

        // Use the actual email if provided, otherwise construct from Google ID
        const userEmail = email || `google-${googleUserId}@example.com`;

        console.log(`Processing zkLogin for email: ${userEmail}`);

        // Implementation based on the zkLogin flow
        try {
            // Step 1: Check if we're in development mode
            if (process.env.NODE_ENV !== 'production') {
                console.log('Using development zkLogin flow');
                return handleDevZkLogin(userEmail, nonce, res);
            }

            // Step 2: Parse and validate the JWT
            const jwtParts = idToken.split('.');
            if (jwtParts.length !== 3) {
                return res.status(400).send({
                    success: false,
                    message: "Invalid JWT format"
                });
            }

            // Decode JWT payload (middle part)
            const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString());
            const sub = payload.sub;
            const aud = payload.aud;
            const iss = payload.iss;

            if (!sub) {
                return res.status(400).send({
                    success: false,
                    message: "JWT missing subject (sub) claim"
                });
            }

            console.log(`JWT validated for subject: ${sub}`);

            // Step 3: Retrieve or generate user salt
            let userSalt;
            let zkAccount = await ZkLoginAccount.findOne({
                provider: iss,
                subjectId: sub
            });

            if (zkAccount) {
                console.log(`Found existing zkLogin account for ${sub}`);
                userSalt = zkAccount.userSalt;
            } else {
                // Generate a new salt for the user
                userSalt = crypto.randomBytes(16).toString('hex');
                console.log(`Generated new salt for user: ${userSalt}`);
            }

            // Step 4: Get current epoch from Sui network
            const suiSystemState = await Sui.getLatestSuiSystemState();
            const currentEpoch = suiSystemState.epoch;
            const maxEpoch = Number(currentEpoch) + MAX_EPOCH_GAP;
            console.log(`Current epoch: ${currentEpoch}, Max epoch: ${maxEpoch}`);

            // Step 5: Generate address seed
            const addressSeed = await Sui.generateAddressSeed(
                BigInt(userSalt),
                'sub',
                sub,
                Array.isArray(aud) ? aud[0] : aud
            );

            // Step 6: Calculate the zkLogin Sui address
            const suiAddress = await Sui.jwtToAddress(idToken, userSalt);
            console.log(`Generated zkLogin address: ${suiAddress}`);

            // Step 7: Get zero-knowledge proof from prover service
            // Note: In production, you should use your own prover or Mysten's production prover
            const jwtRandomness = nonce || crypto.randomBytes(16).toString('hex');

            // Save or update the zkLogin account
            if (zkAccount) {
                // Update existing account
                zkAccount.suiAddress = suiAddress;
                zkAccount.updatedAt = new Date();
                zkAccount.lastJwt = idToken; // Store for potential troubleshooting
                await zkAccount.save();
            } else {
                // Create new account
                zkAccount = new ZkLoginAccount({
                    provider: iss,
                    subjectId: sub,
                    email: userEmail,
                    suiAddress: suiAddress,
                    userSalt: userSalt,
                    addressSeed: addressSeed.toString(),
                    lastJwt: idToken,
                });
                await zkAccount.save();
                console.log(`Created new zkLogin account for ${userEmail}`);
            }

            // Generate auth token for the client
            const authToken = Buffer.from(JSON.stringify({
                email: userEmail,
                suiAddress: suiAddress,
                sub: sub
            })).toString('base64');

            // Return the zkLogin data to the client
            return res.status(200).send({
                success: true,
                address: suiAddress,
                authToken: authToken,
                zkProof: {
                    userSalt: userSalt,
                    addressSeed: addressSeed.toString(),
                    jwtRandomness: jwtRandomness,
                    maxEpoch: maxEpoch.toString()
                }
            });

        } catch (err) {
            console.error("Error processing zkLogin:", err);
            return res.status(500).send({
                success: false,
                error: err.message || "Error processing zkLogin"
            });
        }
    } catch (err) {
        console.error("zkLogin error:", err);
        res.status(500).send({
            success: false,
            error: err.message || "Some error occurred while processing zkLogin."
        });
    }
};


exports.generateZkProof = async (req, res) => {
    try {
        const { jwt, extendedEphemeralPublicKey, maxEpoch, jwtRandomness, salt, keyClaimName = 'sub' } = req.body;

        // Validate required parameters
        if (!jwt || !extendedEphemeralPublicKey || !maxEpoch || !jwtRandomness || !salt) {
            return res.status(400).json({
                success: false,
                error: "Missing required parameters for proof generation"
            });
        }

        console.log(`Generating ZK proof for JWT, maxEpoch: ${maxEpoch}`);

        // For development mode, return mock proof
        if (process.env.NODE_ENV !== 'production') {
            console.log('Returning mock ZK proof for development');
            return res.status(200).json({
                success: true,
                zkProof: {
                    proofPoints: {
                        a: ['1', '2', '3'],
                        b: [['4', '5'], ['6', '7'], ['1', '0']],
                        c: ['8', '9', '10']
                    },
                    issBase64Details: {
                        value: 'mock_iss_value',
                        indexMod4: 2
                    },
                    headerBase64: 'mock_header_base64'
                }
            });
        }

        // In production, call the prover service
        try {
            console.log('Calling ZK prover service:', PROVER_URL);

            const response = await axios.post(PROVER_URL, {
                jwt,
                extendedEphemeralPublicKey,
                maxEpoch,
                jwtRandomness,
                salt,
                keyClaimName
            });

            // Return the proof from the prover service
            return res.status(200).json({
                success: true,
                zkProof: response.data
            });
        } catch (proverError) {
            console.error('Error calling prover service:', proverError);

            return res.status(500).json({
                success: false,
                error: "Failed to generate ZK proof from prover service"
            });
        }
    } catch (error) {
        console.error('Error generating ZK proof:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate ZK proof'
        });
    }
};

/**
 * Handle development zkLogin mode with deterministic values
 */
async function handleDevZkLogin(userEmail, nonce, res) {
    try {
        // Generate deterministic values for development
        const emailHash = crypto.createHash('sha256').update(userEmail).digest('hex');
        const mockAddress = `0x${emailHash.substring(0, 20)}${'0'.repeat(44)}`;
        const mockSalt = `dev_salt_${emailHash.substring(0, 8)}`;
        const mockSeed = `dev_seed_${emailHash.substring(0, 8)}`;

        console.log(`Dev mode: Generated address for ${userEmail}: ${mockAddress}`);

        // Try to find or create the zkLogin account
        let zkAccount = await ZkLoginAccount.findOne({ email: userEmail });

        if (zkAccount) {
            // Update existing account
            zkAccount.suiAddress = mockAddress;
            zkAccount.userSalt = mockSalt;
            zkAccount.addressSeed = mockSeed;
            zkAccount.updatedAt = new Date();
            await zkAccount.save();
            console.log(`Updated existing zkLogin account for ${userEmail}`);
        } else {
            // Create new account
            zkAccount = new ZkLoginAccount({
                provider: 'dev',
                subjectId: userEmail,
                email: userEmail,
                suiAddress: mockAddress,
                userSalt: mockSalt,
                addressSeed: mockSeed
            });
            await zkAccount.save();
            console.log(`Created new zkLogin account for ${userEmail}`);
        }

        // Generate mock auth token
        const authToken = Buffer.from(JSON.stringify({
            email: userEmail,
            suiAddress: mockAddress,
            dev: true
        })).toString('base64');

        // Return mock data
        return res.status(200).send({
            success: true,
            address: mockAddress,
            authToken: authToken,
            zkProof: {
                userSalt: mockSalt,
                addressSeed: mockSeed,
                jwtRandomness: nonce || "dev_randomness",
                maxEpoch: "100" // Mock epoch
            }
        });
    } catch (devError) {
        console.error("Error in dev zkLogin:", devError);
        return res.status(500).send({
            success: false,
            error: devError.message || "Error in dev zkLogin"
        });
    }
}

/**
 * Handle zkLogin refresh
 */
exports.handleZkLoginRefresh = async (req, res) => {
    try {
        // Validate request
        if (!req.body.suiAddress) {
            return res.status(400).send({
                success: false,
                message: "SUI address cannot be empty"
            });
        }

        const { idToken, suiAddress, nonce } = req.body;

        // Find the zkLogin account for this address
        const zkAccount = await ZkLoginAccount.findOne({ suiAddress });

        if (!zkAccount) {
            return res.status(404).send({
                success: false,
                message: "No zkLogin account found for this address"
            });
        }

        // For development mode, return mock data
        if (process.env.NODE_ENV !== 'production' || zkAccount.provider === 'dev') {
            console.log(`Refreshing dev zkLogin for ${zkAccount.email}`);

            // Generate mock auth token
            const authToken = Buffer.from(JSON.stringify({
                email: zkAccount.email,
                suiAddress: zkAccount.suiAddress,
                refreshed: true,
                dev: true
            })).toString('base64');

            return res.status(200).send({
                success: true,
                address: zkAccount.suiAddress,
                authToken: authToken,
                zkProof: {
                    userSalt: zkAccount.userSalt,
                    addressSeed: zkAccount.addressSeed,
                    jwtRandomness: nonce || "refreshed_randomness",
                    maxEpoch: "100" // Mock epoch
                }
            });
        }

        // For production, validate the JWT and update the proof
        if (!idToken) {
            return res.status(400).send({
                success: false,
                message: "ID token is required for refresh in production mode"
            });
        }

        // Parse and validate JWT
        const jwtParts = idToken.split('.');
        if (jwtParts.length !== 3) {
            return res.status(400).send({
                success: false,
                message: "Invalid JWT format"
            });
        }

        // Decode JWT payload
        const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString());
        const sub = payload.sub;

        if (sub !== zkAccount.subjectId) {
            return res.status(403).send({
                success: false,
                message: "JWT subject doesn't match the account"
            });
        }

        // Get current epoch from Sui network
        const suiSystemState = await Sui.getLatestSuiSystemState();
        const currentEpoch = suiSystemState.epoch;
        const maxEpoch = Number(currentEpoch) + MAX_EPOCH_GAP;

        // Generate new JWT randomness
        const jwtRandomness = nonce || crypto.randomBytes(16).toString('hex');

        // Update zkLogin account
        zkAccount.updatedAt = new Date();
        zkAccount.lastJwt = idToken;
        await zkAccount.save();

        // Generate auth token
        const authToken = Buffer.from(JSON.stringify({
            email: zkAccount.email,
            suiAddress: zkAccount.suiAddress,
            sub: sub,
            refreshed: true
        })).toString('base64');

        // Return the refreshed zkLogin data
        return res.status(200).send({
            success: true,
            address: zkAccount.suiAddress,
            authToken: authToken,
            zkProof: {
                userSalt: zkAccount.userSalt,
                addressSeed: zkAccount.addressSeed,
                jwtRandomness: jwtRandomness,
                maxEpoch: maxEpoch.toString()
            }
        });
    } catch (err) {
        console.error("zkLogin refresh error:", err);
        res.status(500).send({
            success: false,
            error: err.message || "Some error occurred while refreshing zkLogin."
        });
    }
};

/**
 * Get zkLogin configuration
 */
exports.getZkLoginConfig = async (req, res) => {
    try {
        // Get the latest epoch information
        let maxEpoch = "10"; // Default fallback
        let networkEnv = process.env.SUI_NETWORK || 'devnet';

        try {
            const suiSystemState = await Sui.getLatestSuiSystemState();
            const currentEpoch = suiSystemState.epoch;
            maxEpoch = (Number(currentEpoch) + MAX_EPOCH_GAP).toString();
        } catch (epochError) {
            console.error("Error getting epoch:", epochError);
        }

        // Return zkLogin configuration
        res.status(200).json({
            success: true,
            config: {
                maxEpoch: maxEpoch,
                jwtIssuer: 'https://accounts.google.com', // Default to Google
                networkEnv: networkEnv,
                proverUrl: PROVER_URL
            }
        });
    } catch (error) {
        console.error("Error getting zkLogin configuration:", error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get zkLogin configuration'
        });
    }
};

/**
 * Handle direct zkLogin initialization
 */
exports.initializeDirectZkLogin = async (req, res) => {
    try {
        // Check if the user is authenticated via token
        const userId = req.userId;
        let userEmail = null;

        // Find user profile if authenticated
        if (userId) {
            try {
                const Profile = db.profiles;
                const userProfile = await Profile.findOne({ id: userId });
                if (userProfile) {
                    userEmail = userProfile.email;
                }
            } catch (profileErr) {
                console.error("Error finding profile:", profileErr);
            }
        }

        // If no authenticated user, check if email was provided in request
        if (!userEmail && req.body && req.body.email) {
            userEmail = req.body.email;
        }

        // If still no email, generate a random identifier
        if (!userEmail) {
            const randomId = crypto.randomBytes(8).toString('hex');
            userEmail = `anonymous-${randomId}@example.com`;
            console.log("Generated anonymous email:", userEmail);
        }

        console.log("Initializing direct zkLogin for:", userEmail);

        // For development, use mock data
        if (process.env.NODE_ENV !== 'production') {
            return handleDevZkLogin(userEmail, crypto.randomBytes(16).toString('hex'), res);
        }

        // For production, generate a new salt and address
        const userSalt = crypto.randomBytes(16).toString('hex');

        // Get current epoch from Sui network
        const suiSystemState = await Sui.getLatestSuiSystemState();
        const currentEpoch = suiSystemState.epoch;
        const maxEpoch = Number(currentEpoch) + MAX_EPOCH_GAP;

        // Create a placeholder for direct zkLogin
        const zkAccount = new ZkLoginAccount({
            provider: 'direct',
            subjectId: userEmail,
            email: userEmail,
            userSalt: userSalt,
            addressSeed: "direct_placeholder",
            suiAddress: "0x" + crypto.randomBytes(32).toString('hex') // Placeholder address
        });

        await zkAccount.save();

        // Generate auth token
        const authToken = Buffer.from(JSON.stringify({
            email: userEmail,
            suiAddress: zkAccount.suiAddress,
            direct: true
        })).toString('base64');

        // Return initialization data
        res.send({
            success: true,
            address: zkAccount.suiAddress,
            authToken: authToken,
            zkProof: {
                userSalt: userSalt,
                addressSeed: "direct_placeholder",
                jwtRandomness: crypto.randomBytes(16).toString('hex'),
                maxEpoch: maxEpoch.toString()
            }
        });
    } catch (err) {
        console.error("Direct zkLogin initialization error:", err);
        res.status(500).send({
            success: false,
            error: err.message || "Failed to initialize direct zkLogin."
        });
    }
};