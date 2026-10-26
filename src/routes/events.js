const router = require('express').Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../errors');
const { subscribe } = require('../events');

// EventSource cannot send an Authorization header. Instead of putting the long-lived JWT in the URL
// (it would end up in access logs), the client trades its JWT for a single-use ticket valid for 30s.
const tickets = new Map();
router.post('/ticket', requireAuth, (req, res) => {
  for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { user: req.user, exp: Date.now() + 30000 });
  res.json({ ticket });
});
router.get('/', (req, res) => {
  const key = String(req.query.ticket || ''); const entry = tickets.get(key); tickets.delete(key);
  if (!entry || entry.exp < Date.now()) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired stream ticket');
  subscribe(req, res, entry.user);
});
module.exports = router;
