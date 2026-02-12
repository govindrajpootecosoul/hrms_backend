const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import centralized config
const { config, ports, getMongoUri, getBackendUrl: getAppBackendUrl } = require('./config/app.config');
// Import network config (single source of truth for network settings)
const { networkConfig, getBackendUrl, getApiUrl, backendPort } = require('./config/network.config');

// Shared routes (used by all portals)
const authRoutes = require('./shared/routes/auth');
const adminUsersRoutes = require('./shared/routes/admin-users');

// Portal-specific routes
const hrmsRoutes = require('./hrms-portal/routes');
const assetTrackerRoutes = require('./asset-tracker-portal/routes');
const financeRoutes = require('./finance-portal/routes');
const employeeRoutes = require('./employee-portal/routes');
const queryTrackerRoutes = require('./query-tracker-portal/routes');

// MySQL auto-setup disabled - using MongoDB only
// const autoSetupDatabase = require('./utils/autoSetup');

const app = express();
// Use port from network.config.js (single source of truth)
const PORT = backendPort;

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
app.use('/api/admin-users', adminUsersRoutes);

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
      uri: getMongoUri()
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
    const { connectMongo, initializeAllPortals } = require('./config/mongo');
    await connectMongo();
    console.log('✅ MongoDB connected successfully');
    
    // Initialize all portal databases and collections
    try {
      await initializeAllPortals();
    } catch (initErr) {
      console.error('⚠️  Portal initialization warning:', initErr.message);
      console.log('   Server will continue, but some portal features may not work until databases are created');
    }
  } catch (err) {
    console.error('⚠️  MongoDB connection warning:', err.message);
    console.log('   Server will start, but MongoDB features may not work until connection is established');
  }
  
  // Connect to Query Tracker database
  try {
    const mongoose = require('mongoose');
    const queryTrackerUri = getMongoUri(config.mongodb.queryTrackerDbName);
    
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(queryTrackerUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log(`✅ Query Tracker database connected: ${config.mongodb.queryTrackerDbName}`);
    } else {
      console.log(`✅ Query Tracker database already connected`);
    }
  } catch (err) {
    console.error('⚠️  Query Tracker database connection warning:', err.message);
    console.log('   Query Tracker features may not work until connection is established');
  }
  
  // Start server
  // Listen on all interfaces (0.0.0.0) to allow network access
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on ${getBackendUrl()}`);
    console.log(`   Network IP: ${networkConfig.serverIp}`);
    console.log(`   Port: ${PORT}`);
    console.log(`📝 Using MongoDB for employee portal and authentication`);
    console.log(`   Login DB: ${config.mongodb.loginDbName}`);
    console.log(`   Employee Portal DB: ${config.mongodb.employeeDbName}`);
    console.log(`   Query Tracker DB: ${config.mongodb.queryTrackerDbName}`);
  });
}

startServer();

