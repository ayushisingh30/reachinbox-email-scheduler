'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { config } = require('./config');
const { apiRouter } = require('./routes');
const { oauthRouter } = require('./routes/auth.routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { logger } = require('./utils/logger');

const log = logger.child('http');

function createApp() {
  const app = express();

  // Behind a proxy or platform router the client IP and protocol arrive in
  // headers; without this, rate limiting and Secure cookies misbehave.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and redirects only, so the restrictive default CSP
      // would just get in the way of the OAuth redirect chain.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server requests send no Origin header.
        if (!origin) return callback(null, true);
        const normalized = origin.replace(/\/+$/, '');
        if (config.corsOrigins.includes(normalized)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true, // required for the session cookie
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(cookieParser());

  // One concise line per request; bodies are never logged.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
      log[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
    });
    next();
  });

  app.get('/', (req, res) =>
    res.json({
      success: true,
      data: { service: 'reachinbox-email-scheduler', health: '/api/health' },
    })
  );

  app.use('/auth', oauthRouter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
