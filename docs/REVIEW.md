# Self-review (evaluator pass) and what changed

Scored against the brief's rubric. "Found" = reproduced or confirmed by reading code; every fix has a test or a code reference.

## Defects found and fixed
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Admin UI could **loop forever** calling the AI draft endpoint if a draft request failed (repaint re-triggered generation) | One auto-attempt per ticket; failure shows a message; manual Generate button |
| 2 | High | Cached draft was ignored: the UI painted (and auto-generated) **before** hydrating the server draft, wasting an AI call per open | Hydrate before paint; auto-generate only for active tickets |
| 3 | High | Sent draft stayed cached and re-appeared on reopen | Draft deleted on send (test) |
| 4 | High | Tickets stranded in `pending` forever if the server restarted mid-classification | Boot sweep + admin "Re-run AI" endpoint |
| 5 | Med | Oversized body returned **500** | Mapped to 413 (test) |
| 6 | Med | Fallback classifier: "royalty on Amazon" → Distribution; "7 months old, update bio" → **Critical** | Scored keywords; "months overdue" only for money tickets (test) |
| 7 | Med | "In Progress" status badge unstyled (class with a space) | Slugged class names |
| 8 | Med | Internal-note text leaked into the next ticket's note box | Reset on ticket switch |
| 9 | Med | Live refresh stole focus/caret while typing | `keepFocus` helper; state kept in memory |
| 10 | Low | JWT in the SSE URL (ends up in logs) | Single-use 30s stream ticket; JWT in URL rejected (test) |
| 11 | Low | Login timing revealed whether an email exists; sync bcrypt blocked the loop | Dummy compare + async bcrypt |

## Improvements added
Circuit breaker for AI outages · per-call token logging · per-user rate limits (AI cost control) · computed `LIKELY OVERDUE` verdict in the draft context · pagination + search on the queue · security headers/CSP · OpenAPI spec · 10 new tests incl. mocked AI, retry, breaker, override race · incremental git history.

## Still open (honest list)
Not run against the live Anthropic API or in a browser · no deployment · attachments UI-only · single-instance (SQLite, in-memory SSE) · draft edits not persisted server-side · no prompt caching · classification accuracy not measured on a labelled set.
