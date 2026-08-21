#!/usr/bin/env node
'use strict';

/**
 * Diagnoses the Google OAuth configuration before you ever open a browser.
 *
 *   npm run check:oauth
 *
 * It asks Google's authorization endpoint about the exact client id +
 * redirect URI pair in backend/.env and reports which of the three usual
 * failures you have:
 *
 *   deleted_client        the client id no longer exists in the console
 *   invalid_client        the client id is wrong / belongs to another project
 *   redirect_uri_mismatch the client is fine, the redirect URI is not listed
 */

const path = require('node:path');
const { config } = require(path.resolve(__dirname, '../backend/src/config'));

const { clientId, clientSecret, callbackUrl } = config.google;

function line(ok, label, detail) {
  console.log(`  ${ok ? '✔' : '✖'} ${label.padEnd(16)} ${detail}`);
}

async function probe() {
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?response_type=code&scope=openid%20email` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&client_id=${encodeURIComponent(clientId)}`;

  const response = await fetch(url, { redirect: 'follow' });
  const html = await response.text();

  if (/deleted_client/.test(html)) return 'deleted_client';
  if (/invalid_client/.test(html)) return 'invalid_client';
  if (/redirect_uri_mismatch/.test(html)) return 'redirect_uri_mismatch';
  if (/Access blocked|Authorization Error/.test(html)) return 'blocked';
  return 'ok';
}

async function main() {
  console.log('\n  Google OAuth configuration\n');
  line(Boolean(clientId), 'client id', clientId || '(not set)');
  line(Boolean(clientSecret), 'client secret', clientSecret ? `set (${clientSecret.length} chars)` : '(not set)');
  line(Boolean(callbackUrl), 'redirect URI', callbackUrl || '(not set)');

  if (!clientId || !clientSecret || !callbackUrl) {
    console.log('\n  Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL in backend/.env.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  Asking Google...\n');

  let verdict;
  try {
    verdict = await probe();
  } catch (err) {
    console.log(`  ✖ Could not reach Google: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (verdict === 'ok') {
    console.log('  ✔ Google accepts this client id and redirect URI.');
    console.log('    Sign-in should work. Open the app and click "Continue with Google".\n');
    return;
  }

  process.exitCode = 1;

  if (verdict === 'deleted_client') {
    console.log('  ✖ deleted_client - this OAuth client no longer exists.\n');
    console.log('    Google Cloud Console -> APIs & Services -> Credentials.');
    console.log('    Either the client was deleted, or GOOGLE_CLIENT_ID points at an old one.');
    console.log('    Copy the client id of a LIVE "OAuth 2.0 Client ID (Web application)"');
    console.log('    into backend/.env, along with a matching client secret.\n');
    return;
  }

  if (verdict === 'invalid_client') {
    console.log('  ✖ invalid_client - Google does not recognise this client id.\n');
    console.log('    Check for a typo, a stray "https://" prefix, or a client id from a different project.\n');
    return;
  }

  if (verdict === 'redirect_uri_mismatch') {
    console.log('  ✖ redirect_uri_mismatch - the client id is valid, the redirect URI is not registered.\n');
    console.log('    Google Cloud Console -> APIs & Services -> Credentials -> your Web client');
    console.log('    -> "Authorized redirect URIs" -> ADD URI -> paste exactly:\n');
    console.log(`        ${callbackUrl}\n`);
    console.log('    It must match character for character (scheme, host, port, path, no trailing slash).');
    console.log('    Note this is your BACKEND URL, not the frontend/Vercel URL.');
    console.log('    Save, wait a minute, then run this check again.\n');
    return;
  }

  console.log('  ✖ Google blocked the request for another reason.');
  console.log('    Open the sign-in flow in a browser to read the exact message.\n');
}

main();
