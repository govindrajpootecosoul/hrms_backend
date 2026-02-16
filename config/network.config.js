require('dotenv').config();

/**
 * Network Configuration for Backend
 * 
 * ⚠️ IMPORTANT: Update .env file to change network settings
 * This file reads from environment variables only
 * 
 * To change network settings:
 * Update SERVER_IP and BACKEND_PORT in .env file
 */

// Validate required environment variables
if (!process.env.SERVER_IP) {
  throw new Error('SERVER_IP must be set in .env file');
}
if (!process.env.BACKEND_PORT) {
  throw new Error('BACKEND_PORT must be set in .env file');
}

const networkConfig = {
  // Server IP Address (must be set in .env file)
  serverIp: process.env.SERVER_IP,
  
  // Backend Port (must be set in .env file)
  backendPort: parseInt(process.env.BACKEND_PORT),
};

// Helper function to get backend URL
function getBackendUrl() {
  const host = networkConfig.serverIp === 'localhost' ? 'localhost' : networkConfig.serverIp;
  return `http://${host}:${networkConfig.backendPort}`;
}

// Helper function to get API URL
function getApiUrl() {
  return `${getBackendUrl()}/api`;
}

// Export configuration
module.exports = {
  networkConfig,
  getBackendUrl,
  getApiUrl,
  // Direct access for convenience
  serverIp: networkConfig.serverIp,
  backendPort: networkConfig.backendPort,
};

