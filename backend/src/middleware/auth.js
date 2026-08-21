'use strict';

const { prisma } = require('../db/prisma');
const { readSession } = require('../auth/session');
const { unauthorized, asyncHandler } = require('../utils/errors');

/**
 * Rejects the request unless it carries a valid session AND that session still
 * maps to a live user row. Checking the database means a deleted account stops
 * working immediately instead of at token expiry.
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const payload = readSession(req);
  if (!payload || !payload.sub) throw unauthorized('Authentication required');

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true },
  });
  if (!user) throw unauthorized('Your session is no longer valid. Please sign in again.');

  req.user = user;
  next();
});

/** Same lookup, but never fails; used by GET /api/auth/me. */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const payload = readSession(req);
  if (payload && payload.sub) {
    req.user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true },
    });
  }
  next();
});

module.exports = { requireAuth, optionalAuth };
