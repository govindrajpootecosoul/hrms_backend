const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { connectMongo, LOGIN_DB_NAME } = require('../config/mongo');

const OTP_COLLECTION = 'password_reset_otps';
const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

let indexesEnsured = false;

async function getOtpCollection() {
  const db = await connectMongo(LOGIN_DB_NAME);
  const col = db.collection(OTP_COLLECTION);

  if (!indexesEnsured) {
    indexesEnsured = true;
    await col.createIndex({ email: 1 }, { unique: true }).catch(() => {});
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  }

  return col;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtp() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

async function createAndStoreOtp(email) {
  const normalized = normalizeEmail(email);
  const col = await getOtpCollection();
  const now = new Date();
  const existing = await col.findOne({ email: normalized });

  if (existing) {
    const windowStart = existing.sendWindowStart ? new Date(existing.sendWindowStart) : null;
    const inWindow = windowStart && now - windowStart < SEND_WINDOW_MS;
    const sendCount = inWindow ? (existing.sendCount || 0) : 0;

    if (sendCount >= MAX_SENDS_PER_WINDOW) {
      const err = new Error('Too many OTP requests. Please try again after 15 minutes.');
      err.statusCode = 429;
      throw err;
    }
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  const windowStart = existing?.sendWindowStart && now - new Date(existing.sendWindowStart) < SEND_WINDOW_MS
    ? existing.sendWindowStart
    : now;
  const sendCount = existing?.sendWindowStart && now - new Date(existing.sendWindowStart) < SEND_WINDOW_MS
    ? (existing.sendCount || 0) + 1
    : 1;

  await col.updateOne(
    { email: normalized },
    {
      $set: {
        email: normalized,
        otpHash,
        expiresAt,
        verifyAttempts: 0,
        sendCount,
        sendWindowStart: windowStart,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return { otp, expiresAt };
}

async function verifyOtpAndConsume(email, otp) {
  const normalized = normalizeEmail(email);
  const col = await getOtpCollection();
  const record = await col.findOne({ email: normalized });

  if (!record) {
    const err = new Error('Invalid or expired OTP');
    err.statusCode = 400;
    throw err;
  }

  if (new Date(record.expiresAt) < new Date()) {
    await col.deleteOne({ email: normalized });
    const err = new Error('OTP has expired. Please request a new one.');
    err.statusCode = 400;
    throw err;
  }

  if ((record.verifyAttempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    await col.deleteOne({ email: normalized });
    const err = new Error('Too many failed attempts. Please request a new OTP.');
    err.statusCode = 400;
    throw err;
  }

  const match = await bcrypt.compare(String(otp), record.otpHash);
  if (!match) {
    await col.updateOne(
      { email: normalized },
      { $inc: { verifyAttempts: 1 }, $set: { updatedAt: new Date() } }
    );
    const err = new Error('Invalid OTP');
    err.statusCode = 400;
    throw err;
  }

  await col.deleteOne({ email: normalized });
  return true;
}

module.exports = {
  OTP_TTL_MS,
  normalizeEmail,
  createAndStoreOtp,
  verifyOtpAndConsume,
};
