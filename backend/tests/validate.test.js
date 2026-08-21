'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateScheduleRequest, parsePagination } = require('../src/utils/validate');
const { config } = require('../src/config');

const base = {
  senderId: 'sender-1',
  subject: 'Hello',
  body: 'Body text',
  recipients: ['a@x.io'],
};

function expectBadRequest(payload, fragment) {
  assert.throws(
    () => validateScheduleRequest(payload),
    (err) => {
      assert.equal(err.status, 400);
      if (fragment) assert.match(err.message, fragment);
      return true;
    }
  );
}

test('accepts a well formed request and applies defaults', () => {
  const result = validateScheduleRequest(base);
  assert.equal(result.subject, 'Hello');
  assert.equal(result.delayBetweenEmails, config.scheduler.defaultMinSendDelayMs);
  assert.equal(result.hourlyLimit, config.scheduler.defaultHourlyLimit);
  assert.deepEqual(result.recipients, ['a@x.io']);
  assert.ok(result.startTime instanceof Date);
});

test('re-validates recipients rather than trusting the client', () => {
  const result = validateScheduleRequest({
    ...base,
    recipients: ['Good@X.io', 'good@x.io', 'garbage', 'second@x.io'],
  });
  assert.deepEqual(result.recipients, ['good@x.io', 'second@x.io']);
  assert.equal(result.parseSummary.duplicateCount, 1);
  assert.equal(result.parseSummary.invalidCount, 1);
});

test('rejects a request with no usable recipient', () => {
  expectBadRequest({ ...base, recipients: ['nope', ''] }, /No valid recipient/);
  expectBadRequest({ ...base, recipients: [] }, /No valid recipient/);
});

test('requires subject, body and sender', () => {
  expectBadRequest({ ...base, subject: '   ' }, /subject/);
  expectBadRequest({ ...base, body: '' }, /body/);
  expectBadRequest({ ...base, senderId: undefined }, /senderId/);
});

test('converts delayBetweenSeconds to milliseconds', () => {
  const result = validateScheduleRequest({ ...base, delayBetweenSeconds: 5 });
  assert.equal(result.delayBetweenEmails, 5000);
});

test('prefers an explicit millisecond delay over the seconds field', () => {
  const result = validateScheduleRequest({ ...base, delayBetweenEmails: 750, delayBetweenSeconds: 5 });
  assert.equal(result.delayBetweenEmails, 750);
});

test('rejects out-of-range numeric settings', () => {
  expectBadRequest({ ...base, hourlyLimit: 0 }, /hourlyLimit/);
  expectBadRequest({ ...base, hourlyLimit: 'abc' }, /hourlyLimit/);
  expectBadRequest({ ...base, delayBetweenEmails: -1 }, /delayBetweenEmails/);
});

test('rejects an unparseable or absurd start time', () => {
  expectBadRequest({ ...base, startTime: 'not-a-date' }, /startTime/);
  expectBadRequest(
    { ...base, startTime: new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString() },
    /one year/
  );
});

test('accepts a past start time (the scheduler clamps it to now)', () => {
  const result = validateScheduleRequest({ ...base, startTime: '2020-01-01T00:00:00.000Z' });
  assert.equal(result.startTime.getUTCFullYear(), 2020);
});

test('truncates and bounds pagination input', () => {
  assert.deepEqual(parsePagination({}), { page: 1, pageSize: 25, search: '' });
  assert.equal(parsePagination({ pageSize: '500' }).pageSize, 200);
  assert.equal(parsePagination({ page: '3' }).page, 3);
  assert.equal(parsePagination({ search: 'x'.repeat(500) }).search.length, 200);
});
