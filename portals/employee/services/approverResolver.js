const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { getUsersCollection } = require('../../../config/mongo');
const { escapeRe } = require('../../hrms/utils/hrmsContext');

function decodeAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
  } catch {
    return null;
  }
}

function isGenericApproverName(name) {
  const n = String(name || '').trim().toLowerCase();
  return !n || n === 'admin' || n === 'hr' || n === 'hr/admin' || n === 'manager/hr' || n === 'manager';
}

async function findUserById(usersCol, userId) {
  const id = String(userId || '').trim();
  if (!id || !ObjectId.isValid(id)) return null;
  return usersCol.findOne({ _id: new ObjectId(id) });
}

async function findUserByEmail(usersCol, email) {
  const em = String(email || '').trim();
  if (!em) return null;
  return usersCol.findOne({ email: { $regex: new RegExp(`^${escapeRe(em)}$`, 'i') } });
}

function inferRoleHint(user, decoded, explicitHint) {
  if (explicitHint) return explicitHint;
  const role = String(user?.role || decoded?.role || '').toLowerCase();
  if (role === 'admin' || role === 'superadmin') return 'hr';
  return 'manager';
}

/**
 * Resolve the logged-in approver/rejector display name from JWT + users collection.
 */
async function resolveActorFromRequest(req, { nameFromBody, userIdFromBody, roleHint } = {}) {
  const decoded = decodeAuth(req);
  const usersCol = await getUsersCollection();

  const candidateIds = [userIdFromBody, decoded?.userId, decoded?.id].filter(Boolean).map(String);
  for (const id of candidateIds) {
    const user = await findUserById(usersCol, id);
    if (user?.name) {
      return {
        userId: user._id.toString(),
        name: String(user.name).trim(),
        roleHint: inferRoleHint(user, decoded, roleHint),
      };
    }
  }

  if (decoded?.email) {
    const user = await findUserByEmail(usersCol, decoded.email);
    if (user?.name) {
      return {
        userId: user._id.toString(),
        name: String(user.name).trim(),
        roleHint: inferRoleHint(user, decoded, roleHint),
      };
    }
  }

  if (nameFromBody && !isGenericApproverName(nameFromBody)) {
    return {
      userId: candidateIds[0] || null,
      name: String(nameFromBody).trim(),
      roleHint: roleHint || 'manager',
    };
  }

  return {
    userId: candidateIds[0] || null,
    name: decoded?.email || 'HR',
    roleHint: roleHint || 'hr',
  };
}

async function resolveActorByUserId(userId, nameFromBody, roleHint) {
  const usersCol = await getUsersCollection();
  const user = await findUserById(usersCol, userId);
  if (user?.name) {
    return {
      userId: user._id.toString(),
      name: String(user.name).trim(),
      roleHint: roleHint || inferRoleHint(user, null, null),
    };
  }
  if (nameFromBody && !isGenericApproverName(nameFromBody)) {
    return { userId: String(userId), name: String(nameFromBody).trim(), roleHint: roleHint || 'manager' };
  }
  return { userId: String(userId || ''), name: 'Department Manager', roleHint: roleHint || 'manager' };
}

module.exports = {
  resolveActorFromRequest,
  resolveActorByUserId,
  isGenericApproverName,
};
