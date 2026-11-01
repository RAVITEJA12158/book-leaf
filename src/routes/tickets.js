const router = require('express').Router();
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const events = require('../events');
const { HttpError } = require('../errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { CATEGORIES, PRIORITIES, STATUSES } = require('../constants');
const { classifyTicket } = require('../services/ticketService');
const { draftResponse } = require('../ai/drafter');

router.use(requireAuth);
const now = () => new Date().toISOString();
const admin = requireRole('admin');
const author = requireRole('author');
// Per-user hourly caps protect AI spend: ticket creation triggers a classify call, drafts/re-runs trigger more.
const perUser = (limit, message) => rateLimit({ windowMs: 3600e3, limit, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => `u${req.user.id}`, message: { error: { code: 'RATE_LIMITED', message } } });
const createLimiter = perUser(20, 'Too many tickets submitted. Please try again in an hour.');
const aiLimiter = perUser(120, 'AI request limit reached. Please try again later.');

const BASE = `SELECT t.*, u.name AS author_name, b.title AS book_title, a.name AS assignee_name
  FROM tickets t JOIN users u ON u.author_id = t.author_id
  LEFT JOIN books b ON b.book_id = t.book_id LEFT JOIN users a ON a.id = t.assigned_to`;

function authorView(t) {
  return { id: t.id, subject: t.subject, description: t.description, status: t.status, book_id: t.book_id,
    book_title: t.book_title, attachment_name: t.attachment_name, created_at: t.created_at, updated_at: t.updated_at };
}
// Loads a ticket and enforces ownership: authors get 404 (not 403) for other authors' tickets so IDs don't leak.
function loadTicket(req) {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const t = db.prepare(`${BASE} WHERE t.id = ?`).get(id);
  if (!t || (req.user.role === 'author' && t.author_id !== req.user.author_id)) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
  return t;
}
const addMessage = (ticketId, user, body, internal = 0) => db.prepare(
  `INSERT INTO messages (ticket_id, sender_id, sender_role, body, internal, created_at) VALUES (?,?,?,?,?,?)`).run(ticketId, user.id, user.role, body, internal, now());
const touch = (id, authorId, extra = {}) => events.publish('ticket.updated', { ticketId: id, authorId, ...extra });

// ---- List ----
const listQuery = z.object({
  status: z.enum([...STATUSES, 'active']).optional(), category: z.enum(CATEGORIES).optional(), priority: z.enum(PRIORITIES).optional(),
  assigned: z.enum(['me', 'unassigned']).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
  sort: z.enum(['urgency', 'newest', 'oldest']).default('urgency'),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
const PRI_RANK = `CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END`;
const SORTS = {
  // Unresolved first, then most urgent, then oldest: the queue's "what needs me now" order.
  urgency: `(t.status IN ('Resolved','Closed')), ${PRI_RANK}, t.created_at ASC`,
  newest: 't.created_at DESC', oldest: 't.created_at ASC',
};
router.get('/', (req, res) => {
  const q = listQuery.parse(req.query);
  const where = [], p = [];
  if (req.user.role === 'author') { where.push('t.author_id = ?'); p.push(req.user.author_id); }
  if (q.status === 'active') where.push(`t.status IN ('Open','In Progress')`); else if (q.status) { where.push('t.status = ?'); p.push(q.status); }
  if (q.category) { where.push('t.category = ?'); p.push(q.category); }
  if (q.priority) { where.push('t.priority = ?'); p.push(q.priority); }
  if (q.assigned === 'me') { where.push('t.assigned_to = ?'); p.push(req.user.id); }
  if (q.assigned === 'unassigned') where.push('t.assigned_to IS NULL');
  if (q.from) { where.push('t.created_at >= ?'); p.push(q.from); }
  if (q.to) { where.push('t.created_at <= ?'); p.push(`${q.to}T23:59:59.999Z`); }
  if (q.q) { where.push('(t.subject LIKE ? OR u.name LIKE ? OR CAST(t.id AS TEXT) = ?)'); p.push(`%${q.q}%`, `%${q.q}%`, q.q); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM tickets t JOIN users u ON u.author_id = t.author_id ${w}`).get(...p).c;
  const order = req.user.role === 'author' ? 't.created_at DESC' : SORTS[q.sort];
  const rows = db.prepare(`${BASE} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...p, q.limit, q.offset);
  res.json({ tickets: req.user.role === 'author' ? rows.map(authorView) : rows, total, limit: q.limit, offset: q.offset });
});

// ---- Create (authors) ----
const createSchema = z.object({
  book_id: z.string().nullish(), subject: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10).max(5000), attachment_name: z.string().max(255).nullish(),
});
router.post('/', author, createLimiter, (req, res) => {
  const b = createSchema.parse(req.body);
  if (b.book_id && !db.prepare('SELECT 1 FROM books WHERE book_id = ? AND author_id = ?').get(b.book_id, req.user.author_id))
    throw new HttpError(400, 'INVALID_BOOK', 'That book is not on your account');
  const ts = now();
  const id = db.prepare(`INSERT INTO tickets (author_id, book_id, subject, description, attachment_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.author_id, b.book_id || null, b.subject, b.description, b.attachment_name || null, ts, ts).lastInsertRowid;
  events.publish('ticket.created', { ticketId: id, authorId: req.user.author_id });
  setImmediate(() => classifyTicket(id).catch(e => console.error('[classify]', e)));   // async: response does not wait for AI
  res.status(201).json({ ticket: authorView(loadTicket({ params: { id }, user: req.user })) });
});

// ---- Detail ----
router.get('/:id', (req, res) => {
  const t = loadTicket(req);
  const isAdmin = req.user.role === 'admin';
  const messages = db.prepare(`SELECT m.id, m.sender_role, m.body, m.internal, m.created_at, u.name AS sender_name
    FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.ticket_id = ? ${isAdmin ? '' : 'AND m.internal = 0'} ORDER BY m.id`).all(t.id);
  if (!isAdmin) return res.json({ ticket: authorView(t), messages: messages.map(({ internal, ...m }) => m) });
  res.json({ ticket: t, messages, draft: db.prepare('SELECT body, source, created_at FROM drafts WHERE ticket_id = ?').get(t.id) || null });
});

// ---- Replies: admin response (visible to author) or author follow-up ----
const replySchema = z.object({ body: z.string().trim().min(1).max(5000), status: z.enum(STATUSES).optional() });
router.post('/:id/replies', (req, res) => {
  const t = loadTicket(req); const { body, status } = replySchema.parse(req.body);
  if (req.user.role === 'author') {
    if (t.status === 'Closed') throw new HttpError(409, 'TICKET_CLOSED', 'This ticket is closed. Please raise a new query.');
    addMessage(t.id, req.user, body);
    // Follow-up on a resolved ticket reopens it; stale AI draft no longer matches the thread.
    db.prepare(`UPDATE tickets SET status = CASE WHEN status='Resolved' THEN 'Open' ELSE status END, updated_at=? WHERE id=?`).run(now(), t.id);
    db.prepare('DELETE FROM drafts WHERE ticket_id = ?').run(t.id);
  } else {
    addMessage(t.id, req.user, body);
    const next = status || (t.status === 'Open' ? 'In Progress' : t.status);
    db.prepare(`UPDATE tickets SET status=?, assigned_to=COALESCE(assigned_to, ?), updated_at=? WHERE id=?`).run(next, req.user.id, now(), t.id);
    db.prepare('DELETE FROM drafts WHERE ticket_id = ?').run(t.id);   // sent: the cached draft is now stale
  }
  touch(t.id, t.author_id);
  res.status(201).json({ ok: true });
});

// ---- Admin: internal notes, updates, AI draft ----
router.post('/:id/notes', admin, (req, res) => {
  const t = loadTicket(req); const { body } = z.object({ body: z.string().trim().min(1).max(3000) }).parse(req.body);
  addMessage(t.id, req.user, body, 1);
  touch(t.id, t.author_id, { adminOnly: true });
  res.status(201).json({ ok: true });
});

const patchSchema = z.object({
  status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional(), priority: z.enum(PRIORITIES).optional(),
  assigned_to: z.enum(['me']).nullable().optional(),
}).refine(o => Object.keys(o).length > 0, 'Provide at least one field to update');
router.patch('/:id', admin, (req, res) => {
  const t = loadTicket(req); const b = patchSchema.parse(req.body);
  const sets = [], p = [];
  if (b.status) { sets.push('status=?'); p.push(b.status); }
  if (b.category) {
    sets.push('category=?', 'category_overridden=?'); p.push(b.category, b.category !== t.ai_category ? 1 : 0);
    if (b.category !== t.category) { addMessage(t.id, req.user, `Category changed: ${t.category} -> ${b.category}${t.ai_category ? ` (AI suggested: ${t.ai_category})` : ''}`, 1); db.prepare('DELETE FROM drafts WHERE ticket_id=?').run(t.id); }
  }
  if (b.priority) {
    sets.push('priority=?', 'priority_overridden=?'); p.push(b.priority, b.priority !== t.ai_priority ? 1 : 0);
    if (b.priority !== t.priority) addMessage(t.id, req.user, `Priority changed: ${t.priority} -> ${b.priority}${t.ai_priority ? ` (AI suggested: ${t.ai_priority})` : ''}`, 1);
  }
  if ('assigned_to' in b) { sets.push('assigned_to=?'); p.push(b.assigned_to === 'me' ? req.user.id : null); }
  db.prepare(`UPDATE tickets SET ${sets.join(', ')}, updated_at=? WHERE id=?`).run(...p, now(), t.id);
  touch(t.id, t.author_id);
  res.json({ ticket: loadTicket(req) });
});

router.post('/:id/classify', admin, aiLimiter, async (req, res) => {     // re-run AI triage (e.g. after an outage)
  const t = loadTicket(req); await classifyTicket(t.id); res.json({ ticket: loadTicket(req) });
});

router.post('/:id/draft', admin, aiLimiter, async (req, res) => {
  const t = loadTicket(req);
  const d = await draftResponse(t);      // never throws on AI failure; falls back to a template
  db.prepare(`INSERT INTO drafts (ticket_id, body, source, created_at) VALUES (?,?,?,?)
    ON CONFLICT(ticket_id) DO UPDATE SET body=excluded.body, source=excluded.source, created_at=excluded.created_at`).run(t.id, d.body, d.source, now());
  res.json({ draft: { body: d.body, source: d.source }, ai_error: d.error || null });
});
module.exports = router;
