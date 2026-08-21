'use strict';

const os = require('node:os');
const crypto = require('node:crypto');
const { Worker } = require('bullmq');

const { config } = require('../config');
const { prisma } = require('../db/prisma');
const { createRedisConnection } = require('../db/redis');
const { QUEUE_NAME, enqueueEmailJob, buildJobId } = require('../queues/emailQueue');
const { tryConsumeHourlySlot, reserveOverflowOffset } = require('../services/rateLimiter');
const { reserveSendSlot, releaseSendSlot } = require('../services/spacing');
const { sendEmail, isPermanentSmtpError } = require('../services/mailer');
const { logger } = require('../utils/logger');

const log = logger.child('worker');

const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
const MAX_OVERFLOW_OFFSET_MS = 55 * 60 * 1000;
const CLAIMABLE_STATUSES = ['SCHEDULED', 'RATE_LIMITED'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Moves an email to a later instant: PostgreSQL first (so the durable record is
 * correct even if the process dies here), then a fresh delayed BullMQ job. The
 * queue id is derived from the new time, so it cannot collide with the job that
 * is currently executing.
 */
async function reschedule({ emailJobId, at, status, reason, meta }) {
  const scheduledAt = new Date(at);
  const bullJobId = buildJobId(emailJobId, scheduledAt);

  await prisma.emailJob.update({
    where: { id: emailJobId },
    data: { status, scheduledAt, bullJobId, lockedAt: null, lockedBy: null },
  });

  await enqueueEmailJob({ emailJobId, scheduledAt });

  log.info(`Job rescheduled (${reason})`, {
    emailJobId,
    status,
    scheduledAt: scheduledAt.toISOString(),
    inMs: scheduledAt.getTime() - Date.now(),
    ...meta,
  });
}

/**
 * Atomically takes ownership of an email.
 *
 * This conditional UPDATE is the idempotency barrier. A row can only move into
 * PROCESSING from SCHEDULED/RATE_LIMITED, or from a PROCESSING lease that has
 * already expired. A duplicate queue delivery, a BullMQ retry, a second worker
 * and a restarted worker therefore cannot all send the same email: exactly one
 * of them observes `count === 1`.
 */
async function claim(emailJobId) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - config.scheduler.processingLeaseMs);

  const result = await prisma.emailJob.updateMany({
    where: {
      id: emailJobId,
      OR: [
        { status: { in: CLAIMABLE_STATUSES } },
        { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
        { status: 'PROCESSING', lockedAt: null },
      ],
    },
    data: { status: 'PROCESSING', lockedAt: now, lockedBy: WORKER_ID },
  });

  return result.count === 1;
}

