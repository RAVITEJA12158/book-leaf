// Integration tests: run with `npm test`. Uses a temp DB and no AI key, so it also proves graceful degradation.
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `bl-test-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
// Keep API tests offline even when the developer has a local Gemini key in .env.
process.env.GEMINI_API_KEY = '';
const test = require('node:test');
const assert = require('node:assert');
const { seed } = require('../src/seed');
const app = require('../src/server');
const { heuristicClassify } = require('../src/ai/fallback');
const { payoutWindow } = require('../src/ai/accountContext');

let base, server;
test.before(async () => { seed(); server = app.listen(0); base = `http://localhost:${server.address().port}/api`; });
test.after(() => server.close());
const call = async (method, path, token, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const login = async (email, password = 'Author@123') => (await call('POST', '/auth/login', null, { email, password })).body.token;

test('auth: bad credentials 401, validation 400, unauthenticated 401', async () => {
  assert.equal((await call('POST', '/auth/login', null, { email: 'x@y.com', password: 'nope' })).status, 401);
  assert.equal((await call('POST', '/auth/login', null, { email: 'bad' })).status, 400);
  assert.equal((await call('GET', '/tickets')).status, 401);
});
test('authors only see their own books and tickets; admin sees all', async () => {
  const priya = await login('priya.sharma@email.com'), arjun = await login('arjun.malhotra@email.com'), adm = await login('admin@bookleaf.com', 'Admin@123');
  const books = (await call('GET', '/books', priya)).body.books;
  assert.deepEqual(books.map(b => b.book_id), ['BK001', 'BK002']);
  const mine = (await call('GET', '/tickets', arjun)).body.tickets;
  assert.ok(mine.length >= 1 && mine.every(t => !('author_id' in t) && !('ai_category' in t)));
  assert.equal((await call('GET', '/tickets/1', priya)).status, 404);       // Arjun's ticket hidden from Priya
  assert.equal((await call('GET', '/tickets', adm)).body.tickets.length >= 3, true);
  assert.equal((await call('GET', '/tickets?status=bogus', adm)).status, 400);
  assert.equal((await call('POST', '/tickets', adm, {})).status, 403);       // admins cannot raise author tickets
});
test('ticket lifecycle with AI disabled: created, fallback-classified, overridable, draftable, replied', async () => {
  const kav = await login('kavita.deshmukh@email.com'), adm = await login('admin@bookleaf.com', 'Admin@123');
  assert.equal((await call('POST', '/tickets', kav, { subject: 'x', description: 'short' })).status, 400);
  assert.equal((await call('POST', '/tickets', kav, { book_id: 'BK001', subject: 'Not mine', description: 'This book is not mine at all' })).status, 400);
  const c = await call('POST', '/tickets', kav, { book_id: 'BK016', subject: 'Blurry images', description: 'My author copies arrived and the print quality is terrible, pages are misaligned.' });
  assert.equal(c.status, 201);
  const id = c.body.ticket.id;
  let t = (await call('GET', `/tickets/${id}`, adm)).body;
  for (let attempt = 0; attempt < 100 && t.ticket.ai_status === 'pending'; attempt++) {
    await new Promise(r => setTimeout(r, 50));
    t = (await call('GET', `/tickets/${id}`, adm)).body;                       // wait for async classification, up to 5s
  }
  assert.equal(t.ticket.category, 'Printing & Quality'); assert.equal(t.ticket.ai_status, 'fallback');
  const p = await call('PATCH', `/tickets/${id}`, adm, { category: 'General Inquiry', priority: 'Low', assigned_to: 'me' });
  assert.equal(p.body.ticket.category_overridden, 1); assert.equal(p.body.ticket.assignee_name, 'BookLeaf Support');
  const d = await call('POST', `/tickets/${id}/draft`, adm);
  assert.equal(d.body.draft.source, 'template'); assert.match(d.body.draft.body, /Hi Kavita/);
  await call('POST', `/tickets/${id}/notes`, adm, { body: 'internal only' });
  await call('POST', `/tickets/${id}/replies`, adm, { body: d.body.draft.body, status: 'Resolved' });
  const authorView = (await call('GET', `/tickets/${id}`, kav)).body;
  assert.equal(authorView.ticket.status, 'Resolved');
  assert.equal(authorView.messages.some(m => m.body === 'internal only' || /Category changed/.test(m.body)), false);
  assert.equal(authorView.messages.filter(m => m.sender_role === 'admin').length, 1);
});
test('hardening: 413 on huge body, pagination/search, stream auth, security headers', async () => {
  const adm = await login('admin@bookleaf.com', 'Admin@123');
  const big = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(200000) }) });
  assert.equal(big.status, 413);
  const page = (await call('GET', '/tickets?limit=1&from=2026-01-01', adm)).body;
  assert.equal(page.tickets.length, 1); assert.ok(page.total >= 3);
  assert.ok((await call('GET', '/tickets?q=ISBN', adm)).body.tickets.every(t => /isbn/i.test(t.subject + t.author_name)));
  assert.equal((await call('GET', '/tickets?limit=9999', adm)).status, 400);
  assert.equal((await fetch(base + '/events?ticket=nope')).status, 401);
  assert.equal((await fetch(base + '/events?token=' + adm)).status, 401);            // JWT in URL no longer accepted
  assert.ok((await call('POST', '/events/ticket', adm)).body.ticket);
  assert.equal((await fetch(base + '/health')).headers.get('x-content-type-options'), 'nosniff');
});
test('draft is cleared after the admin sends it, and stale draft is not resurrected', async () => {
  const adm = await login('admin@bookleaf.com', 'Admin@123');
  await call('POST', '/tickets/2/draft', adm);
  assert.ok((await call('GET', '/tickets/2', adm)).body.draft);
  await call('POST', '/tickets/2/replies', adm, { body: 'Escalated to production.' });
  assert.equal((await call('GET', '/tickets/2', adm)).body.draft, null);
});
test('heuristics and payout calendar', () => {
  const h = heuristicClassify;
  assert.equal(h({ subject: 'Royalty low', description: 'My royalty on Amazon seems too low, sold 200 copies' }).category, 'Royalty & Payments');
  assert.equal(h({ subject: 'Bio', description: 'My book is 7 months old, can I update my bio?' }).priority, 'Low');
  assert.equal(heuristicClassify({ subject: 'ISBN mismatch', description: 'wrong isbn on amazon' }).category, 'ISBN & Metadata Issues');
  assert.equal(heuristicClassify({ subject: 'No royalty', description: "I haven't received any royalty for 6 months" }).priority, 'Critical');
  assert.equal(heuristicClassify({ subject: 'Bio', description: 'Can I update my author bio?' }).priority, 'Low');
  assert.equal(payoutWindow(new Date('2026-10-26T00:00:00Z')).lastPayoutDue, '2026-11-14');
});
