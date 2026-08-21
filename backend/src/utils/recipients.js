'use strict';

// Deliberately pragmatic rather than fully RFC 5322: it must accept every
// address a real lead list contains and reject obvious junk.
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

const MAX_LOCAL_PART = 64;
const MAX_EMAIL_LENGTH = 254;

function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  if (email.includes('..')) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at > MAX_LOCAL_PART) return false;
  return EMAIL_RE.test(email);
}

/**
 * Splits one delimited line into cells, honouring double-quoted cells so that
 * `"Doe, John","john@x.com"` yields two cells rather than three.
 */
function splitLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && (char === ',' || char === ';' || char === '\t' || char === '|')) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

/** Pulls the address out of `Display Name <user@host>` if that is the shape. */
function unwrapAngleBrackets(cell) {
  const match = /<([^<>]+)>/.exec(cell);
  return match ? match[1] : cell;
}

/**
 * Extracts recipients from raw CSV/TXT content without assuming a column name
 * or a header row: every cell of every line is tested and the ones that look
 * like an address win. Content is only ever compared, never evaluated.
 *
 * Returns { recipients, validCount, invalidCount, duplicateCount, invalidSamples }.
 */
function parseRecipientText(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  const seen = new Set();
  const recipients = [];
  const invalidSamples = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const cells = splitLine(line)
      .map((cell) => unwrapAngleBrackets(cell).trim().replace(/^["']|["']$/g, '').trim())
      .filter((cell) => cell !== '');

    // A cell only matters if it contains an "@"; names and ids are ignored
    // rather than counted as invalid addresses.
    const candidates = cells.filter((cell) => cell.includes('@'));

    for (const candidate of candidates) {
      if (!isValidEmail(candidate)) {
        invalidCount += 1;
        if (invalidSamples.length < 10) invalidSamples.push(candidate.slice(0, 120));
        continue;
      }

      const normalized = candidate.trim().toLowerCase();
      if (seen.has(normalized)) {
        duplicateCount += 1;
        continue;
      }

      seen.add(normalized);
      recipients.push(normalized);
    }
  }

  return {
    recipients,
    validCount: recipients.length,
    invalidCount,
    duplicateCount,
    invalidSamples,
  };
}

/**
 * Applies the same rules to an already-split array, which is what the JSON
 * schedule endpoint receives. The API must never trust the browser's parsing.
 *
 * Unlike a CSV cell, every array element is *meant* to be an address, so a
 * non-address entry is reported as invalid rather than quietly ignored. An
 * element that is itself a delimited blob (someone pasted a list into one
 * field) is expanded through the text parser.
 */
function normalizeRecipientList(list) {
  const empty = {
    recipients: [],
    validCount: 0,
    invalidCount: 0,
    duplicateCount: 0,
    invalidSamples: [],
  };
  if (!Array.isArray(list)) return empty;

  const seen = new Set();
  const recipients = [];
  const invalidSamples = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  const accept = (candidate) => {
    const normalized = candidate.trim().toLowerCase();
    if (seen.has(normalized)) {
      duplicateCount += 1;
      return;
    }
    seen.add(normalized);
    recipients.push(normalized);
  };

  for (const raw of list) {
    const cell = unwrapAngleBrackets(String(raw ?? ''))
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();

    if (cell === '') continue;

    if (isValidEmail(cell)) {
      accept(cell);
      continue;
    }

    if (/[\r\n,;\t|]/.test(cell)) {
      const nested = parseRecipientText(cell);
      nested.recipients.forEach(accept);
      invalidCount += nested.invalidCount;
      duplicateCount += nested.duplicateCount;
      continue;
    }

    invalidCount += 1;
    if (invalidSamples.length < 10) invalidSamples.push(cell.slice(0, 120));
  }

  return {
    recipients,
    validCount: recipients.length,
    invalidCount,
    duplicateCount,
    invalidSamples,
  };
}

module.exports = { isValidEmail, parseRecipientText, normalizeRecipientList, splitLine };
