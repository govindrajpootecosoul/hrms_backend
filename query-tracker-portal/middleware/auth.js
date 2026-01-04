const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { connectMongo, getUsersCollection, LOGIN_DB_NAME } = require('../../config/mongo');

// Ensure Query Tracker database is connected
const QUERY_TRACKER_DB_NAME = process.env.QUERY_TRACKER_DB_NAME || 'query_tracker';
const QUERY_TRACKER_MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';

async function ensureQueryTrackerConnection() {
  try {
    // Check if already connected to Query Tracker database
    if (mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === QUERY_TRACKER_DB_NAME) {
      return;
    }
    
    // Connect to Query Tracker database if not connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(`${QUERY_TRACKER_MONGO_URI}${QUERY_TRACKER_DB_NAME}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log('[Query Tracker Auth] Connected to Query Tracker database');
    } else if (mongoose.connection.db.databaseName !== QUERY_TRACKER_DB_NAME) {
      // Switch to Query Tracker database
      mongoose.connection.useDb(QUERY_TRACKER_DB_NAME);
      console.log('[Query Tracker Auth] Switched to Query Tracker database');
    }
  } catch (error) {
    console.error('[Query Tracker Auth] Error connecting to Query Tracker database:', error);
    throw error;
  }
}

const auth = async (req, res, next) => {
  try {
    // Ensure Query Tracker database connection
    await ensureQueryTrackerConnection();
    
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    console.log('[Query Tracker Auth] Request received:', {
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      path: req.path,
      method: req.method
    });
    
    if (!token) {
      console.log('[Query Tracker Auth] No token provided');
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    // Use the same JWT_SECRET as main auth, with same fallback
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (jwtError) {
      console.error('[Query Tracker Auth] JWT verification failed:', {
        error: jwtError.message,
        name: jwtError.name,
        jwtSecretSet: !!process.env.JWT_SECRET
      });
      return res.status(401).json({ 
        message: 'Token is not valid', 
        error: process.env.NODE_ENV === 'development' ? jwtError.message : 'Invalid token'
      });
    }
    
    console.log('[Query Tracker Auth] Token decoded:', { 
      hasEmail: !!decoded.email, 
      hasUserId: !!decoded.userId,
      email: decoded.email,
      role: decoded.role 
    });
    
    let user = null;
    
    // Priority 1: If token has email, use that to find/create user (main auth uses email)
    if (decoded.email) {
      // First try to find user in Query Tracker database by email
      try {
        user = await User.findOne({ email: decoded.email }).select('-password');
        if (user) {
          console.log('[Query Tracker Auth] User found in Query Tracker:', user.email);
        }
      } catch (dbError) {
        console.error('[Query Tracker Auth] Error finding user in Query Tracker:', dbError);
      }
      
      // If not found in Query Tracker, try to get from main auth database
      if (!user) {
        try {
          await connectMongo(LOGIN_DB_NAME);
          const usersCol = await getUsersCollection();
          const mainUser = await usersCol.findOne({ email: decoded.email });
          
          if (mainUser) {
            // Check if user exists in Query Tracker, if not create one
            let queryTrackerUser = await User.findOne({ email: decoded.email });
            
            if (!queryTrackerUser) {
              // Create new user - password will be hashed by pre-save hook
              queryTrackerUser = new User({
                name: mainUser.name || decoded.email,
                email: decoded.email,
                password: 'temp-password-' + Date.now(), // Will be hashed by pre-save hook
                role: mainUser.role === 'admin' ? 'admin' : 'user',
                isActive: true
              });
              await queryTrackerUser.save();
            } else {
              // Update existing user
              queryTrackerUser.name = mainUser.name || queryTrackerUser.name;
              queryTrackerUser.role = mainUser.role === 'admin' ? 'admin' : 'user';
              queryTrackerUser.isActive = true;
              await queryTrackerUser.save();
            }
            
            user = await User.findById(queryTrackerUser._id).select('-password');
          }
        } catch (error) {
          console.error('Error syncing user from main auth:', error);
        }
      }
      
      // If still no user, create a basic user from token data
      if (!user) {
        try {
          let queryTrackerUser = await User.findOne({ email: decoded.email });
          
          if (!queryTrackerUser) {
            console.log('[Query Tracker Auth] Creating new user from token:', decoded.email);
            queryTrackerUser = new User({
              name: decoded.email.split('@')[0] || 'User',
              email: decoded.email,
              password: 'temp-password-' + Date.now(), // Will be hashed by pre-save hook
              role: decoded.role === 'admin' ? 'admin' : 'user',
              isActive: true
            });
            await queryTrackerUser.save();
            console.log('[Query Tracker Auth] User created successfully:', queryTrackerUser._id);
          }
          
          user = await User.findById(queryTrackerUser._id).select('-password');
          if (user) {
            console.log('[Query Tracker Auth] User found after creation:', user.email);
          }
        } catch (error) {
          console.error('[Query Tracker Auth] Error creating user from token:', error);
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            email: decoded.email
          });
        }
      }
    } 
    // Priority 2: If token has userId (for Query Tracker native tokens), try to find by MongoDB ObjectId
    else if (decoded.userId) {
      try {
        // Check if userId is a valid MongoDB ObjectId
        const { ObjectId } = require('mongoose').Types;
        if (ObjectId.isValid(decoded.userId)) {
          user = await User.findById(decoded.userId).select('-password');
        }
      } catch (error) {
        console.error('Error finding user by userId:', error);
      }
    }
    
    if (!user) {
      console.log('[Query Tracker Auth] User not found after all attempts:', { 
        email: decoded.email,
        hasEmail: !!decoded.email,
        hasUserId: !!decoded.userId
      });
      return res.status(401).json({ message: 'User not found. Please contact administrator.' });
    }
    
    if (!user.isActive) {
      console.log('[Query Tracker Auth] User is inactive:', { 
        email: user.email,
        isActive: user.isActive
      });
      return res.status(401).json({ message: 'User account is inactive' });
    }

    console.log('[Query Tracker Auth] Authentication successful:', { 
      userId: user._id, 
      email: user.email, 
      role: user.role 
    });
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    // Don't expose internal error details in production
    const errorMessage = process.env.NODE_ENV === 'development' ? error.message : 'Token is not valid';
    res.status(401).json({ message: 'Token is not valid', error: errorMessage });
  }
};

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }
  next();
};

module.exports = { auth, adminAuth };

