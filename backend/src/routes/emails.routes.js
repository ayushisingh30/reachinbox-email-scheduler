'use strict';

const { Router } = require('express');
const emailController = require('../controllers/emailController');
const campaignController = require('../controllers/campaignController');
const { requireAuth } = require('../middleware/auth');
const { uploadRecipients } = require('../middleware/upload');
const { scheduleLimiter, uploadLimiter } = require('./limiters');

const router = Router();

router.use(requireAuth);

// Alias of POST /api/campaigns; both create a campaign and queue its emails.
router.post('/schedule', scheduleLimiter, campaignController.createCampaign);

router.post('/parse-recipients', uploadLimiter, uploadRecipients, emailController.parseRecipients);

router.get('/scheduled', emailController.listScheduled);
router.get('/sent', emailController.listSent);
router.get('/stats', emailController.stats);

// Declared after the literal paths so "scheduled" is never read as an id.
router.get('/:id', emailController.getEmail);
router.post('/:id/cancel', emailController.cancelEmail);

module.exports = router;
