import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend/.env
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),

  databaseUrl: process.env.DATABASE_URL || '',

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  jwtSecret: process.env.JWT_SECRET || '',

  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',

  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),

  defaultMinDelayMs: parseInt(
    process.env.DEFAULT_MIN_DELAY_MS || '2000',
    10
  ),

  defaultMaxEmailsPerHour: parseInt(
    process.env.DEFAULT_MAX_EMAILS_PER_HOUR || '200',
    10
  ),
};