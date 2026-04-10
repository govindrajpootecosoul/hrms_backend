const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Network + env validation before app.config (app.config also requires SERVER_IP, ports, DB, Mongo from .env)
require('./config/network.config');
const { config, ports, getMongoUri, getBackendUrl: getAppBackendUrl } = require('./config/app.config');
const { networkConfig, getBackendUrl, getApiUrl, backendPort } = require('./config/network.config');

// Portals (see /portals/<name>/app.js — shared config/ and this server.js at repo root)
const { authRoutes, adminUsersRoutes } = require('./portals/admin-portal/app');
const hrmsAdminRoutes = require('./portals/hrms-admin/app');
const hrmsRoutes = require('./portals/hrms/app');
const assetTrackerRoutes = require('./portals/assets/app');
const financeRoutes = require('./portals/finance/app');
const employeeRoutes = require('./portals/employee/app');
const queryTrackerRoutes = require('./portals/query-tracker/app');

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
const ENABLE_REQUEST_LOGS = process.env.REQUEST_LOGS === 'true' || process.env.NODE_ENV !== 'production';
const REQUEST_LOG_EXCLUDE_PATHS = new Set([
  '/api/health',
  '/api/employee/checkin/status',
]);

if (ENABLE_REQUEST_LOGS) {
  app.use((req, res, next) => {
    // Avoid noisy hot-path logs in production/PM2
    if (!REQUEST_LOG_EXCLUDE_PATHS.has(req.path)) {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    }
    next();
  });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Admin portal (auth + admin users)
app.use('/api/auth', authRoutes);
app.use('/api/admin-users', adminUsersRoutes);

// HRMS: admin surface first, then main HRMS API
const mountHrms = () => {
  app.use('/api/hrms', hrmsAdminRoutes);
  app.use('/api/hrms', hrmsRoutes);
  // Legacy frontend paths use /api/hrms-portal/* — same handlers
  app.use('/api/hrms-portal', hrmsAdminRoutes);
  app.use('/api/hrms-portal', hrmsRoutes);
};
mountHrms();
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
  
  // Query Tracker: mongoose connects per company in middleware (no global DB at startup).

  // Start server
  // Listen on all interfaces (0.0.0.0) to allow network access
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on ${getBackendUrl()}`);
    console.log(`   Network IP: ${networkConfig.serverIp}`);
    console.log(`   Port: ${PORT}`);
    console.log(`📝 MongoDB: main/login mongod default :27012; Ecosoul :27013; Thrive :27014 (override with MONGO_HOST / MONGO_URI_*)`);
    console.log(`   Login DB: ${config.mongodb.loginDbName} / ${config.mongodb.usersCollection}`);
    console.log(`   Company portal data: DB name per company on MONGO_URI_ECOSOUL / MONGO_URI_THRIVE (defaults :27013 / :27014)`);
    console.log(`   (Legacy env names MONGO_DB_NAME / QUERY_TRACKER_DB_NAME etc. no longer select separate DBs per module — company DB holds all portal collections.)`);
  });
}

startServer();

