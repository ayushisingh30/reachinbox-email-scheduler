'use strict';

const { Router } = require('express');
const campaignController = require('../controllers/campaignController');
const { requireAuth } = require('../middleware/auth');
const { scheduleLimiter } = require('./limiters');

const router = Router();

router.use(requireAuth);
router.post('/', scheduleLimiter, campaignController.createCampaign);
router.get('/', campaignController.listCampaigns);
router.get('/:id', campaignController.getCampaign);
router.post('/:id/cancel', campaignController.cancelCampaign);

module.exports = router;
