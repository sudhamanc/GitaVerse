// Netlify Function — proxies "Ask Krishna" requests to Anthropic.
// Reuses the same rate-limiting and key-handling pattern as ai-insight.js.

const CHAPTER_VERSE_COUNTS = [47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78];
const BODY_MAX_BYTES = 12_000;
const ANTHROPIC_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 15_000);
const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60);
const RATE_LIMIT_MAX_PER_IP = Number(process.env.RATE_LIMIT_MAX_PER_IP || 20);
const RATE_LIMIT_MAX_PER_FP = Number(process.env.RATE_LIMIT_MAX_PER_FP || 20);
const DAILY_QUOTA_PER_IP = Number(process.env.DAILY_QUOTA_PER_IP || 200);
const DAILY_QUOTA_PER_FP = Number(process.env.DAILY_QUOTA_PER_FP || 120);

const MEM = new Map();

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function clientIp(event) {
  return event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.floor((next - now.getTime()) / 1000));
}

async function redisCmd(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Redis HTTP ${res.status}`);
  return data?.result;
}

async function incrementWithExpiry(key, ttlSeconds) {
  const redisEnabled = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (redisEnabled) {
    const count = Number(await redisCmd(['INCR', key]) || 0);
    await redisCmd(['EXPIRE', key, String(ttlSeconds)]);
    return count;
  }

  const now = Date.now();
  const existing = MEM.get(key);
  if (!existing || existing.expireAt < now) {
    MEM.set(key, { count: 1, expireAt: now + ttlSeconds * 1000 });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

async function enforceLimits(event) {
  const ip = clientIp(event);
  const fpRaw = (event.headers['x-client-fingerprint'] || '').toString().slice(0, 128);
  const fingerprint = fpRaw || 'anon';

  const minuteBucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const day = utcDateKey();
  const dayTtl = secondsUntilUtcMidnight();

  const ipMinuteKey = `gv:rl:ak:ip:${ip}:${minuteBucket}`;
  const fpMinuteKey = `gv:rl:ak:fp:${fingerprint}:${minuteBucket}`;
  const ipDayKey = `gv:dq:ak:ip:${ip}:${day}`;
  const fpDayKey = `gv:dq:ak:fp:${fingerprint}:${day}`;

  const [ipMinuteCount, fpMinuteCount, ipDayCount, fpDayCount] = await Promise.all([
    incrementWithExpiry(ipMinuteKey, RATE_LIMIT_WINDOW_SECONDS + 5),
    incrementWithExpiry(fpMinuteKey, RATE_LIMIT_WINDOW_SECONDS + 5),
    incrementWithExpiry(ipDayKey, dayTtl + 60),
    incrementWithExpiry(fpDayKey, dayTtl + 60)
  ]);

  if (ipMinuteCount > RATE_LIMIT_MAX_PER_IP || fpMinuteCount > RATE_LIMIT_MAX_PER_FP) {
    return json(429, { error: 'Rate limit exceeded. Please try again shortly.' });
  }
  if (ipDayCount > DAILY_QUOTA_PER_IP || fpDayCount > DAILY_QUOTA_PER_FP) {
    return json(429, { error: 'Daily quota reached. Please try again tomorrow (UTC).' });
  }
  return null;
}

export async function handler(event) {
  console.log(`[ask-krishna] ${event.httpMethod} request received`);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const bodyStr = event.body || '';
  if (Buffer.byteLength(bodyStr, 'utf8') > BODY_MAX_BYTES) {
    return json(413, { error: 'Request too large' });
  }

  const serverKey = process.env.ANTHROPIC_API_KEY || '';
  const userKey = event.headers['x-api-key'] ?? event.headers['X-Api-Key'] ?? '';
  const apiKey = serverKey || userKey;
  if (!apiKey) {
    return json(503, { error: 'No API key available.' });
  }

  let body;
  try {
    body = JSON.parse(bodyStr || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const limitError = await enforceLimits(event);
  if (limitError) return limitError;

  // Validate
  const chapter = Number(body.chapter);
  const verse = Number(body.verse);
  const translation = typeof body.translation === 'string' ? body.translation.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';

  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 18) {
    return json(422, { error: 'Invalid chapter' });
  }
  if (!Number.isInteger(verse) || verse < 1 || verse > CHAPTER_VERSE_COUNTS[chapter - 1]) {
    return json(422, { error: 'Invalid verse' });
  }
  if (!translation) {
    return json(422, { error: 'Missing translation' });
  }
  if (!question || question.length > 500) {
    return json(422, { error: 'Question is required and must be under 500 characters.' });
  }

  const prompt = `You are Krishna from the Bhagavad Gita, speaking with wisdom and compassion.

Today's verse is Chapter ${chapter}, Verse ${verse}:
Translation: ${translation}

The reader asks: "${question}"

Respond warmly in 150–250 words, connecting your answer to the wisdom in this verse. Speak directly to the reader as "you". Be practical and grounded in modern life. No bullet points or headers — write in flowing paragraphs.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages:   [{ role: 'user', content: prompt }]
      })
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[ask-krishna] Anthropic HTTP ${res.status}:`, errBody.slice(0, 300));
      return json(502, { error: `Anthropic API error (${res.status})` });
    }

    const data = await res.json();
    const answer = data?.content?.[0]?.text || '';
    if (!answer) {
      return json(502, { error: 'Empty response from AI' });
    }

    return json(200, { answer });
  } catch (err) {
    if (err.name === 'AbortError') {
      return json(502, { error: 'AI request timed out. Try again.' });
    }
    console.error('[ask-krishna] Unexpected error:', err);
    return json(500, { error: 'Internal error' });
  }
}
