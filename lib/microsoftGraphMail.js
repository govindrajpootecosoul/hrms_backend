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

function buildMessageBody({ to, cc, subject, html, text, internetMessageHeaders }) {
  const toRecipients = toGraphRecipients(to);
  if (!toRecipients.length) {
    throw new Error('At least one TO recipient is required');
  }

  const content = html || text || '';
  const contentType = html ? 'HTML' : 'Text';
  const ccRecipients = toGraphRecipients(cc);
  const headers = Array.isArray(internetMessageHeaders)
    ? internetMessageHeaders.filter((h) => h?.name && h?.value)
    : [];

  return {
    subject,
    body: { contentType, content },
    toRecipients,
    ...(ccRecipients.length ? { ccRecipients } : {}),
    ...(headers.length ? { internetMessageHeaders: headers } : {}),
  };
}

function buildReplyHeaders(inReplyToMessageId) {
  const id = String(inReplyToMessageId || '').trim();
  if (!id) return [];
  return [
    { name: 'In-Reply-To', value: id },
    { name: 'References', value: id },
  ];
}

/**
 * @param {{ to: string|string[], cc?: string|string[], subject: string, html: string, text?: string, internetMessageHeaders?: Array<{name:string,value:string}> }} opts
 */
async function sendMail({ to, cc, subject, html, text, internetMessageHeaders }) {
  const cfg = getGraphConfig();
  if (!cfg) {
    throw new Error('Microsoft Graph mail is not configured');
  }

  const token = await getAccessToken();
  const payload = {
    message: buildMessageBody({ to, cc, subject, html, text, internetMessageHeaders }),
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

/**
 * Create and send a message, returning Graph message id for threading (reply/replyAll).
 * @param {{ to: string|string[], cc?: string|string[], subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ success: true, messageId: string, conversationId?: string }>}
 */
async function sendMailWithId({ to, cc, subject, html, text }) {
  const cfg = getGraphConfig();
  if (!cfg) {
    throw new Error('Microsoft Graph mail is not configured');
  }

  const token = await getAccessToken();
  const sender = encodeURIComponent(cfg.senderEmail);
  const messageBody = buildMessageBody({ to, cc, subject, html, text });

  const createRes = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messageBody),
  });

  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const detail = created.error?.message || createRes.statusText;
    throw new Error(`Microsoft Graph create message failed: ${detail}`);
  }

  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${sender}/messages/${created.id}/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!sendRes.ok) {
    const data = await sendRes.json().catch(() => ({}));
    const detail = data.error?.message || sendRes.statusText;
    throw new Error(`Microsoft Graph send message failed: ${detail}`);
  }

  return {
    success: true,
    messageId: created.id,
    conversationId: created.conversationId || null,
  };
}

/**
 * Reply-all on an existing sent message so HR/manager/applicant stay in the same thread.
 * @param {{ messageId: string, html: string }} opts
 */
async function replyAllToMessage({ messageId, html }) {
  const cfg = getGraphConfig();
  if (!cfg) {
    throw new Error('Microsoft Graph mail is not configured');
  }
  if (!messageId) {
    throw new Error('messageId is required for replyAll');
  }

  const token = await getAccessToken();
  const sender = encodeURIComponent(cfg.senderEmail);
  const base = `https://graph.microsoft.com/v1.0/users/${sender}/messages/${messageId}`;

  const createRes = await fetch(`${base}/createReplyAll`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const draft = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const detail = draft.error?.message || createRes.statusText;
    throw new Error(`Microsoft Graph createReplyAll failed: ${detail}`);
  }

  const patchRes = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/messages/${draft.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: { contentType: 'HTML', content: html },
    }),
  });

  if (!patchRes.ok) {
    const data = await patchRes.json().catch(() => ({}));
    const detail = data.error?.message || patchRes.statusText;
    throw new Error(`Microsoft Graph update reply draft failed: ${detail}`);
  }

  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${sender}/messages/${draft.id}/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!sendRes.ok) {
    const data = await sendRes.json().catch(() => ({}));
    const detail = data.error?.message || sendRes.statusText;
    throw new Error(`Microsoft Graph send reply failed: ${detail}`);
  }

  return { success: true };
}

module.exports = {
  getGraphConfig,
  isGraphMailConfigured,
  getAccessToken,
  sendMail,
  sendMailWithId,
  replyAllToMessage,
  buildReplyHeaders,
  normalizeEmailList,
};
