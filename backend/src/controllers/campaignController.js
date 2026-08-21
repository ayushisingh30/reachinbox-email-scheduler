'use strict';

const campaignService = require('../services/campaignService');
const { validateScheduleRequest, parsePagination } = require('../utils/validate');
const { asyncHandler } = require('../utils/errors');
const { ok } = require('../utils/response');

/**
 * POST /api/campaigns  (alias: POST /api/emails/schedule)
 *
 * Creates the campaign and one EmailJob per recipient, then queues a delayed
 * BullMQ job for each. Send an `Idempotency-Key` header to make a retried
 * request return the original campaign instead of scheduling it twice.
 */
const createCampaign = asyncHandler(async (req, res) => {
  const input = validateScheduleRequest({
    ...req.body,
    requestKey: req.body.requestKey || req.get('Idempotency-Key') || null,
  });

  const result = await campaignService.scheduleCampaign({
    userId: req.user.id,
    senderId: input.senderId,
    subject: input.subject,
    body: input.body,
    startTime: input.startTime,
    delayBetweenEmails: input.delayBetweenEmails,
    hourlyLimit: input.hourlyLimit,
    recipients: input.recipients,
    requestKey: input.requestKey,
  });

  return ok(
    res,
    {
      campaignId: result.campaign.id,
      scheduled: result.scheduled,
      replayed: result.replayed,
      startTime: result.campaign.startTime,
      delayBetweenEmails: input.delayBetweenEmails,
      hourlyLimit: input.hourlyLimit,
      recipients: input.parseSummary,
      message: result.replayed
        ? 'This request was already processed; returning the original campaign.'
        : `Scheduled ${result.scheduled} email${result.scheduled === 1 ? '' : 's'}.`,
    },
    result.replayed ? 200 : 201
  );
});

/** GET /api/campaigns */
const listCampaigns = asyncHandler(async (req, res) => {
  const { page, pageSize } = parsePagination(req.query);
  return ok(res, await campaignService.listCampaigns(req.user.id, { page, pageSize }));
});

/** GET /api/campaigns/:id */
const getCampaign = asyncHandler(async (req, res) =>
  ok(res, await campaignService.getCampaign(req.user.id, req.params.id))
);

/** POST /api/campaigns/:id/cancel */
const cancelCampaign = asyncHandler(async (req, res) =>
  ok(res, await campaignService.cancelCampaign(req.user.id, req.params.id))
);

module.exports = { createCampaign, listCampaigns, getCampaign, cancelCampaign };
