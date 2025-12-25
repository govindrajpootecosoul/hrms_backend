const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const User = require('../models/User');
const { connectMongo, getUsersCollection, LOGIN_DB_NAME } = require('../../config/mongo');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    
    // First, try to find user in main app's database (ecosoul_project_tracker)
    try {
      await connectMongo(LOGIN_DB_NAME);
      const usersCol = getUsersCollection();
      const mainAppUser = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });
      
      if (mainAppUser && mainAppUser.isActive !== false) {
        // Convert ObjectId to string for consistency
        const userId = mainAppUser._id?.toString() || mainAppUser._id;
        
        // Ensure _id is a proper ObjectId for Mongoose
        let mongooseId;
        try {
          if (mainAppUser._id instanceof ObjectId) {
            mongooseId = mainAppUser._id;
          } else if (typeof mainAppUser._id === 'string') {
            mongooseId = new ObjectId(mainAppUser._id);
          } else {
            mongooseId = mainAppUser._id;
          }
        } catch (e) {
          mongooseId = mainAppUser._id;
        }
        
        // User found in main app - map to Query Tracker format
        // Create a Mongoose-compatible user object
        req.user = {
          _id: mongooseId, // Keep as ObjectId for Mongoose queries
          id: userId,
          name: mainAppUser.name,
          email: mainAppUser.email,
          role: mainAppUser.role || 'user',
          isActive: mainAppUser.isActive !== false,
          // Store original user data for reference
          _mainAppUser: mainAppUser
        };
        
        // Optionally sync user to Query Tracker database for consistency
        try {
          const queryTrackerUser = await User.findOne({ email: mainAppUser.email });
          if (!queryTrackerUser) {
            // Create user in Query Tracker database if doesn't exist
            await User.create({
              name: mainAppUser.name,
              email: mainAppUser.email,
              role: mainAppUser.role || 'user',
              isActive: mainAppUser.isActive !== false,
              password: 'synced-from-main-app' // Placeholder, won't be used for auth
            });
          } else {
            // Update existing user
            queryTrackerUser.name = mainAppUser.name;
            queryTrackerUser.role = mainAppUser.role || 'user';
            queryTrackerUser.isActive = mainAppUser.isActive !== false;
            await queryTrackerUser.save();
          }
        } catch (syncError) {
          // Log but don't fail - user can still access
          console.warn('Failed to sync user to Query Tracker DB:', syncError.message);
        }
        
        return next();
      }
    } catch (mainAppError) {
      // If main app lookup fails, fall back to Query Tracker's own User model
      console.warn('Main app user lookup failed, trying Query Tracker DB:', mainAppError.message);
    }

    // Fallback: Check Query Tracker's own User model (for backward compatibility)
    const queryTrackerUser = await User.findById(decoded.userId).select('-password');
    
    if (!queryTrackerUser || !queryTrackerUser.isActive) {
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    req.user = queryTrackerUser;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const adminAuth = (req, res, next) => {
  // Allow both 'admin' and 'superadmin' roles
  if (!req.user) {
    return res.status(401).json({ message: 'User not authenticated' });
  }
  
  const userRole = req.user.role;
  if (userRole !== 'admin' && userRole !== 'superadmin') {
    if (process.env.NODE_ENV === 'development') {
      console.log('AdminAuth failed - User role:', userRole, 'User:', req.user.email);
    }
    return res.status(403).json({ 
      message: 'Access denied. Admin only.',
      userRole: userRole // Include in dev mode for debugging
    });
  }
  next();
};

module.exports = { auth, adminAuth };

