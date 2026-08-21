#!/usr/bin/env node
'use strict';

/**
 * Mints a session token for a local development user so the API can be driven
 * with curl without going through a browser OAuth round trip.
 *
 *   node scripts/dev-token.js
 *   node scripts/dev-token.js you@example.com
 *
 * It reads SESSION_SECRET and DATABASE_URL from backend/.env, so it grants
 * nothing that the operator of those secrets does not already have. It refuses
 * to run against a production environment.
 */

const path = require('node:path');
const backend = path.resolve(__dirname, '../backend');

const { config } = require(path.join(backend, 'src/config'));
const { prisma } = require(path.join(backend, 'src/db/prisma'));
const { signSession } = require(path.join(backend, 'src/auth/session'));
const { ensureDefaultSender } = require(path.join(backend, 'src/services/senderService'));

async function main() {
  if (config.isProduction) {
    console.error('Refusing to mint a development token with NODE_ENV=production.');
    process.exitCode = 1;
    return;
  }

  const email = (process.argv[2] || 'dev.tester@example.com').toLowerCase();
  const googleId = `dev-local-${email}`;

  const user = await prisma.user.upsert({
    where: { googleId },
    update: {},
    create: { googleId, email, name: 'Local Dev User', avatarUrl: null },
  });

  const sender = await ensureDefaultSender(user.id);
  const token = signSession(user);

  console.log('\n  user       ', user.email, `(${user.id})`);
  console.log('  sender     ', sender.email, `(${sender.id})`);
  console.log('\n  export TOKEN=' + token);
  console.log('  export SENDER=' + sender.id);
  console.log('\n  curl -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/emails/stats\n');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
  await prisma.$disconnect().catch(() => {});
});
