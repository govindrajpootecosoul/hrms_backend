const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Query = require('../models/Query');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/query-tracker/queries
// @desc    Get all queries with filters
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { 
      status, 
      assignedTo, 
      createdBy, 
      search,
      page = 1, 
      limit = 10 
    } = req.query;

    const query = {};

    // Check if user is admin (handle both 'admin' and 'superadmin' roles)
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';

    // If user is not admin, only show their queries or assigned queries
    if (!isAdmin) {
      // Convert user._id to ObjectId if it's not already
      let userId;
      try {
        if (req.user._id && req.user._id.toString) {
          // It's already an ObjectId or has toString method
          userId = req.user._id;
        } else if (typeof req.user._id === 'string' && mongoose.Types.ObjectId.isValid(req.user._id)) {
          userId = new mongoose.Types.ObjectId(req.user._id);
        } else {
          userId = req.user._id;
        }
      } catch (e) {
        console.warn('Error converting user._id to ObjectId:', e);
        userId = req.user._id;
      }
      
      query.$or = [
        { createdBy: userId },
        { assignedTo: userId }
      ];
    }

    if (status) query.status = status;
    if (assignedTo) {
      // Convert string ID to ObjectId if needed
      try {
        query.assignedTo = mongoose.Types.ObjectId.isValid(assignedTo) 
          ? new mongoose.Types.ObjectId(assignedTo) 
          : assignedTo;
      } catch (e) {
        query.assignedTo = assignedTo;
      }
    }
    if (createdBy) {
      // Convert string ID to ObjectId if needed
      try {
        query.createdBy = mongoose.Types.ObjectId.isValid(createdBy) 
          ? new mongoose.Types.ObjectId(createdBy) 
          : createdBy;
      } catch (e) {
        query.createdBy = createdBy;
      }
    }

    // Global search filter
    if (search) {
      const searchConditions = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerMobile: { $regex: search, $options: 'i' } },
        { queryType: { $regex: search, $options: 'i' } }
      ];
      
      // If we already have $or conditions (from access control), combine them properly
      if (query.$or && !isAdmin) {
        // For non-admin users, we need to combine access control with search
        // User must have access AND match search
        query.$and = [
          { $or: query.$or }, // Access control: user's queries or assigned queries
          { $or: searchConditions } // Search conditions
        ];
        delete query.$or;
      } else {
        // Admin users or no access control - just use search
        query.$or = searchConditions;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Debug: log the query in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Query Tracker - GET /queries - Query object:', JSON.stringify(query, null, 2));
      console.log('Query Tracker - User:', { id: req.user._id, role: req.user.role, email: req.user.email });
    }

    // Build query with proper error handling
    let queries;
    try {
      queries = await Query.find(query)
        .populate({
          path: 'createdBy',
          select: 'name email',
          model: 'QueryTrackerUser',
          strictPopulate: false // Don't throw error if user doesn't exist
        })
        .populate({
          path: 'assignedTo',
          select: 'name email',
          model: 'QueryTrackerUser',
          strictPopulate: false // Don't throw error if user doesn't exist
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
    } catch (populateError) {
      // If populate fails, try without populate
      console.warn('Populate failed, trying without:', populateError.message);
      queries = await Query.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
    }

    const total = await Query.countDocuments(query);

    res.json({
      queries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error in GET /queries:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/query-tracker/queries/:id
// @desc    Get single query
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const query = await Query.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email');

    if (!query) {
      return res.status(404).json({ message: 'Query not found' });
    }

    // Check access
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isAdmin && 
        query.createdBy._id.toString() !== req.user._id.toString() &&
        (!query.assignedTo || query.assignedTo._id.toString() !== req.user._id.toString())) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(query);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/query-tracker/queries
// @desc    Create a new query
// @access  Private
router.post('/', [
  body('platform').isIn(['Website', 'Email', 'Phone', 'WhatsApp']).withMessage('Invalid platform'),
  body('customerName').trim().notEmpty().withMessage('Customer name is required'),
  body('customerMobile').trim().notEmpty().withMessage('Customer mobile is required'),
  body('customerQuery').trim().notEmpty().withMessage('Customer query is required')
], auth, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const queryData = {
      ...req.body,
      createdBy: req.user._id
    };

    if (req.body.queryReceivedDate) {
      queryData.queryReceivedDate = new Date(req.body.queryReceivedDate);
    }
    if (req.body.agentCallingDate) {
      queryData.agentCallingDate = new Date(req.body.agentCallingDate);
    }

    const query = new Query(queryData);
    await query.save();

    const populatedQuery = await Query.findById(query._id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email');

    res.status(201).json(populatedQuery);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/query-tracker/queries/:id
// @desc    Update a query
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    const query = await Query.findById(req.params.id);

    if (!query) {
      return res.status(404).json({ message: 'Query not found' });
    }

    // Check access: user can only update their own queries, admin can update any
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isAdmin && 
        query.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    Object.assign(query, req.body);

    if (req.body.queryReceivedDate) {
      query.queryReceivedDate = new Date(req.body.queryReceivedDate);
    }
    if (req.body.agentCallingDate) {
      query.agentCallingDate = new Date(req.body.agentCallingDate);
    }

    await query.save();

    const populatedQuery = await Query.findById(query._id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email');

    res.json(populatedQuery);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/query-tracker/queries/:id
// @desc    Delete a query
// @access  Private/Admin
router.delete('/:id', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can delete queries' });
    }

    const query = await Query.findByIdAndDelete(req.params.id);

    if (!query) {
      return res.status(404).json({ message: 'Query not found' });
    }

    res.json({ message: 'Query deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

