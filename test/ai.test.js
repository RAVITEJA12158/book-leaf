// AI-path tests with a mocked Anthropic API (no network, no key needed). Proves prompt scoping, retries,
// circuit breaker, invalid-output handling and that admin overrides win over a late AI result.
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `bl-ai-${Date.now()}.db`);
process.env.ANTHROPIC_API_KEY = 'sk-test-key'; process.env.AS_OF_DATE = '2026-10-26'; process.env.AI_RETRY_BASE_MS = '5';
const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
require('../src/seed').seed();
const client = require('../src/ai/client');
const { classify } = require('../src/ai/classifier');
const { draftResponse } = require('../src/ai/drafter');
const app = require('../src/server');

const ok = text => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 20 } }) });
const fail = status => ({ ok: false, status, headers: { get: () => null }, json: async () => ({}) });
let handler = () => ok('{}'), calls = [];
const realFetch = global.fetch;
global.fetch = (url, opts) => String(url).includes('api.anthropic.com') ? (calls.push(JSON.parse(opts.body)), calls.at(-1).headers = opts.headers, Promise.resolve(handler(opts))) : realFetch(url, opts);
test.beforeEach(() => { calls = []; client.resetBreaker(); });

const mkTicket = (author, book, category, subject, description) => {
  const id = db.prepare(`INSERT INTO tickets (author_id,book_id,subject,description,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(author, book, subject, description, category, new Date().toISOString(), new Date().toISOString()).lastInsertRowid;
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
};

test('classifier parses valid JSON and rejects out-of-enum output', async () => {
  handler = () => ok('Sure! {"category":"Royalty & Payments","priority":"Critical","reason":"no payout"}');
  assert.deepEqual(await classify({ subject: 's', description: 'd' }), { category: 'Royalty & Payments', priority: 'Critical', reason: 'no payout' });
  handler = () => ok('{"category":"Billing","priority":"Urgent"}');
  await assert.rejects(classify({ subject: 's', description: 'd' }));
});

test('draft prompt is scoped: only the matching KB section, key only in header, below-threshold flagged', async () => {
  handler = () => ok('Hi Kavita, ...');
  const t = mkTicket('AUTH009', 'BK016', 'Royalty & Payments', 'Where is my royalty?', 'I have not been paid for The Nagpur Notebooks.');
  const d = await draftResponse(t);
  assert.equal(d.source, 'ai');
  const body = calls[0];
  assert.match(body.system, /ROYALTY POLICY/); assert.doesNotMatch(body.system, /ISBN POLICY|PRINTING & QUALITY/);
  assert.match(body.messages[0].content, /BELOW the ₹1,000/); assert.match(body.messages[0].content, /not been paid/);
  assert.equal(body.headers['x-api-key'], 'sk-test-key'); assert.doesNotMatch(JSON.stringify(body.messages), /sk-test-key/);
  assert.ok(body.max_tokens <= 450);
});

test('royalty context computes an overdue verdict from data, not from the model', async () => {
  handler = () => ok('draft');
  await draftResponse(mkTicket('AUTH006', 'BK010', 'Royalty & Payments', 'No royalty', 'Never paid'));   // Arjun: 88 copies, never paid
  assert.match(calls[0].messages[0].content, /LIKELY OVERDUE/);
  calls = [];
  await draftResponse(mkTicket('AUTH009', null, 'Royalty & Payments', 'Royalty', 'Status?'));            // Kavita: ₹850 pending
  assert.doesNotMatch(calls[0].messages[0].content, /LIKELY OVERDUE/);
});

test('in-production book is described as unpublished (no invented royalties)', async () => {
  handler = () => ok('draft');
  await draftResponse(mkTicket('AUTH009', 'BK015', 'Book Status & Production Updates', 'Typesetting delay', 'Still in typesetting after 3 weeks'));
  assert.match(calls[0].messages[0].content, /NOT PUBLISHED YET[\s\S]*Typesetting/);
});

test('retries once on 429 then succeeds', async () => {
  let n = 0; handler = () => (++n === 1 ? fail(429) : ok('{"category":"General Inquiry","priority":"Low"}'));
  assert.equal((await classify({ subject: 's', description: 'd' })).priority, 'Low'); assert.equal(calls.length, 2);
});

test('does not retry 401 (bad key); drafter degrades to template', async () => {
  handler = () => fail(401);
  const d = await draftResponse(mkTicket('AUTH001', null, 'General Inquiry', 'Bio', 'Can I update my bio?'));
  assert.equal(d.source, 'template'); assert.equal(calls.length, 1);
});

test('circuit breaker opens after 3 failed calls and stops hitting the API', async () => {
  handler = () => fail(500);
  for (let i = 0; i < 3; i++) await assert.rejects(client.complete({ system: 's', user: 'u' }));
  const before = calls.length;
  await assert.rejects(client.complete({ system: 's', user: 'u' }), /temporarily disabled/);
  assert.equal(calls.length, before);
});

test('admin override made while the AI call is in flight is not overwritten', async () => {
  const server = app.listen(0); const base = `http://localhost:${server.address().port}/api`;
  const call = async (m, p, tok, b) => (await realFetch(base + p, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: b && JSON.stringify(b) })).json();
  const login = async (e, pw) => (await (await realFetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: pw }) })).json()).token;
  const author = await login('meera.nair@email.com', 'Author@123'), adm = await login('admin@bookleaf.com', 'Admin@123');
  handler = () => new Promise(r => setTimeout(() => r(ok('{"category":"General Inquiry","priority":"Low"}')), 250));
  const { ticket } = await call('POST', '/tickets', author, { subject: 'Printing defect', description: 'Binding came apart on my author copies, please help.' });
  await call('PATCH', `/tickets/${ticket.id}`, adm, { priority: 'Critical', category: 'Printing & Quality' });
  await new Promise(r => setTimeout(r, 600));
  const t = (await call('GET', `/tickets/${ticket.id}`, adm)).ticket;
  assert.equal(t.priority, 'Critical'); assert.equal(t.category, 'Printing & Quality'); assert.equal(t.ai_priority, 'Low'); assert.equal(t.ai_status, 'done');
  server.close();
});
