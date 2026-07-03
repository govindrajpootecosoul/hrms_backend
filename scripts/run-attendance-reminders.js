/**
 * Send morning check-in or evening check-out reminder emails to active employees.
 *
 * Usage:
 *   node scripts/run-attendance-reminders.js --slot=morning
 *   node scripts/run-attendance-reminders.js --slot=evening
 *   node scripts/run-attendance-reminders.js --slot=morning --dry-run
 *   node scripts/run-attendance-reminders.js --slot=evening --force
 */
require('dotenv').config();
const { connectMongo, LOGIN_DB_NAME } = require('../config/mongo');
const {
  ensureReminderLogIndexes,
  sendAttendanceReminders,
  sendTestReminderEmail,
} = require('../portals/employee/services/attendanceReminderService');

function parseArgs(argv) {
  const out = { slot: null, dryRun: false, force: false, dateYmd: null, onlyEmail: null, testEmail: null, testName: null };
  for (const arg of argv) {
    if (arg.startsWith('--slot=')) out.slot = arg.split('=')[1];
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--force') out.force = true;
    else if (arg.startsWith('--date=')) out.dateYmd = arg.split('=')[1];
    else if (arg.startsWith('--only-email=')) out.onlyEmail = arg.split('=')[1];
    else if (arg.startsWith('--test-email=')) out.testEmail = arg.split('=')[1];
    else if (arg.startsWith('--test-name=')) out.testName = arg.split('=')[1];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.testEmail) {
    const slot = args.slot && ['morning', 'evening'].includes(args.slot) ? args.slot : 'morning';
    await connectMongo(LOGIN_DB_NAME);
    const result = await sendTestReminderEmail({
      email: args.testEmail,
      slot,
      name: args.testName,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (!args.slot || !['morning', 'evening'].includes(args.slot)) {
    console.error(
      'Usage:\n' +
        '  node scripts/run-attendance-reminders.js --slot=morning|evening [--dry-run] [--force] [--date=YYYY-MM-DD] [--only-email=user@company.com]\n' +
        '  node scripts/run-attendance-reminders.js --test-email=user@company.com [--slot=morning|evening] [--test-name=Name]'
    );
    process.exit(1);
  }

  await connectMongo(LOGIN_DB_NAME);
  await ensureReminderLogIndexes();
  const result = await sendAttendanceReminders({
    slot: args.slot,
    dateYmd: args.dateYmd || undefined,
    dryRun: args.dryRun,
    force: args.force,
    onlyEmail: args.onlyEmail,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
