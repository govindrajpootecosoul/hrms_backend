const mongoose = require('mongoose');
const { config, getMongoUri } = require('../../config/app.config');

// Query Tracker database configuration
const QUERY_TRACKER_DB_NAME = config.mongodb.queryTrackerDbName;
const QUERY_TRACKER_MONGO_URI = getMongoUri();

async function ensureQueryTrackerConnection() {
  try {
    // If not connected, connect to Query Tracker database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(`${QUERY_TRACKER_MONGO_URI}${QUERY_TRACKER_DB_NAME}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log(`[Query Tracker DB] Connected to: ${QUERY_TRACKER_DB_NAME}`);
    } else {
      // If connected to a different database, switch to Query Tracker
      const currentDbName = mongoose.connection.db?.databaseName;
      if (currentDbName !== QUERY_TRACKER_DB_NAME) {
        mongoose.connection.useDb(QUERY_TRACKER_DB_NAME);
        console.log(`[Query Tracker DB] Switched to: ${QUERY_TRACKER_DB_NAME}`);
      }
    }
    return mongoose.connection;
  } catch (error) {
    console.error('[Query Tracker DB] Connection error:', error);
    throw error;
  }
}

module.exports = {
  ensureQueryTrackerConnection,
  QUERY_TRACKER_DB_NAME
};

