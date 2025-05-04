// app/middlewares/error.middleware.js
const { ValidationError } = require('express-validation');

const errorHandler = (err, req, res, next) => {
  console.error(`Error processing ${req.method} ${req.url}:`, err);
  
  // Handle validation errors
  if (err instanceof ValidationError) {
    return res.status(err.statusCode).json({
      success: false,
      error: 'Validation Error',
      details: err.details
    });
  }
  
  // Handle zkLogin specific errors
  if (err.message && err.message.includes('zkLogin')) {
    return res.status(400).json({
      success: false,
      error: 'zkLogin Error',
      message: err.message
    });
  }
  
  // Handle blockchain transaction errors
  if (err.message && (err.message.includes('transaction') || err.message.includes('Sui'))) {
    return res.status(502).json({
      success: false, 
      error: 'Blockchain Error',
      message: err.message
    });
  }
  
  // Default server error
  return res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred'
      : err.message
  });
};

// Catch async errors
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  asyncHandler
};