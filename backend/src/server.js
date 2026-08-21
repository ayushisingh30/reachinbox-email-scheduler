'use strict';

/**
 * API process.
 *
 *   node src/server.js      (npm run dev / npm start)
 *
 * The BullMQ worker deliberately runs in its own process (`npm run worker`) so
 * that restarting the API never interrupts a delivery, and so the worker can be
 * scaled independently.
 */

const { config, assertConfig } = require('./config');
const { createApp } = require('./app');
const { connectDatabase, disconnectDatabase } = require('./db/prisma');
const { getRedis, checkRedis, closeRedis } = require('./db/redis');
const { closeQueue } = require('./queues/emailQueue');
const { logger } = require('./utils/logger');

const log = logger.child('server');

let server = null;
let shuttingDown = false;

async function main() {
  assertConfig('api');

  await connectDatabase();

  // Redis is required for scheduling, but the API still starts without it so
  // that /api/health can report the outage instead of the process crash-looping.
  getRedis();
  try {
    await checkRedis();
    log.info('Redis connected');
  } catch (err) {
    log.error(`Redis is not reachable at startup: ${err.message}`);
  }

  const app = createApp();

  server = app.listen(config.port, () => {
    log.info('Server started', {
      port: config.port,
      env: config.nodeEnv,
      frontendUrl: config.frontendUrl,
      googleCallbackUrl: config.google.callbackUrl,
      health: `${config.backendUrl}/api/health`,
    });
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal}, shutting down API`);

  const force = setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  force.unref();

  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeQueue();
    await closeRedis();
    await disconnectDatabase();
    log.info('API stopped cleanly');
    process.exit(0);
  } catch (err) {
    log.error(`Error during shutdown: ${err.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});

main().catch((err) => {
  log.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});
