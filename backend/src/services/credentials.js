'use strict';

const { config } = require('../config');

const DEFAULT_REF = 'ETHEREAL_DEFAULT';

/**
 * SMTP secrets live in the environment, never in PostgreSQL. A Sender row
 * stores only a `credentialRef`, which is resolved here.
 *
 * The default entry comes from ETHEREAL_*. Extra senders are added by defining
 * SMTP_CRED_<REF>_USER / _PASSWORD (and optionally _HOST / _PORT), e.g.
 *   SMTP_CRED_TEAM_B_USER=...
 *   SMTP_CRED_TEAM_B_PASSWORD=...
 * and pointing a Sender at credentialRef "TEAM_B".
 */
function resolveCredential(credentialRef = DEFAULT_REF) {
  if (credentialRef === DEFAULT_REF) {
    if (!config.smtp.user || !config.smtp.password) {
      throw new Error(
        'SMTP is not configured: set ETHEREAL_USER and ETHEREAL_PASSWORD in the environment. ' +
          'Emails are never reported as sent without a real SMTP delivery.'
      );
    }
    return {
      ref: DEFAULT_REF,
      host: config.smtp.host,
      port: config.smtp.port,
      user: config.smtp.user,
      password: config.smtp.password,
    };
  }

  const key = String(credentialRef).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const user = process.env[`SMTP_CRED_${key}_USER`];
  const password = process.env[`SMTP_CRED_${key}_PASSWORD`];

  if (!user || !password) {
    throw new Error(
      `SMTP credential "${credentialRef}" is not configured: expected SMTP_CRED_${key}_USER and ` +
        `SMTP_CRED_${key}_PASSWORD in the environment.`
    );
  }

  return {
    ref: credentialRef,
    host: process.env[`SMTP_CRED_${key}_HOST`] || config.smtp.host,
    port: Number.parseInt(process.env[`SMTP_CRED_${key}_PORT`] || '', 10) || config.smtp.port,
    user,
    password,
  };
}

function hasCredential(credentialRef = DEFAULT_REF) {
  try {
    resolveCredential(credentialRef);
    return true;
  } catch {
    return false;
  }
}

module.exports = { DEFAULT_REF, resolveCredential, hasCredential };
