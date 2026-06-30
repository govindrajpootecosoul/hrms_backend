/**
 * Send email via Microsoft Graph API (client credentials flow).
 * Requires Azure app registration with Mail.Send application permission.
 */

let cachedToken = null;
let tokenExpiresAt = 0;

function getGraphConfig() {
  const tenantId = process.env.TENANT_ID && String(process.env.TENANT_ID).trim();
  const clientId = process.env.CLIENT_ID && String(process.env.CLIENT_ID).trim();
  const clientSecret = process.env.CLIENT_SECRET && String(process.env.CLIENT_SECRET).trim();
  const senderEmail = process.env.ORGANIZER_EMAIL && String(process.env.ORGANIZER_EMAIL).trim();

  if (!tenantId || !clientId || !clientSecret || !senderEmail) {
    return null;
  }

  return { tenantId, clientId, clientSecret, senderEmail };
}

function isGraphMailConfigured() {
  return Boolean(getGraphConfig());
}

async function getAccessToken() {
  const cfg = getGraphConfig();
  if (!cfg) {
    throw new Error('Microsoft Graph mail is not configured (TENANT_ID, CLIENT_ID, CLIENT_SECRET, ORGANIZER_EMAIL)');
  }

  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error_description || data.error || res.statusText;
    throw new Error(`Microsoft token request failed: ${detail}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

function normalizeEmailList(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(
    new Set(
      raw
        .map((v) => String(v || '').trim().toLowerCase())
        .filter((v) => v && v.includes('@'))
    )
  );
}

function toGraphRecipients(emails) {
  return normalizeEmailList(emails).map((address) => ({
    emailAddress: { address },
  }));
}

/**
 * @param {{ to: string|string[], cc?: string|string[], subject: string, html: string, text?: string }} opts
 */
async function sendMail({ to, cc, subject, html, text }) {
  const cfg = getGraphConfig();
  if (!cfg) {
    throw new Error('Microsoft Graph mail is not configured');
  }

  const toRecipients = toGraphRecipients(to);
  if (!toRecipients.length) {
    throw new Error('At least one TO recipient is required');
  }

  const token = await getAccessToken();
  const content = html || text || '';
  const contentType = html ? 'HTML' : 'Text';

  const ccRecipients = toGraphRecipients(cc);

  const payload = {
    message: {
      subject,
      body: { contentType, content },
      toRecipients,
      ...(ccRecipients.length ? { ccRecipients } : {}),
    },
    saveToSentItems: true,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.senderEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data.error?.message || res.statusText;
    throw new Error(`Microsoft Graph sendMail failed: ${detail}`);
  }

  return { success: true };
}

module.exports = {
  getGraphConfig,
  isGraphMailConfigured,
  getAccessToken,
  sendMail,
  normalizeEmailList,
};
