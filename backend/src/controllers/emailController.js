'use strict';

const emailService = require('../services/emailService');
const { parsePagination } = require('../utils/validate');
const { parseRecipientText } = require('../utils/recipients');
const { asyncHandler, badRequest } = require('../utils/errors');
const { ok } = require('../utils/response');
const { config } = require('../config');

/** GET /api/emails/scheduled */
const listScheduled = asyncHandler(async (req, res) => {
  const options = parsePagination(req.query);
  return ok(res, await emailService.listScheduled(req.user.id, options));
});

/** GET /api/emails/sent */
const listSent = asyncHandler(async (req, res) => {
  const options = parsePagination(req.query);
  return ok(res, await emailService.listSent(req.user.id, options));
});

/** GET /api/emails/stats */
const stats = asyncHandler(async (req, res) => ok(res, await emailService.getStats(req.user.id)));

/** GET /api/emails/:id */
const getEmail = asyncHandler(async (req, res) =>
  ok(res, await emailService.getEmailJob(req.user.id, req.params.id))
);

/** POST /api/emails/:id/cancel */
const cancelEmail = asyncHandler(async (req, res) =>
  ok(res, await emailService.cancelEmailJob(req.user.id, req.params.id))
);

/**
 * POST /api/emails/parse-recipients
 *
 * Server-side parsing of an uploaded CSV/TXT list. The browser previews the
 * same numbers for UX, but this endpoint is what the backend trusts: content is
 * only ever read as text and compared against a pattern, never executed.
 */
const parseRecipients = asyncHandler(async (req, res) => {
  const inlineText = typeof req.body?.text === 'string' ? req.body.text : null;

  if (!req.file && !inlineText) {
    throw badRequest('Attach a CSV or TXT file in the "file" field, or send a "text" field');
  }

  const raw = req.file ? req.file.buffer.toString('utf8') : inlineText;
  const parsed = parseRecipientText(raw);

  if (parsed.recipients.length > config.limits.maxRecipientsPerCampaign) {
    throw badRequest(
      `The file contains ${parsed.recipients.length} addresses, above the ${config.limits.maxRecipientsPerCampaign} limit`
    );
  }

  return ok(res, {
    recipients: parsed.recipients,
    validCount: parsed.validCount,
    invalidCount: parsed.invalidCount,
    duplicateCount: parsed.duplicateCount,
    invalidSamples: parsed.invalidSamples,
  });
});

module.exports = {
  listScheduled,
  listSent,
  stats,
  getEmail,
  cancelEmail,
  parseRecipients,
};
