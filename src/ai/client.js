// Thin Anthropic Messages API client. The key is read from the environment on the server only.
const API_URL = 'https://api.anthropic.com/v1/messages';
const sleep = ms => new Promise(r => setTimeout(r, ms));

class AIUnavailableError extends Error {}

async function complete({ system, user, maxTokens = 400, temperature = 0, timeoutMs = 15000, retries = 1 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AIUnavailableError('ANTHROPIC_API_KEY not configured');
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
        return { text, usage: data.usage };
      }
      lastErr = new AIUnavailableError(`AI API ${res.status}`);
      // Only 429 / 5xx are worth retrying; 4xx (bad key, bad request) will not fix themselves.
      if (res.status !== 429 && res.status < 500) break;
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * (attempt + 1);
      if (attempt < retries) await sleep(Math.min(wait, 5000));
    } catch (e) {
      lastErr = e instanceof AIUnavailableError ? e : new AIUnavailableError(e.name === 'AbortError' ? 'AI request timed out' : e.message);
      if (attempt < retries) await sleep(500);
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}
module.exports = { complete, AIUnavailableError };
