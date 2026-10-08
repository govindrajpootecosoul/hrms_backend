/**
 * Disable check-in/check-out reminder emails for one or more addresses.
 * Use this for bounced / left employees who still have isActive:true or
 * a company string that previously matched the loose Ecosoul regex.
 *
 * Usage:
 *   node scripts/disable-attendance-reminder.js --email=jay.gope@ecosoulhome.com
 *   node scripts/disable-attendance-reminder.js --email=a@x.com --email=b@y.com
 *   node scripts/disable-attendance-reminder.js --email=jay.gope@ecosoulhome.com --deactivate
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { config } = require('../config/app.config');

function parseArgs(argv) {
  const emails = [];
  let deactivate = false;
  for (const arg of argv) {
    if (arg.startsWith('--email=')) emails.push(arg.split('=').slice(1).join('=').trim().toLowerCase());
    else if (arg === '--deactivate') deactivate = true;
  }
  return { emails: emails.filter(Boolean), deactivate };
}

async function main() {
  const { emails, deactivate } = parseArgs(process.argv.slice(2));
  if (!emails.length) {
    console.error(
      'Usage: node scripts/disable-attendance-reminder.js --email=user@company.com [--deactivate]'
    );
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is required in .env');
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(config.mongodb.loginDbName);
  const col = db.collection(config.mongodb.usersCollection);

  for (const email of emails) {
    const filter = { email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };
    const before = await col.find(filter).project({
      name: 1,
      email: 1,
      company: 1,
      isActive: 1,
      attendanceReminderEmails: 1,
      employeeId: 1,
    }).toArray();

    if (!before.length) {
      console.log(`[miss] no employee_details row for ${email}`);
      continue;
    }

    const update = {
      $set: {
        attendanceReminderEmails: false,
        updatedAt: new Date(),
      },
    };
    if (deactivate) {
      update.$set.isActive = false;
    }

    const result = await col.updateMany(filter, update);
    console.log(`[ok] ${email}: matched=${before.length}, modified=${result.modifiedCount}`);
    console.log(JSON.stringify(before, null, 2));
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
