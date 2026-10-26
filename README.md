# BookLeaf Author Support & Communication Portal

Two portals (author + admin) on one Node/Express service, with AI-assisted ticket triage and response drafting.
**Confidential assignment: keep the repo private.**

## Quick start
```bash
npm install
cp .env.example .env        # set JWT_SECRET and ANTHROPIC_API_KEY
npm start                   # http://localhost:3000, auto-seeds on first run
npm test                    # integration tests (no API key needed)
npm run seed                # wipe and re-seed the DB
```
Requires Node 18+. The app runs **without** an API key: tickets are still created, classified by rules, and admins get a template to edit.

### Test logins (seeded from `bookleaf_sample_data.json`)
| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookleaf.com` | `Admin@123` |
| Authors (all 10) | e.g. `priya.sharma@email.com`, `arjun.malhotra@email.com`, `kavita.deshmukh@email.com`, `sneha.kulkarni@email.com` | `Author@123` |

Useful edge cases: **Kavita** (book in production + ₹850 pending, below the ₹1,000 threshold), **Sneha** (3 books, one in cover design), **Arjun / Ananya / Diya** (pending royalty, never paid). 3 demo tickets are pre-seeded.

### Deploy (Render / Railway / VPS)
Build `npm install`, start `npm start`. Set `JWT_SECRET`, `ANTHROPIC_API_KEY`, `NODE_ENV=production`. SQLite lives in `data/`; mount a persistent disk there (or set `DB_PATH`). The server seeds itself when the DB is empty.

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
- **Real-time via SSE** (`/api/events`): server pushes `ticket.created/updated`; the client refetches. Authors only receive events for their own tickets; internal notes emit admin-only events. A 30s poll is a safety net. EventSource can't send headers, so the JWT goes in the query string for that route only.
- **Auth**: bcrypt hashes, 12h JWT, login rate-limited. Authors requesting another author's ticket get **404**, not 403, so IDs don't leak.

## AI integration
**Model: Claude Haiku (`claude-haiku-5-5`, configurable via `AI_MODEL`).** Cheap and fast enough for short classification and ~150-word drafts, follows tone instructions well, and keeps latency low for an admin who is waiting. Keys are read from `process.env` on the server only; nothing AI-related is sent to the browser.

**Flow**
1. Author submits → ticket saved and returned immediately (`Open`, default Medium) → classification runs in the background → SSE updates the admin queue.
2. Admin opens ticket → draft generated on demand (not for every ticket) and cached; "Regenerate" re-runs it. Editing happens in a textarea; the sent text is what the author sees.
3. Overrides: changing category/priority sets `*_overridden`, keeps the AI value for comparison, and logs an internal note. A late-arriving AI result never overwrites an admin override.

**Prompt strategy**
- *Classifier*: tiny static system prompt (category definitions + priority rubric), JSON-only output, `temperature 0`, `max_tokens 80`, output validated against the enums. No KB, no history.
- *Drafter*: persona and tone rules from the BookLeaf guidelines (empathy first, own mistakes, specific numbers, timeline, clear next step, under 180 words) + **only the KB sections for the ticket's category** + the category's playbook from the sample responses + a compact **account snapshot** (the referenced book only; all books for royalty tickets) + the last 4 public messages (500 chars each).
- *Grounding*: the snapshot includes computed facts: months since publication, never-paid flags, the ₹1,000 threshold check, and the next payout due date from the quarterly + 45-day rule. Unknowns (e.g. bank-link status) are labelled UNKNOWN so the model asks rather than invents. Books in production are described as unpublished with no royalties.
- *Safety*: ticket text is wrapped in tags and declared untrusted data; a human always reviews before sending.

**Error handling / graceful degradation**: 15s timeout, one retry on 429/5xx (honouring `retry-after`), no retry on 4xx. On failure, classification falls back to keyword rules (`ai_status = fallback`, shown in the UI) and drafting falls back to a category template with a visible warning. Ticket creation never depends on AI.

**Cost awareness**: classification ≈ 400 input tokens; drafting ≈ 900-1,300 input tokens (not the full KB or full history); drafts only when an admin opens a ticket; `max_tokens` capped; drafts cached; classification skips no calls but is cheap. Not implemented: prompt caching (the static prefix is below Haiku's minimum cacheable size).

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
| `GET /events?token=` | any | SSE stream |
| `GET /health` | public | Liveness + whether AI is configured |

Admin queue order (`urgency`): unresolved first → Critical→Low → oldest first; rows unresolved >48h get a red bar.

## Assumptions
- Sample data is the source of truth for balances; royalty figures are displayed as stored, not recomputed from the 80/20 formula (the dataset gives a per-copy royalty).
- The ₹1,000 threshold is applied to an author's combined pending royalties (Kavita's ₹850 rolls over). The data doesn't say whether it's per book or per author.
- "Today" is the server clock. The seed data's payout dates end Dec 2025, so payout-window maths follows the real date.
- Bank-detail status isn't in the data, so drafts ask the author to confirm it instead of asserting it.
- "My Books" shows in-production books too (with a "still in production" note instead of royalty figures).
- One shared admin account is seeded; admin assignment is "assign to me / unassign".
- Attachments are UI-only (file name recorded, file not stored), per the brief.

## Known limitations / next steps
- SQLite and in-memory SSE clients mean one instance; production would use Postgres + Redis pub/sub.
- No password reset, admin user management, or audit log table; JWT in localStorage (httpOnly cookie would be safer).
- Real attachment upload (S3), email notifications, and SLA timers/escalation rules.
- Evaluate classifier accuracy on a labelled set; add prompt caching and a review-feedback loop (log admin edits to drafts to improve prompts).
- Frontend is plain JS; a component framework would help as it grows.
