const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { connectMongo, getUsersCollection, LOGIN_DB_NAME } = require('../../config/mongo');

// Portal mapping - maps admin portal names to select portal identifiers
const PORTAL_MAPPING = {
  'HRMS': 'hrms',
  'DataHive': 'datahive',
  'Asset Tracker': 'asset-tracker',
  'Finance Tools': 'finance',
  'Project Tracker': 'project-tracker',
  'Employee Portal': 'employee-portal',
  'Query Tracker': 'query-tracker',
  'Demand / Panel': 'demand-panel'
};

// Reverse mapping for display
const PORTAL_DISPLAY_NAMES = {
  'hrms': 'HRMS',
  'datahive': 'DataHive',
  'asset-tracker': 'Asset Tracker',
  'finance': 'Finance Tools',
  'project-tracker': 'Project Tracker',
  'employee-portal': 'Employee Portal',
  'query-tracker': 'Query Tracker',
  'demand-panel': 'Demand / Panel'
};

/**
 * Check if a user is a dummy/test user
 * @param {Object} user - User object
 * @returns {boolean} - True if user is dummy/test user
 */
function isDummyUser(user) {
  const email = (user.email || '').toLowerCase();
  const name = (user.name || '').toLowerCase();
  
  // Common dummy/test patterns
  const dummyEmailPatterns = [
    'test@',
    'dummy@',
    'example@',
    'sample@',
    'demo@',
    '@test.',
    '@example.',
    '@dummy.',
    'admin@test',
    'user@test',
    'testuser@',
    'dummyuser@'
  ];
  
  const dummyNamePatterns = [
    'test user',
    'dummy user',
    'example user',
    'sample user',
    'demo user',
    'test account',
    'dummy account',
    'test data',
    'testuser',
    'dummyuser',
    'testadmin',
    'test admin'
  ];
  
  // Check email patterns
  const isDummyEmail = dummyEmailPatterns.some(pattern => email.includes(pattern));
  
  // Check name patterns
  const isDummyName = dummyNamePatterns.some(pattern => name.includes(pattern));
  
  // Also check if email is very short or suspicious
  const isSuspiciousEmail = email.length < 5 || email.split('@').length !== 2;
  
  return isDummyEmail || isDummyName || isSuspiciousEmail;
}

// @route   GET /api/admin-users
// @desc    Get all users for admin portal (from Employees_List database)
// @access  Private/Admin
// @query   filterDummy - Optional: set to 'true' to filter out dummy/test users
// @query   company - Optional: filter users by company name (e.g., 'Ecosoul Home', 'Thrive')
router.get('/', async (req, res) => {
  try {
    const { filterDummy, company } = req.query;
    const shouldFilterDummy = filterDummy === 'true';
    
    // Get the appropriate collection based on company name
    // If company is provided, use company-specific collection
    // If no company is provided, we'll need to query both collections or use a default
    let usersCol;
    let collectionName;
    
    if (company) {
      // Use company name to get the appropriate collection
      usersCol = await getUsersCollection(null, company);
      collectionName = company.toLowerCase().includes('thrive') ? 'Thrive_Employees' : 'Ecosoul_Employees';
    } else {
      // If no company specified, default to Ecosoul for backward compatibility
      // In the future, we might want to query both collections and merge results
      usersCol = await getUsersCollection(null, 'Ecosoul Home');
      collectionName = 'Ecosoul_Employees';
    }
    
    // Build query object (no need to filter by company field since we're already in the right collection)
    const query = {};
    
    // Fetch users from the appropriate collection
    const allUsers = await usersCol.find(query).toArray();
    
    console.log(`[admin-users] Fetched ${allUsers.length} total users from ${collectionName} collection in ${LOGIN_DB_NAME} database${company ? ` for company: ${company}` : ''}`);
    
    // By default, show ALL users. Only filter if explicitly requested
    let usersToReturn = allUsers;
    let dummyCount = 0;
    
    if (shouldFilterDummy) {
      usersToReturn = allUsers.filter(user => !isDummyUser(user));
      dummyCount = allUsers.length - usersToReturn.length;
      if (dummyCount > 0) {
        console.log(`[admin-users] Filtered out ${dummyCount} dummy/test users`);
      }
    } else {
      console.log(`[admin-users] Showing all ${allUsers.length} users from database`);
    }
    
    // Transform users to include portals array (default to empty if not present)
    const transformedUsers = usersToReturn.map(user => ({
      id: user._id?.toString(),
      _id: user._id?.toString(),
      name: user.name || '',
      email: user.email || '',
      password: '', // Don't send password
      active: user.isActive !== false, // Default to true if not set
      portals: user.portals || [], // Array of portal names
      role: user.role || 'user',
      employeeId: user.employeeId,
      department: user.department,
      company: user.company,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));

    // Log response details
    console.log(`[admin-users] Returning ${transformedUsers.length} users to frontend`);
    if (transformedUsers.length > 0) {
      console.log(`[admin-users] Sample user:`, {
        id: transformedUsers[0].id,
        name: transformedUsers[0].name,
        email: transformedUsers[0].email,
        employeeId: transformedUsers[0].employeeId
      });
    }

    res.json({
      success: true,
      users: transformedUsers,
      total: transformedUsers.length,
      filtered: dummyCount,
      database: LOGIN_DB_NAME, // Show which database was used
      collection: collectionName || 'users',
      message: `Fetched ${transformedUsers.length} users from ${collectionName || 'users'} collection in ${LOGIN_DB_NAME} database`
    });
  } catch (error) {
    console.error('[Admin Users GET Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch users'
    });
  }
});

