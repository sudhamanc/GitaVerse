// Netlify Function — proxies AI insight requests to Anthropic.
// Your API key lives in Netlify's environment variables, never in the browser.
//
// Set up:
//   Netlify dashboard → Site → Environment variables → Add:
//     ANTHROPIC_API_KEY = sk-ant-...
//
// The browser calls POST /.netlify/functions/ai-insight
// This function calls Anthropic and returns the result.

export async function handler(event) {
  console.log(`[ai-insight] ${event.httpMethod} request received`);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Prefer server-side env key; fall back to user-supplied key from header
  const apiKey = process.env.ANTHROPIC_API_KEY
    || (event.headers['x-api-key'] ?? event.headers['X-Api-Key'] ?? '');
  if (!apiKey) {
    console.warn('[ai-insight] No API key available');
    return { statusCode: 503, body: JSON.stringify({ error: 'No API key. Set ANTHROPIC_API_KEY on the server or enter your key in Settings.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Lightweight capability probe used by frontend to detect server-side key mode
  if (body.probe === true) {
    const hasServerKey = !!process.env.ANTHROPIC_API_KEY;
    if (!hasServerKey) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, serverKey: false })
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, serverKey: true })
    };
  }

  const { chapter, verse, slok, transliteration, translation } = body;

  const prompt = `You are a wise and compassionate teacher of the Bhagavad Gita.

Here is a shloka from Chapter ${chapter}, Verse ${verse}:

Sanskrit: ${slok}
Transliteration: ${transliteration}
Standard translation: ${translation}

Please give a brief (150–200 word), warm, and practical insight about this verse — connecting its wisdom to everyday modern life. Write in plain paragraphs, no bullet points or headers. Speak directly to the reader.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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

    const data = await res.json();
    if (!res.ok) {
      console.error(`[ai-insight] Anthropic error ${res.status}:`, data.error?.message);
      return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'Anthropic error' }) };
    }

    const insight = data.content?.[0]?.text || '';
    console.log(`[ai-insight] Success — ${insight.length} chars for Ch.${body.chapter}:${body.verse}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insight })
    };
  } catch (err) {
    console.error('[ai-insight] Proxy error:', err.message);
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
}
