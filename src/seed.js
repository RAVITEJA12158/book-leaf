if (process.env.NODE_ENV !== 'test') require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const AUTHOR_PASSWORD = process.env.AUTHOR_PASSWORD || 'Author@123';
const ADMIN = { email: 'admin@bookleaf.com', password: process.env.ADMIN_PASSWORD || 'Admin@123', name: 'BookLeaf Support' };
const now = () => new Date().toISOString();

function seed({ reset = false } = {}) {
  if (reset) db.exec('DELETE FROM drafts; DELETE FROM messages; DELETE FROM tickets; DELETE FROM books; DELETE FROM users;');
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return false;
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bookleaf_sample_data.json'), 'utf8'));
  const insUser = db.prepare(`INSERT INTO users (email,password_hash,name,role,author_id,phone,city,joined_date) VALUES (?,?,?,?,?,?,?,?)`);
  const insBook = db.prepare(`INSERT INTO books VALUES (@book_id,@author_id,@title,@isbn,@genre,@publication_date,@status,@mrp,@royalty_per_copy,@copies_sold,@royalty_earned,@royalty_paid,@royalty_pending,@last_payout_date,@print_partner,@available_on)`);
  const authorHash = bcrypt.hashSync(AUTHOR_PASSWORD, 10);
  db.transaction(() => {
    insUser.run(ADMIN.email, bcrypt.hashSync(ADMIN.password, 10), ADMIN.name, 'admin', null, null, null, null);
    for (const a of data.authors) {
      insUser.run(a.email.toLowerCase(), authorHash, a.name, 'author', a.author_id, a.phone, a.city, a.joined_date);
      for (const b of a.books) insBook.run({
        book_id: b.book_id, author_id: a.author_id, title: b.title, isbn: b.isbn, genre: b.genre,
        publication_date: b.publication_date, status: b.status, mrp: b.mrp, royalty_per_copy: b.author_royalty_per_copy,
        copies_sold: b.total_copies_sold, royalty_earned: b.total_royalty_earned, royalty_paid: b.royalty_paid,
        royalty_pending: b.royalty_pending, last_payout_date: b.last_royalty_payout_date, print_partner: b.print_partner,
        available_on: JSON.stringify(b.available_on || []),
      });
    }
    seedTickets();
  })();
  return true;
}

// A few demo tickets so the admin queue is not empty on first load (no AI calls needed).
function seedTickets() {
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const ins = db.prepare(`INSERT INTO tickets (author_id,book_id,subject,description,status,category,priority,ai_category,ai_priority,ai_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'done',?,?)`);
  const t1 = ins.run('AUTH006', 'BK010', 'No royalty received since publication',
    'Turban Tales has been live since September 2024 and I have sold 88 copies, but I have never received a single payout. It has been over a year. Please explain what is going on.',
    'Open', 'Royalty & Payments', 'Critical', 'Royalty & Payments', 'Critical', ago(80), ago(80)).lastInsertRowid;
  ins.run('AUTH010', 'BK017', 'ISBN on Amazon differs from my printed copy',
    'The ISBN shown on the Amazon listing for Durga’s Daughters does not match the one printed on the back of my physical copy.',
    'Open', 'ISBN & Metadata Issues', 'High', 'ISBN & Metadata Issues', 'High', ago(20), ago(20));
  const t3 = ins.run('AUTH001', null, 'Can I update my book description on Amazon?',
    'Whispers of the Ganges is live. I would like to refresh the description. Is that possible?',
    'Resolved', 'General Inquiry', 'Low', 'General Inquiry', 'Low', ago(120), ago(100)).lastInsertRowid;
  db.prepare(`INSERT INTO messages (ticket_id,sender_id,sender_role,body,internal,created_at) VALUES (?,1,'admin',?,0,?)`)
    .run(t3, 'Hi Priya,\n\nYes, metadata updates can be submitted through your dashboard or by emailing our team. Changes typically reflect on platforms within 3–5 business days.\n\nNext step: send us the new description and we will take it from there.\n\nWarm regards,\nTeam BookLeaf', ago(100));
}

module.exports = { seed, AUTHOR_PASSWORD, ADMIN };
if (require.main === module) {
  const done = seed({ reset: process.argv.includes('--reset') });
  console.log(done ? `Seeded. Admin: ${ADMIN.email} / ${ADMIN.password}; authors: <email> / ${AUTHOR_PASSWORD}` : 'DB already seeded (use --reset to rebuild).');
}
