// server.js - Fixed with root health endpoint and explicit routes
const express = require("express");
const cors = require("cors");
require('dotenv').config();

const app = express();

// Global CORS configuration - apply to all routes
const corsOptions = {
  origin: "*", // Allow all origins in development
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"],
  credentials: true
};

// Apply CORS globally
app.use(cors(corsOptions));

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// parse requests of content-type - application/json
app.use(express.json({ limit: '50mb' }));

// parse requests of content-type - application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// Add a root health endpoint (no /api prefix)
app.get("/health", (req, res) => {
  const isDbConnected = app.get('mongoDbConnected') === true;
  res.json({
    status: isDbConnected ? "ok" : "degraded",
    database: isDbConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    message: "Server is running"
  });
});

// Keep the /api/health endpoint too
app.get("/api/health", (req, res) => {
  const isDbConnected = app.get('mongoDbConnected') === true;
  res.json({
    status: isDbConnected ? "ok" : "degraded",
    database: isDbConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
    message: "Server is running"
  });
});

// Simple route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to WayFit application." });
});

// Add an explicit test route for zkLogin
app.post('/api/sui/zklogin/test', (req, res) => {
  console.log('Test zkLogin endpoint hit');
  console.log('Request body:', req.body);
  
  res.json({
    success: true,
    message: "Test endpoint is working",
    received: req.body
  });
});

// db connection
const db = require("./app/models");

// Load routes before attempting to connect to MongoDB
console.log("Loading API routes...");

// Define a manual route for the zkLogin endpoint to debug
app.post('/api/sui/zklogin', (req, res) => {
  console.log('Manual zkLogin endpoint hit');
  console.log('Request body:', req.body);
  
  // Extract parameters from request
  const { idToken, accessToken, nonce, googleUserId, email } = req.body;
  
  // Create a mock response
  const mockAddress = `0x${Math.random().toString(36).substring(2, 15)}${'0'.repeat(50)}`;
  const authToken = Buffer.from(JSON.stringify({ 
    email: email || `google-${googleUserId}@example.com`, 
    address: mockAddress,
    mock: true
  })).toString('base64');
  
  res.status(200).json({
    success: true,
    address: mockAddress,
    authToken: authToken,
    zkProof: {
      userSalt: "mock_user_salt_" + Math.random().toString(36).substring(2, 15),
      addressSeed: "mock_address_seed_" + Math.random().toString(36).substring(2, 15),
      jwtRandomness: nonce || "mock_jwt_randomness"
    }
  });
});

// Load the normal routes
require("./app/routes/profile.routes")(app);
require("./app/routes/exercise.routes")(app);
require("./app/routes/sui.routes")(app);
require('./app/routes/auth.routes')(app);

console.log("Routes loaded. API endpoints should now be accessible.");

// Catch-all route for debugging 404s
app.use((req, res, next) => {
  if (req.path.startsWith('/api/sui')) {
    console.log(`404 Not Found: ${req.method} ${req.path}`);
    console.log('Headers:', req.headers);
    
    return res.status(404).json({
      success: false,
      error: "Route Not Found",
      message: `Cannot ${req.method} ${req.path}`,
      availableRoutes: [
        "/api/sui/zklogin",
        "/api/sui/zklogin/test",
        "/api/sui/zklogin/config",
        "/api/sui/zklogin/refresh"
      ]
    });
  }
  next();
});

// Start server without waiting for DB connection
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}.`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Connect to MongoDB after server starts and routes are loaded
  connectToMongoDB();
});

// Graceful shutdown process
process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await db.mongoose.disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// MongoDB connection function with retries
async function connectToMongoDB() {
  let retries = 0;
  const maxRetries = 5;
  const retryInterval = 5000; // 5 seconds
  
  while (retries < maxRetries) {
    try {
      console.log(`Connecting to MongoDB... Attempt ${retries + 1}/${maxRetries}`);
      await db.connect();
      
      // Mark MongoDB as connected in app settings
      app.set('mongoDbConnected', true);
      console.log("MongoDB connected successfully!");
      
      return;
    } catch (err) {
      retries++;
      console.error(`Failed to connect to MongoDB (Attempt ${retries}/${maxRetries}):`, err);
      app.set('mongoDbConnected', false);
      
      if (retries >= maxRetries) {
        console.error("Max MongoDB connection retries reached. API will work in limited mode.");
        return;
      }
      
      // Wait before retrying
      console.log(`Waiting ${retryInterval/1000} seconds before next retry...`);
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }
}

// In case of unhandled errors, keep the server running
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});