'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planSchedule, idempotencyKeyFor } = require('../src/services/schedulePlanner');
const { HOUR_MS } = require('../src/utils/time');

const START = Date.UTC(2026, 7, 21, 10, 0, 0);

test('spaces sends by the configured delay', () => {
  const times = planSchedule({ startMs: START, count: 5, delayMs: 2000, hourlyLimit: 100 });
  assert.deepEqual(
    times.map((time) => time - START),
    [0, 2000, 4000, 6000, 8000]
  );
});

test('never schedules everything at the same instant', () => {
  const times = planSchedule({ startMs: START, count: 100, delayMs: 2000, hourlyLimit: 1000 });
  assert.equal(new Set(times).size, 100);
});

test('pushes recipients past the hourly limit into later hourly waves', () => {
  const times = planSchedule({ startMs: START, count: 250, delayMs: 1000, hourlyLimit: 100 });
  assert.equal(times[0] - START, 0);
  assert.equal(times[99] - START, 99 * 1000);
  assert.equal(times[100] - START, HOUR_MS);
  assert.equal(times[199] - START, HOUR_MS + 99 * 1000);
  assert.equal(times[200] - START, 2 * HOUR_MS);
});

test('1000 emails at 100/hour and 2s spacing span ten hourly waves', () => {
  const times = planSchedule({ startMs: START, count: 1000, delayMs: 2000, hourlyLimit: 100 });
  const waves = new Set(times.map((time) => Math.floor((time - START) / HOUR_MS)));
  assert.deepEqual([...waves].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // No wave may exceed the hourly allowance.
  for (const wave of waves) {
    const inWave = times.filter((time) => Math.floor((time - START) / HOUR_MS) === wave);
    assert.ok(inWave.length <= 100, `wave ${wave} holds ${inWave.length} emails`);
  }
});

test('a long delay dominates the hourly wave rather than being overridden', () => {
  const times = planSchedule({ startMs: START, count: 3, delayMs: 90 * 60 * 1000, hourlyLimit: 1 });
  assert.equal(times[1] - START, 90 * 60 * 1000);
  assert.equal(times[2] - START, 180 * 60 * 1000);
});

test('degenerate inputs are clamped instead of producing NaN', () => {
  const times = planSchedule({ startMs: START, count: 3, delayMs: -5, hourlyLimit: 0 });
  assert.deepEqual(times, [START, START + HOUR_MS, START + 2 * HOUR_MS]);
});

test('idempotency keys are stable per campaign and recipient', () => {
  const a = idempotencyKeyFor('campaign-1', 'x@y.io');
  assert.equal(a, idempotencyKeyFor('campaign-1', 'x@y.io'));
  assert.notEqual(a, idempotencyKeyFor('campaign-2', 'x@y.io'));
  assert.notEqual(a, idempotencyKeyFor('campaign-1', 'z@y.io'));
  assert.match(a, /^[0-9a-f]{64}$/);
});
