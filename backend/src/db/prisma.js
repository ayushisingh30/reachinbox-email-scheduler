'use strict';

const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient({
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

prisma.$on('warn', (event) => logger.warn(`prisma: ${event.message}`));
prisma.$on('error', (event) => logger.error(`prisma: ${event.message}`));

async function connectDatabase() {
  await prisma.$connect();
  logger.info('PostgreSQL connected');
}

async function disconnectDatabase() {
  await prisma.$disconnect();
}

/** Cheap liveness probe used by /api/health. */
async function checkDatabase() {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

module.exports = { prisma, connectDatabase, disconnectDatabase, checkDatabase };
