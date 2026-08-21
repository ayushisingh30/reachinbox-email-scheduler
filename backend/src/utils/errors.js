'use strict';

/** An error that is safe to surface to the client verbatim. */
class AppError extends Error {
  constructor(message, status = 500, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.expose = true;
    if (details) this.details = details;
  }
}

const badRequest = (message, details) => new AppError(message, 400, details);
const unauthorized = (message = 'Authentication required') => new AppError(message, 401);
const forbidden = (message = 'You do not have access to this resource') => new AppError(message, 403);
const notFound = (message = 'Resource not found') => new AppError(message, 404);
const conflict = (message) => new AppError(message, 409);
const serverError = (message = 'Internal server error') => new AppError(message, 500);

/** Wraps an async express handler so rejections reach the error middleware. */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  serverError,
  asyncHandler,
};
