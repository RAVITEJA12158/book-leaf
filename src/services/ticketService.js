const db = require('../db');
const events = require('../events');
const { classify } = require('../ai/classifier');
const { heuristicClassify } = require('../ai/fallback');

const now = () => new Date().toISOString();

// Runs after the ticket is already saved, so AI failure can never block ticket creation.
async function classifyTicket(ticketId) {
  const t = db.prepare(`SELECT t.*, b.title AS book_title FROM tickets t LEFT JOIN books b ON b.book_id = t.book_id WHERE t.id = ?`).get(ticketId);
  if (!t) return;
  let result, aiStatus = 'done';
  try {
    result = await classify({ subject: t.subject, description: t.description, bookTitle: t.book_title });
  } catch (e) {
    console.warn(`[classify] ticket ${ticketId} using heuristic fallback: ${e.message}`);
    result = heuristicClassify(t); aiStatus = 'fallback';
  }
  // Re-read override flags: an admin may have changed the values while the AI call was in flight.
  const cur = db.prepare('SELECT category_overridden co, priority_overridden po FROM tickets WHERE id = ?').get(ticketId);
  db.prepare(`UPDATE tickets SET ai_category=?, ai_priority=?, ai_status=?,
      category = CASE WHEN ? THEN category ELSE ? END, priority = CASE WHEN ? THEN priority ELSE ? END, updated_at=? WHERE id=?`)
    .run(result.category, result.priority, aiStatus, cur.co, result.category, cur.po, result.priority, now(), ticketId);
  events.publish('ticket.updated', { ticketId, authorId: t.author_id });
}
module.exports = { classifyTicket };
