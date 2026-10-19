const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { connectMongo, getUsersCollection, LOGIN_DB_NAME, initializeCompanyPortals } = require('../../../config/mongo');
const { config } = require('../../../config/app.config');
const { isGraphMailConfigured, sendMail } = require('../../../lib/microsoftGraphMail');
const {
  normalizeEmail,
  createAndStoreOtp,
  verifyOtpAndConsume,
  OTP_TTL_MS,
} = require('../../../lib/passwordResetOtp');

const ALLOWED_EMAIL_DOMAINS = ['@thrivebrands.ai', '@ecosoulhome.com', '@tathasstu.com'];
const ALLOWED_EMAIL_DOMAIN_ERROR =
  'Invalid email domain. Email must end with @thrivebrands.ai, @ecosoulhome.com, or @tathasstu.com';

function isAllowedLoginEmail(email) {
  const emailLower = String(email || '').trim().toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.some((domain) => emailLower.endsWith(domain));
}

// Signup endpoint

async function signup(req, res) {
  try {
    const { name, email, phone, role, password, employeeId, company, department } = req.body;

    // Validation
    if (!name || !email || !phone || !role || !password) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    // Validate role
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be either "admin" or "user"'
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

    // Ensure login DB connected
    await connectMongo(LOGIN_DB_NAME);
    const usersCol = await getUsersCollection();
    const existingUser = await usersCol.findOne({
      email: { $regex: new RegExp(`^${String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}$`, 'i') },
    });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const now = new Date();
    const doc = {
      name,
      email,
      phone: phone || '',
      password: hashedPassword,
      role,
      employeeId: employeeId || '',
      company: company || '',
      department: department || '',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      hasCredentialAccess: true,
      hasSubscriptionAccess: true,
    };
    const result = await usersCol.insertOne(doc);

    if (doc.company) {
      try {
        await initializeCompanyPortals(doc.company);
      } catch (e) {
        console.warn('[signup] portal collections init skipped:', e.message);
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.insertedId.toString(), email, role, company: doc.company },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      token,
      user: {
        id: result.insertedId.toString(),
        name,
        email,
        phone,
        role,
        company: doc.company,
        employeeId: doc.employeeId,
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// Login endpoint

async function login(req, res) {
  try {
    const { email, password } = req.body;

    console.log('Login attempt for email:', email);

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (!isAllowedLoginEmail(email)) {
      return res.status(400).json({
        success: false,
        error: ALLOWED_EMAIL_DOMAIN_ERROR
      });
    }

    await connectMongo(LOGIN_DB_NAME);

    const usersCol = await getUsersCollection();
    const usersNs = `${LOGIN_DB_NAME}.${config.mongodb.usersCollection}`;
    console.log(`[login] Querying ${usersNs}, email: ${email}`);
    
    // Use case-insensitive email matching
    const user = await usersCol.findOne({ email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });

    if (!user) {
      console.log(`[login] User not found with email: ${email}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    console.log(`[login] User found: ${user.email}, employeeId: ${user.employeeId || 'N/A'}`);

    // Check if user is active
    if (user.isActive === false) {
      console.log(`[login] User account is inactive for email: ${email}`);
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Please contact your administrator to reactivate your account.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      console.log(`[login] Password mismatch for email: ${email}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id?.toString(),
        email: user.email,
        role: user.role,
        company: user.company,
      },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '7d' }
    );

    // Auto-initialize required portal collections inside the company DB (on the company Mongo server)
    if (user.company) {
      try {
        await initializeCompanyPortals(user.company);
      } catch (e) {
        console.warn('[login] portal init skipped/failed:', e.message);
      }
    }

    console.log('Login successful for user:', user.email);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id?.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        emp_code: user.emp_code || null,
        department: user.department,
        company: user.company,
        isActive: user.isActive,
        avatar: user.avatar,
        portals: user.portals || [] // Include portals array
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    
    // Send proper error response
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

// Verify token endpoint

async function verify(req, res) {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key-change-in-production'
    );

    await connectMongo(LOGIN_DB_NAME);

    const userEmail = decoded.email;
    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token: email not found'
      });
    }

    const usersCol = await getUsersCollection();
    console.log(`[verify] Querying ${LOGIN_DB_NAME}.${config.mongodb.usersCollection}, email: ${userEmail}`);

    const user = await usersCol.findOne({ _id: new ObjectId(decoded.userId) });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if user is active
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Please contact your administrator to reactivate your account.'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id?.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        emp_code: user.emp_code || null,
        department: user.department,
        company: user.company,
        isActive: user.isActive,
        avatar: user.avatar,
        portals: user.portals || [] // Include portals array
      }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!isAllowedLoginEmail(email)) {
      return res.status(400).json({
        success: false,
        error: ALLOWED_EMAIL_DOMAIN_ERROR,
      });
    }

    if (!isGraphMailConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Password reset email is not configured. Please contact your administrator.',
      });
    }

    const normalized = normalizeEmail(email);
    await connectMongo(LOGIN_DB_NAME);
    const usersCol = await getUsersCollection();
    const user = await usersCol.findOne({
      email: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });

    // Always return the same message to avoid email enumeration
    const genericSuccess = {
      success: true,
      message: 'If an account exists for this email, an OTP has been sent.',
    };

    if (!user || user.isActive === false) {
      return res.json(genericSuccess);
    }

    const { otp } = await createAndStoreOtp(normalized);
    const expiryMinutes = Math.round(OTP_TTL_MS / 60000);

    await sendMail({
      to: user.email,
      subject: 'Vectorlytics Portal — Password reset OTP',
      html: `
        <p>Hello${user.name ? ` ${user.name}` : ''},</p>
        <p>Your one-time password (OTP) to reset your Vectorlytics Portal password is:</p>
        <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${otp}</p>
        <p>This OTP expires in ${expiryMinutes} minutes. If you did not request this, you can ignore this email.</p>
        <p>— Vectorlytics Portal</p>
      `,
    });

    return res.json(genericSuccess);
  } catch (error) {
    console.error('[forgotPassword]', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to send password reset OTP',
    });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, otp, password, confirmPassword } = req.body;

    if (!email || !otp || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email, OTP, and new password are required',
      });
    }

    if (!isAllowedLoginEmail(email)) {
      return res.status(400).json({
        success: false,
        error: ALLOWED_EMAIL_DOMAIN_ERROR,
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long',
      });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match',
      });
    }

    const normalized = normalizeEmail(email);
    await verifyOtpAndConsume(normalized, String(otp).trim());

    await connectMongo(LOGIN_DB_NAME);
    const usersCol = await getUsersCollection();
    const user = await usersCol.findOne({
      email: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });

    if (!user) {
      return res.status(400).json({ success: false, error: 'User not found' });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Please contact your administrator.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCol.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );

    return res.json({
      success: true,
      message: 'Password updated successfully. You can now sign in with your new password.',
    });
  } catch (error) {
    console.error('[resetPassword]', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to reset password',
    });
  }
}

module.exports = { signup, login, verify, forgotPassword, resetPassword };
