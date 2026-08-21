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
let worker = null;
let shuttingDown = false;

/**
 * Single-process mode.
 *
 * Set RUN_WORKER_IN_API=true to run the BullMQ worker inside this process
 * instead of as a separate one. This exists for hosts that only give you a
 * single long-running service, where paying
 * for a second process is not an option.
 *
 * Two processes is still the default and the better shape: the API can restart
 * without interrupting a delivery, and each side scales on its own. Nothing
 * about correctness changes either way - the same claim, rate limit and
 * spacing rules apply, because they live in PostgreSQL and Redis rather than in
 * process memory.
 */
async function startEmbeddedWorker() {
  const { createEmailWorker } = require('./workers/emailWorker');
  const { reconcileScheduledJobs } = require('./services/emailService');
  const { verifyTransport } = require('./services/mailer');
  const { DEFAULT_REF } = require('./services/credentials');

  assertConfig('worker');
  await verifyTransport(DEFAULT_REF);
  await reconcileScheduledJobs();

  ({ worker } = createEmailWorker());
  log.warn('Worker is running inside the API process (RUN_WORKER_IN_API=true)');
}

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

  if (config.runWorkerInApi) {
    try {
      await startEmbeddedWorker();
    } catch (err) {
      // A worker that cannot send is worth shouting about, but the API should
      // still come up so /api/health can explain what is wrong.
      log.error(`Embedded worker failed to start: ${err.message}`);
    }
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
    if (worker) await worker.close();
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
