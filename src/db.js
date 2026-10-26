const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bookleaf.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('author','admin')),
  author_id TEXT UNIQUE, phone TEXT, city TEXT, joined_date TEXT
);
CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(author_id),
  title TEXT NOT NULL, isbn TEXT, genre TEXT, publication_date TEXT, status TEXT NOT NULL,
  mrp INTEGER, royalty_per_copy INTEGER, copies_sold INTEGER NOT NULL DEFAULT 0,
  royalty_earned INTEGER NOT NULL DEFAULT 0, royalty_paid INTEGER NOT NULL DEFAULT 0,
  royalty_pending INTEGER NOT NULL DEFAULT 0, last_payout_date TEXT, print_partner TEXT,
  available_on TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id TEXT NOT NULL REFERENCES users(author_id),
  book_id TEXT REFERENCES books(book_id),
  subject TEXT NOT NULL, description TEXT NOT NULL, attachment_name TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  category TEXT NOT NULL DEFAULT 'General Inquiry', priority TEXT NOT NULL DEFAULT 'Medium',
  ai_category TEXT, ai_priority TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',          -- pending | done | fallback
  category_overridden INTEGER NOT NULL DEFAULT 0, priority_overridden INTEGER NOT NULL DEFAULT 0,
  assigned_to INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, priority, created_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id), sender_role TEXT NOT NULL,
  body TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);
CREATE TABLE IF NOT EXISTS drafts (
  ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  body TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
);
`);
module.exports = db;
