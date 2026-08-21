'use strict';

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, message, status = 400, details) {
  const error = { message };
  if (details) error.details = details;
  return res.status(status).json({ success: false, error });
}

module.exports = { ok, fail };
