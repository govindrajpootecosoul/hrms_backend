const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Import routes
const authRoutes = require('./auth');
const queriesRoutes = require('./queries');
const usersRoutes = require('./users');
const reportsRoutes = require('./reports');

// Connect to MongoDB for query tracker
// Use a separate database for query tracker
const QUERY_TRACKER_DB_URI = process.env.QUERY_TRACKER_MONGODB_URI || 
  (process.env.MONGO_URI ? `${process.env.MONGO_URI}query_tracker` : 'mongodb://localhost:27017/query_tracker');

// Initialize mongoose connection for query tracker
let isConnected = false;

async function connectQueryTrackerDB() {
  if (isConnected) {
    return;
  }

  try {
    await mongoose.connect(QUERY_TRACKER_DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    isConnected = true;
    console.log('✅ Query Tracker MongoDB connected');
  } catch (error) {
    console.error('❌ Query Tracker MongoDB connection error:', error.message);
    // Don't throw - let the server start even if query tracker DB is not available
  }
}

// Connect on module load
connectQueryTrackerDB();

// Mount routes
router.use('/auth', authRoutes);
router.use('/queries', queriesRoutes);
router.use('/users', usersRoutes);
router.use('/reports', reportsRoutes);

module.exports = router;

