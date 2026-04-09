const express = require('express');
const cors = require('cors');

/**
 * Shared Express app factory for per-portal backend services.
 */
function createServiceApp() {
  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-company'],
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  return app;
}

function attachErrorHandler(app) {
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message,
      });
    }
  });
}

module.exports = { createServiceApp, attachErrorHandler };
