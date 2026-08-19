import { Queue } from 'bullmq';
import { config } from './config';

// Initialize the BullMQ Queue
export const emailQueue = new Queue('email-queue', {
  connection: {
    host: config.redis.host,
    port: config.redis.port,
  },
  defaultJobOptions: {
    attempts: 3, // retry up to 3 times if SMTP fails
    backoff: {
      type: 'exponential',
      delay: 5000, // wait 5s, then 10s, then 20s
    },
  },
});

/**
 * Schedules a delayed email sending job in BullMQ.
 *
 * A database email can be scheduled more than once (for example, when it is
 * moved to the next rate-limit window).  The BullMQ job ID therefore includes
 * the scheduled occurrence, rather than reusing the database ID of an active
 * job.  Repeating this call for the same occurrence remains idempotent.
 */
export async function scheduleEmailJob(
  emailJobId: string,
  delayMs: number,
  hourlyLimit?: number,
  scheduledFor: Date = new Date(Date.now() + Math.max(0, delayMs)),
) {
  const delay = Math.max(0, delayMs);
  const jobId = `${emailJobId}-at-${scheduledFor.getTime()}`;
  
  await emailQueue.add(
    'send-email',
    { emailJobId, hourlyLimit },
    {
      delay,
      jobId, // Unique per occurrence; deterministic for recovery/idempotency
      removeOnComplete: true, // Auto-cleanup completed jobs from Redis
      removeOnFail: false, // Retain failed jobs in Redis for logs and debugging
    }
  );
}

/**
 * Removes a scheduled job from the queue.
 */
export async function cancelEmailJob(emailJobId: string) {
  try {
    const job = await emailQueue.getJob(emailJobId);
    if (job) {
      await job.remove();
    }
  } catch (err) {
    console.error(`Failed to cancel job ${emailJobId} from queue:`, err);
  }
}
