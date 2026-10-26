const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const { HttpError } = require('../errors');
const { sign, requireAuth, publicUser } = require('../middleware/auth');

const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } } });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
router.post('/login', limiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  // Always run a hash comparison so response time does not reveal whether the email exists.
  const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  res.json({ token: sign(user), user: publicUser(user) });
});
router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
module.exports = router;
