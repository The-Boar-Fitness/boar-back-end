const { Joi, validate } = require('express-validation');

const validations = {
  // Existing validation schemas
  zkLogin: {
    body: Joi.object({
      idToken: Joi.string().required(),
      accessToken: Joi.string().optional(),
      nonce: Joi.string().optional(),
      googleUserId: Joi.string().optional(),
      email: Joi.string().email().optional()
    })
  },
  
  zkLoginRefresh: {
    body: Joi.object({
      idToken: Joi.string().optional(),
      suiAddress: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/),
      nonce: Joi.string().optional()
    })
  },
  
  initializeDirectZkLogin: {
    body: Joi.object({
      email: Joi.string().email().optional()
    })
  },
  
  // Add this new validation schema for zkProof generation
  generateZkProof: {
    body: Joi.object({
      jwt: Joi.string().required(),
      extendedEphemeralPublicKey: Joi.string().required(),
      maxEpoch: Joi.string().required(),
      jwtRandomness: Joi.string().required(),
      salt: Joi.string().required(),
      keyClaimName: Joi.string().optional().default('sub')
    })
  },
  
  // Challenge validation schemas (unchanged)
  initializeChallenge: {
    body: Joi.object({
      targetExercises: Joi.number().integer().min(1).required(),
      durationDays: Joi.number().integer().min(1).max(365).required(),
      email: Joi.string().email().optional(), // Required for zkLogin initialization
      poolName: Joi.string().max(100).optional(),
      poolDescription: Joi.string().max(500).optional(),
      poolImageUrl: Joi.string().uri().optional()
    })
  },
  
  joinChallenge: {
    body: Joi.object({
      poolId: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/),
      userAddress: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/)
    })
  },
  
  completeExercise: {
    body: Joi.object({
      poolId: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/),
      nftId: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/),
      userAddress: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/)
    })
  },
  
  // NFT validation schemas
  createNFT: {
    body: Joi.object({
      name: Joi.string().required().max(100),
      description: Joi.string().optional().max(500),
      imageUrl: Joi.string().uri().optional(),
      userAddress: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/)
    })
  },
  
  upgradeGem: {
    body: Joi.object({
      nftId: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/),
      userAddress: Joi.string().required().pattern(/^0x[a-fA-F0-9]{40,64}$/),
      paymentAmount: Joi.number().integer().positive().required()
    })
  }
};

// Apply validation with custom options
const validateRequest = (schema) => validate(schema, {
  context: true, 
  keyByField: true,
  statusCode: 422, // Use 422 Unprocessable Entity for validation errors
}, {
  abortEarly: false // Return all errors, not just the first one
});


module.exports = {
  validations,
  validateRequest
};