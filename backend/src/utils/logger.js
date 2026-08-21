'use strict';

const { config } = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

// Anything matching these is redacted before it reaches a log line.
const SENSITIVE_KEYS =
  /^(pass|password|pwd|secret|token|authorization|cookie|idtoken|id_token|access_token|refresh_token|client_secret|session|jwt|smtppass)$/i;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (meta === undefined) {
    console[level === 'debug' ? 'log' : level](line);
    return;
  }
  console[level === 'debug' ? 'log' : level](line, JSON.stringify(redact(meta)));
}

const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
  child(prefix) {
    return {
      error: (message, meta) => emit('error', `[${prefix}] ${message}`, meta),
      warn: (message, meta) => emit('warn', `[${prefix}] ${message}`, meta),
      info: (message, meta) => emit('info', `[${prefix}] ${message}`, meta),
      debug: (message, meta) => emit('debug', `[${prefix}] ${message}`, meta),
    };
  },
};

module.exports = { logger, redact };
