'use strict';

const { Queue } = require('bullmq');
const { config } = require('../config');
const { createRedisConnection } = require('../db/redis');
const { logger } = require('../utils/logger');

const QUEUE_NAME = 'emailQueue';
const JOB_NAME = 'send-email';

let queue = null;
let connection = null;

function getEmailQueue() {
  if (queue) return queue;

  connection = createRedisConnection('queue');
  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: config.scheduler.jobAttempts,
      backoff: { type: 'exponential', delay: config.scheduler.jobBackoffMs },
      // Trim Redis history only. PostgreSQL keeps the permanent email record,
      // so removing a completed BullMQ job never loses delivery history.
      removeOnComplete: { count: config.scheduler.removeOnCompleteCount },
      removeOnFail: { count: config.scheduler.removeOnFailCount },
    },
  });

  return queue;
}

/**
 * Deterministic per-occurrence id. Re-running recovery for the same
 * (emailJob, scheduledAt) pair is a no-op because BullMQ ignores an `add` for
 * an id it already holds; a rate-limit reschedule gets a new occurrence id and
 * therefore its own job.
 */
function buildJobId(emailJobId, scheduledAt) {
  // BullMQ rejects ":" in a custom job id, so the occurrence separator is "-at-".
  return `${emailJobId}-at-${new Date(scheduledAt).getTime()}`;
}

/**
 * Queues one email for delivery at `scheduledAt`. Safe to call repeatedly.
 * Returns the BullMQ job id that was used.
 */
async function enqueueEmailJob({ emailJobId, scheduledAt, now = Date.now() }) {
  const runAt = new Date(scheduledAt).getTime();
  const delay = Math.max(0, runAt - now);
  const jobId = buildJobId(emailJobId, runAt);

  await getEmailQueue().add(JOB_NAME, { emailJobId }, { jobId, delay });

  return jobId;
}

/** Bulk variant used when scheduling a campaign of thousands of recipients. */
async function enqueueEmailJobs(entries, now = Date.now()) {
  if (entries.length === 0) return [];

  const jobs = entries.map((entry) => {
    const runAt = new Date(entry.scheduledAt).getTime();
    return {
      name: JOB_NAME,
      data: { emailJobId: entry.emailJobId },
      opts: { jobId: buildJobId(entry.emailJobId, runAt), delay: Math.max(0, runAt - now) },
    };
  });

  await getEmailQueue().addBulk(jobs);
  return jobs.map((job) => job.opts.jobId);
}

/** Best-effort removal; a job that already ran simply no longer exists. */
async function removeEmailJob(bullJobId) {
  if (!bullJobId) return false;
  try {
    const job = await getEmailQueue().getJob(bullJobId);
    if (!job) return false;
    await job.remove();
    return true;
  } catch (err) {
    logger.warn(`Could not remove queue job ${bullJobId}: ${err.message}`);
    return false;
  }
}

async function getQueueCounts() {
  return getEmailQueue().getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
}

async function closeQueue() {
  if (queue) await queue.close();
  if (connection) await connection.quit().catch(() => {});
  queue = null;
  connection = null;
}

module.exports = {
  QUEUE_NAME,
  JOB_NAME,
  getEmailQueue,
  buildJobId,
  enqueueEmailJob,
  enqueueEmailJobs,
  removeEmailJob,
  getQueueCounts,
  closeQueue,
};
