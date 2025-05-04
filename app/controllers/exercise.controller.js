// app/controllers/exercise.controller.js
const db = require("../models");
const DailyExercise = db.daily_exercise;

// Helper function to check MongoDB connection
const checkDbConnection = (req, res, next) => {
  if (!req.app.get('mongoDbConnected')) {
    return res.status(503).send({
      success: false,
      message: "Database connection is not available. Please try again later."
    });
  }
  next();
};

// Get all exercise records
exports.findAll = [checkDbConnection, async (req, res) => {
  try {
    const data = await DailyExercise.find({});
    res.send(data);
  } catch (err) {
    console.error("Error retrieving all exercises:", err);
    res.status(500).send({
      success: false,
      message: err.message || "Some error occurred while retrieving daily exercise records."
    });
  }
}];

// Create a new daily exercise record
exports.create = [checkDbConnection, async (req, res) => {
  try {
    // Validate required fields: 'user' and 'day'
    if (!req.body.user || !req.body.day) {
      return res.status(400).send({ 
        success: false,
        message: "User and day are required." 
      });
    }

    // Create the exercise record
    const dailyExercise = new DailyExercise({
      user: req.body.user,
      day: new Date(req.body.day),
      type: req.body.type || "general",
      calories_burned: req.body.calories_burned || 0,
      duration: req.body.duration || 0
    });

    // Save to database
    const data = await dailyExercise.save();
    res.status(201).send({
      success: true,
      data
    });
  } catch (err) {
    console.error("Error creating exercise:", err);
    res.status(500).send({
      success: false,
      message: err.message || "Some error occurred while creating the daily exercise record."
    });
  }
}];

// Retrieve all daily exercise records for a given user
exports.findByUser = [checkDbConnection, async (req, res) => {
  try {
    const user = req.params.user;
    
    // Optional filters
    const filters = { user };
    
    // Add date range filter if provided
    if (req.query.startDate && req.query.endDate) {
      filters.day = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }
    
    // Add exercise type filter if provided
    if (req.query.type) {
      filters.type = req.query.type;
    }
    
    const data = await DailyExercise.find(filters)
      .sort({ day: -1 }) // Most recent first
      .limit(req.query.limit ? parseInt(req.query.limit) : 100);
      
    if (!data || data.length === 0) {
      return res.status(404).send({ 
        success: false,
        message: "No daily exercise records found for this user." 
      });
    }
    
    res.send({
      success: true,
      count: data.length,
      data
    });
  } catch (err) {
    console.error("Error finding exercises by user:", err);
    res.status(500).send({
      success: false,
      message: "Error retrieving daily exercise records: " + err.message
    });
  }
}];

// Get performance statistics by exercise type
exports.getPerformanceByType = [checkDbConnection, async (req, res) => {
  try {
    const type = req.query.type;
    const start = req.query.start;
    const end = req.query.end;

    // Validate the required query parameters
    if (!type || !start || !end) {
      return res.status(400).send({ 
        success: false,
        message: "Exercise type, start, and end dates are required." 
      });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    // Check if dates are valid
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).send({
        success: false,
        message: "Invalid date format. Please use YYYY-MM-DD format."
      });
    }

    const result = await DailyExercise.aggregate([
      {
        $match: {
          type: type,
          day: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: "$user",
          totalExercises: { $sum: 1 },
          totalDuration: { $sum: "$duration" },
          totalCalories: { $sum: "$calories_burned" },
          distinctDays: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$day" } } }
        }
      },
      {
        $project: {
          _id: 0,
          user: "$_id",
          totalExercises: 1,
          totalDuration: 1,
          totalCalories: 1,
          exerciseDays: { $size: "$distinctDays" }
        }
      }
    ]);

    if (!result || result.length === 0) {
      return res.status(404).send({ 
        success: false,
        message: "No exercise records found for the given type and time range." 
      });
    }
    
    res.send({
      success: true,
      data: result
    });
  } catch (err) {
    console.error("Error getting performance by type:", err);
    res.status(500).send({
      success: false,
      message: err.message || "Error retrieving performance data."
    });
  }
}];

// Get summary of exercises for a user
exports.getSummary = [checkDbConnection, async (req, res) => {
  try {
    const user = req.params.user;
    
    if (!user) {
      return res.status(400).send({
        success: false,
        message: "User parameter is required"
      });
    }
    
    const result = await DailyExercise.aggregate([
      {
        $match: { user }
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          totalDuration: { $sum: "$duration" },
          totalCalories: { $sum: "$calories_burned" },
          lastPerformed: { $max: "$day" }
        }
      },
      {
        $project: {
          _id: 0,
          type: "$_id",
          count: 1,
          totalDuration: 1,
          totalCalories: 1,
          lastPerformed: 1
        }
      },
      {
        $sort: { lastPerformed: -1 }
      }
    ]);
    
    if (!result || result.length === 0) {
      return res.status(404).send({
        success: false,
        message: "No exercise data found for this user"
      });
    }
    
    // Also get overall totals
    const totals = await DailyExercise.aggregate([
      {
        $match: { user }
      },
      {
        $group: {
          _id: null,
          totalExercises: { $sum: 1 },
          totalDuration: { $sum: "$duration" },
          totalCalories: { $sum: "$calories_burned" },
          uniqueDays: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$day" } } }
        }
      },
      {
        $project: {
          _id: 0,
          totalExercises: 1,
          totalDuration: 1,
          totalCalories: 1,
          totalDays: { $size: "$uniqueDays" }
        }
      }
    ]);
    
    res.send({
      success: true,
      byExerciseType: result,
      totals: totals.length > 0 ? totals[0] : {
        totalExercises: 0,
        totalDuration: 0,
        totalCalories: 0,
        totalDays: 0
      }
    });
  } catch (err) {
    console.error("Error getting exercise summary:", err);
    res.status(500).send({
      success: false,
      message: err.message || "Error retrieving exercise summary"
    });
  }
}];