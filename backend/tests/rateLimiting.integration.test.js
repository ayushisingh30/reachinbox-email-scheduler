'use strict';

/**
 * Integration tests for the two Redis-backed guarantees that concurrency makes
 * hard: the hourly cap and the minimum spacing between sends. They exercise the
 * real Lua scripts against a real Redis, because that is exactly the part a
 * pure unit test cannot prove.
 *
 * The whole file is skipped (not failed) when Redis is unreachable, so
 * `npm test` still works on a machine without it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { getRedis, closeRedis } = require('../src/db/redis');
const { tryConsumeHourlySlot, reserveOverflowOffset, rateKey } = require('../src/services/rateLimiter');
const { reserveSendSlot, releaseSendSlot, spacingKey } = require('../src/services/spacing');
const { nextHourStart } = require('../src/utils/time');

let redisAvailable = false;

test.before(async () => {
  try {
    await getRedis().ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
  }
});

test.after(async () => {
  await closeRedis();
});

const senderId = () => `test-sender-${crypto.randomUUID()}`;

async function cleanup(id) {
  const redis = getRedis();
  await redis.del(rateKey(id, new Date()), spacingKey(id));
}

test('hourly limit: allows exactly `limit` sends and then denies', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const results = [];
  for (let i = 0; i < 7; i += 1) {
    results.push(await tryConsumeHourlySlot({ senderId: id, limit: 5 }));
  }

  assert.equal(results.filter((r) => r.allowed).length, 5);
  assert.equal(results.filter((r) => !r.allowed).length, 2);
  assert.deepEqual(
    results.map((r) => r.allowed),
    [true, true, true, true, true, false, false]
  );

  await cleanup(id);
});

test('hourly limit: concurrent workers cannot race past the cap', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const limit = 25;
  const attempts = 200;

  // Fire every attempt at once: a GET-then-INCR implementation fails here.
  const results = await Promise.all(
    Array.from({ length: attempts }, () => tryConsumeHourlySlot({ senderId: id, limit }))
  );

  const allowed = results.filter((r) => r.allowed).length;
  assert.equal(allowed, limit, `expected exactly ${limit} sends to be allowed, got ${allowed}`);
  assert.equal(Number(await getRedis().get(rateKey(id, new Date()))), limit);

  await cleanup(id);
});

test('hourly limit: a denied send is told to retry in the next hour', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  await tryConsumeHourlySlot({ senderId: id, limit: 1 });
  const denied = await tryConsumeHourlySlot({ senderId: id, limit: 1 });

  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAt instanceof Date);
  assert.equal(denied.retryAt.getTime(), nextHourStart().getTime());
  assert.ok(denied.retryAt.getTime() > Date.now());

  await cleanup(id);
});

test('hourly limit: the counter carries a TTL so buckets expire', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  await tryConsumeHourlySlot({ senderId: id, limit: 3 });
  const ttl = await getRedis().ttl(rateKey(id, new Date()));

  assert.ok(ttl > 0, 'expected a positive TTL');
  assert.ok(ttl <= 3600 + 300, `TTL ${ttl} should not outlive the hour bucket by much`);

  await cleanup(id);
});

test('overflow offsets keep rescheduled emails ordered and spaced', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const windowStart = nextHourStart();
  const offsets = [];
  for (let i = 0; i < 5; i += 1) {
    offsets.push(
      await reserveOverflowOffset({
        senderId: id,
        windowStart,
        spacingMs: 2000,
        maxOffsetMs: 60000,
      })
    );
  }

  assert.deepEqual(offsets, [0, 2000, 4000, 6000, 8000]);

  await getRedis().del(`email-rate-overflow:${id}:${windowStart.toISOString().slice(0, 13).replace('T', '-')}`);
});

test('overflow offsets are capped so nothing lands outside the window', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const windowStart = nextHourStart();
  let last = 0;
  for (let i = 0; i < 5; i += 1) {
    last = await reserveOverflowOffset({
      senderId: id,
      windowStart,
      spacingMs: 60000,
      maxOffsetMs: 120000,
    });
  }

  assert.equal(last, 120000);
});

test('spacing: sequential reservations are exactly one gap apart', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const now = Date.now();

  const first = await reserveSendSlot({ senderId: id, gapMs: 2000, now });
  const second = await reserveSendSlot({ senderId: id, gapMs: 2000, now });
  const third = await reserveSendSlot({ senderId: id, gapMs: 2000, now });

  assert.equal(first.waitMs, 0);
  assert.equal(second.waitMs, 2000);
  assert.equal(third.waitMs, 4000);

  await cleanup(id);
});

test('spacing: concurrent workers each receive a distinct slot', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const now = Date.now();

  // Five workers reserving simultaneously must not all be told "send now".
  const slots = await Promise.all(
    Array.from({ length: 5 }, () => reserveSendSlot({ senderId: id, gapMs: 1500, now }))
  );

  const waits = slots.map((slot) => slot.waitMs).sort((a, b) => a - b);
  assert.deepEqual(waits, [0, 1500, 3000, 4500, 6000]);
  assert.equal(new Set(slots.map((slot) => slot.slot)).size, 5);

  await cleanup(id);
});

test('spacing: releasing the newest reservation hands the slot back', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const now = Date.now();

  await reserveSendSlot({ senderId: id, gapMs: 2000, now });
  const second = await reserveSendSlot({ senderId: id, gapMs: 2000, now });
  assert.equal(second.waitMs, 2000);

  const released = await releaseSendSlot({ senderId: id, ...second });
  assert.equal(released, 1);

  // The freed instant is handed to the next caller instead of being wasted.
  const third = await reserveSendSlot({ senderId: id, gapMs: 2000, now });
  assert.equal(third.waitMs, 2000);

  await cleanup(id);
});

test('spacing: releasing a superseded reservation is a safe no-op', async (t) => {
  if (!redisAvailable) return t.skip('Redis is not reachable');

  const id = senderId();
  const now = Date.now();

  const first = await reserveSendSlot({ senderId: id, gapMs: 2000, now });
  await reserveSendSlot({ senderId: id, gapMs: 2000, now }); // supersedes `first`

  const released = await releaseSendSlot({ senderId: id, ...first });
  assert.equal(released, 0, 'a stale release must not rewind a newer reservation');

  // Losing that race only ever makes the next send later, never sooner.
  const next = await reserveSendSlot({ senderId: id, gapMs: 2000, now });
  assert.ok(next.waitMs >= 2000);

  await cleanup(id);
});
