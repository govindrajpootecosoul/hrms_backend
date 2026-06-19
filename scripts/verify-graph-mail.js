#!/usr/bin/env node
/**
 * Verify Microsoft Graph mail config (token + optional test send).
 * Usage:
 *   node scripts/verify-graph-mail.js
 *   node scripts/verify-graph-mail.js --send admin@thrivebrands.ai
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { isGraphMailConfigured, getAccessToken, sendMail } = require('../lib/microsoftGraphMail');

async function main() {
  const sendTo = process.argv.includes('--send')
    ? process.argv[process.argv.indexOf('--send') + 1]
    : null;

  if (!isGraphMailConfigured()) {
    console.error('FAIL: Microsoft Graph is not configured.');
    console.error('Set TENANT_ID, CLIENT_ID, CLIENT_SECRET, ORGANIZER_EMAIL in hrms_backend/.env');
    process.exit(1);
  }

  console.log('OK: Graph env vars present');
  console.log('ORGANIZER_EMAIL:', process.env.ORGANIZER_EMAIL);

  try {
    const token = await getAccessToken();
    console.log('OK: Access token acquired (' + String(token).slice(0, 12) + '...)');
  } catch (e) {
    console.error('FAIL: Token request:', e.message);
    process.exit(1);
  }

  if (sendTo) {
    try {
      await sendMail({
        to: sendTo,
        subject: 'Vectorlytics Portal — Graph mail test',
        html: '<p>If you received this, Microsoft Graph mail is working.</p>',
      });
      console.log('OK: Test email sent to', sendTo);
    } catch (e) {
      console.error('FAIL: sendMail:', e.message);
      process.exit(1);
    }
  } else {
    console.log('Tip: run with --send your@email.com to send a test message');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
