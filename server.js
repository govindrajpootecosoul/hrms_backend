const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Shared routes (used by all portals)
const authRoutes = require('./shared/routes/auth');

// Portal-specific routes
const hrmsRoutes = require('./hrms-portal/routes');
const assetTrackerRoutes = require('./asset-tracker-portal/routes');
const financeRoutes = require('./finance-portal/routes');
const employeeRoutes = require('./employee-portal/routes');
const queryTrackerRoutes = require('./query-tracker-portal/routes');

// MySQL auto-setup disabled - using MongoDB only
// const autoSetupDatabase = require('./utils/autoSetup');

const app = express();
const PORT = process.env.PORT || 5008;

// Middleware
// CORS configuration - allow all origins for development
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Add request logging middleware for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Shared Routes (used by all portals)
app.use('/api/auth', authRoutes);

// Portal-specific Routes
app.use('/api/hrms', hrmsRoutes);
app.use('/api/asset-tracker', assetTrackerRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/query-tracker', queryTrackerRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  let mongoStatus = false;
  let mongoError = null;
  
  // Check MongoDB connection
  try {
    const { connectMongo } = require('./config/mongo');
    await connectMongo();
    mongoStatus = true;
  } catch (err) {
    mongoStatus = false;
    mongoError = err.message;
  }
  
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    database: {
      type: 'MongoDB',
      connected: mongoStatus,
      error: mongoError,
      uri: process.env.MONGO_URI || 'mongodb://localhost:27017/'
    }
  });
});

// Error handling middleware - must be after all routes
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Start server and test MongoDB connection
async function startServer() {
  // Test MongoDB connection on startup
  try {
    const { connectMongo } = require('./config/mongo');
    await connectMongo();
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('⚠️  MongoDB connection warning:', err.message);
    console.log('   Server will start, but MongoDB features may not work until connection is established');
  }
  
  // Connect to Query Tracker database
  try {
    const mongoose = require('mongoose');
    const QUERY_TRACKER_DB_NAME = process.env.QUERY_TRACKER_DB_NAME || 'query_tracker';
    const QUERY_TRACKER_MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';
    
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(`${QUERY_TRACKER_MONGO_URI}${QUERY_TRACKER_DB_NAME}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log(`✅ Query Tracker database connected: ${QUERY_TRACKER_DB_NAME}`);
    } else {
      console.log(`✅ Query Tracker database already connected`);
    }
  } catch (err) {
    console.error('⚠️  Query Tracker database connection warning:', err.message);
    console.log('   Query Tracker features may not work until connection is established');
  }
  
  // Start server
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 Using MongoDB for employee portal and authentication`);
    console.log(`   Login DB: ecosoul_project_tracker`);
    console.log(`   Employee Portal DB: Employee`);
    console.log(`   Query Tracker DB: query_tracker`);
  });
}

startServer();

