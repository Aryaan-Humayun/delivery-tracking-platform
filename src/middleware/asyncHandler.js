// Express 4 doesn't forward rejected promises from async handlers to error
// middleware on its own - this wraps a handler so unexpected errors reach the
// global error handler instead of hanging the request.
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

module.exports = asyncHandler;
