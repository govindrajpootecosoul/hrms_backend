require('dotenv').config();

/**
 * Network Configuration for Backend
 * 
 * ⚠️ IMPORTANT: Update only this file to change network settings
 * This is the SINGLE SOURCE OF TRUTH for backend network configuration
 * 
 * To change network settings:
 * 1. Update SERVER_IP and BACKEND_PORT below
 * 2. Or set environment variables: SERVER_IP and BACKEND_PORT
 */

const networkConfig = {
  // Server IP Address (change this to your network IP)
  // Examples: '192.168.50.107', '192.168.1.100', 'localhost'
  serverIp: process.env.SERVER_IP || '192.168.50.107',
  
  // Backend Port (change this to your desired port)
  backendPort: parseInt(process.env.BACKEND_PORT) || 5008,
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

