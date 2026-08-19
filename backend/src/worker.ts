import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';
import { config } from './config';
import { prisma } from './prisma';
import { scheduleEmailJob } from './queue';

const PROCESSING_LEASE_MS = 60_000;

// Redis connection for rate limits and locks
const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
});

// Helper sleep function
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Process a single email job from the queue
 */
async function processEmailJob(job: Job) {
  const { emailJobId, hourlyLimit } = job.data;
  
  if (!emailJobId) {
    console.error('Job missing emailJobId:', job.id);
    return;
  }

  // 1. Fetch job from DB and atomically acquire its processing lease.
  const emailJob = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: { sender: true },
  });

  if (!emailJob) {
    console.warn(`[Idempotency] Job ${emailJobId} not found in database. Skipping.`);
    return;
  }

  if (emailJob.status === 'SENT') {
    console.log(`[Idempotency] Job ${emailJobId} already SENT. Skipping.`);
    return;
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const claim = await prisma.emailJob.updateMany({
    where: {
      id: emailJobId,
      OR: [
        { status: 'PENDING' },
        {
          status: 'PROCESSING',
          OR: [
            { processingStartedAt: { lt: staleBefore } },
            { processingStartedAt: null },
          ],
        },
      ],
    },
    data: { status: 'PROCESSING', processingStartedAt: now },
  });

  if (claim.count === 0) {
    console.log(`[Idempotency] Job ${emailJobId} has an active processing lease. Skipping.`);
    return;
  }

  const sender = emailJob.sender;
  if (!sender) {
    const errorMsg = 'No sender assigned to this email job';
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'FAILED', error: errorMsg },
    });
    console.error(errorMsg);
    return;
  }

  // 2. Enforce Emails Per Hour (Rate Limiting) per sender
  const rateLimitNow = new Date();
  const year = rateLimitNow.getFullYear();
  const month = String(rateLimitNow.getMonth() + 1).padStart(2, '0');
  const date = String(rateLimitNow.getDate()).padStart(2, '0');
  const hour = String(rateLimitNow.getHours()).padStart(2, '0');
  const hourKey = `${year}${month}${date}${hour}`; // e.g., 2026081813
  
  const redisRateKey = `sender:rate:${sender.id}:${hourKey}`;
  const maxEmailsPerHour = hourlyLimit ?? config.defaultMaxEmailsPerHour;

  // Increment counter in Redis
  const count = await redis.incr(redisRateKey);
  if (count === 1) {
    await redis.expire(redisRateKey, 7200); // expire in 2 hours
  }

  if (count > maxEmailsPerHour) {
    // Decrement immediately since we are not sending it now
    await redis.decr(redisRateKey);
    
    // Calculate delay until next hour window
    const nextHourStart = new Date();
    nextHourStart.setHours(nextHourStart.getHours() + 1, 0, 0, 0);
    const delayMs = nextHourStart.getTime() - Date.now();
    
    console.log(`⚠️ Sender ${sender.email} hit hourly limit (${maxEmailsPerHour}/hr). Rescheduling job ${emailJobId} to next hour: ${nextHourStart.toISOString()} (delay: ${Math.round(delayMs / 1000)}s)`);
    
    // Reschedule in DB
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'PENDING',
        scheduledAt: nextHourStart,
        processingStartedAt: null,
      },
    });

    // Re-schedule in BullMQ
    await scheduleEmailJob(emailJobId, delayMs, hourlyLimit, nextHourStart);
    return;
  }

  // 3. Enforce Minimum Delay Between Sends (Spacing / Throttling) per sender
  const redisDelayKey = `sender:last_send:${sender.id}`;
  const minDelayMs = config.defaultMinDelayMs;
  
  const lastSendStr = await redis.get(redisDelayKey);
  if (lastSendStr) {
    const lastSend = parseInt(lastSendStr, 10);
    const timeSinceLastSend = Date.now() - lastSend;
    if (timeSinceLastSend < minDelayMs) {
      const waitTime = minDelayMs - timeSinceLastSend;
      console.log(`⏳ Spacing out email. Sender ${sender.email} waiting ${waitTime}ms before sending.`);
      await sleep(waitTime);
    }
  }
  
  // Update last send timestamp in Redis
  await redis.set(redisDelayKey, Date.now());

  // 4. Send Email via Ethereal SMTP
  try {
    const transporter = nodemailer.createTransport({
      host: sender.host,
      port: sender.port,
      secure: sender.port === 465,
      auth: {
        user: sender.username,
        pass: sender.password,
      },
    });

    const info = await transporter.sendMail({
      from: `"${sender.name}" <${sender.email}>`,
      to: emailJob.recipient,
      subject: emailJob.subject,
      text: emailJob.body,
      html: emailJob.body.replace(/\n/g, '<br>'), // convert newlines to HTML br tags
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`🚀 [SUCCESS] Sent email to ${emailJob.recipient}. Preview URL: ${previewUrl}`);

    // Update DB to SENT
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        processingStartedAt: null,
        error: previewUrl ? `Preview URL: ${previewUrl}` : null,
      },
    });

  } catch (err: any) {
    console.error(`❌ [FAILED] Email send to ${emailJob.recipient} failed:`, err.message);
    
    // Update DB to FAILED
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'FAILED',
        sentAt: new Date(),
        processingStartedAt: null,
        error: err.message || 'SMTP Send Failed',
      },
    });

    // Re-throw the error so BullMQ handles retry attempts
    throw err;
  }
}

/**
 * Requeue durable work after a process restart.  A stale PROCESSING lease is
 * returned to PENDING; deterministic BullMQ IDs make repeated recovery safe.
 */
export async function recoverEmailJobs() {
  const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
  await prisma.emailJob.updateMany({
    where: {
      status: 'PROCESSING',
      OR: [
        { processingStartedAt: { lt: staleBefore } },
        { processingStartedAt: null },
      ],
    },
    data: { status: 'PENDING', processingStartedAt: null },
  });

  const pendingJobs = await prisma.emailJob.findMany({
    where: { status: 'PENDING' },
    select: { id: true, scheduledAt: true, hourlyLimit: true },
  });

  await Promise.all(pendingJobs.map((emailJob) =>
    scheduleEmailJob(
      emailJob.id,
      Math.max(0, emailJob.scheduledAt.getTime() - Date.now()),
      emailJob.hourlyLimit ?? undefined,
      emailJob.scheduledAt,
    )
  ));
}

// Initialize the worker
export function startWorker() {
  const worker = new Worker(
    'email-queue',
    async (job) => {
      await processEmailJob(job);
    },
    {
      connection: {
        host: config.redis.host,
        port: config.redis.port,
      },
      concurrency: config.workerConcurrency,
    }
  );

  worker.on('active', (job) => {
    console.log(`Worker picked up job ${job.id} [${job.name}]`);
  });

  worker.on('completed', (job) => {
    console.log(`Worker completed job ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Worker failed job ${job?.id}: ${err.message}`);
  });

  console.log(`🔥 BullMQ Worker started successfully with concurrency: ${config.workerConcurrency}`);
  // A stalled BullMQ job can finish before its database lease expires.
  // Reconciliation guarantees the durable record is retried after that lease.
  const recoveryTimer = setInterval(() => {
    recoverEmailJobs().catch((err) => {
      console.error('Failed to reconcile durable email jobs:', err);
    });
  }, PROCESSING_LEASE_MS);
  recoveryTimer.unref();

  return worker;
}
