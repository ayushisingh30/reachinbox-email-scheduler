import express from 'express';
import cors from 'cors';
import { config } from './config';
import { authRouter } from './routes/auth';
import { emailsRouter, ensureSendersPool } from './routes/emails';
import { recoverEmailJobs, startWorker } from './worker';
import { prisma } from './prisma';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/emails', emailsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'reachinbox-scheduler-backend' });
});

// Bootstrap server
async function bootstrap() {
  try {
    // 1. Verify database connection
    console.log('Testing MySQL Database connection...');
    await prisma.$connect();
    console.log('✅ MySQL Database connected successfully.');

    // 2. Initialize SMTP senders pool
    await ensureSendersPool();

    // 3. Reconcile durable database jobs with Redis before accepting work.
    await recoverEmailJobs();

    // 4. Start BullMQ worker
    startWorker();

    // 5. Listen on PORT
    app.listen(config.port, () => {
      console.log(`🚀 Express server running on port ${config.port}`);
    });
  } catch (err) {
    console.error('❌ Failed to bootstrap the backend server:', err);
    process.exit(1);
  }
}

bootstrap();
