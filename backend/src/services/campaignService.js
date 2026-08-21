'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../db/prisma');
const { config } = require('../config');
const { planSchedule, idempotencyKeyFor } = require('./schedulePlanner');
const { getOwnedSender } = require('./senderService');
const { enqueueEmailJobs, buildJobId, removeEmailJob } = require('../queues/emailQueue');
const { AppError, badRequest, notFound, forbidden } = require('../utils/errors');
const { logger } = require('../utils/logger');

const log = logger.child('campaigns');

const INSERT_CHUNK = 1000;
const ENQUEUE_CHUNK = 500;
const TERMINAL_STATUSES = ['SENT', 'FAILED', 'CANCELLED'];

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function enqueueWithRetry(entries, now) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      for (const batch of chunk(entries, ENQUEUE_CHUNK)) {
        await enqueueEmailJobs(batch, now);
      }
      return true;
    } catch (err) {
      lastError = err;
      log.warn(`Queue write attempt ${attempt} failed: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError;
}

/**
 * Persists a campaign and its emails, then queues them.
 *
 * PostgreSQL is committed first and Redis second on purpose. There is no
 * distributed transaction across the two; instead every queue write is
 * idempotent (deterministic job ids) and `reconcileScheduledJobs` re-queues any
 * row whose queue entry is missing. The failure mode is therefore "queued
 * late", never "silently dropped" and never "sent twice".
 */
async function scheduleCampaign(input) {
  const {
    userId,
    senderId,
    subject,
    body,
    startTime,
    delayBetweenEmails,
    hourlyLimit,
    recipients,
    requestKey,
  } = input;

  if (requestKey) {
    const replay = await prisma.campaign.findUnique({
      where: { requestKey },
      include: { _count: { select: { emailJobs: true } } },
    });
    if (replay) {
      if (replay.userId !== userId) {
        throw forbidden('This idempotency key belongs to another account');
      }
      log.info('Replayed schedule request', { campaignId: replay.id });
      return { campaign: replay, scheduled: replay._count.emailJobs, replayed: true };
    }
  }

  const sender = await getOwnedSender(userId, senderId);

  if (recipients.length === 0) throw badRequest('At least one valid recipient is required');
  if (recipients.length > config.limits.maxRecipientsPerCampaign) {
    throw badRequest(
      `A campaign can target at most ${config.limits.maxRecipientsPerCampaign} recipients`
    );
  }

  const now = Date.now();
  // A start time in the past means "start now" rather than "send everything
  // immediately at a timestamp that has already elapsed".
  const startMs = Math.max(now, new Date(startTime).getTime());
  const campaignId = crypto.randomUUID();
  const times = planSchedule({
    startMs,
    count: recipients.length,
    delayMs: delayBetweenEmails,
    hourlyLimit,
  });

  const rows = recipients.map((recipient, index) => {
    const id = crypto.randomUUID();
    const scheduledAt = new Date(times[index]);
    return {
      id,
      campaignId,
      userId,
      senderId: sender.id,
      recipient,
      subject,
      body,
      scheduledAt,
      status: 'SCHEDULED',
      idempotencyKey: idempotencyKeyFor(campaignId, recipient),
      bullJobId: buildJobId(id, scheduledAt),
      delayBetweenEmails,
      hourlyLimit,
    };
  });

  const campaign = await prisma.$transaction(
    async (tx) => {
      const created = await tx.campaign.create({
        data: {
          id: campaignId,
          userId,
          senderId: sender.id,
          subject,
          body,
          startTime: new Date(startMs),
          delayBetweenEmails,
          hourlyLimit,
          status: 'SCHEDULED',
          totalRecipients: rows.length,
          requestKey: requestKey || null,
        },
      });

      for (const batch of chunk(rows, INSERT_CHUNK)) {
        // skipDuplicates turns a retried request into a no-op on the unique
        // idempotencyKey rather than an error.
        await tx.emailJob.createMany({ data: batch, skipDuplicates: true });
      }

      return created;
    },
    { timeout: 60000, maxWait: 15000 }
  );

  log.info('Campaign persisted', {
    campaignId,
    userId,
    senderId: sender.id,
    recipients: rows.length,
    startAt: new Date(startMs).toISOString(),
    delayBetweenEmails,
    hourlyLimit,
  });

  try {
    await enqueueWithRetry(
      rows.map((row) => ({ emailJobId: row.id, scheduledAt: row.scheduledAt })),
      now
    );
  } catch (err) {
    log.error('Campaign persisted but queue write failed', {
      campaignId,
      error: err.message,
    });
    throw new AppError(
      'The campaign was saved but the scheduler queue is unavailable. No email was lost: ' +
        'the jobs are queued automatically as soon as Redis is reachable again.',
      503,
      { campaignId, recipients: rows.length }
    );
  }

  log.info('Campaign queued', { campaignId, jobs: rows.length });

  return { campaign, scheduled: rows.length, replayed: false };
}

/** Derives campaign progress from its emails. */
function deriveStatus(current, counts) {
  if (current === 'CANCELLED') return 'CANCELLED';
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const terminal = TERMINAL_STATUSES.reduce((sum, key) => sum + (counts[key] || 0), 0);
  if (total > 0 && terminal === total) return 'COMPLETED';
  if ((counts.SENT || 0) > 0 || (counts.PROCESSING || 0) > 0) return 'RUNNING';
  return 'SCHEDULED';
}

async function listCampaigns(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(1, pageSize), 100);
  const skip = (Math.max(1, page) - 1) * take;

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { sender: { select: { id: true, name: true, email: true } } },
    }),
    prisma.campaign.count({ where: { userId } }),
  ]);

  if (items.length === 0) return { items: [], total, page: Math.max(1, page), pageSize: take };

  const grouped = await prisma.emailJob.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: items.map((item) => item.id) } },
    _count: { _all: true },
  });

  const countsByCampaign = new Map();
  for (const row of grouped) {
    const bucket = countsByCampaign.get(row.campaignId) || {};
    bucket[row.status] = row._count._all;
    countsByCampaign.set(row.campaignId, bucket);
  }

  const enriched = [];
  const statusUpdates = [];

  for (const item of items) {
    const counts = countsByCampaign.get(item.id) || {};
    const status = deriveStatus(item.status, counts);
    if (status !== item.status) statusUpdates.push({ id: item.id, status });
    enriched.push({ ...item, status, counts });
  }

  // Status is derived on read and written back opportunistically, so the
  // worker never pays for a campaign-wide count on every single email.
  await Promise.all(
    statusUpdates.map((update) =>
      prisma.campaign
        .update({ where: { id: update.id }, data: { status: update.status } })
        .catch(() => {})
    )
  );

  return { items: enriched, total, page: Math.max(1, page), pageSize: take };
}

async function getCampaign(userId, campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { sender: { select: { id: true, name: true, email: true } } },
  });
  if (!campaign) throw notFound('Campaign not found');
  if (campaign.userId !== userId) throw forbidden('This campaign belongs to another account');

  const grouped = await prisma.emailJob.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));

  return { ...campaign, status: deriveStatus(campaign.status, counts), counts };
}

/** Cancels every email that has not been sent yet and drops its queue entry. */
async function cancelCampaign(userId, campaignId) {
  await getCampaign(userId, campaignId);

  const pending = await prisma.emailJob.findMany({
    where: { campaignId, status: { in: ['SCHEDULED', 'RATE_LIMITED'] } },
    select: { id: true, bullJobId: true },
  });

  const result = await prisma.emailJob.updateMany({
    where: { campaignId, status: { in: ['SCHEDULED', 'RATE_LIMITED'] } },
    data: { status: 'CANCELLED', bullJobId: null },
  });

  await Promise.all(pending.map((job) => removeEmailJob(job.bullJobId)));
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'CANCELLED' } });

  log.info('Campaign cancelled', { campaignId, cancelled: result.count });
  return { cancelled: result.count };
}

module.exports = {
  planSchedule,
  idempotencyKeyFor,
  scheduleCampaign,
  listCampaigns,
  getCampaign,
  cancelCampaign,
  deriveStatus,
};
