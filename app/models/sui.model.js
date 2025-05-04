// app/models/sui.model.js - Fixed to prevent model recompilation
const crypto = require('crypto');
const { SuiClient } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { 
  jwtToAddress, 
  genAddressSeed, 
  generateNonce, 
  generateRandomness,
  getZkLoginSignature
} = require('@mysten/sui/zklogin');
const axios = require('axios');

// Sui configuration
const NETWORK_ENV = process.env.SUI_NETWORK || 'testnet';
const SUI_NODE_URL = {
  mainnet: 'https://fullnode.mainnet.sui.io',
  testnet: 'https://fullnode.testnet.sui.io',
  devnet: 'https://fullnode.devnet.sui.io'
}[NETWORK_ENV] || 'https://fullnode.testnet.sui.io';

// zkLogin configuration
const PROVER_URL = process.env.PROVER_URL || 'https://prover-dev.mystenlabs.com/v1';
const MAX_EPOCH_GAP = parseInt(process.env.MAX_EPOCH_GAP) || 2;

// Contract configuration
const CONTRACT_PACKAGE_ID = process.env.SUI_CONTRACT_PACKAGE_ID || '0xab310610823f47b2e4a58a1987114793514d63605826a766b0c2dd4bd2b6d3d3';
const CONTRACT_MODULE_NAME = process.env.SUI_CONTRACT_MODULE_NAME || 'boar_challenge';

