'use strict';

const { prisma } = require('../db/prisma');
const { config } = require('../config');
const { enqueueEmailJobs, removeEmailJob, buildJobId } = require('../queues/emailQueue');
const { notFound, forbidden, badRequest } = require('../utils/errors');
const { logger } = require('../utils/logger');

const log = logger.child('emails');

const PENDING_STATUSES = ['SCHEDULED', 'PROCESSING', 'RATE_LIMITED'];
const HISTORY_STATUSES = ['SENT', 'FAILED', 'CANCELLED'];

const LIST_SELECT = {
  id: true,
  campaignId: true,
  recipient: true,
  subject: true,
  status: true,
  scheduledAt: true,
  sentAt: true,
  failedAt: true,
  attempts: true,
  errorMessage: true,
  previewUrl: true,
  createdAt: true,
  sender: { select: { id: true, name: true, email: true } },
};

function buildWhere(userId, statuses, search) {
  const where = { userId, status: { in: statuses } };
  const term = String(search ?? '').trim();
  if (term) {
    where.OR = [
      { recipient: { contains: term, mode: 'insensitive' } },
      { subject: { contains: term, mode: 'insensitive' } },
    ];
  }
  return where;
}

async function listEmails(userId, { statuses, page = 1, pageSize = 25, search = '', orderBy }) {
  const take = Math.min(Math.max(1, Number(pageSize) || 25), 200);
  const currentPage = Math.max(1, Number(page) || 1);
  const where = buildWhere(userId, statuses, search);

  const [items, total] = await Promise.all([
    prisma.emailJob.findMany({
      where,
      orderBy,
      skip: (currentPage - 1) * take,
      take,
      select: LIST_SELECT,
    }),
    prisma.emailJob.count({ where }),
  ]);

  return { items, total, page: currentPage, pageSize: take, pages: Math.ceil(total / take) || 1 };
}

const listScheduled = (userId, options = {}) =>
  listEmails(userId, {
    ...options,
    statuses: PENDING_STATUSES,
    orderBy: { scheduledAt: 'asc' },
  });

const listSent = (userId, options = {}) =>
  listEmails(userId, {
    ...options,
    statuses: HISTORY_STATUSES,
    orderBy: [{ sentAt: 'desc' }, { failedAt: 'desc' }, { updatedAt: 'desc' }],
  });

async function getEmailJob(userId, id) {
  const job = await prisma.emailJob.findUnique({
    where: { id },
    include: { sender: { select: { id: true, name: true, email: true } } },
  });
  if (!job) throw notFound('Email job not found');
  if (job.userId !== userId) throw forbidden('This email belongs to another account');
  return job;
}

async function getStats(userId) {
  const grouped = await prisma.emailJob.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });

  const stats = {
    SCHEDULED: 0,
    PROCESSING: 0,
    RATE_LIMITED: 0,
    SENT: 0,
    FAILED: 0,
    CANCELLED: 0,
  };
  for (const row of grouped) stats[row.status] = row._count._all;
  stats.TOTAL = Object.values(stats).reduce((sum, value) => sum + value, 0);
  return stats;
}

/** Cancels a single not-yet-sent email and removes its queue entry. */
async function cancelEmailJob(userId, id) {
  const job = await getEmailJob(userId, id);
  if (!PENDING_STATUSES.includes(job.status)) {
    throw badRequest(`An email with status ${job.status} can no longer be cancelled`);
  }

  const result = await prisma.emailJob.updateMany({
    where: { id, status: { in: ['SCHEDULED', 'RATE_LIMITED'] } },
    data: { status: 'CANCELLED', bullJobId: null },
  });
  if (result.count === 0) throw badRequest('The email is already being processed');

  await removeEmailJob(job.bullJobId);
  log.info('Email cancelled', { emailJobId: id });
  return { cancelled: true };
}

/**
 * Startup reconciliation between PostgreSQL (source of truth) and Redis
 * (scheduler). This is NOT a scheduler and NOT a polling loop: it runs once
 * when a worker boots, so that any row whose queue entry was never written
 * (Redis outage during scheduling, or a Redis flush) gets its delayed job back.
 * Queue writes are idempotent, so re-queueing an existing job is a no-op.
 */
async function reconcileScheduledJobs() {
  const staleBefore = new Date(Date.now() - config.scheduler.processingLeaseMs);

  // A worker that died mid-send leaves a PROCESSING row behind. Once its lease
  // has expired the email is safe to hand to another worker.
  const released = await prisma.emailJob.updateMany({
    where: {
      status: 'PROCESSING',
      OR: [{ lockedAt: { lt: staleBefore } }, { lockedAt: null }],
    },
    data: { status: 'SCHEDULED', lockedAt: null, lockedBy: null },
  });

  if (released.count > 0) {
    log.warn('Released stale processing leases', { count: released.count });
  }

  const pending = await prisma.emailJob.findMany({
    where: { status: { in: ['SCHEDULED', 'RATE_LIMITED'] } },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
  });

  if (pending.length === 0) {
    log.info('Reconciliation complete: no outstanding emails');
    return { released: released.count, requeued: 0 };
  }

  const now = Date.now();
  const entries = pending.map((job) => ({ emailJobId: job.id, scheduledAt: job.scheduledAt }));

  for (let i = 0; i < entries.length; i += 500) {
    await enqueueEmailJobs(entries.slice(i, i + 500), now);
  }

  // Keep the stored queue id aligned with what was just written.
  await Promise.all(
    pending.map((job) =>
      prisma.emailJob
        .update({
          where: { id: job.id },
          data: { bullJobId: buildJobId(job.id, job.scheduledAt), status: 'SCHEDULED' },
        })
        .catch(() => {})
    )
  );

  log.info('Reconciliation complete', { released: released.count, requeued: entries.length });
  return { released: released.count, requeued: entries.length };
}

module.exports = {
  PENDING_STATUSES,
  HISTORY_STATUSES,
  listScheduled,
  listSent,
  getEmailJob,
  getStats,
  cancelEmailJob,
  reconcileScheduledJobs,
};
