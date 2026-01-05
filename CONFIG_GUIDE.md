# Centralized Configuration Guide

## Overview

All IPs, URLs, and Ports are now managed in a single configuration file: `config/app.config.js`

**IMPORTANT:** Do NOT hardcode any IPs, URLs, or ports in any file. Always use variables from the config file.

## Configuration File Location

```
worklytics_HRMS_backend/config/app.config.js
```

## How to Use

### Import the Config

```javascript
const { config, ports, mongodb, mysql, getMongoUri, getBackendUrl } = require('./config/app.config');
```

### Available Configurations

#### Ports
```javascript
ports.backend        // Backend server port (default: 5008)
ports.frontend       // Frontend server port (default: 4000)
ports.queryTracker   // Query Tracker port (default: 5009)
```

#### MongoDB
```javascript
mongodb.host              // MongoDB host (default: 'localhost')
mongodb.port              // MongoDB port (default: 27017)
mongodb.uri               // Full MongoDB URI (if set, overrides host:port)
mongodb.loginDbName       // Login database name
mongodb.employeeDbName    // Employee database name
mongodb.queryTrackerDbName // Query Tracker database name
mongodb.usersCollection   // Users collection name

// Helper function to get MongoDB URI
getMongoUri(databaseName) // Returns full MongoDB connection string
```

#### MySQL
```javascript
mysql.host      // MySQL host (default: '192.168.50.29')
mysql.port      // MySQL port (default: 3306)
mysql.user      // MySQL username
mysql.password  // MySQL password
mysql.database  // MySQL database name
mysql.poolSize  // Connection pool size
```

#### URLs
```javascript
// Helper functions to get URLs
getBackendUrl()      // Returns backend base URL
getFrontendUrl()     // Returns frontend base URL
getApiUrl()          // Returns backend API URL
getHealthCheckUrl()  // Returns health check URL
```

#### Network
```javascript
network.serverIp  // Server's IP address for network access (default: 'localhost')
```

## Environment Variables

You can override any default value using environment variables in your `.env` file:

```env
# Ports
BACKEND_PORT=5008
FRONTEND_PORT=4000
QUERY_TRACKER_PORT=5009

# MongoDB
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_URI=mongodb://localhost:27017/  # If set, overrides host:port
MONGO_LOGIN_DB_NAME=ecosoul_project_tracker
MONGO_DB_NAME=Employee
QUERY_TRACKER_DB_NAME=query_tracker
MONGO_USERS_COLLECTION=users

# MySQL
DB_HOST=192.168.50.29
DB_PORT=3306
DB_USER=apiuser
DB_PASSWORD=Thrive@2910
DB_NAME=worklytics_hrms
DB_POOL_SIZE=12

# URLs (optional - will be constructed if not set)
BACKEND_BASE_URL=http://localhost:5008
FRONTEND_BASE_URL=http://localhost:4000
BACKEND_API_URL=http://localhost:5008/api
HEALTH_CHECK_URL=http://localhost:5008/api/health

# Network
SERVER_IP=localhost  # Or your actual IP like 192.168.50.107
```

## Examples

### Using Ports
```javascript
const { ports } = require('./config/app.config');
const PORT = ports.backend;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Using MongoDB
```javascript
const { getMongoUri, config } = require('./config/app.config');

// Get MongoDB URI
const mongoUri = getMongoUri();
// Or with database name
const queryTrackerUri = getMongoUri(config.mongodb.queryTrackerDbName);

// Connect
await mongoose.connect(queryTrackerUri);
```

### Using MySQL
```javascript
const { mysql } = require('./config/app.config');

const connectionConfig = {
  host: mysql.host,
  port: mysql.port,
  user: mysql.user,
  password: mysql.password,
  database: mysql.database
};
```

### Using URLs
```javascript
const { getBackendUrl, getApiUrl, getHealthCheckUrl } = require('./config/app.config');

console.log(`Backend: ${getBackendUrl()}`);
console.log(`API: ${getApiUrl()}`);
console.log(`Health: ${getHealthCheckUrl()}`);
```

## Files Updated

The following files have been updated to use the centralized config:

- ✅ `server.js`
- ✅ `config/mongo.js`
- ✅ `config/database.js`
- ✅ `query-tracker-portal/server.js`
- ✅ `query-tracker-portal/config/database.js`
- ✅ `query-tracker-portal/scripts/seed.js`
- ✅ `test-mongodb-connection.js`
- ✅ `test-connection.js`
- ✅ `utils/autoSetup.js`
- ✅ `setup-database.js`
- ✅ `ecosystem.config.js`

## Benefits

1. **Single Source of Truth**: All configuration in one place
2. **Easy Management**: Change IPs/ports in one file
3. **Environment Flexibility**: Override with environment variables
4. **No Hardcoding**: Prevents scattered hardcoded values
5. **Better Maintainability**: Easy to update and track changes

## Migration Notes

- All hardcoded `localhost`, IP addresses, and ports have been removed from code files
- Default values are set in `config/app.config.js`
- Environment variables can override defaults
- Documentation files (`.md`) may still contain examples, but code uses config

