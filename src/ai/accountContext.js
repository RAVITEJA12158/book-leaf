// Builds a compact, ticket-relevant snapshot of the author's account (instead of dumping everything).
const db = require('../db');
const iso = d => d.toISOString().slice(0, 10);
const DAY = 864e5;
const inr = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// Quarterly cycle: paid within 45 days of quarter end.
function payoutWindow(now = new Date()) {
  const y = now.getUTCFullYear();
  const ends = [[y - 1, 11, 31], [y, 2, 31], [y, 5, 30], [y, 8, 30], [y, 11, 31]].map(([a, m, d]) => new Date(Date.UTC(a, m, d)));
  const last = [...ends].reverse().find(d => d <= now);
  const next = ends.find(d => d > now);
  const due = d => new Date(d.getTime() + 45 * DAY);
  return { lastQuarterEnd: iso(last), lastPayoutDue: iso(due(last)), nextQuarterEnd: iso(next), nextPayoutDue: iso(due(next)) };
}
const monthsSince = (dateStr, now) => dateStr ? Math.max(0, Math.round((now - new Date(dateStr)) / (30.4 * DAY))) : null;

function bookLine(b, now) {
  if (!b.publication_date) return `- ${b.title} (${b.book_id}): NOT PUBLISHED YET. Production stage: "${b.status}". No sales or royalties yet; no publication date or MRP set.`;
  const neverPaid = b.royalty_paid === 0 && b.royalty_pending > 0;
  return `- ${b.title} (${b.book_id}): status "${b.status}"; published ${b.publication_date} (${monthsSince(b.publication_date, now)} months ago); ISBN ${b.isbn}; MRP ${inr(b.mrp)}; ` +
    `${b.copies_sold} copies sold; royalty/copy ${inr(b.royalty_per_copy)}; earned ${inr(b.royalty_earned)}, paid ${inr(b.royalty_paid)}, pending ${inr(b.royalty_pending)}; ` +
    `last payout ${b.last_payout_date || 'NONE YET'}${neverPaid ? ' (never paid despite pending balance)' : ''}; printer ${b.print_partner}; listed on ${JSON.parse(b.available_on).join(', ') || 'nowhere'}.`;
}

function buildAccountContext(ticket, now = new Date()) {
  const author = db.prepare('SELECT name, joined_date FROM users WHERE author_id = ?').get(ticket.author_id);
  const all = db.prepare('SELECT * FROM books WHERE author_id = ?').all(ticket.author_id);
  const isRoyalty = ticket.category === 'Royalty & Payments';
  // Only the referenced book, unless it's a royalty/account-level ticket where totals matter.
  const books = ticket.book_id ? all.filter(b => b.book_id === ticket.book_id) : (isRoyalty ? all : all.slice(0, 5));
  const lines = [`Today: ${iso(now)}`, `Author: ${author.name} (joined ${author.joined_date})`,
    ticket.book_id ? 'Ticket is about the book below.' : 'Ticket is general / account level.', ...books.map(b => bookLine(b, now))];
  if (isRoyalty) {
    const pending = all.reduce((s, b) => s + b.royalty_pending, 0);
    const w = payoutWindow(now);
    lines.push(`Author-wide pending royalty: ${inr(pending)} (${pending >= 1000 ? 'meets' : 'BELOW'} the ₹1,000 payout threshold${pending < 1000 ? '; rolls over to next quarter' : ''}).`,
      `Payout calendar: last quarter ended ${w.lastQuarterEnd}, its payout due by ${w.lastPayoutDue}; next quarter ends ${w.nextQuarterEnd}, payout due by ${w.nextPayoutDue}.`,
      `Bank-account link status: UNKNOWN (not in data) - ask the author to confirm in their dashboard.`);
  }
  return lines.join('\n');
}
module.exports = { buildAccountContext, payoutWindow };
