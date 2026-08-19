import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from './auth';
import { prisma } from '../prisma';
import { scheduleEmailJob } from '../queue';
import nodemailer from 'nodemailer';

export const emailsRouter = Router();

/**
 * Helper to ensure at least one Ethereal SMTP sender exists in the database.
 * Creates one account only if no sender already exists.
 */
export async function ensureSendersPool() {
  try {
    // Check whether a sender already exists
    const existingSender = await prisma.sender.findFirst();

    if (existingSender) {
      console.log(`Using existing SMTP sender: ${existingSender.email}`);
      return;
    }

    console.log('Generating Ethereal SMTP account...');

    const testAccount = await nodemailer.createTestAccount();

    await prisma.sender.create({
      data: {
        email: testAccount.user,
        name: 'Ethereal Sender',
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        username: testAccount.user,
        password: testAccount.pass,
      },
    });

    console.log(`Created Ethereal SMTP Sender: ${testAccount.user}`);
  } catch (err: any) {
    console.error(
      'Failed to create or load Ethereal SMTP sender:',
      err.message
    );
    throw err;
  }
}

/**
 * Endpoint: GET /api/emails/senders
 * Returns the pool of active senders
 */
emailsRouter.get(
  '/senders',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await ensureSendersPool();

      const senders = await prisma.sender.findMany({
        select: {
          id: true,
          email: true,
          name: true,
        },
      });

      return res.json(senders);
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to retrieve senders',
      });
    }
  }
);

/**
 * Endpoint: POST /api/emails/schedule
 * Body: { subject, body, recipients, scheduledAt, delayBetweenSeconds, hourlyLimit }
 */
emailsRouter.post(
  '/schedule',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const {
      subject,
      body,
      recipients,
      scheduledAt,
      delayBetweenSeconds,
      hourlyLimit,
    } = req.body;

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    if (
      !subject ||
      !body ||
      !recipients ||
      !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      return res.status(400).json({
        error: 'Subject, body, and non-empty recipients list are required',
      });
    }

    try {
      // 1. Ensure at least one sender exists
      await ensureSendersPool();

      const senders = await prisma.sender.findMany();

      if (senders.length === 0) {
        return res.status(500).json({
          error: 'No email senders available in the SMTP pool',
        });
      }

      // 2. Parse start time
      const startMs = scheduledAt
        ? new Date(scheduledAt).getTime()
        : Date.now();

      const now = Date.now();

      const delayBetweenMs =
        (delayBetweenSeconds || 2) * 1000;

      console.log(
        `Scheduling ${recipients.length} emails starting at ${new Date(
          startMs
        ).toISOString()}...`
      );

      // 3. Create jobs in database and queue them in BullMQ
      const createdJobs = [];

      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i].trim();

        if (!recipient) {
          continue;
        }

        // Round-robin distribution of available senders
        const sender = senders[i % senders.length];

        // Calculate delay
        const jobScheduledAtMs =
          startMs + i * delayBetweenMs;

        const queueDelayMs =
          jobScheduledAtMs - now;

        // Write PENDING job to database
        const dbJob = await prisma.emailJob.create({
          data: {
            recipient,
            subject,
            body,
            status: 'PENDING',
            scheduledAt: new Date(jobScheduledAtMs),
            hourlyLimit: hourlyLimit
              ? parseInt(String(hourlyLimit), 10)
              : null,
            senderId: sender.id,
            userId,
          },
        });

        // Add delayed job to BullMQ
        await scheduleEmailJob(
          dbJob.id,
          queueDelayMs,
          hourlyLimit
            ? parseInt(String(hourlyLimit), 10)
            : undefined,
          new Date(jobScheduledAtMs)
        );

        createdJobs.push(dbJob);
      }

      return res.status(201).json({
        message: `Successfully scheduled ${createdJobs.length} emails`,
        jobsCount: createdJobs.length,
      });
    } catch (err) {
      console.error('Failed to schedule email batch:', err);

      return res.status(500).json({
        error: 'Failed to schedule emails',
        details: String(err),
      });
    }
  }
);

/**
 * Endpoint: GET /api/emails/scheduled
 * Returns all PENDING/PROCESSING email jobs
 */
emailsRouter.get(
  '/scheduled',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
      const scheduledJobs = await prisma.emailJob.findMany({
        where: {
          userId,
          status: {
            in: ['PENDING', 'PROCESSING'],
          },
        },
        include: {
          sender: {
            select: {
              email: true,
              name: true,
            },
          },
        },
        orderBy: {
          scheduledAt: 'asc',
        },
      });

      return res.json(scheduledJobs);
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to retrieve scheduled emails',
      });
    }
  }
);

/**
 * Endpoint: GET /api/emails/sent
 * Returns all SENT/FAILED email jobs
 */
emailsRouter.get(
  '/sent',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
      const sentJobs = await prisma.emailJob.findMany({
        where: {
          userId,
          status: {
            in: ['SENT', 'FAILED'],
          },
        },
        include: {
          sender: {
            select: {
              email: true,
              name: true,
            },
          },
        },
        orderBy: {
          sentAt: 'desc',
        },
      });

      return res.json(sentJobs);
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to retrieve sent email history',
      });
    }
  }
);

/**
 * Endpoint: GET /api/emails/stats
 * Returns summary stats for the dashboard
 */
emailsRouter.get(
  '/stats',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    try {
      const stats = await prisma.emailJob.groupBy({
        by: ['status'],
        where: {
          userId,
        },
        _count: {
          id: true,
        },
      });

      const formattedStats = {
        PENDING: 0,
        PROCESSING: 0,
        SENT: 0,
        FAILED: 0,
      };

      stats.forEach((stat) => {
        const statusKey =
          stat.status as keyof typeof formattedStats;

        if (statusKey in formattedStats) {
          formattedStats[statusKey] =
            stat._count.id;
        }
      });

      const totalCount = Object.values(
        formattedStats
      ).reduce((a, b) => a + b, 0);

      return res.json({
        ...formattedStats,
        TOTAL: totalCount,
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to retrieve statistics',
      });
    }
  }
);