const router = require('express').Router();
const { verify } = require('../middleware/auth');
const { HttpError } = require('../errors');
const { subscribe } = require('../events');

// EventSource cannot set headers, so the JWT is accepted as a query param for this one route.
router.get('/', (req, res) => {
  const user = verify(String(req.query.token || ''));
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in to continue');
  subscribe(req, res, user);
});
module.exports = router;
