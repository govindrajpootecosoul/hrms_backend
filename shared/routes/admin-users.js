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

// @route   GET /api/admin-users
// @desc    Get all users for admin portal
// @access  Private/Admin
router.get('/', async (req, res) => {
  try {
    const usersCol = await getUsersCollection();
    const users = await usersCol.find({}).toArray();
    
    // Transform users to include portals array (default to empty if not present)
    const transformedUsers = users.map(user => ({
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

    res.json({
      success: true,
      users: transformedUsers
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
router.post('/', async (req, res) => {
  try {
    const { name, email, password, active, portals, role } = req.body;

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

    const usersCol = await getUsersCollection();

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
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, active, portals, role } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const usersCol = await getUsersCollection();

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
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const usersCol = await getUsersCollection();

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
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const usersCol = await getUsersCollection();

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

// @route   PATCH /api/admin-users/:id/portals
// @desc    Update user portals
// @access  Private/Admin
router.patch('/:id/portals', async (req, res) => {
  try {
    const { id } = req.params;
    const { portals } = req.body;

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

    const usersCol = await getUsersCollection();

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

