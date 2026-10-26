const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
// Authors: always scoped to their own author_id. Admins: all books, optional ?author_id= filter.
router.get('/', (req, res) => {
  const { user } = req;
  const rows = user.role === 'author'
    ? db.prepare('SELECT * FROM books WHERE author_id = ? ORDER BY publication_date IS NULL, publication_date').all(user.author_id)
    : req.query.author_id ? db.prepare('SELECT * FROM books WHERE author_id = ?').all(String(req.query.author_id)) : db.prepare('SELECT * FROM books').all();
  res.json({ books: rows.map(b => ({ ...b, available_on: JSON.parse(b.available_on) })) });
});
module.exports = router;
