const { ZodError } = require('zod');
class HttpError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
// Central error handler: validation -> 400, known errors -> their status, everything else -> opaque 500.
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input',
      details: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })) } });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  if (err.status >= 400 && err.status < 500) {
    const code = err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    return res.status(err.status).json({ error: { code, message: err.type === 'entity.too.large' ? 'Request body too large' : 'Bad request' } });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } });
}
module.exports = { HttpError, errorHandler };
