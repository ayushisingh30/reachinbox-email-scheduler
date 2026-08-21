'use strict';

const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { config } = require('../config');
const { AppError } = require('../utils/errors');

let client = null;

/**
 * Real Google OAuth 2.0 authorization-code flow, handled entirely on the
 * server. The client secret never leaves this process and is never sent to the
 * browser; the frontend only ever follows a redirect.
 */
function getClient() {
  if (!client) {
    client = new OAuth2Client(
      config.google.clientId,
      config.google.clientSecret,
      config.google.callbackUrl
    );
  }
  return client;
}

function createState() {
  return crypto.randomBytes(24).toString('hex');
}

function buildAuthUrl(state) {
  return getClient().generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    include_granted_scopes: true,
    prompt: 'select_account',
    state,
  });
}

/**
 * Exchanges the one-time code for tokens and verifies the returned id_token
 * against our own client id, so a token minted for a different app is rejected.
 */
async function exchangeCodeForProfile(code) {
  const oauthClient = getClient();

  let tokens;
  try {
    ({ tokens } = await oauthClient.getToken(code));
  } catch (err) {
    throw new AppError(
      `Google rejected the authorization code: ${err.message}. ` +
        'Confirm GOOGLE_CALLBACK_URL is listed as an authorized redirect URI.',
      401
    );
  }

  if (!tokens || !tokens.id_token) {
    throw new AppError('Google did not return an identity token', 401);
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.google.clientId,
  });

  const payload = ticket.getPayload();

  if (!payload || !payload.sub || !payload.email) {
    throw new AppError('Google identity token is missing required claims', 401);
  }
  if (payload.email_verified === false) {
    throw new AppError('This Google account does not have a verified email address', 403);
  }

  return {
    googleId: payload.sub,
    email: String(payload.email).toLowerCase(),
    name: payload.name || payload.given_name || payload.email,
    avatarUrl: payload.picture || null,
  };
}

module.exports = { buildAuthUrl, createState, exchangeCodeForProfile, getClient };
