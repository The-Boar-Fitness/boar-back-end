// app/routes/exercise.routes.js
module.exports = app => {
    const dailyExercise = require("../controllers/exercise.controller.js");
    const router = require("express").Router();
    
    // Create a new daily exercise record
    router.post("/", dailyExercise.create);
    
    // Get all exercise records
    router.get("/", dailyExercise.findAll);
    
    // Get daily exercise records by user
    router.get("/user/:user", dailyExercise.findByUser);
    
    // Get performance statistics by exercise type
    router.get("/performanceByType", dailyExercise.getPerformanceByType);
    
    // Get exercise summary for a user
    router.get("/summary/:user", dailyExercise.getSummary);
    
    // Global error handler for this router
    router.use((err, req, res, next) => {
      console.error("Exercise route error:", err);
      res.status(500).send({
        success: false,
        message: "An unexpected error occurred",
        error: process.env.NODE_ENV === 'production' ? undefined : err.message
      });
    });
    
    // Mount the router
    app.use("/api/daily_exercise", router);
  };