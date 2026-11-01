# BookLeaf Author Support & Communication Portal

Two portals (author + admin) on one Node/Express service, with AI-assisted ticket triage and response drafting.
**Live demo:** https://bookleaf-portal-4zzq.onrender.com
**Confidential assignment: keep the repo private.**

## Quick start
```bash
npm install
cp .env.example .env        # set JWT_SECRET and GEMINI_API_KEY
npm start                   # http://localhost:3000, auto-seeds on first run
npm test                    # 14 tests: API + mocked-AI paths (no key or network needed)
npm run seed                # wipe and re-seed the DB
```
Requires Node 22+. The app runs **without** an API key: tickets are still created, classified by rules, and admins get a template to edit.

### Test logins (seeded from `bookleaf_sample_data.json`)
| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookleaf.com` | `Admin@123` |
| Authors (all 10) | e.g. `priya.sharma@email.com`, `arjun.malhotra@email.com`, `kavita.deshmukh@email.com`, `sneha.kulkarni@email.com` | `Author@123` |

Useful edge cases: **Kavita** (book in production + ₹850 pending, below the ₹1,000 threshold), **Sneha** (3 books, one in cover design), **Arjun / Ananya / Diya** (pending royalty, never paid). 3 demo tickets are pre-seeded.

### Deploy on Render
This SQLite version is configured for a single Render web service. The free Blueprint in `render.yaml` has no persistent disk, so the database is stored on Render's temporary filesystem and can be lost when the service restarts, spins down, or redeploys. The Blueprint generates `JWT_SECRET` and prompts for `GEMINI_API_KEY`, `ADMIN_PASSWORD`, and `AUTHOR_PASSWORD`. It also sets `GEMINI_MODEL=gemini-3.5-flash-lite`.

1. Push this repository to GitHub.
2. In Render, create a **Blueprint** and select the repository. Render reads `render.yaml` and proposes the free web service.
3. Enter your Gemini API key and choose strong `ADMIN_PASSWORD` and `AUTHOR_PASSWORD` values when Render prompts for them. Set these before the first deploy because the seed runs only when the database is empty.
4. Deploy. On first start, the service creates the SQLite schema and seeds the sample accounts and books.
5. Open the service URL and sign in using the seeded email addresses and passwords in the Test logins table above.

**Cost and storage:** The free service has an ephemeral filesystem, so its SQLite data can be lost on restart, spin-down, or redeploy. The service is intentionally single-instance because SQLite and the in-memory SSE event hub are local to that instance. The previous paid configuration is saved in `render.paid.yaml`; use that Blueprint file if you need a persistent disk and are willing to use a paid service.

## Architecture
```
public/            Vanilla JS SPA (no build step), talks only to /api
src/server.js      App wiring, static hosting, error handler
src/routes/        auth, books, tickets, events (thin HTTP layer + zod validation)
src/services/      ticketService: async classification pipeline
src/ai/            client (API + retries), classifier, drafter, kb, accountContext, fallback
src/middleware/    JWT auth + role guard
src/db.js, seed.js SQLite schema and seeding
```
Decisions:
- **SQLite (better-sqlite3)**: zero-ops, single file, real SQL and constraints. Schema is portable to Postgres (users/books/tickets/messages/drafts). Not suitable for multi-instance scale (see limitations).
- **One service, no framework build**: fewer moving parts to deploy and explain; the brief says UI polish is not graded.
- **Messages table holds public replies and internal notes** (`internal` flag). Authors' queries never select internal rows, and admin-only fields (AI values, assignee, notes) are stripped from author responses.
- **Real-time via SSE** (`/api/events`): server pushes `ticket.created/updated`; the client refetches (preserving focus and unsent text). Authors only receive events for their own tickets; internal notes emit admin-only events. EventSource can't send headers, so the client trades its JWT for a **single-use 30-second stream ticket** (`POST /events/ticket`) instead of putting the JWT in a URL; it reconnects automatically. A 30s poll is a safety net.
- **Auth/hardening**: bcrypt (async, with a dummy compare so login timing doesn't reveal valid emails), 12h JWT, login rate limit, security headers + CSP, 100kb body limit (413). Authors requesting another author's ticket get **404**, not 403, so IDs don't leak.

## AI integration
**Model: Gemini Flash-Lite (`gemini-3.5-flash-lite`, configurable via `GEMINI_MODEL`).** Fast enough for short classification and response drafts. The server calls Google's Gemini `generateContent` REST API; the API key is read from `process.env` on the server only and is never sent to the browser.

**Flow**
1. Author submits → ticket saved and returned immediately (`Open`, default Medium) → classification runs in the background → SSE updates the admin queue.
2. Admin opens ticket → draft generated on demand (not for every ticket) and cached; "Regenerate" re-runs it. Editing happens in a textarea; the sent text is what the author sees.
3. Overrides: changing category/priority sets `*_overridden`, keeps the AI value for comparison, and logs an internal note. A late-arriving AI result never overwrites an admin override.

**Prompt strategy**
- *Classifier*: tiny static system prompt (category definitions + priority rubric), JSON-only output, `temperature 0`, `maxOutputTokens 80`, output validated against the enums. No KB, no history.
- *Drafter*: persona and tone rules from the BookLeaf guidelines (empathy first, own mistakes, specific numbers, timeline, clear next step, under 180 words) + **only the KB sections for the ticket's category** + the category's playbook from the sample responses + a compact **account snapshot** (the referenced book only; all books for royalty tickets) + the last 4 public messages (500 chars each).
- *Grounding*: the snapshot includes computed facts (including an explicit `LIKELY OVERDUE` verdict when ≥₹1,000 is pending and more than ~135 days have passed since the last payout/first publication; the model does no date arithmetic): months since publication, never-paid flags, the ₹1,000 threshold check, and the next payout due date from the quarterly + 45-day rule. Unknowns (e.g. bank-link status) are labelled UNKNOWN so the model asks rather than invents. Books in production are described as unpublished with no royalties.
- *Safety*: ticket text is wrapped in tags and declared untrusted data; a human always reviews before sending.

**Error handling / graceful degradation**: 15s timeout, one retry on 429/5xx (honouring `retry-after`), no retry on 4xx, and a **circuit breaker** (3 consecutive failed calls → AI skipped for 60s, so an outage does not add latency to every ticket). Tickets stranded in `pending` by a restart are re-classified at boot; admins can also click **Re-run AI** (`POST /tickets/:id/classify`). On failure, classification falls back to keyword rules (`ai_status = fallback`, shown in the UI) and drafting falls back to a category template with a visible warning. Ticket creation never depends on AI.

**Cost awareness**: the classifier sends no KB or history; the drafter sends only the KB slice for the ticket's category, a compact account snapshot and the last 4 public messages (never the full history or full KB). Drafts are generated once per ticket on open (active tickets only), cached, and cleared on send/category change. Gemini `maxOutputTokens` is capped (80 / 450). Per-user hourly rate limits cap spend (20 tickets, 120 AI actions). Every call logs `[ai] op= in= out=` token counts so real cost can be measured from logs (I have not measured live numbers here). Not implemented: prompt caching (the static prefix is likely below the minimum cacheable size).

## API
All routes are under `/api`. Auth: `Authorization: Bearer <token>`. Errors: `{ "error": { "code", "message", "details?" } }` with 400 validation, 401, 403, 404, 409, 429, never a raw 500 stack.

| Method & path | Role | Description |
|---|---|---|
| `POST /auth/login` | public | `{email,password}` → `{token,user}` |
| `GET /auth/me` | any | Current user |
| `GET /books` | any | Author: own books. Admin: all, optional `?author_id=` |
| `GET /tickets` | any | Author: own tickets. Admin: all; filters `status` (incl. `active`), `category`, `priority`, `assigned` (`me`/`unassigned`), `from`, `to` (YYYY-MM-DD), `sort` (`urgency` default, `newest`, `oldest`) |
| `POST /tickets` | author | `{book_id?, subject(3-150), description(10-5000), attachment_name?}` → 201 |
| `GET /tickets/:id` | owner/admin | Ticket + thread. Admin also gets internal notes, AI fields, cached draft |
| `POST /tickets/:id/replies` | owner/admin | `{body, status?}`. Admin: visible response (Open→In Progress, auto-assign). Author: follow-up (reopens Resolved; 409 if Closed) |
| `POST /tickets/:id/notes` | admin | `{body}` internal note |
| `PATCH /tickets/:id` | admin | Any of `status`, `category`, `priority`, `assigned_to` (`"me"` or `null`) |
| `POST /tickets/:id/draft` | admin | (Re)generate AI draft → `{draft:{body,source},ai_error}` |
| `POST /tickets/:id/classify` | admin | Re-run AI triage (keeps overrides) |
| `POST /events/ticket` | any | Exchange JWT for single-use SSE ticket |
| `GET /events?ticket=` | ticket | SSE stream |
| `GET /health` | public | Liveness + whether AI is configured |

Full OpenAPI 3 spec: [`docs/openapi.yaml`](docs/openapi.yaml), also served at `/api/openapi.yaml`. List supports `q` (subject/author/#id), `limit` (≤200) and `offset`; response includes `total`.

Admin queue order (`urgency`): unresolved first → Critical→Low → oldest first; rows unresolved >48h get a red bar.

## Assumptions
- Sample data is the source of truth for balances; royalty figures are displayed as stored, not recomputed from the 80/20 formula (the dataset gives a per-copy royalty).
- The ₹1,000 threshold is applied to an author's combined pending royalties (Kavita's ₹850 rolls over). The data doesn't say whether it's per book or per author.
- "Today" is the server clock (override with `AS_OF_DATE=YYYY-MM-DD`). The seed data's payouts end Dec 2025, so with the real date most authors with pending royalty look overdue; set `AS_OF_DATE=2025-12-15` for a period-consistent demo.
- Bank-detail status isn't in the data, so drafts ask the author to confirm it instead of asserting it.
- "My Books" shows in-production books too (with a "still in production" note instead of royalty figures).
- One shared admin account is seeded; admin assignment is "assign to me / unassign".
- Attachments are UI-only (file name recorded, file not stored), per the brief.

## Known limitations / next steps
- The UI has been exercised only through API tests and a server smoke check, not automated browser tests (add Playwright).
- Admin draft edits live in the browser until sent (not saved server-side).
- SQLite and in-memory SSE clients mean one instance; production would use Postgres + Redis pub/sub.
- No password reset, admin user management, or audit log table; JWT in localStorage (httpOnly cookie would be safer).
- Real attachment upload (S3), email notifications, and SLA timers/escalation rules.
- Evaluate classifier accuracy on a labelled set; add prompt caching and a review-feedback loop (log admin edits to drafts to improve prompts).
- Frontend is plain JS; a component framework would help as it grows.
