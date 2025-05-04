// app/routes/sui.routes.js
const { authJwt } = require("../middlewares");
const { validations, validateRequest } = require("../middlewares/validation.middleware");
const { asyncHandler } = require("../middlewares/error.middleware");
const rateLimit = require("express-rate-limit");

module.exports = app => {
  const sui = require("../controllers/sui.controller.js");
  const router = require("express").Router();
  
  /**
   * Helper function to safely apply middleware
   * Returns an array with the middleware if it exists, or an empty array if not
   */
  const safeMiddleware = (middleware) => {
    return middleware ? [middleware] : [];
  };
  
  /**
   * Authentication middleware that verifies token but allows requests without tokens
   * Used for endpoints that can work with or without authentication
   */
  const optionalAuth = safeMiddleware(authJwt && authJwt.verifyTokenOptional);
  
  /**
   * Authentication middleware that requires a valid token
   * Used for endpoints that require user authentication
   */
  const requiredAuth = safeMiddleware(authJwt && authJwt.verifyToken);
  
  /**
   * Rate limiting for auth endpoints
   */
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      success: false,
      error: "Too many requests, please try again later."
    }
  });
  
  /**
   * Rate limiting for blockchain transaction endpoints
   */
  const transactionRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // Limit each IP to 20 transactions per windowMs
    message: {
      success: false,
      error: "Transaction rate limit exceeded, please try again later."
    }
  });
  
  //=============================================================================
  // zkLogin Authentication Endpoints
  //=============================================================================
  
  /**
   * Handle zkLogin authentication
   * POST /api/sui/zklogin
   * Creates a new zkLogin session for a user based on their Google OIDC token
   */
  router.post(
    "/zklogin", 
    authRateLimiter,
    validateRequest(validations.zkLogin),
    asyncHandler(sui.handleZkLogin)
  );

  /**
 * Generate ZK proof for transaction
 * POST /api/sui/zklogin/prove
 * Generates a ZK proof for use in transactions
 */
router.post(
  "/zklogin/prove", 
  authRateLimiter,
  validateRequest(validations.generateZkProof), // Create this validation
  asyncHandler(sui.generateZkProof)
);
  
  /**
   * Refresh zkLogin session
   * POST /api/sui/zklogin/refresh
   * Refreshes an existing zkLogin session with a new token
   */
  router.post(
    "/zklogin/refresh", 
    authRateLimiter,
    validateRequest(validations.zkLoginRefresh),
    asyncHandler(sui.handleZkLoginRefresh)
  );
  
  /**
   * Get zkLogin configuration
   * GET /api/sui/zklogin/config
   * Returns configuration parameters for zkLogin
   */
  router.get(
    "/zklogin/config", 
    asyncHandler(sui.getZkLoginConfig)
  );
  
  /**
   * Initialize direct zkLogin
   * POST /api/sui/zklogin/initialize-direct
   * Creates a zkLogin session directly without Google Sign-In (for mobile apps)
   */
  router.post(
    "/zklogin/initialize-direct", 
    authRateLimiter,
    optionalAuth,
    validateRequest(validations.initializeDirectZkLogin),
    asyncHandler(sui.initializeDirectZkLogin)
  );
  
  //=============================================================================
  // Challenge Management Endpoints
  //=============================================================================
  
  /**
   * Initialize a new challenge
   * POST /api/sui/challenge/init
   * Creates a new challenge pool with the specified parameters
   */
  router.post(
    "/challenge/init", 
    transactionRateLimiter,
    validateRequest(validations.initializeChallenge),
    asyncHandler(sui.initializeChallenge)
  );
  
  /**
   * Initialize a challenge with zkLogin
   * POST /api/sui/challenge/init-zklogin
   * Creates a new challenge using zkLogin authentication
   */
  if (sui.initializeChallengeWithZkLogin) {
    router.post(
      "/challenge/init-zklogin",
      transactionRateLimiter,
      validateRequest(validations.initializeChallenge),
      asyncHandler(sui.initializeChallengeWithZkLogin)
    );
  }
  
  /**
   * Join a challenge
   * POST /api/sui/challenge/join
   * Allows a user to join a challenge by staking SUI tokens
   */
  router.post(
    "/challenge/join", 
    transactionRateLimiter,
    validateRequest(validations.joinChallenge),
    asyncHandler(sui.joinChallenge)
  );
  
  /**
   * Complete an exercise
   * POST /api/sui/challenge/complete-exercise
   * Records a completed exercise for the user
   */
  router.post(
    "/challenge/complete-exercise", 
    transactionRateLimiter,
    validateRequest(validations.completeExercise),
    asyncHandler(sui.completeExercise)
  );
  
  /**
   * Distribute rewards
   * POST /api/sui/challenge/distribute-rewards
   * Distributes rewards to winners after a challenge ends
   */
  if (sui.distributeRewards) {
    router.post(
      "/challenge/distribute-rewards", 
      transactionRateLimiter,
      requireAuth,
      asyncHandler(sui.distributeRewards)
    );
  }
  
  //=============================================================================
  // NFT Management Endpoints
  //=============================================================================
  
  /**
   * Create a custom NFT
   * POST /api/sui/nft/create
   * Creates a new custom NFT with gem properties
   */
  router.post(
    "/nft/create", 
    transactionRateLimiter,
    validateRequest(validations.createNFT),
    asyncHandler(sui.createNFT)
  );
  
  /**
   * Upgrade a gem NFT
   * POST /api/sui/nft/upgrade-gem
   * Upgrades the gem level and power of a CustomNFT
   */
  if (sui.upgradeGem) {
    router.post(
      "/nft/upgrade-gem", 
      transactionRateLimiter,
      validateRequest(validations.upgradeGem),
      asyncHandler(sui.upgradeGem)
    );
  }
  
  //=============================================================================
  // Information Retrieval Endpoints
  //=============================================================================
  
  /**
   * Get challenge pool information
   * GET /api/sui/pool/:id
   * Retrieves information about a challenge pool
   */
  router.get(
    "/pool/:id", 
    asyncHandler(sui.getPoolInfo)
  );
  
  /**
   * Get user balance
   * GET /api/sui/balance/:address
   * Retrieves a user's SUI balance
   */
  router.get(
    "/balance/:address", 
    asyncHandler(sui.getBalance)
  );
  
  /**
   * Check if a user is a winner
   * GET /api/sui/winner/:poolId/:address
   * Determines if a user has won rewards in a challenge
   */
  router.get(
    "/winner/:poolId/:address", 
    asyncHandler(sui.checkWinner)
  );
  
  /**
   * Get player progress
   * GET /api/sui/progress/:poolId/:address
   * Retrieves a player's current progress in a challenge
   */
  if (sui.getPlayerProgress) {
    router.get(
      "/progress/:poolId/:address", 
      asyncHandler(sui.getPlayerProgress)
    );
  }
  
  //=============================================================================
  // Mount all routes under /api/sui
  //=============================================================================
  
  /**
   * Register the router
   * All endpoints will be prefixed with /api/sui
   */
  app.use("/api/sui", router);
};