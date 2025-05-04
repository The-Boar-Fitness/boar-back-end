// app/config/index.js
require('dotenv').config();

/**
 * Configuration management system
 * Centralizes all configuration with validation and defaults
 */
const config = {
  // Node environment
  env: process.env.NODE_ENV || 'development',
  
  // Server configuration
  server: {
    port: parseInt(process.env.PORT) || 8080,
    host: process.env.HOST || '0.0.0.0',
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
      credentials: true
    }
  },
  
  // MongoDB configuration
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/wayfit',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10
    },
    // Connection retry settings
    connectionRetry: {
      maxRetries: 5,
      retryInterval: 5000 // 5 seconds
    }
  },
  
  // Authentication configuration
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    jwtExpiration: parseInt(process.env.JWT_EXPIRATION) || 86400, // 24 hours in seconds
    jwtRefreshExpiration: parseInt(process.env.JWT_REFRESH_EXPIRATION) || 604800, // 7 days in seconds
  },
  
  // Sui blockchain configuration
  sui: {
    network: process.env.SUI_NETWORK || 'testnet',
    nodeUrl: {
      testnet: process.env.SUI_TESTNET_URL || 'https://fullnode.testnet.sui.io',
      mainnet: process.env.SUI_MAINNET_URL || 'https://fullnode.mainnet.sui.io',
      devnet: process.env.SUI_DEVNET_URL || 'https://fullnode.devnet.sui.io'
    },
    contractPackageId: process.env.SUI_CONTRACT_PACKAGE_ID || '0xab310610823f47b2e4a58a1987114793514d63605826a766b0c2dd4bd2b6d3d3',
    contractModuleName: process.env.SUI_CONTRACT_MODULE_NAME || 'boar_challenge',
    // Faucet configuration for testnet/devnet
    faucet: {
      url: process.env.SUI_FAUCET_URL || 'https://faucet.testnet.sui.io/gas',
      requestAmount: parseInt(process.env.SUI_FAUCET_AMOUNT) || 10000000000 // 10 SUI in MIST
    }
  },
  
  // zkLogin configuration
  zkLogin: {
    maxEpoch: process.env.ZKLOGIN_MAX_EPOCH || '5',
    jwtIssuer: process.env.ZKLOGIN_JWT_ISSUER || 'https://accounts.google.com',
    // Session expiration (in hours)
    sessionExpiration: parseInt(process.env.ZKLOGIN_SESSION_EXPIRATION) || 24,
    // Salt generation settings
    saltLength: parseInt(process.env.ZKLOGIN_SALT_LENGTH) || 16,
    addressSeedLength: parseInt(process.env.ZKLOGIN_ADDRESS_SEED_LENGTH) || 32
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    filePath: process.env.LOG_FILE_PATH || 'logs/application-%DATE%.log',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d'
  },
  
  // Rate limiting configuration
  rateLimit: {
    auth: {
      windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 100 // 100 requests per window
    },
    transaction: {
      windowMs: parseInt(process.env.TX_RATE_LIMIT_WINDOW) || 5 * 60 * 1000, // 5 minutes
      max: parseInt(process.env.TX_RATE_LIMIT_MAX) || 20 // 20 requests per window
    }
  }
};

/**
 * Helper function to get the current network node URL
 */
config.getCurrentNodeUrl = () => {
  return config.sui.nodeUrl[config.sui.network] || config.sui.nodeUrl.testnet;
};

/**
 * Validate critical configuration
 * Throw error if any required configuration is missing
 */
const validateConfig = () => {
  const requiredValues = [
    { key: 'mongodb.uri', value: config.mongodb.uri },
    { key: 'auth.jwtSecret', value: config.auth.jwtSecret },
    { key: 'sui.contractPackageId', value: config.sui.contractPackageId }
  ];
  
  const missingValues = requiredValues
    .filter(item => !item.value)
    .map(item => item.key);
  
  if (missingValues.length > 0) {
    throw new Error(`Missing required configuration: ${missingValues.join(', ')}`);
  }
  
  // Check if JWT secret is using default value in production
  if (config.env === 'production' && config.auth.jwtSecret === 'your-secret-key') {
    throw new Error('Using default JWT secret in production environment. Please set a secure JWT_SECRET.');
  }
};

// Validate configuration on startup
validateConfig();

module.exports = config;