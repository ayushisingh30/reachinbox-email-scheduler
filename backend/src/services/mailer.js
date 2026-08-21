'use strict';

const nodemailer = require('nodemailer');
const { resolveCredential } = require('./credentials');
const { logger } = require('../utils/logger');

const log = logger.child('mailer');
const transports = new Map();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain-text body -> safe HTML. Recipient-supplied data is never interpolated raw. */
function toHtml(body) {
  return escapeHtml(body).replace(/\r?\n/g, '<br>');
}

function getTransport(credentialRef) {
  const credential = resolveCredential(credentialRef);
  const cacheKey = `${credential.ref}:${credential.host}:${credential.port}:${credential.user}`;

  if (transports.has(cacheKey)) return transports.get(cacheKey);

  const transport = nodemailer.createTransport({
    host: credential.host,
    port: credential.port,
    secure: credential.port === 465,
    auth: { user: credential.user, pass: credential.password },
    pool: true,
    maxConnections: 3,
    maxMessages: 200,
  });

  transports.set(cacheKey, transport);
  return transport;
}

/**
 * Really sends through SMTP (Ethereal). There is no simulated success path:
 * a missing credential throws, and a rejected message rejects.
 */
async function sendEmail({ sender, to, subject, body }) {
  const transport = getTransport(sender.credentialRef);

  const info = await transport.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to,
    subject,
    text: body,
    html: toHtml(body),
  });

  // Ethereal returns a browsable copy of the message; other providers do not.
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;

  return {
    messageId: info.messageId || null,
    previewUrl: previewUrl === false ? null : previewUrl,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
}

/** Used by startup checks so a bad credential surfaces before any job runs. */
async function verifyTransport(credentialRef) {
  await getTransport(credentialRef).verify();
  return true;
}

/**
 * 5xx replies and auth failures will not succeed on a retry; 4xx replies and
 * socket errors usually will. Getting this wrong either burns retries or
 * marks a recoverable failure as permanent, so it is classified explicitly.
 */
function isPermanentSmtpError(err) {
  const code = err && (err.responseCode || err.code);
  if (typeof code === 'number') return code >= 500 && code < 600;
  if (code === 'EAUTH' || code === 'EENVELOPE') return true;
  return false;
}

async function closeTransports() {
  for (const transport of transports.values()) {
    try {
      transport.close();
    } catch (err) {
      log.warn(`Failed to close SMTP transport: ${err.message}`);
    }
  }
  transports.clear();
}

module.exports = { sendEmail, verifyTransport, isPermanentSmtpError, closeTransports, toHtml };
