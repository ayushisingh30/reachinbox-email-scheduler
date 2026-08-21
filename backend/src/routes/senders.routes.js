'use strict';

const { Router } = require('express');
const senderController = require('../controllers/senderController');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);
router.get('/', senderController.listSenders);
router.post('/', senderController.createSender);

module.exports = router;
