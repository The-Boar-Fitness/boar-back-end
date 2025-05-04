const winston = require('winston');
const mongoose = require('mongoose');
require('winston-daily-rotate-file');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

// Register colors with winston
winston.addColors(colors);

// Define format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define file transport for rotating logs
const fileTransport = new winston.transports.DailyRotateFile({
  filename: 'logs/application-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  level: level(),
});

// Define console transport
const consoleTransport = new winston.transports.Console({
  format: format,
  level: level(),
});

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports: [
    fileTransport,
    consoleTransport
  ],
});

// Transaction logging helper
const logTransaction = async (txDetails) => {
  try {
    const Transaction = mongoose.model('Transaction');
    
    // Create new transaction record
    const transaction = new Transaction({
      ...txDetails,
      updatedAt: new Date()
    });
    
    // Save to database
    await transaction.save();
    
    // Log transaction details
    logger.info(`Transaction recorded: ${txDetails.txDigest} (${txDetails.txType}) - Status: ${txDetails.status}`);
    
    return transaction;
  } catch (error) {
    logger.error(`Failed to log transaction: ${error.message}`);
    return null;
  }
};

// Update transaction status
const updateTransactionStatus = async (txDigest, status, details = {}) => {
  try {
    const Transaction = mongoose.model('Transaction');
    
    // Find and update transaction
    const transaction = await Transaction.findOneAndUpdate(
      { txDigest },
      { 
        status,
        ...details,
        updatedAt: new Date(),
        ...(status === 'success' || status === 'failure' ? { finalizedAt: new Date() } : {})
      },
      { new: true }
    );
    
    if (!transaction) {
      logger.warn(`Cannot update transaction status: Transaction ${txDigest} not found`);
      return null;
    }
    
    logger.info(`Transaction ${txDigest} status updated to ${status}`);
    return transaction;
  } catch (error) {
    logger.error(`Error updating transaction status: ${error.message}`);
    return null;
  }
};

// Get transaction history for an address
const getTransactionHistory = async (address, limit = 20, skip = 0, filters = {}) => {
  try {
    const Transaction = mongoose.model('Transaction');
    
    // Build query
    const query = { address, ...filters };
    
    // Get transactions with pagination
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    // Get total count
    const total = await Transaction.countDocuments(query);
    
    return {
      transactions,
      pagination: {
        total,
        skip,
        limit,
        hasMore: total > skip + limit
      }
    };
  } catch (error) {
    logger.error(`Error retrieving transaction history: ${error.message}`);
    return { transactions: [], pagination: { total: 0, skip, limit, hasMore: false } };
  }
};

module.exports = {
  logger,
  logTransaction,
  updateTransactionStatus,
  getTransactionHistory
};