/**
 * One-off: create manager notifications for pending leave requests that predate notification fixes.
 * Usage: node scripts/backfill-leave-notifications.js
 */
require('dotenv').config();
const { connectMongo, LOGIN_DB_NAME } = require('../config/mongo');
const { normalizeCompany } = require('../portals/hrms/utils/hrmsContext');
const { getEmployeePortalDb } = require('../config/mongo');
const { triggerRequestNotification } = require('../portals/employee/services/notificationService');

async function main() {
  await connectMongo(LOGIN_DB_NAME);

  for (const companyLabel of ['Ecosoul Home', 'Thrive']) {
    const company = normalizeCompany(companyLabel);
    const db = await getEmployeePortalDb(company);
    const col = db.collection('attendance_requests');
    const pending = await col.find({ type: 'time-off', status: 'pending' }).sort({ submittedAt: -1 }).limit(50).toArray();

    console.log(`[${company}] pending leave requests:`, pending.length);

    for (const req of pending) {
      await triggerRequestNotification({
        company,
        requestDoc: req,
        requestId: req._id,
      });
    }
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
