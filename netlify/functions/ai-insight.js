// Netlify Function — proxies AI insight requests to Anthropic.
// Your API key lives in Netlify's environment variables, never in the browser.
//
// Set up:
//   Netlify dashboard → Site → Environment variables → Add:
//     ANTHROPIC_API_KEY = sk-ant-...
//
// The browser calls POST /.netlify/functions/ai-insight
// This function calls Anthropic and returns the result.

const CHAPTER_VERSE_COUNTS = [46, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78];
const BODY_MAX_BYTES = 12_000;
const ANTHROPIC_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 15_000);
const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60);
const RATE_LIMIT_MAX_PER_IP = Number(process.env.RATE_LIMIT_MAX_PER_IP || 20);
const RATE_LIMIT_MAX_PER_FP = Number(process.env.RATE_LIMIT_MAX_PER_FP || 20);
const DAILY_QUOTA_PER_IP = Number(process.env.DAILY_QUOTA_PER_IP || 200);
const DAILY_QUOTA_PER_FP = Number(process.env.DAILY_QUOTA_PER_FP || 120);
const INSIGHT_CACHE_TTL_SECONDS = Number(process.env.INSIGHT_CACHE_TTL_SECONDS || 172800);
const APP_ORIGIN = (process.env.APP_ORIGIN || 'https://dailygitaverse.netlify.app').trim();

const MEM = new Map();
const INSIGHT_MEM = new Map();

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

function getHeader(event, name) {
  return event.headers?.[name] || event.headers?.[name.toLowerCase()] || event.headers?.[name.toUpperCase()] || '';
}

