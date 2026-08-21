'use strict';

const { Router } = require('express');
const { health } = require('../controllers/healthController');
const { apiAuthRouter } = require('./auth.routes');
const sendersRouter = require('./senders.routes');
const campaignsRouter = require('./campaigns.routes');
const emailsRouter = require('./emails.routes');
const { apiLimiter } = require('./limiters');

const apiRouter = Router();

// Health must stay outside the rate limiter so probes never trip it.
apiRouter.get('/health', health);

apiRouter.use(apiLimiter);
apiRouter.use('/auth', apiAuthRouter);
apiRouter.use('/senders', sendersRouter);
apiRouter.use('/campaigns', campaignsRouter);
apiRouter.use('/emails', emailsRouter);

module.exports = { apiRouter };
