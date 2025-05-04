// app/routes/health.routes.js
module.exports = app => {
    const health = require("../controllers/health.controller.js");
    const router = require("express").Router();
    
    // Health check endpoint - no authentication required
    router.get("/health", health.checkHealth);
    
    // Register the router - mount it at the root path
    app.use("/api", router);
  };