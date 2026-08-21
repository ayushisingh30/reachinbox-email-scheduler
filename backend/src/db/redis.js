'use strict';

const IORedis = require('ioredis');
const { config } = require('../config');
const { logger } = require('../utils/logger');

const connections = new Set();

/**
 * BullMQ needs `maxRetriesPerRequest: null` because it issues blocking
 * commands; the same options work for our own counters.
 * `rediss://` URLs (Upstash and friends) enable TLS automatically.
 */
function createRedisConnection(name = 'redis') {
  const client = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    connectionName: `reachinbox:${name}`,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });

  client.on('error', (err) => logger.error(`Redis (${name}) error: ${err.message}`));
  client.on('end', () => logger.warn(`Redis (${name}) connection closed`));

  connections.add(client);
  return client;
}

let shared = null;

/** Shared, non-blocking connection for rate limiting, spacing and health. */
function getRedis() {
  if (!shared) {
    shared = createRedisConnection('shared');
  }
  return shared;
}

async function checkRedis() {
  const pong = await getRedis().ping();
  return pong === 'PONG';
}

async function closeRedis() {
  await Promise.allSettled([...connections].map((client) => client.quit()));
  connections.clear();
  shared = null;
}

module.exports = { createRedisConnection, getRedis, checkRedis, closeRedis };