function shouldRequireCaptcha(event) {
  const origin = String(getHeader(event, 'origin') || '').trim();
  const referer = String(getHeader(event, 'referer') || '').trim();
  const secFetchSite = String(getHeader(event, 'sec-fetch-site') || '').trim().toLowerCase();
  const userAgent = String(getHeader(event, 'user-agent') || '').trim();

  if (!userAgent) return true;

  const allowedOrigin = APP_ORIGIN;
  const hasExpectedOrigin = !!allowedOrigin && origin === allowedOrigin;
  const hasExpectedReferer = !!allowedOrigin && referer.startsWith(`${allowedOrigin}/`);
  const browserLikeFetchSite = secFetchSite === 'same-origin' || secFetchSite === 'same-site';

  const looksLikeInAppBrowserRequest = hasExpectedOrigin && hasExpectedReferer && browserLikeFetchSite;
  return !looksLikeInAppBrowserRequest;
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

function textHash(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function insightCacheKey(validated) {
  const combined = `${validated.chapter}|${validated.verse}|${validated.slok}|${validated.transliteration}|${validated.translation}`;
  return `gv:ai:insight:v2:${validated.chapter}:${validated.verse}:${textHash(combined)}`;
}

async function getCachedInsight(key) {
  const redisEnabled = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (redisEnabled) {
    try {
      const value = await redisCmd(['GET', key]);
      return typeof value === 'string' && value ? value : null;
    } catch (err) {
      console.warn('[ai-insight] Redis GET failed:', err.message);
    }
  }

  const now = Date.now();
  const cached = INSIGHT_MEM.get(key);
  if (!cached || cached.expireAt < now) {
    INSIGHT_MEM.delete(key);
    return null;
  }
  return cached.value;
}

async function setCachedInsight(key, value, ttlSeconds) {
  const redisEnabled = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (redisEnabled) {
    try {
      await redisCmd(['SETEX', key, String(ttlSeconds), value]);
      return;
    } catch (err) {
      console.warn('[ai-insight] Redis SETEX failed:', err.message);
    }
  }

  INSIGHT_MEM.set(key, {
    value,
    expireAt: Date.now() + ttlSeconds * 1000
  });
}

async function enforceLimits(event) {
  const ip = clientIp(event);
  const fpRaw = (event.headers['x-client-fingerprint'] || '').toString().slice(0, 128);
  const fingerprint = fpRaw || 'anon';

  const minuteBucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const day = utcDateKey();
  const dayTtl = secondsUntilUtcMidnight();

  const ipMinuteKey = `gv:rl:ip:${ip}:${minuteBucket}`;
  const fpMinuteKey = `gv:rl:fp:${fingerprint}:${minuteBucket}`;
  const ipDayKey = `gv:dq:ip:${ip}:${day}`;
  const fpDayKey = `gv:dq:fp:${fingerprint}:${day}`;

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

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY || '';
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip && ip !== 'unknown') body.set('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  return !!data.success;
}

function validatePayload(body) {
  const chapter = Number(body.chapter);
  const verse = Number(body.verse);
  const slok = typeof body.slok === 'string' ? body.slok.trim() : '';
  const transliteration = typeof body.transliteration === 'string' ? body.transliteration.trim() : '';
  const translation = typeof body.translation === 'string' ? body.translation.trim() : '';

  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 18) {
    return { error: 'Invalid chapter' };
  }
  const maxVerse = CHAPTER_VERSE_COUNTS[chapter - 1];
  if (!Number.isInteger(verse) || verse < 1 || verse > maxVerse) {
    return { error: 'Invalid verse' };
  }
  if (!slok || !translation) {
    return { error: 'Missing verse text or translation' };
  }
  if (slok.length > 5000 || transliteration.length > 5000 || translation.length > 5000) {
    return { error: 'Payload fields too large' };
  }

  return {
    chapter,
    verse,
    slok,
    transliteration,
    translation
  };
}

export async function handler(event) {
  console.log(`[ai-insight] ${event.httpMethod} request received`);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const bodyStr = event.body || '';
  if (Buffer.byteLength(bodyStr, 'utf8') > BODY_MAX_BYTES) {
    return json(413, { error: 'Request too large' });
  }

  // Prefer server-side env key; fall back to user-supplied key from header
  const serverKey = process.env.ANTHROPIC_API_KEY || '';
  const userKey = event.headers['x-api-key'] ?? event.headers['X-Api-Key'] ?? '';
  const apiKey = serverKey || userKey;
  if (!apiKey) {
    console.warn('[ai-insight] No API key available');
    return json(503, { error: 'No API key. Set ANTHROPIC_API_KEY on the server or enter your key in Settings.' });
  }

  let body;
  try {
    body = JSON.parse(bodyStr || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  // Lightweight capability probe used by frontend to detect server-side key mode
  if (body.probe === true) {
    const hasServerKey = !!serverKey;
    if (!hasServerKey) {
      return json(503, { ok: false });
    }
    return json(200, { ok: true });
  }

  const limitError = await enforceLimits(event);
  if (limitError) return limitError;

  const usingServerKey = !!serverKey && !userKey;
  const captchaEnabled = !!process.env.TURNSTILE_SECRET_KEY;
  if (usingServerKey && captchaEnabled && shouldRequireCaptcha(event)) {
    const token = event.headers['x-turnstile-token'] || event.headers['X-Turnstile-Token'] || '';
    const ok = await verifyTurnstile(token, clientIp(event));
    if (!ok) {
      return json(403, {
        error: 'CAPTCHA_REQUIRED',
        siteKey: process.env.TURNSTILE_SITE_KEY || ''
      });
    }
  }

  const validated = validatePayload(body);
  if (validated.error) {
    return json(422, { error: validated.error });
  }

  const { chapter, verse, slok, transliteration, translation } = validated;
  const cacheEligible = usingServerKey;
  const cacheKey = cacheEligible ? insightCacheKey(validated) : '';

  if (cacheEligible) {
    const cachedInsight = await getCachedInsight(cacheKey);
    if (cachedInsight) {
      console.log(`[ai-insight] Cache hit for Ch.${chapter}:${verse}`);
      return json(200, { insight: cachedInsight, cached: true });
    }
  }

  const prompt = `You are a wise and compassionate teacher of the Bhagavad Gita.

Here is a shloka from Chapter ${chapter}, Verse ${verse}:

Sanskrit: ${slok}
Transliteration: ${transliteration}
Standard translation: ${translation}

Please give a brief (100–120 word), warm, and practical insight about this verse — connecting its wisdom to everyday modern life. Write in plain paragraphs, no bullet points or headers. Speak directly to the reader.`;

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
        max_tokens: 300,
        messages:   [{ role: 'user', content: prompt }]
      })
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (!res.ok) {
      console.error(`[ai-insight] Anthropic error ${res.status}:`, data.error?.message);
      return json(res.status, { error: data.error?.message || 'Anthropic error' });
    }

    const insight = data.content?.[0]?.text || '';
    console.log(`[ai-insight] Success — ${insight.length} chars for Ch.${body.chapter}:${body.verse}`);

    if (cacheEligible && insight) {
      await setCachedInsight(cacheKey, insight, INSIGHT_CACHE_TTL_SECONDS);
    }

    return json(200, { insight });
  } catch (err) {
    console.error('[ai-insight] Proxy error:', err.message);
    return json(502, { error: err.name === 'AbortError' ? 'AI request timed out' : err.message });
  }
}