// @route   GET /api/admin-users/:id
// @desc    Get single user by ID
// @access  Private/Admin
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const usersCol = await getUsersCollection();
    const user = await usersCol.findOne({ _id: new ObjectId(id) });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id?.toString(),
        _id: user._id?.toString(),
        name: user.name || '',
        email: user.email || '',
        password: '', // Don't send password
        active: user.isActive !== false,
        portals: user.portals || [],
        role: user.role || 'user',
        employeeId: user.employeeId,
        department: user.department,
        company: user.company
      }
    });
  } catch (error) {
    console.error('[Admin Users GET by ID Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch user'
    });
  }
});

// @route   POST /api/admin-users
// @desc    Create a new user
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')
router.post('/', async (req, res) => {
  try {
    const { name, email, password, active, portals, role } = req.body;
    const { company } = req.query; // Get company from query parameter

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollection(null, company);

    // Check if user already exists
    const existingUser = await usersCol.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user object
    const newUser = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      isActive: active !== false, // Default to true
      portals: portals || [], // Array of portal names
      role: role || 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert user
    const result = await usersCol.insertOne(newUser);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: result.insertedId.toString(),
        _id: result.insertedId.toString(),
        name: newUser.name,
        email: newUser.email,
        password: '', // Don't send password
        active: newUser.isActive,
        portals: newUser.portals,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('[Admin Users POST Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create user'
    });
  }
});

// @route   PUT /api/admin-users/:id
// @desc    Update a user
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, active, portals, role } = req.body;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollection(null, company);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Build update object
    const updateData = {
      updatedAt: new Date()
    };

    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }

      // Check if email is already taken by another user
      const emailUser = await usersCol.findOne({ 
        email: email.toLowerCase().trim(),
        _id: { $ne: new ObjectId(id) }
      });
      if (emailUser) {
        return res.status(400).json({
          success: false,
          error: 'Email already taken by another user'
        });
      }

      updateData.email = email.toLowerCase().trim();
    }
    if (password !== undefined && password !== '') {
      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters long'
        });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }
    if (active !== undefined) updateData.isActive = active;
    if (portals !== undefined) updateData.portals = portals; // Array of portal names
    if (role !== undefined) updateData.role = role;

    // Update user
    await usersCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    // Fetch updated user
    const updatedUser = await usersCol.findOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: updatedUser._id?.toString(),
        _id: updatedUser._id?.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        password: '', // Don't send password
        active: updatedUser.isActive !== false,
        portals: updatedUser.portals || [],
        role: updatedUser.role || 'user'
      }
    });
  } catch (error) {
    console.error('[Admin Users PUT Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user'
    });
  }
});

// @route   DELETE /api/admin-users/:id
// @desc    Delete a user (soft delete by setting isActive to false)
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollection(null, company);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Soft delete - set isActive to false
    await usersCol.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          isActive: false,
          updatedAt: new Date()
        } 
      }
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('[Admin Users DELETE Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete user'
    });
  }
});

// @route   PATCH /api/admin-users/:id/toggle-active
// @desc    Toggle user active status
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollection(null, company);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Toggle isActive
    const newActiveStatus = !existingUser.isActive;

    await usersCol.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          isActive: newActiveStatus,
          updatedAt: new Date()
        } 
      }
    );

    res.json({
      success: true,
      message: 'User status updated successfully',
      active: newActiveStatus
    });
  } catch (error) {
    console.error('[Admin Users Toggle Active Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to toggle user status'
    });
  }
});

// @route   GET /api/admin-users/debug/info
// @desc    Get debug information about users database
// @access  Private/Admin
router.get('/debug/info', async (req, res) => {
  try {
    const usersCol = await getUsersCollection();
    
    // Get total count
    const totalCount = await usersCol.countDocuments({});
    
    // Get sample users (first 5)
    const sampleUsers = await usersCol.find({}).limit(5).toArray();
    
    // Get users with employeeId
    const usersWithEmployeeId = await usersCol.countDocuments({ employeeId: { $exists: true, $ne: null } });
    
    // Get active users
    const activeUsers = await usersCol.countDocuments({ isActive: { $ne: false } });
    
    res.json({
      success: true,
      database: LOGIN_DB_NAME,
      collection: 'users',
      stats: {
        totalUsers: totalCount,
        usersWithEmployeeId: usersWithEmployeeId,
        activeUsers: activeUsers,
        inactiveUsers: totalCount - activeUsers
      },
      sampleUsers: sampleUsers.map(user => ({
        _id: user._id?.toString(),
        name: user.name,
        email: user.email,
        employeeId: user.employeeId,
        isActive: user.isActive,
        role: user.role
      }))
    });
  } catch (error) {
    console.error('[Admin Users Debug Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get debug info'
    });
  }
});

// @route   PATCH /api/admin-users/:id/portals
// @desc    Update user portals
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')
router.patch('/:id/portals', async (req, res) => {
  try {
    const { id } = req.params;
    const { portals } = req.body;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    if (!Array.isArray(portals)) {
      return res.status(400).json({
        success: false,
        error: 'Portals must be an array'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollection(null, company);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update portals
    await usersCol.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          portals: portals,
          updatedAt: new Date()
        } 
      }
    );

    // Fetch updated user
    const updatedUser = await usersCol.findOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: 'User portals updated successfully',
      user: {
        id: updatedUser._id?.toString(),
        _id: updatedUser._id?.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        active: updatedUser.isActive !== false,
        portals: updatedUser.portals || [],
        role: updatedUser.role || 'user'
      }
    });
  } catch (error) {
    console.error('[Admin Users Update Portals Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user portals'
    });
  }
});

module.exports = router;

