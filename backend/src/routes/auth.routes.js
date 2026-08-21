'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { requireAuth, optionalAuth } = require('../middleware/auth');

/** Routes mounted at /auth - the browser-facing OAuth redirects. */
const oauthRouter = Router();

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

oauthRouter.get('/google', oauthLimiter, authController.startGoogleLogin);
oauthRouter.get('/google/callback', oauthLimiter, authController.googleCallback);

/** Routes mounted at /api/auth - consumed by the SPA via fetch. */
const apiAuthRouter = Router();

apiAuthRouter.get('/me', optionalAuth, authController.me);
apiAuthRouter.post('/logout', optionalAuth, authController.logout);
// Convenience redirect so the frontend only needs to know the API base URL.
apiAuthRouter.get('/google', oauthLimiter, authController.startGoogleLogin);

module.exports = { oauthRouter, apiAuthRouter, requireAuth };
