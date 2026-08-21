'use strict';

const { prisma } = require('../db/prisma');
const { config } = require('../config');
const { buildAuthUrl, createState, exchangeCodeForProfile } = require('../auth/googleOAuth');
const {
  issueSession,
  clearSession,
  setStateCookie,
  readStateCookie,
  clearStateCookie,
} = require('../auth/session');
const { ensureDefaultSender } = require('../services/senderService');
const { asyncHandler, unauthorized } = require('../utils/errors');
const { ok } = require('../utils/response');
const { logger } = require('../utils/logger');

const log = logger.child('auth');

function redirectToFrontend(res, path, params = {}) {
  const url = new URL(config.frontendUrl + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return res.redirect(url.toString());
}

/** GET /auth/google - starts the authorization-code flow. */
const startGoogleLogin = asyncHandler(async (req, res) => {
  const state = createState();
  setStateCookie(res, state);
  res.redirect(buildAuthUrl(state));
});

/**
 * GET /auth/google/callback - Google redirects the browser back here with a
 * one-time code. The exchange happens server side, a session cookie is set, and
 * the browser is sent on to the dashboard. No token is ever put in the URL.
 */
const googleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    log.warn('Google returned an error', { error: String(error) });
    return redirectToFrontend(res, '/login', { error: 'google_denied' });
  }

  const expectedState = readStateCookie(req);
  clearStateCookie(res);

  // Without this check a third party could complete a login on the user's
  // behalf (OAuth CSRF).
  if (!state || !expectedState || String(state) !== String(expectedState)) {
    log.warn('OAuth state mismatch');
    return redirectToFrontend(res, '/login', { error: 'state_mismatch' });
  }

  if (!code) return redirectToFrontend(res, '/login', { error: 'missing_code' });

  const profile = await exchangeCodeForProfile(String(code));

  const user = await prisma.user.upsert({
    where: { googleId: profile.googleId },
    update: { name: profile.name, avatarUrl: profile.avatarUrl, email: profile.email },
    create: {
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    },
  });

  // Give brand new accounts a usable "from" identity straight away.
  await ensureDefaultSender(user.id).catch((err) =>
    log.warn(`Could not provision default sender: ${err.message}`)
  );

  issueSession(res, user);
  log.info('User signed in', { userId: user.id });

  return redirectToFrontend(res, '/dashboard');
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  if (!req.user) throw unauthorized('Not signed in');
  return ok(res, { user: req.user });
});

/** POST /api/auth/logout */
const logout = asyncHandler(async (req, res) => {
  clearSession(res);
  if (req.user) log.info('User signed out', { userId: req.user.id });
  return ok(res, { loggedOut: true });
});

module.exports = { startGoogleLogin, googleCallback, me, logout };
