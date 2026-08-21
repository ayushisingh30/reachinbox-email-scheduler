'use strict';

const multer = require('multer');
const { config } = require('../config');
const { badRequest } = require('../utils/errors');

const ALLOWED_EXTENSIONS = /\.(csv|txt)$/i;
const ALLOWED_MIME = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

/**
 * Recipient lists are held in memory and parsed as text; nothing is written to
 * disk and nothing is executed. The size cap is what keeps a large upload from
 * exhausting memory.
 */
const uploadRecipients = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.maxUploadBytes, files: 1, fields: 10 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_EXTENSIONS.test(file.originalname)) {
      return cb(badRequest('Only .csv and .txt files are accepted'));
    }
    if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) {
      return cb(badRequest(`Unsupported file type: ${file.mimetype}`));
    }
    return cb(null, true);
  },
}).single('file');

module.exports = { uploadRecipients };