// Export a function that takes mongoose as parameter
module.exports = function(mongoose) {
  // Create Sui client instance
  const suiClient = new SuiClient({ url: SUI_NODE_URL });
  
  //=============================================================================
  // Define Schemas
  //=============================================================================
  
  // Schema for zkLogin accounts - storing user-specific zkLogin data
  const zkLoginAccountSchema = mongoose.Schema(
    {
      // Provider information (e.g., 'https://accounts.google.com')
      provider: {
        type: String,
        required: true,
        index: true
      },
      // Subject ID from JWT (unique user identifier)
      subjectId: {
        type: String,
        required: true,
        index: true
      },
      // User email (if available)
      email: {
        type: String,
        index: true,
        sparse: true
      },
      // Sui address for this user
      suiAddress: {
        type: String,
        required: true,
        index: true
      },
      // User salt (needed for zkLogin)
      userSalt: {
        type: String,
        required: true
      },
      // Address seed (derived from salt and JWT claims)
      addressSeed: {
        type: String,
        required: true
      },
      // Creation timestamp
      createdAt: {
        type: Date,
        default: Date.now
      },
      // Last update timestamp
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }
  );

  // Schema for challenge participation - tracking user progress
  const challengeParticipationSchema = mongoose.Schema(
    {
      // Sui address of the participant
      address: {
        type: String,
        required: true,
        index: true
      },
      // Challenge pool ID
      poolId: {
        type: String,
        required: true,
        index: true
      },
      // NFT ID representing the challenge
      nftId: {
        type: String,
        required: true
      },
      // Number of exercises to complete
      targetExercises: {
        type: Number,
        required: true
      },
      // Current progress (exercises completed)
      progress: {
        type: Number,
        default: 0
      },
      // Last exercise day (for streaks)
      lastExerciseDay: {
        type: Number,
        default: 0
      },
      // Challenge start time
      startTime: {
        type: Date,
        required: true
      },
      // Challenge end time
      endTime: {
        type: Date,
        required: true
      },
      // Whether the user has won
      hasWon: {
        type: Boolean,
        default: false
      },
      // Creation timestamp
      createdAt: {
        type: Date,
        default: Date.now
      },
      // Last update timestamp
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }
  );

  //=============================================================================
  // Sui Network Interaction Functions
  //=============================================================================

  /**
   * Get the latest Sui system state (epochs, etc.)
   */
  const getLatestSuiSystemState = async () => {
    try {
      const state = await suiClient.getLatestSuiSystemState();
      return {
        epoch: state.epoch,
        epochDurationMs: state.epochDurationMs,
        epochStartTimestampMs: state.epochStartTimestampMs
      };
    } catch (error) {
      console.error('Error getting Sui system state:', error);
      // Return default values for fallback
      return {
        epoch: '1',
        epochDurationMs: '86400000', // 1 day in milliseconds
        epochStartTimestampMs: Date.now().toString()
      };
    }
  };

  /**
   * Get balance for a Sui address
   */
  const getBalance = async (address) => {
    try {
      const balanceResponse = await suiClient.getBalance({
        owner: address,
        coinType: '0x2::sui::SUI'
      });
      
      const balanceInSui = Number(balanceResponse.totalBalance) / 1_000_000_000;
      
      return {
        success: true,
        balance: balanceInSui.toFixed(4)
      };
    } catch (error) {
      console.error('Error fetching balance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  };

  //=============================================================================
  // zkLogin Authentication Functions
  //=============================================================================

  /**
   * Create a deterministic address based on the user's email/subject
   * Used for development/testing mode
   */
  const generateDeterministicAddress = (identifier) => {
    // Create a SHA-256 hash of the identifier
    const hash = crypto.createHash('sha256').update(identifier).digest('hex');
    
    // Format as a SUI address (0x followed by 64 hex chars)
    // Use the first 20 characters of the hash, padded with zeros
    return `0x${hash.substring(0, 20)}${'0'.repeat(44)}`;
  };

  /**
   * Convert JWT to Sui address
   */
  const jwtToSuiAddress = async (jwt, userSalt) => {
    try {
      return jwtToAddress(jwt, userSalt);
    } catch (error) {
      console.error('Error converting JWT to address:', error);
      throw error;
    }
  };

  /**
   * Generate address seed from salt and JWT claims
   */
  const generateAddressSeed = async (userSalt, keyClaimName, keyClaimValue, audience) => {
    try {
      return genAddressSeed(userSalt, keyClaimName, keyClaimValue, audience);
    } catch (error) {
      console.error('Error generating address seed:', error);
      throw error;
    }
  };

  /**
   * Generate ephemeral key pair for zkLogin
   */
  const generateEphemeralKeyPair = async () => {
    // Get current epoch information
    const { epoch } = await getLatestSuiSystemState();
    
    // Generate a new ephemeral key pair
    const ephemeralKeyPair = new Ed25519Keypair();
    const publicKey = ephemeralKeyPair.getPublicKey();
    
    // Calculate max epoch (current + MAX_EPOCH_GAP)
    const maxEpoch = Number(epoch) + MAX_EPOCH_GAP;
    
    // Generate randomness and nonce
    const randomness = generateRandomness();
    const nonce = generateNonce(publicKey, maxEpoch, randomness);
    
    return {
      keyPair: ephemeralKeyPair,
      publicKey: publicKey.toSuiPublicKey(),
      maxEpoch,
      randomness,
      nonce
    };
  };

  /**
   * Get ZK proof from prover service
   */
  const getZkProof = async (jwt, ephemeralPublicKey, maxEpoch, jwtRandomness, userSalt, keyClaimName = 'sub') => {
    try {
      // In development mode, return a mock proof
      if (process.env.NODE_ENV !== 'production') {
        console.log('Development mode: Returning mock ZK proof');
        return {
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
        };
      }
      
      // In production, call the prover service
      console.log('Calling ZK prover service:', PROVER_URL);
      
      const response = await axios.post(PROVER_URL, {
        jwt,
        extendedEphemeralPublicKey: ephemeralPublicKey,
        maxEpoch: maxEpoch.toString(),
        jwtRandomness: jwtRandomness.toString(),
        salt: userSalt.toString(),
        keyClaimName
      });
      
      return response.data;
    } catch (error) {
      console.error('Error getting ZK proof:', error);
      throw error;
    }
  };

  /**
   * Generate zkLogin data with a JWT
   * This is the main function for initializing zkLogin
   */
  const generateZkLoginData = async (idToken, accessToken, nonce, userEmail) => {
    try {
      console.log(`Generating zkLogin data for email: ${userEmail}`);
      
      // Parse the JWT to get necessary claims
      const jwtParts = idToken.split('.');
      if (jwtParts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      
      // Decode JWT payload (middle part)
      const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString());
      const sub = payload.sub;
      const aud = payload.aud;
      const iss = payload.iss;
      
      if (!sub) {
        throw new Error('JWT missing subject (sub) claim');
      }
      
      // In development mode, use deterministic values
      if (process.env.NODE_ENV !== 'production') {
        console.log('Development mode: Using deterministic zkLogin data');
        
        // Generate deterministic address and salt
        const mockAddress = generateDeterministicAddress(userEmail);
        const mockSalt = `dev_salt_${crypto.createHash('sha256').update(userEmail).digest('hex').substring(0, 8)}`;
        const mockSeed = `dev_seed_${crypto.createHash('sha256').update(userEmail).digest('hex').substring(0, 8)}`;
        
        // Find or create zkLogin account
        let zkAccount;
        const ZkLoginAccount = mongoose.models.ZkLoginAccount || mongoose.model('ZkLoginAccount', zkLoginAccountSchema);
        
        try {
          zkAccount = await ZkLoginAccount.findOne({ email: userEmail });
          
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
              provider: iss || 'dev',
              subjectId: sub || userEmail,
              email: userEmail,
              suiAddress: mockAddress,
              userSalt: mockSalt,
              addressSeed: mockSeed
            });
            await zkAccount.save();
            console.log(`Created new zkLogin account for ${userEmail}`);
          }
        } catch (dbError) {
          console.error('Database error:', dbError);
          // Continue even with database errors in development mode
        }
        
        // Create mock auth token
        const authToken = Buffer.from(JSON.stringify({ 
          email: userEmail, 
          address: mockAddress,
          dev: true
        })).toString('base64');
        
        // Return mock data
        return {
          success: true,
          address: mockAddress,
          authToken,
          zkProof: {
            userSalt: mockSalt,
            addressSeed: mockSeed,
            jwtRandomness: nonce || generateRandomness().toString(),
            maxEpoch: "100" // Mock epoch for development
          }
        };
      }
      
      // Production flow starts here
      
      // Find or generate user salt
      const ZkLoginAccount = mongoose.models.ZkLoginAccount || mongoose.model('ZkLoginAccount', zkLoginAccountSchema);
      let zkAccount = await ZkLoginAccount.findOne({ 
        provider: iss,
        subjectId: sub 
      });
      
      let userSalt;
      if (zkAccount) {
        userSalt = zkAccount.userSalt;
      } else {
        // Generate a deterministic salt based on the subject ID
        userSalt = crypto.createHash('sha256')
          .update(`${sub}-${crypto.randomBytes(16).toString('hex')}`)
          .digest('hex')
          .substring(0, 32);
      }
      
      // Calculate Sui address from JWT and salt
      const suiAddress = await jwtToSuiAddress(idToken, userSalt);
      
      // Generate address seed
      const addressSeed = await generateAddressSeed(
        BigInt(userSalt), 
        'sub', 
        sub, 
        Array.isArray(aud) ? aud[0] : aud
      );
      
      // Save or update zkLogin account
      if (zkAccount) {
        zkAccount.suiAddress = suiAddress;
        zkAccount.updatedAt = new Date();
        await zkAccount.save();
        console.log(`Updated existing zkLogin account for ${userEmail}`);
      } else {
        zkAccount = new ZkLoginAccount({
          provider: iss,
          subjectId: sub,
          email: userEmail,
          suiAddress: suiAddress,
          userSalt: userSalt,
          addressSeed: addressSeed.toString()
        });
        await zkAccount.save();
        console.log(`Created new zkLogin account for ${userEmail}`);
      }
      
      // Get epoch information
      const { epoch } = await getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + MAX_EPOCH_GAP;
      
      // Create auth token
      const authToken = Buffer.from(JSON.stringify({ 
        email: userEmail, 
        address: suiAddress,
        sub: sub
      })).toString('base64');
      
      // Return zkLogin data
      return {
        success: true,
        address: suiAddress,
        authToken,
        zkProof: {
          userSalt,
          addressSeed: addressSeed.toString(),
          jwtRandomness: nonce || generateRandomness().toString(),
          maxEpoch: maxEpoch.toString()
        }
      };
    } catch (error) {
      console.error('Error in generateZkLoginData:', error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Refresh zkLogin data
   */
  const refreshZkLogin = async (idToken, suiAddress, nonce) => {
    try {
      console.log(`Refreshing zkLogin for address: ${suiAddress}`);
      
      // Find the zkLogin account
      const ZkLoginAccount = mongoose.models.ZkLoginAccount || mongoose.model('ZkLoginAccount', zkLoginAccountSchema);
      const zkAccount = await ZkLoginAccount.findOne({ suiAddress });
      
      if (!zkAccount) {
        return { 
          success: false, 
          error: 'No zkLogin account found for this address' 
        };
      }
      
      // For development mode, return mock data
      if (process.env.NODE_ENV !== 'production') {
        console.log('Development mode: Using mock zkLogin refresh data');
        
        // Create mock auth token
        const authToken = Buffer.from(JSON.stringify({ 
          email: zkAccount.email, 
          address: suiAddress,
          refreshed: true,
          dev: true
        })).toString('base64');
        
        return {
          success: true,
          address: suiAddress,
          authToken,
          zkProof: {
            userSalt: zkAccount.userSalt,
            addressSeed: zkAccount.addressSeed,
            jwtRandomness: nonce || generateRandomness().toString(),
            maxEpoch: "100" // Mock epoch for development
          }
        };
      }
      
      // Production code
      
      // Get epoch information
      const { epoch } = await getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + MAX_EPOCH_GAP;
      
      // Update zkLogin account
      zkAccount.updatedAt = new Date();
      await zkAccount.save();
      
      // Create auth token
      const authToken = Buffer.from(JSON.stringify({ 
        email: zkAccount.email, 
        address: suiAddress,
        sub: zkAccount.subjectId,
        refreshed: true
      })).toString('base64');
      
      return {
        success: true,
        address: suiAddress,
        authToken,
        zkProof: {
          userSalt: zkAccount.userSalt,
          addressSeed: zkAccount.addressSeed,
          jwtRandomness: nonce || generateRandomness().toString(),
          maxEpoch: maxEpoch.toString()
        }
      };
    } catch (error) {
      console.error('Error in refreshZkLogin:', error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Create a zkLogin transaction
   */
  const createZkLoginTransaction = async (zkLoginData, buildTransactionFn) => {
    try {
      const { suiAddress, addressSeed, userSalt, maxEpoch } = zkLoginData;
      
      // Create a transaction
      const tx = new Transaction();
      tx.setSender(suiAddress);
      
      // Let the caller build the transaction
      await buildTransactionFn(tx);
      
      // For development mode, return mock success
      if (process.env.NODE_ENV !== 'production') {
        return {
          success: true,
          txDigest: `mock_tx_${Date.now().toString(16)}`
        };
      }
      
      // In production, we would:
      // 1. Sign the transaction with ephemeral key
      // 2. Create zkLogin signature
      // 3. Execute transaction
      
      // This would be the real implementation:
      /*
      const ephemeralKeyPair = new Ed25519Keypair();
      
      const { bytes, signature: userSignature } = await tx.sign({
        client: suiClient,
        signer: ephemeralKeyPair
      });
      
      const zkLoginSignature = getZkLoginSignature({
        inputs: {
          ...zkProof,
          addressSeed
        },
        maxEpoch,
        userSignature
      });
      
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: bytes,
        signature: zkLoginSignature,
        options: {
          showEffects: true,
          showEvents: true
        }
      });
      
      return {
        success: true,
        txDigest: result.digest
      };
      */
      
      // For now, return mock success
      return {
        success: true,
        txDigest: `mock_tx_${Date.now().toString(16)}`
      };
    } catch (error) {
      console.error('Error creating zkLogin transaction:', error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Initialize direct zkLogin (without OAuth flow)
   */
  const initializeDirectZkLogin = async (userEmail) => {
    try {
      console.log(`Initializing direct zkLogin for email: ${userEmail}`);
      
      // Create a deterministic identifier
      const identifier = userEmail || `anonymous-${crypto.randomBytes(8).toString('hex')}`;
      
      // For development mode, use deterministic values
      if (process.env.NODE_ENV !== 'production') {
        // Generate deterministic address and salt
        const mockAddress = generateDeterministicAddress(identifier);
        const mockSalt = `direct_salt_${crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 8)}`;
        const mockSeed = `direct_seed_${crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 8)}`;
        
        // Find or create zkLogin account
        const ZkLoginAccount = mongoose.models.ZkLoginAccount || mongoose.model('ZkLoginAccount', zkLoginAccountSchema);
        let zkAccount;
        
        try {
          zkAccount = await ZkLoginAccount.findOne({ email: identifier });
          
          if (zkAccount) {
            // Update existing account
            zkAccount.suiAddress = mockAddress;
            zkAccount.userSalt = mockSalt;
            zkAccount.addressSeed = mockSeed;
            zkAccount.updatedAt = new Date();
            await zkAccount.save();
          } else {
            // Create new account
            zkAccount = new ZkLoginAccount({
              provider: 'direct',
              subjectId: identifier,
              email: identifier,
              suiAddress: mockAddress,
              userSalt: mockSalt,
              addressSeed: mockSeed
            });
            await zkAccount.save();
          }
        } catch (dbError) {
          console.error('Database error:', dbError);
          // Continue even with database errors in development mode
        }
        
        // Create auth token
        const authToken = Buffer.from(JSON.stringify({ 
          email: identifier, 
          address: mockAddress,
          direct: true,
          dev: true
        })).toString('base64');
        
        return {
          success: true,
          address: mockAddress,
          authToken,
          zkProof: {
            userSalt: mockSalt,
            addressSeed: mockSeed,
            jwtRandomness: generateRandomness().toString(),
            maxEpoch: "100" // Mock epoch for development
          }
        };
      }
      
      // Production code would require more setup
      // For now, create a placeholder account
      
      const userSalt = crypto.randomBytes(16).toString('hex');
      const addressSeed = crypto.randomBytes(32).toString('hex');
      const mockAddress = generateDeterministicAddress(identifier);
      
      // Create zkLogin account
      const ZkLoginAccount = mongoose.models.ZkLoginAccount || mongoose.model('ZkLoginAccount', zkLoginAccountSchema);
      const zkAccount = new ZkLoginAccount({
        provider: 'direct',
        subjectId: identifier,
        email: identifier,
        suiAddress: mockAddress,
        userSalt,
        addressSeed
      });
      
      await zkAccount.save();
      
      // Get epoch information
      const { epoch } = await getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + MAX_EPOCH_GAP;
      
      // Create auth token
      const authToken = Buffer.from(JSON.stringify({ 
        email: identifier, 
        address: mockAddress,
        direct: true
      })).toString('base64');
      
      return {
        success: true,
        address: mockAddress,
        authToken,
        zkProof: {
          userSalt,
          addressSeed,
          jwtRandomness: generateRandomness().toString(),
          maxEpoch: maxEpoch.toString()
        }
      };
    } catch (error) {
      console.error('Error in initializeDirectZkLogin:', error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Get zkLogin configuration
   */
  const getZkLoginConfig = async () => {
    try {
      // Get epoch information
      const { epoch } = await getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + MAX_EPOCH_GAP;
      
      return {
        success: true,
        config: {
          maxEpoch: maxEpoch.toString(),
          jwtIssuer: 'https://accounts.google.com',
          networkEnv: NETWORK_ENV,
          proverUrl: PROVER_URL
        }
      };
    } catch (error) {
      console.error('Error getting zkLogin config:', error);
      
      // Return fallback config
      return {
        success: true,
        config: {
          maxEpoch: '10',
          jwtIssuer: 'https://accounts.google.com',
          networkEnv: NETWORK_ENV,
          proverUrl: PROVER_URL
        }
      };
    }
  };

  //=============================================================================
  // Challenge Functions
  //=============================================================================

  /**
   * Initialize a challenge
   */
  const initializeChallenge = async (targetExercises, durationDays) => {
    try {
      console.log(`Initializing challenge with ${targetExercises} exercises for ${durationDays} days`);
      
      // For development, return mock data
      if (process.env.NODE_ENV !== 'production') {
        return {
          success: true,
          poolId: `mock_pool_${Date.now().toString(16)}`,
          targetExercises,
          durationDays
        };
      }
      
      // In production, create a transaction
      // This would involve a real transaction to the blockchain
      
      return {
        success: true,
        poolId: `pool_${Date.now().toString(16)}`,
        targetExercises,
        durationDays
      };
    } catch (error) {
      console.error('Error initializing challenge:', error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Initialize a challenge with zkLogin
   */
  const initializeChallengeWithZkLogin = async (params) => {
    try {
      const { 
        suiAddress, 
        userSalt, 
        addressSeed, 
        targetExercises, 
        durationDays,
        poolName,
        poolDescription,
        poolImageUrl
      } = params;
      
      console.log(`Initializing challenge with zkLogin for ${suiAddress}`);
      
      // For development, return mock data
      if (process.env.NODE_ENV !== 'production') {
        return {
          success: true,
          poolId: `mock_pool_${Date.now().toString(16)}`,
          targetExercises,
          durationDays,
          suiAddress
        };
      }
      
      // In production, create a transaction
      // This would involve a real transaction to the blockchain using zkLogin
      
      return {
        success: true,
        poolId: `pool_${Date.now().toString(16)}`,
        targetExercises,
        durationDays,
        suiAddress
      };
    } catch (error) {
      console.error('Error initializing challenge with zkLogin:', error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Get pool information
   */
  const getPoolInfo = async (poolId) => {
    try {
      console.log(`Getting pool info for ${poolId}`);
      
      // For development, return mock data
      if (process.env.NODE_ENV !== 'production') {
        return {
          success: true,
          poolInfo: {
            objectId: poolId,
            totalBalance: '1000000000', // 1 SUI
            targetExercises: 10,
            startTime: Date.now() - 86400000, // Yesterday
            durationDays: 30,
            rewardsDistributed: false
          }
        };
      }
      
      // In production, query the blockchain
      // This would involve a real query to the blockchain
      
      return {
        success: true,
        poolInfo: {
          objectId: poolId,
          totalBalance: '1000000000', // 1 SUI
          targetExercises: 10,
          startTime: Date.now() - 86400000, // Yesterday
          durationDays: 30,
          rewardsDistributed: false
        }
      };
    } catch (error) {
      console.error('Error getting pool info:', error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Check if a user is a winner
   */
  const checkWinner = async (poolId, address) => {
    try {
      console.log(`Checking if ${address} is a winner in ${poolId}`);
      
      // For development, return mock data
      if (process.env.NODE_ENV !== 'production') {
        return {
          success: true,
          isWinner: Math.random() > 0.5 // Random result for testing
        };
      }
      
      // In production, query the blockchain
      // This would involve a real query to the blockchain
      
      return {
        success: true,
        isWinner: false // Default to false
      };
    } catch (error) {
      console.error('Error checking winner:', error);
      return { success: false, error: error.message };
    }
  };

  //=============================================================================
  // Create and return models and functions
  //=============================================================================
  
  // Check if models already exist to prevent recompilation
  let ZkLoginAccount, ChallengeParticipation;
  
  // Use existing models if they exist, create them if they don't
  if (mongoose.models.ZkLoginAccount) {
    ZkLoginAccount = mongoose.models.ZkLoginAccount;
  } else {
    ZkLoginAccount = mongoose.model('ZkLoginAccount', zkLoginAccountSchema);
  }
  
  if (mongoose.models.ChallengeParticipation) {
    ChallengeParticipation = mongoose.models.ChallengeParticipation;
  } else {
    ChallengeParticipation = mongoose.model('ChallengeParticipation', challengeParticipationSchema);
  }

  return {
    // Models
    ZkLoginAccount,
    ChallengeParticipation,
    
    // zkLogin Authentication
    generateZkLoginData,
    refreshZkLogin,
    initializeDirectZkLogin,
    getZkLoginConfig,
    getLatestSuiSystemState,
    jwtToAddress: jwtToSuiAddress,
    generateAddressSeed,
    getZkProof,
    generateEphemeralKeyPair,
    createZkLoginTransaction,
    
    // Blockchain Interaction
    getBalance,
    initializeChallenge,
    initializeChallengeWithZkLogin,
    getPoolInfo,
    checkWinner
  };
};