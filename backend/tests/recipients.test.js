'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidEmail,
  parseRecipientText,
  normalizeRecipientList,
} = require('../src/utils/recipients');

test('accepts ordinary addresses and rejects malformed ones', () => {
  for (const good of ['a@b.co', 'first.last+tag@sub.example.com', "o'neil@example.io"]) {
    assert.equal(isValidEmail(good), true, `expected ${good} to be valid`);
  }
  for (const bad of ['', 'no-at-sign', 'a@@b.com', 'a@b', 'a..b@c.com', '@b.com', 'a@.com']) {
    assert.equal(isValidEmail(bad), false, `expected ${bad} to be invalid`);
  }
});

test('parses a headered CSV without knowing the column name', () => {
  const csv = ['FullName,WorkAddress,Company', 'John Doe,john@acme.io,Acme', 'Jane Roe,jane@acme.io,Acme'].join('\n');
  const result = parseRecipientText(csv);
  assert.deepEqual(result.recipients, ['john@acme.io', 'jane@acme.io']);
  assert.equal(result.invalidCount, 0);
});

test('handles quoted cells, angle brackets and bare TXT lines', () => {
  const input = [
    '"Doe, John","john@acme.io"',
    'Jane Roe <jane@acme.io>',
    'plain@acme.io',
    'Name; semi@acme.io',
    'tab\tseparated@acme.io',
  ].join('\n');

  const result = parseRecipientText(input);
  assert.deepEqual(result.recipients, [
    'john@acme.io',
    'jane@acme.io',
    'plain@acme.io',
    'semi@acme.io',
    'separated@acme.io',
  ]);
});

test('removes duplicates case-insensitively and counts them', () => {
  const result = parseRecipientText(['a@x.io', 'A@X.IO', ' a@x.io ', 'b@x.io'].join('\n'));
  assert.deepEqual(result.recipients, ['a@x.io', 'b@x.io']);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.validCount, 2);
});

test('reports invalid addresses instead of silently dropping them', () => {
  const result = parseRecipientText(['good@x.io', 'bad@@x.io', 'also bad@', 'John Doe'].join('\n'));
  assert.equal(result.validCount, 1);
  assert.equal(result.invalidCount, 2);
  assert.ok(result.invalidSamples.includes('bad@@x.io'));
});

test('ignores a UTF-8 BOM and blank lines', () => {
  const result = parseRecipientText('\uFEFFEmail\n\n  \nonly@x.io\n');
  assert.deepEqual(result.recipients, ['only@x.io']);
});

test('normalizeRecipientList counts a non-address array entry as invalid', () => {
  // In a CSV a "nope" cell is just a name column, but every element of the
  // JSON recipients array is meant to be an address.
  const result = normalizeRecipientList(['A@x.io', 'a@x.io', 'nope', 'b@x.io']);
  assert.deepEqual(result.recipients, ['a@x.io', 'b@x.io']);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.invalidCount, 1);
  assert.deepEqual(result.invalidSamples, ['nope']);
});

test('normalizeRecipientList expands a delimited blob pasted into one element', () => {
  const result = normalizeRecipientList(['a@x.io, b@x.io', 'c@x.io']);
  assert.deepEqual(result.recipients, ['a@x.io', 'b@x.io', 'c@x.io']);
  assert.equal(result.invalidCount, 0);
});

test('normalizeRecipientList tolerates a non-array payload', () => {
  const result = normalizeRecipientList(null);
  assert.deepEqual(result.recipients, []);
});
