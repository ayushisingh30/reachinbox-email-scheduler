'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../config');

const DAY_MS = 24 * 60 * 60 * 1000;

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true, // never readable from JavaScript
    secure: config.session.secure, // HTTPS only in production
    sameSite: config.session.sameSite, // 'none' for cross-site prod, 'lax' locally
    domain: config.session.domain,
    path: '/',
    maxAge: maxAgeMs,
  };
}

function signSession(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    config.session.secret,
    { expiresIn: `${config.session.ttlDays}d`, issuer: 'reachinbox' }
  );
}

/** Sets the session cookie. The token is never returned in the response body. */
function issueSession(res, user) {
  const token = signSession(user);
  res.cookie(config.session.cookieName, token, cookieOptions(config.session.ttlDays * DAY_MS));
  return token;
}

function clearSession(res) {
  res.clearCookie(config.session.cookieName, { ...cookieOptions(0), maxAge: undefined });
}

/**
 * Reads the session from the cookie, or from `Authorization: Bearer` so that
 * curl and the test-suite can authenticate without a browser.
 */
function readSession(req) {
  const fromCookie = req.cookies ? req.cookies[config.session.cookieName] : null;
  const header = req.headers.authorization || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = fromCookie || fromHeader;

  if (!token) return null;

  try {
    return jwt.verify(token, config.session.secret, { issuer: 'reachinbox' });
  } catch {
    return null;
  }
}

/** Short-lived cookie holding the OAuth `state` value (CSRF protection). */
const STATE_COOKIE = 'reachinbox_oauth_state';

function setStateCookie(res, state) {
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.session.secure,
    // The Google redirect is a cross-site top-level GET, which 'lax' allows.
    sameSite: config.session.secure ? 'none' : 'lax',
    domain: config.session.domain,
    path: '/',
    maxAge: 10 * 60 * 1000,
  });
}

function readStateCookie(req) {
  return req.cookies ? req.cookies[STATE_COOKIE] : null;
}

function clearStateCookie(res) {
  res.clearCookie(STATE_COOKIE, {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.secure ? 'none' : 'lax',
    domain: config.session.domain,
    path: '/',
  });
}

module.exports = {
  issueSession,
  clearSession,
  readSession,
  signSession,
  STATE_COOKIE,
  setStateCookie,
  readStateCookie,
  clearStateCookie,
};
