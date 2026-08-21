'use strict';

/**
 * Dedicated worker process.
 *
 *   node src/workers/index.js      (npm run worker)
 *
 * It shares PostgreSQL and Redis with the API but runs on its own, so the API
 * can restart without interrupting deliveries and the worker can be scaled to
 * several instances. Nothing here polls the database for work: BullMQ delivers
 * a delayed job when Redis says it is due.
 */

const { config, assertConfig } = require('../config');
const { connectDatabase, disconnectDatabase } = require('../db/prisma');
const { closeRedis } = require('../db/redis');
const { closeQueue } = require('../queues/emailQueue');
const { reconcileScheduledJobs } = require('../services/emailService');
const { verifyTransport, closeTransports } = require('../services/mailer');
const { DEFAULT_REF } = require('../services/credentials');
const { createEmailWorker, WORKER_ID } = require('./emailWorker');
const { logger } = require('../utils/logger');

const log = logger.child('worker');

let worker = null;
let shuttingDown = false;

async function main() {
  assertConfig('worker');

  await connectDatabase();

  try {
    await verifyTransport(DEFAULT_REF);
    log.info('SMTP transport verified', { host: config.smtp.host, port: config.smtp.port });
  } catch (err) {
    // Refuse to start rather than silently "sending" nothing.
    throw new Error(
      `SMTP verification failed for ${config.smtp.host}:${config.smtp.port} - ${err.message}. ` +
        'Check ETHEREAL_USER / ETHEREAL_PASSWORD.'
    );
  }

  // One-shot reconciliation between the durable record and the queue.
  await reconcileScheduledJobs();

  ({ worker } = createEmailWorker());
  log.info('Worker process ready', { workerId: WORKER_ID });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal}, shutting down worker`);

  try {
    // `close()` waits for in-flight jobs so a send is never cut in half.
    if (worker) await worker.close();
    await closeTransports();
    await closeQueue();
    await closeRedis();
    await disconnectDatabase();
    log.info('Worker stopped cleanly');
    process.exit(0);
  } catch (err) {
    log.error(`Error during worker shutdown: ${err.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection in worker', { reason: String(reason) });
});

main().catch((err) => {
  log.error(`Worker failed to start: ${err.message}`);
  process.exit(1);
});
