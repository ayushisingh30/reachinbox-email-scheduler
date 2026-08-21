'use strict';

const { prisma } = require('../db/prisma');
const { config } = require('../config');
const { DEFAULT_REF, hasCredential } = require('./credentials');
const { forbidden, notFound, badRequest, conflict } = require('../utils/errors');
const { isValidEmail } = require('../utils/recipients');
const { logger } = require('../utils/logger');

const log = logger.child('senders');

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  smtpHost: true,
  smtpPort: true,
  credentialRef: true,
  active: true,
  createdAt: true,
};

/**
 * Every user needs at least one "from" identity before they can schedule.
 * The default one points at the shared Ethereal credential; additional senders
 * are ordinary rows with their own `credentialRef`, so nothing about the model
 * assumes a single sender.
 */
async function ensureDefaultSender(userId) {
  const existing = await prisma.sender.findFirst({
    where: { userId, active: true },
    orderBy: { createdAt: 'asc' },
    select: PUBLIC_FIELDS,
  });
  if (existing) return existing;

  if (!hasCredential(DEFAULT_REF)) {
    throw badRequest(
      'No SMTP credentials are configured on the server. Set ETHEREAL_USER and ETHEREAL_PASSWORD.'
    );
  }

  const created = await prisma.sender.upsert({
    where: { userId_email: { userId, email: config.smtp.user } },
    update: { active: true },
    create: {
      userId,
      name: config.smtp.fromName,
      email: config.smtp.user,
      smtpHost: config.smtp.host,
      smtpPort: config.smtp.port,
      credentialRef: DEFAULT_REF,
    },
    select: PUBLIC_FIELDS,
  });

  log.info('Default sender provisioned', { userId, senderId: created.id });
  return created;
}

async function listSenders(userId) {
  await ensureDefaultSender(userId);
  return prisma.sender.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: PUBLIC_FIELDS,
  });
}

/** Ownership check. A sender belonging to another user must read as 404/403. */
async function getOwnedSender(userId, senderId) {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender) throw notFound('Sender not found');
  if (sender.userId !== userId) throw forbidden('This sender belongs to another account');
  if (!sender.active) throw badRequest('This sender is disabled');
  return sender;
}

async function createSender(userId, input) {
  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim().toLowerCase();
  const credentialRef = String(input.credentialRef ?? DEFAULT_REF).trim();

  if (name.length === 0 || name.length > 120) throw badRequest('Sender name is required');
  if (!isValidEmail(email)) throw badRequest('Sender email is not a valid address');
  if (!hasCredential(credentialRef)) {
    throw badRequest(
      `SMTP credential "${credentialRef}" is not configured on the server. ` +
        'SMTP passwords are read from environment variables, never from the request.'
    );
  }

  const existing = await prisma.sender.findUnique({
    where: { userId_email: { userId, email } },
  });
  if (existing) throw conflict('A sender with this email already exists for your account');

  return prisma.sender.create({
    data: {
      userId,
      name,
      email,
      credentialRef,
      smtpHost: String(input.smtpHost ?? config.smtp.host),
      smtpPort: Number.parseInt(input.smtpPort ?? config.smtp.port, 10) || config.smtp.port,
    },
    select: PUBLIC_FIELDS,
  });
}

module.exports = { PUBLIC_FIELDS, ensureDefaultSender, listSenders, getOwnedSender, createSender };
