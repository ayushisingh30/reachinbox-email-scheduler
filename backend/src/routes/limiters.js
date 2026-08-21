'use strict';

const rateLimit = require('express-rate-limit');
const { config } = require('../config');

const perUser = (req) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`);

/** Scheduling is expensive (thousands of rows + queue writes), so cap it. */
const scheduleLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  keyGenerator: perUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many scheduling requests. Please slow down.' } },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 1000 : 60,
  keyGenerator: perUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many uploads. Please slow down.' } },
});

/** Blanket protection for the whole API surface. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 100000 : 300,
  keyGenerator: perUser,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests. Please try again shortly.' } },
});

module.exports = { scheduleLimiter, uploadLimiter, apiLimiter };
