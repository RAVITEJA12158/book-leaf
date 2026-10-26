const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { HttpError } = require('../errors');

let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET not set; using a random one (sessions reset on restart).');
}
const sign = u => jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '12h' });
function verify(token) {
  try { return db.prepare('SELECT * FROM users WHERE id = ?').get(jwt.verify(token, SECRET).sub) || null; }
  catch { return null; }
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = h.startsWith('Bearer ') ? verify(h.slice(7)) : null;
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in to continue');
  req.user = user; next();
}
const requireRole = role => (req, res, next) => {
  if (req.user.role !== role) throw new HttpError(403, 'FORBIDDEN', `${role} access required`);
  next();
};
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, author_id: u.author_id, city: u.city });
module.exports = { sign, verify, requireAuth, requireRole, publicUser };