async function processEmailJob(job) {
  const { emailJobId } = job.data || {};

  if (!emailJobId) {
    log.error('Queue job carries no emailJobId', { bullJobId: job.id });
    return { outcome: 'invalid' };
  }

  log.debug('Job received', { emailJobId, bullJobId: job.id });

  const emailJob = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: { sender: true },
  });

  if (!emailJob) {
    log.warn('Email no longer exists; dropping queue job', { emailJobId });
    return { outcome: 'missing' };
  }

  // Cheap pre-checks. The authoritative guard is the conditional claim below.
  if (emailJob.status === 'SENT') {
    log.info('Idempotency: already sent, skipping', { emailJobId });
    return { outcome: 'already-sent' };
  }
  if (emailJob.status === 'CANCELLED') {
    log.info('Email was cancelled, skipping', { emailJobId });
    return { outcome: 'cancelled' };
  }

  if (!(await claim(emailJobId))) {
    // Another worker holds a live lease. Rather than dropping the email, come
    // back just after that lease can expire. If the lease holder succeeds, the
    // SENT short-circuit above ends it on the next pass.
    const current = await prisma.emailJob.findUnique({
      where: { id: emailJobId },
      select: { status: true, lockedAt: true },
    });

    if (!current || ['SENT', 'FAILED', 'CANCELLED'].includes(current.status)) {
      log.info('Idempotency: another worker finished this email', {
        emailJobId,
        status: current ? current.status : 'missing',
      });
      return { outcome: 'already-handled' };
    }

    const leaseEndsAt =
      (current.lockedAt ? current.lockedAt.getTime() : Date.now()) +
      config.scheduler.processingLeaseMs;

    await reschedule({
      emailJobId,
      at: Math.max(Date.now() + 1000, leaseEndsAt + 1000),
      status: 'SCHEDULED',
      reason: 'processing-lease-held',
    });
    return { outcome: 'lease-held' };
  }

  const sender = emailJob.sender;
  const gapMs = Math.max(emailJob.delayBetweenEmails, config.scheduler.floorSendDelayMs);

  // ---------------------------------------------------------------------
  // 1. Minimum delay between sends (per sender, cluster wide).
  // Reserved before the hourly slot so that a spacing-driven reschedule does
  // not burn an hourly allowance it never uses.
  // ---------------------------------------------------------------------
  const slot = await reserveSendSlot({ senderId: sender.id, gapMs });

  if (slot.waitMs > config.scheduler.maxInlineSpacingWaitMs) {
    // Parking a worker slot for minutes would starve the pool, so hand the
    // email back to Redis instead of sleeping on it.
    await releaseSendSlot({ senderId: sender.id, ...slot });
    await reschedule({
      emailJobId,
      at: Date.now() + slot.waitMs,
      status: 'SCHEDULED',
      reason: 'min-delay-spacing',
      meta: { waitMs: slot.waitMs, gapMs },
    });
    return { outcome: 'deferred-spacing' };
  }

  // ---------------------------------------------------------------------
  // 2. Hourly rate limit (per sender, cluster wide, Redis-atomic).
  // ---------------------------------------------------------------------
  const rate = await tryConsumeHourlySlot({
    senderId: sender.id,
    limit: emailJob.hourlyLimit,
  });

  if (!rate.allowed) {
    await releaseSendSlot({ senderId: sender.id, ...slot });

    // Overflowing emails keep their arrival order and stay spaced inside the
    // next window instead of stampeding its first second.
    const offset = await reserveOverflowOffset({
      senderId: sender.id,
      windowStart: rate.retryAt,
      spacingMs: gapMs,
      maxOffsetMs: MAX_OVERFLOW_OFFSET_MS,
    });

    await reschedule({
      emailJobId,
      at: rate.retryAt.getTime() + offset,
      status: 'RATE_LIMITED',
      reason: 'hourly-limit-reached',
      meta: { senderId: sender.id, limit: rate.limit, used: rate.count, bucket: rate.bucket },
    });
    return { outcome: 'rate-limited' };
  }

  if (slot.waitMs > 0) {
    log.debug('Spacing send', { emailJobId, waitMs: slot.waitMs, gapMs });
    await sleep(slot.waitMs);
  }

  // ---------------------------------------------------------------------
  // 3. Send. The attempt counter is incremented here (not at claim time) so
  // that rate-limit and spacing deferrals never consume a retry.
  // ---------------------------------------------------------------------
  const counted = await prisma.emailJob.update({
    where: { id: emailJobId },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });
  const hasRetriesLeft = counted.attempts < config.scheduler.jobAttempts;

  log.info('Sending email', {
    emailJobId,
    recipient: emailJob.recipient,
    senderId: sender.id,
    attempt: counted.attempts,
    hourlyUsed: rate.count,
    hourlyLimit: rate.limit,
  });

  try {
    const result = await sendEmail({
      sender,
      to: emailJob.recipient,
      subject: emailJob.subject,
      body: emailJob.body,
    });

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        previewUrl: result.previewUrl,
        messageId: result.messageId,
        errorMessage: null,
        failedAt: null,
        lockedAt: null,
        lockedBy: null,
        bullJobId: null,
      },
    });

    log.info('Email sent', {
      emailJobId,
      recipient: emailJob.recipient,
      previewUrl: result.previewUrl,
    });

    return { outcome: 'sent', previewUrl: result.previewUrl };
  } catch (err) {
    const permanent = isPermanentSmtpError(err);
    const willRetry = hasRetriesLeft && !permanent;
    const message = String(err && err.message ? err.message : err).slice(0, 1000);

    if (willRetry) {
      // Release the lease so the BullMQ retry can re-claim the row; the
      // conditional claim still prevents two workers running at once.
      await prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status: 'SCHEDULED',
          errorMessage: message,
          lockedAt: null,
          lockedBy: null,
        },
      });

      log.warn('Email send failed, retrying', {
        emailJobId,
        recipient: emailJob.recipient,
        attempt: counted.attempts,
        maxAttempts: config.scheduler.jobAttempts,
        error: message,
      });

      // Rethrow so BullMQ applies its exponential backoff and re-delivers.
      throw err;
    }

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMessage: message,
        lockedAt: null,
        lockedBy: null,
        bullJobId: null,
      },
    });

    log.error('Email permanently failed', {
      emailJobId,
      recipient: emailJob.recipient,
      attempts: counted.attempts,
      permanent,
      error: message,
    });

    // Resolved rather than rethrown: the durable record already says FAILED and
    // there is nothing left for BullMQ to retry.
    return { outcome: 'failed', error: message };
  }
}

function createEmailWorker() {
  const connection = createRedisConnection('worker');

  const worker = new Worker(QUEUE_NAME, processEmailJob, {
    connection,
    concurrency: config.scheduler.workerConcurrency,
    // Detects jobs whose worker died without releasing them.
    stalledInterval: 30000,
    maxStalledCount: 2,
  });

  worker.on('ready', () =>
    log.info('Worker started', {
      workerId: WORKER_ID,
      queue: QUEUE_NAME,
      concurrency: config.scheduler.workerConcurrency,
      minSendDelayFloorMs: config.scheduler.floorSendDelayMs,
    })
  );
  worker.on('failed', (job, err) =>
    log.warn('Queue job failed', { bullJobId: job ? job.id : null, error: err.message })
  );
  worker.on('error', (err) => log.error(`Worker error: ${err.message}`));
  worker.on('stalled', (jobId) => log.warn('Queue job stalled', { bullJobId: jobId }));

  return { worker, connection };
}

module.exports = { WORKER_ID, createEmailWorker, processEmailJob, claim, reschedule };
