'use strict';

const { getRedis } = require('../db/redis');

const SPACING_KEY_PREFIX = 'email-spacing';

/**
 * Reserves the next send instant for a sender. Because the read and the write
 * happen in one Lua call, N concurrent workers get N distinct slots spaced
 * `gapMs` apart rather than all reading the same "last sent" value and firing
 * together. Returns the wait, the reserved slot and the value it replaced so
 * the reservation can be rolled back.
 */
const RESERVE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local last = tonumber(redis.call('GET', key) or '0')
local slot = now
if last + gap > now then
  slot = last + gap
end
redis.call('SET', key, slot, 'PX', ttl)
return {slot - now, slot, last}
`;

/**
 * Gives a reserved slot back, but only if nobody has reserved a later one in
 * the meantime. Losing the race is harmless: the sender simply waits slightly
 * longer than required, which never violates the minimum delay.
 */
const RELEASE_SCRIPT = `
local key = KEYS[1]
local expected = ARGV[1]
local previous = ARGV[2]
local ttl = tonumber(ARGV[3])
if redis.call('GET', key) == expected then
  redis.call('SET', key, previous, 'PX', ttl)
  return 1
end
return 0
`;

let registered = false;

function client() {
  const redis = getRedis();
  if (!registered) {
    redis.defineCommand('reserveSendSlot', { numberOfKeys: 1, lua: RESERVE_SCRIPT });
    redis.defineCommand('releaseSendSlot', { numberOfKeys: 1, lua: RELEASE_SCRIPT });
    registered = true;
  }
  return redis;
}

function spacingKey(senderId) {
  return `${SPACING_KEY_PREFIX}:${senderId}`;
}

function ttlFor(gapMs) {
  return Math.max(60000, gapMs * 10);
}

async function reserveSendSlot({ senderId, gapMs, now = Date.now() }) {
  const gap = Math.max(0, gapMs);
  const [waitMs, slot, previous] = await client().reserveSendSlot(
    spacingKey(senderId),
    String(now),
    String(gap),
    String(ttlFor(gap))
  );

  return { waitMs: Number(waitMs), slot: String(slot), previous: String(previous), gapMs: gap };
}

async function releaseSendSlot({ senderId, slot, previous, gapMs }) {
  return client().releaseSendSlot(
    spacingKey(senderId),
    String(slot),
    String(previous),
    String(ttlFor(Math.max(0, gapMs)))
  );
}

module.exports = { SPACING_KEY_PREFIX, spacingKey, reserveSendSlot, releaseSendSlot };
