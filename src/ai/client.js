// Thin Anthropic Messages API client. The key is read from the environment on the server only.
const API_URL = 'https://api.anthropic.com/v1/messages';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRY_BASE_MS = () => Number(process.env.AI_RETRY_BASE_MS || 1000);

class AIUnavailableError extends Error {}

// Circuit breaker: after 3 consecutive failed calls, skip the AI for 60s so an outage does not add
// 15-30s of latency to every ticket. Fallbacks (rules / template) take over immediately.
const breaker = { fails: 0, openUntil: 0 };
const resetBreaker = () => { breaker.fails = 0; breaker.openUntil = 0; };
const recordFailure = () => { if (++breaker.fails >= 3) { breaker.openUntil = Date.now() + 60000; breaker.fails = 0; } };

async function complete({ label = 'ai', system, user, maxTokens = 400, temperature = 0, timeoutMs = 15000, retries = 1 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AIUnavailableError('ANTHROPIC_API_KEY not configured');
  if (Date.now() < breaker.openUntil) throw new AIUnavailableError('AI temporarily disabled after repeated failures');
  const model = process.env.AI_MODEL || 'claude-haiku-5-5';
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(API_URL, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
        if (!text) throw new AIUnavailableError('Empty AI response');
        breaker.fails = 0;
        // Per-call token usage: the evidence for cost tracking (no prompt text is logged: it contains author data).
        console.log(`[ai] op=${label} model=${model} in=${data.usage?.input_tokens ?? '?'} out=${data.usage?.output_tokens ?? '?'}`);
        return { text, usage: data.usage };
      }
      lastErr = new AIUnavailableError(`AI API ${res.status}`);
      // Only 429 / 5xx are worth retrying; 4xx (bad key, bad request) will not fix themselves.
      if (res.status !== 429 && res.status < 500) break;
      const wait = Number(res.headers.get('retry-after')) * 1000 || RETRY_BASE_MS() * (attempt + 1);
      if (attempt < retries) await sleep(Math.min(wait, 5000));
    } catch (e) {
      lastErr = e instanceof AIUnavailableError ? e : new AIUnavailableError(e.name === 'AbortError' ? 'AI request timed out' : e.message);
      if (attempt < retries) await sleep(RETRY_BASE_MS() / 2);
    } finally { clearTimeout(timer); }
  }
  recordFailure();
  throw lastErr;
}
module.exports = { complete, AIUnavailableError, resetBreaker };
