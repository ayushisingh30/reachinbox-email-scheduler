'use strict';

const senderService = require('../services/senderService');
const { getHourlyUsage } = require('../services/rateLimiter');
const { asyncHandler } = require('../utils/errors');
const { ok } = require('../utils/response');

/** GET /api/senders - the caller's own senders, with current hourly usage. */
const listSenders = asyncHandler(async (req, res) => {
  const senders = await senderService.listSenders(req.user.id);

  const withUsage = await Promise.all(
    senders.map(async (sender) => ({
      ...sender,
      usage: await getHourlyUsage({ senderId: sender.id }).catch(() => null),
    }))
  );

  return ok(res, { items: withUsage });
});

/** POST /api/senders */
const createSender = asyncHandler(async (req, res) =>
  ok(res, await senderService.createSender(req.user.id, req.body), 201)
);

module.exports = { listSenders, createSender };
