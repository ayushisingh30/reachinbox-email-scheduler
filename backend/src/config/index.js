'use strict';

const path = require('path');
const dotenv = require('dotenv');

// backend/.env wins, repo-root .env is a fallback so a single file can drive
// both packages during local development.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : String(value).trim();
}

function int(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name, fallback) {
  const value = str(name);
  if (value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * Google sometimes gets pasted with a scheme in front of it. The client id is
 * an opaque string, never a URL, so strip anything that looks like one.
 */
function normalizeClientId(raw) {
  return raw.replace(/^https?:\/\//i, '').trim();
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

const port = int('PORT', 5000);
const frontendUrl = str('FRONTEND_URL', 'http://localhost:5173').replace(/\/+$/, '');
const backendUrl = str('BACKEND_URL', `http://localhost:${port}`).replace(/\/+$/, '');

const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port,

  frontendUrl,
  backendUrl,
  // Comma separated list; the frontend origin is always allowed.
  corsOrigins: Array.from(
    new Set(
      [frontendUrl, ...str('CORS_ORIGINS').split(',')]
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    )
  ),

  databaseUrl: str('DATABASE_URL'),
  redisUrl: str('REDIS_URL', 'redis://127.0.0.1:6379'),

  session: {
    secret: str('SESSION_SECRET'),
    cookieName: str('SESSION_COOKIE_NAME', 'reachinbox_session'),
    ttlDays: int('SESSION_TTL_DAYS', 7),
    // Cross-site cookies (frontend and API on different hosts) require
    // SameSite=None, which browsers only accept together with Secure.
    sameSite: str('SESSION_COOKIE_SAMESITE', isProduction ? 'none' : 'lax'),
    secure: bool('SESSION_COOKIE_SECURE', isProduction),
    domain: str('SESSION_COOKIE_DOMAIN') || undefined,
  },

  google: {
    clientId: normalizeClientId(str('GOOGLE_CLIENT_ID')),
    clientSecret: str('GOOGLE_CLIENT_SECRET'),
    callbackUrl: str('GOOGLE_CALLBACK_URL', `${backendUrl}/auth/google/callback`),
  },

  smtp: {
    host: str('ETHEREAL_HOST', 'smtp.ethereal.email'),
    port: int('ETHEREAL_PORT', 587),
    user: str('ETHEREAL_USER'),
    password: str('ETHEREAL_PASSWORD'),
    fromName: str('ETHEREAL_FROM_NAME', 'ReachInbox'),
  },

  scheduler: {
    workerConcurrency: Math.max(1, int('WORKER_CONCURRENCY', 5)),
    defaultMinSendDelayMs: Math.max(0, int('DEFAULT_MIN_SEND_DELAY_MS', 2000)),
    defaultHourlyLimit: Math.max(1, int('DEFAULT_HOURLY_LIMIT', 100)),
    // Absolute floor the worker enforces regardless of what a campaign asks for.
    floorSendDelayMs: Math.max(0, int('MIN_SEND_DELAY_FLOOR_MS', 250)),
    // How long a worker may hold a job before another worker may steal it.
    processingLeaseMs: Math.max(5000, int('PROCESSING_LEASE_MS', 60000)),
    // Spacing waits longer than this are turned into a re-queue instead of an
    // in-process sleep, so a worker slot is never parked for minutes.
    maxInlineSpacingWaitMs: Math.max(0, int('MAX_INLINE_SPACING_WAIT_MS', 10000)),
    jobAttempts: Math.max(1, int('JOB_ATTEMPTS', 3)),
    jobBackoffMs: Math.max(1000, int('JOB_BACKOFF_MS', 5000)),
    // Retained BullMQ history; PostgreSQL keeps the permanent record.
    removeOnCompleteCount: int('QUEUE_KEEP_COMPLETED', 1000),
    removeOnFailCount: int('QUEUE_KEEP_FAILED', 5000),
  },

  limits: {
    maxRecipientsPerCampaign: Math.max(1, int('MAX_RECIPIENTS_PER_CAMPAIGN', 10000)),
    maxUploadBytes: Math.max(1024, int('MAX_UPLOAD_BYTES', 5 * 1024 * 1024)),
    maxSubjectLength: int('MAX_SUBJECT_LENGTH', 300),
    maxBodyLength: int('MAX_BODY_LENGTH', 100000),
    maxHourlyLimit: int('MAX_HOURLY_LIMIT', 10000),
    maxDelayBetweenEmailsMs: int('MAX_DELAY_BETWEEN_EMAILS_MS', 3600000),
  },

  // Run the BullMQ worker inside the API process. Off by default; see the
  // note in server.js for when a single-process deployment makes sense.
  runWorkerInApi: bool('RUN_WORKER_IN_API', false),

  logLevel: str('LOG_LEVEL', 'info'),
};

/**
 * Fail loudly at boot instead of silently mis-behaving at send time.
 * `scope` narrows the check so the worker does not demand OAuth settings.
 */
function assertConfig(scope = 'api') {
  const missing = [];

  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.redisUrl) missing.push('REDIS_URL');

  if (scope === 'api') {
    if (!config.session.secret) missing.push('SESSION_SECRET');
    if (!config.google.clientId) missing.push('GOOGLE_CLIENT_ID');
    if (!config.google.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
    if (!config.google.callbackUrl) missing.push('GOOGLE_CALLBACK_URL');
  }

  if (scope === 'worker') {
    if (!config.smtp.user) missing.push('ETHEREAL_USER');
    if (!config.smtp.password) missing.push('ETHEREAL_PASSWORD');
  }

  if (config.isProduction && config.session.secret.length < 32) {
    missing.push('SESSION_SECRET (must be at least 32 characters in production)');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment configuration: ${missing.join(', ')}. ` +
        'Copy .env.example to backend/.env and fill in the values.'
    );
  }
}

module.exports = { config, assertConfig };
