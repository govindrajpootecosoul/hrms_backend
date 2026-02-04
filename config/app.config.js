require('dotenv').config();

/**
 * Centralized Application Configuration
 * All IPs, URLs, and Ports are managed here
 * DO NOT hardcode any IPs, URLs, or ports in other files
 * 
 * ⚠️ IMPORTANT: MongoDB configuration is now in config/database.config.js
 * Update MongoDB settings there to apply across all portals
 */

// Import centralized database configuration
const { MONGODB_CONFIG, getMongoUri: getDbMongoUri, getDatabaseName, getCollectionName } = require('./database.config');

const config = {
  // Server Ports
  ports: {
    backend: parseInt(process.env.BACKEND_PORT) || 5008,
    frontend: parseInt(process.env.FRONTEND_PORT) || 4000,
    queryTracker: parseInt(process.env.QUERY_TRACKER_PORT) || 5009,
  },

  // MongoDB Configuration (now uses centralized config)
  mongodb: {
    host: MONGODB_CONFIG.host,
    port: MONGODB_CONFIG.port,
    uri: MONGODB_CONFIG.uri,
    loginDbName: getDatabaseName('login'),
    employeeDbName: getDatabaseName('employee'),
    queryTrackerDbName: getDatabaseName('queryTracker'),
    assetTrackerDbName: getDatabaseName('assetTracker'),
    usersCollection: getCollectionName('users'),
  },

  // MySQL Configuration
  mysql: {
    host: process.env.DB_HOST || '192.168.50.29',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'apiuser',
    password: process.env.DB_PASSWORD || 'Thrive@2910',
    database: process.env.DB_NAME || 'worklytics_hrms',
    poolSize: parseInt(process.env.DB_POOL_SIZE) || 12,
  },

  // Server URLs
  urls: {
    // Base URLs
    backendBase: process.env.BACKEND_BASE_URL || null, // Will be constructed if not set
    frontendBase: process.env.FRONTEND_BASE_URL || null, // Will be constructed if not set
    
    // API Endpoints
    backendApi: process.env.BACKEND_API_URL || null, // Will be constructed if not set
    healthCheck: process.env.HEALTH_CHECK_URL || null, // Will be constructed if not set
  },

  // Network IPs (for external access)
  network: {
    serverIp: process.env.SERVER_IP || 'localhost', // Server's IP address for network access
  },

  // Environment
  env: {
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production',
  },
};

// Helper function to get MongoDB URI (uses centralized config)
function getMongoUri(databaseName = null) {
  return getDbMongoUri(databaseName);
}

// Helper function to get backend URL
function getBackendUrl() {
  if (config.urls.backendBase) {
    return config.urls.backendBase;
  }
  const host = config.network.serverIp === 'localhost' ? 'localhost' : config.network.serverIp;
  return `http://${host}:${config.ports.backend}`;
}

// Helper function to get frontend URL
function getFrontendUrl() {
  if (config.urls.frontendBase) {
    return config.urls.frontendBase;
  }
  const host = config.network.serverIp === 'localhost' ? 'localhost' : config.network.serverIp;
  return `http://${host}:${config.ports.frontend}`;
}

// Helper function to get API URL
function getApiUrl() {
  if (config.urls.backendApi) {
    return config.urls.backendApi;
  }
  return `${getBackendUrl()}/api`;
}

// Helper function to get health check URL
function getHealthCheckUrl() {
  if (config.urls.healthCheck) {
    return config.urls.healthCheck;
  }
  return `${getBackendUrl()}/api/health`;
}

// Export configuration and helper functions
module.exports = {
  config,
  getMongoUri,
  getBackendUrl,
  getFrontendUrl,
  getApiUrl,
  getHealthCheckUrl,
  
  // Direct access to commonly used values
  ports: config.ports,
  mongodb: config.mongodb,
  mysql: config.mysql,
  urls: config.urls,
  network: config.network,
  env: config.env,
};

