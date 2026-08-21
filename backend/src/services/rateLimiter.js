'use strict';

const { getRedis } = require('../db/redis');
const { hourBucket, nextHourStart, secondsUntilNextHour } = require('../utils/time');

const RATE_KEY_PREFIX = 'email-rate';
const OVERFLOW_KEY_PREFIX = 'email-rate-overflow';

/**
 * Check-and-increment in a single round trip. Doing this in Lua is what makes
 * the limit hold across many workers and many backend instances: `GET` then
 * `INCR` from Node would let two workers both read `limit - 1` and both send.
 */
const CONSUME_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current >= limit then
  return {0, current}
end
current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return {1, current}
`;

let registered = false;

function client() {
  const redis = getRedis();
  if (!registered) {
    redis.defineCommand('consumeHourlySlot', { numberOfKeys: 1, lua: CONSUME_SCRIPT });
    registered = true;
  }
  return redis;
}

function rateKey(senderId, at) {
  return `${RATE_KEY_PREFIX}:${senderId}:${hourBucket(at)}`;
}

/**
 * Attempts to reserve one send for `senderId` inside the current UTC hour.
 * Never blocks; the caller reschedules when `allowed` is false.
 */
async function tryConsumeHourlySlot({ senderId, limit, now = new Date() }) {
  const key = rateKey(senderId, now);
  // Keep the counter a little past the hour so a clock skew cannot resurrect
  // a stale bucket, but short enough that Redis stays tidy.
  const ttlSeconds = secondsUntilNextHour(now) + 300;

  const [allowed, count] = await client().consumeHourlySlot(key, String(limit), String(ttlSeconds));

  return {
    allowed: allowed === 1,
    count: Number(count),
    limit,
    bucket: hourBucket(now),
    retryAt: allowed === 1 ? null : nextHourStart(now),
  };
}

/**
 * Assigns an ordered position to a job that has been pushed into a later hour.
 * Overflowing jobs keep their relative order and stay spaced by `spacingMs`
 * instead of stampeding the first second of the new window.
 */
async function reserveOverflowOffset({ senderId, windowStart, spacingMs, maxOffsetMs }) {
  const key = `${OVERFLOW_KEY_PREFIX}:${senderId}:${hourBucket(windowStart)}`;
  const redis = client();

  const position = await redis.incr(key);
  if (position === 1) {
    await redis.expire(key, secondsUntilNextHour(windowStart) + 3600);
  }

  return Math.min((position - 1) * Math.max(0, spacingMs), Math.max(0, maxOffsetMs));
}

/** Read-only view of the current hour's usage, for the dashboard/health view. */
async function getHourlyUsage({ senderId, now = new Date() }) {
  const value = await client().get(rateKey(senderId, now));
  return { used: Number(value ?? 0), bucket: hourBucket(now) };
}

module.exports = {
  RATE_KEY_PREFIX,
  rateKey,
  tryConsumeHourlySlot,
  reserveOverflowOffset,
  getHourlyUsage,
};
