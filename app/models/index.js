// app/models/index.js - Update your MongoDB connection

const dbConfig = require("../config/db.config.js");
const mongoose = require("mongoose");

// Disable Mongoose buffering to avoid timeout issues
mongoose.set('bufferCommands', false);

// Add more logging for connection events
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected from MongoDB');
});

// More robust connection options
const connectOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
  family: 4 // Use IPv4, avoid IPv6 issues
};

// Create a function to connect to MongoDB with retry
const connectWithRetry = async (retryCount = 5, delay = 1000) => {
  let lastError;
  
  for (let i = 0; i < retryCount; i++) {
    try {
      console.log(`MongoDB connection attempt ${i + 1}/${retryCount}...`);
      await mongoose.connect(dbConfig.url, connectOptions);
      console.log("MongoDB connection successful!");
      return; // Connection successful, exit function
    } catch (err) {
      console.error(`MongoDB connection attempt ${i + 1} failed:`, err);
      lastError = err;
      
      // Wait before next retry
      if (i < retryCount - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Increase delay for next attempt
        delay *= 1.5;
      }
    }
  }
  
  // All retries failed
  console.error(`All ${retryCount} MongoDB connection attempts failed`);
  throw lastError;
};

// Initialize the db object
const db = {};
db.mongoose = mongoose;
db.url = dbConfig.url;

// Add your models
db.profiles = require("./profile.model.js")(mongoose);
db.daily_exercise = require("./exercise.model.js")(mongoose);
db.zkLoginAccount = require("./ZkLoginAccount.js")(mongoose);
db.sui = require("./sui.model.js")(mongoose);

// Add connect function to db object so it can be called from server.js
db.connect = connectWithRetry;

module.exports = db;