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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'AI Insight not configured on this server.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
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
      return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'Anthropic error' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insight: data.content?.[0]?.text || '' })
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
}
