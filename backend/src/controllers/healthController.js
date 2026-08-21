'use strict';

const { checkDatabase } = require('../db/prisma');
const { checkRedis } = require('../db/redis');
const { getQueueCounts } = require('../queues/emailQueue');
const { hasCredential, DEFAULT_REF } = require('../services/credentials');
const { asyncHandler } = require('../utils/errors');

async function probe(fn) {
  try {
    await fn();
    return { status: 'connected' };
  } catch (err) {
    return { status: 'unavailable', error: err.message };
  }
}

/**
 * GET /api/health
 * Reports dependency reachability without leaking hostnames, credentials or
 * connection strings. Returns 503 when a hard dependency is down so that a
 * load balancer can act on it.
 */
const health = asyncHandler(async (req, res) => {
  const [database, redis] = await Promise.all([probe(checkDatabase), probe(checkRedis)]);

  let queue = null;
  if (redis.status === 'connected') {
    try {
      queue = await getQueueCounts();
    } catch {
      queue = null;
    }
  }

  const healthy = database.status === 'connected' && redis.status === 'connected';

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      api: 'healthy',
      database: database.status,
      redis: redis.status,
      smtp: hasCredential(DEFAULT_REF) ? 'configured' : 'not_configured',
      queue,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = { health };
