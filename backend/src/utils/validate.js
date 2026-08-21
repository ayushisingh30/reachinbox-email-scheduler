'use strict';

const { config } = require('../config');
const { badRequest } = require('./errors');
const { normalizeRecipientList } = require('./recipients');

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function requireString(value, field, { min = 1, max = 1000 } = {}) {
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`"${field}" is required`);
  if (trimmed.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  return trimmed;
}

function optionalInt(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) throw badRequest(`"${field}" must be a whole number`);
  if (min !== undefined && parsed < min) throw badRequest(`"${field}" must be at least ${min}`);
  if (max !== undefined && parsed > max) throw badRequest(`"${field}" must be at most ${max}`);
  return parsed;
}

function optionalDate(value, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`"${field}" is not a valid date`);
  if (date.getTime() > Date.now() + ONE_YEAR_MS) {
    throw badRequest(`"${field}" cannot be more than one year in the future`);
  }
  return date;
}

/**
 * Full server-side validation of a schedule request. The browser does the same
 * checks for feedback, but nothing the browser sends is trusted: recipients are
 * re-parsed, re-validated and re-deduplicated here.
 */
function validateScheduleRequest(body = {}) {
  const subject = requireString(body.subject, 'subject', {
    max: config.limits.maxSubjectLength,
  });
  const emailBody = requireString(body.body, 'body', { max: config.limits.maxBodyLength });
  const senderId = requireString(body.senderId, 'senderId', { max: 64 });

  const startTime = optionalDate(body.startTime ?? body.scheduledAt, 'startTime', new Date());

  // Accept milliseconds (canonical) or seconds (what the compose form shows).
  const delayFromSeconds =
    body.delayBetweenSeconds === undefined || body.delayBetweenSeconds === null || body.delayBetweenSeconds === ''
      ? undefined
      : Number.parseInt(String(body.delayBetweenSeconds), 10) * 1000;

  const delayBetweenEmails = optionalInt(
    body.delayBetweenEmails ?? delayFromSeconds,
    'delayBetweenEmails',
    {
      min: 0,
      max: config.limits.maxDelayBetweenEmailsMs,
      fallback: config.scheduler.defaultMinSendDelayMs,
    }
  );

  const hourlyLimit = optionalInt(body.hourlyLimit, 'hourlyLimit', {
    min: 1,
    max: config.limits.maxHourlyLimit,
    fallback: config.scheduler.defaultHourlyLimit,
  });

  const parsed = normalizeRecipientList(body.recipients);
  if (parsed.recipients.length === 0) {
    throw badRequest(
      'No valid recipient email addresses were found. Upload a CSV or TXT file containing at least one address.',
      { invalidCount: parsed.invalidCount, duplicateCount: parsed.duplicateCount }
    );
  }
  if (parsed.recipients.length > config.limits.maxRecipientsPerCampaign) {
    throw badRequest(
      `A campaign can target at most ${config.limits.maxRecipientsPerCampaign} recipients (received ${parsed.recipients.length})`
    );
  }

  const requestKey = body.requestKey ? requireString(body.requestKey, 'requestKey', { max: 200 }) : null;

  return {
    subject,
    body: emailBody,
    senderId,
    startTime,
    delayBetweenEmails,
    hourlyLimit,
    recipients: parsed.recipients,
    parseSummary: {
      validCount: parsed.validCount,
      invalidCount: parsed.invalidCount,
      duplicateCount: parsed.duplicateCount,
    },
    requestKey,
  };
}

/**
 * Pagination is clamped rather than rejected: a stale bookmark or an
 * over-eager page size should return sensible data, not a 400.
 */
function parsePagination(query = {}) {
  const clamp = (value, fallback, min, max) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  };

  return {
    page: clamp(query.page, 1, 1, 100000),
    pageSize: clamp(query.pageSize ?? query.limit, 25, 1, 200),
    search: typeof query.search === 'string' ? query.search.slice(0, 200) : '',
  };
}

module.exports = {
  requireString,
  optionalInt,
  optionalDate,
  validateScheduleRequest,
  parsePagination,
};
