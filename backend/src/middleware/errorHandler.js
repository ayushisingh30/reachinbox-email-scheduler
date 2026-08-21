'use strict';

const multer = require('multer');
const { AppError } = require('../utils/errors');
const { fail } = require('../utils/response');
const { logger } = require('../utils/logger');
const { config } = require('../config');

const log = logger.child('http');

function notFoundHandler(req, res) {
  return fail(res, `No route matches ${req.method} ${req.originalUrl}`, 404);
}

/** Maps a thrown error onto a status code and a message safe to show a user. */
function classify(err) {
  if (err instanceof AppError) {
    return { status: err.status, message: err.message, details: err.details };
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(config.limits.maxUploadBytes / (1024 * 1024));
      return { status: 413, message: `The uploaded file is larger than the ${mb} MB limit` };
    }
    return { status: 400, message: `Upload rejected: ${err.message}` };
  }

  // Body-parser rejects malformed JSON with a SyntaxError carrying a status.
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return { status: 400, message: 'Request body is not valid JSON' };
  }

  // Prisma known request errors.
  if (err && typeof err.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      return { status: 409, message: 'That record already exists' };
    }
    if (err.code === 'P2025') {
      return { status: 404, message: 'Resource not found' };
    }
    if (err.code === 'P1001' || err.code === 'P1002') {
      return { status: 503, message: 'The database is unreachable. Please try again shortly.' };
    }
    return { status: 400, message: 'The request could not be completed against the database' };
  }

  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return { status: 401, message: 'Your session is invalid or has expired' };
  }

  // Redis / BullMQ connectivity.
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
    return { status: 503, message: 'A required service is unreachable. Please try again shortly.' };
  }

  return { status: 500, message: 'Internal server error' };
}

// eslint-disable-next-line no-unused-vars -- Express identifies this by arity.
function errorHandler(err, req, res, next) {
  const { status, message, details } = classify(err);

  const meta = {
    method: req.method,
    path: req.originalUrl,
    status,
    userId: req.user ? req.user.id : undefined,
  };

  if (status >= 500) {
    // Stack traces stay in the server log; they are never sent to the client.
    log.error(`${message}`, { ...meta, error: err.message, stack: err.stack });
  } else {
    log.warn(`${message}`, meta);
  }

  return fail(res, message, status, details);
}

module.exports = { errorHandler, notFoundHandler };
