# GitaVerse — Daily Bhagavad Gita

A beautiful, no-backend daily Bhagavad Gita shloka app that works on any browser and installs on your phone as a PWA.

## Features

- **Today's shloka only** — one verse per day, cycles through all 700 verses deterministically (~2-year cycle)
- **No database, no server** — pure math selects today's verse (deterministic shuffle by day-since-epoch)
- **Offline-first PWA** — install on your phone from Chrome/Safari, works offline after first load
- **Sanskrit** (Devanagari) + **transliteration** + **English translation** + word meanings
- **Sanskrit audio recitation** — real Sanskrit pronunciation streamed from bhagavadgita.com (per-verse MP3s)
- **AI Insight** (optional) — Claude gives a warm, modern interpretation of the verse connecting its wisdom to daily life
- **Works everywhere** — same code runs locally and on Netlify with no changes

## How to Run Locally

No build step. Use the included `server.py` which serves static files **and** proxies AI insight requests to Anthropic (bypasses browser CORS restrictions):

```bash
# Start the dev server
python3 server.py

# Or, if you don't need AI insights, any static server works:
# npx serve .
# python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser. On mobile, use Chrome → "Add to Home Screen" or Safari → Share → "Add to Home Screen" to install as a PWA.

### Enabling AI Insights Locally

1. Open the app → click the **⚙ Settings** icon
2. Paste your [Anthropic API key](https://console.anthropic.com) (`sk-ant-...`)
3. Save → expand the **✨ AI Insight** section on today's verse

The key is stored in your browser's `localStorage` and sent to the local proxy server, which forwards requests to Anthropic's API. Your key never leaves your machine.

## Deploy to Netlify

GitaVerse is ready to deploy to Netlify with zero configuration. The Netlify Function in `netlify/functions/ai-insight.js` handles AI insight requests server-side.

### Option 1: Deploy via Netlify UI (recommended)

1. Push this repo to GitHub
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
3. Connect your GitHub repo
4. Build settings (leave defaults):
   - **Build command:** _(leave blank — no build step)_
   - **Publish directory:** `.`
5. Click **Deploy site**

### Option 2: Deploy via Netlify CLI

```bash
# Install the CLI
npm install -g netlify-cli

# Login to your Netlify account
netlify login

# Deploy (first time — creates the site for you)
netlify deploy --prod
```

### Setting Up AI Insights on Netlify

**With a server-side key (recommended for your own site):**

1. Netlify dashboard → your site → **Site configuration** → **Environment variables**
2. Add: `ANTHROPIC_API_KEY` = `sk-ant-...`
3. Redeploy (or it will pick it up on the next deploy)

When a server key is configured, AI insights work automatically for all visitors — no key entry needed.

**Without a server-side key:**

Users can still enter their own Anthropic API key in the app's Settings. The key is sent via `x-api-key` header to the Netlify Function, which proxies the request to Anthropic. The key is only stored in the user's browser.

## AI Insight — Cost Estimate

The AI Insight feature uses **Claude Haiku** (`claude-haiku-4-5-20251001`), the most cost-efficient model:

| Input | Output | Total per request |
|---|---|---|
| ~250 tokens ($0.25/M) | ~200 tokens ($1.25/M) | **~$0.0003** |

| Users/day | Requests/day | Monthly cost |
|---|---|---|
| 100 | 100 | ~$0.90 |
| 100 | 300 (3 taps each) | ~$2.70 |
| 500 | 500 | ~$4.50 |
| 1,000 | 1,000 | ~$9.00 |

Very affordable. For high-traffic sites, consider adding rate limiting to the Netlify Function.

## Do I Need an LLM?

**No** — the app works great without one. The Bhagavad Gita already has excellent scholarly translations (Swami Sivananda, Swami Gambhirananda, etc.) that cover the meaning faithfully.

**With an LLM** (optional): the "✨ AI Insight" panel uses Claude to give you a warm, conversational take connecting the verse's wisdom to modern daily life. Enable it by adding your [Anthropic API key](https://console.anthropic.com) in Settings, or set `ANTHROPIC_API_KEY` as a Netlify environment variable for all users.

## How "Daily, No-Repeat" Works (No Database)

```
All 700 verse refs [chapter, verse]
    ↓
Deterministic Fisher-Yates shuffle (fixed seed = 20240101)
    ↓
DAILY_ORDER[0..699]  — same sequence for every device, every time

Today's verse = DAILY_ORDER[ daysSince(2024-01-01) % 700 ]
```

- Same verse on the same calendar date for everyone, globally
- No login, no account, no sync needed
- After 700 days the cycle starts again

## Data Sources

- **Translations:** [Vedic Scriptures API](https://vedicscriptures.github.io) — Swami Sivananda and others (CC-licensed)
- **Sanskrit audio:** [bhagavadgita.com](https://bhagavadgita.com) — per-verse Sanskrit recitation MP3s
- **AI Insight:** [Anthropic Claude API](https://anthropic.com) (optional)

Fetched verses are cached in `localStorage` for offline use.

## Tech Stack

- Vanilla HTML / CSS / JavaScript — no framework, no build tool
- PWA: `manifest.json` + Service Worker (`sw.js`)
- Fonts: Google Fonts (Noto Sans Devanagari, Crimson Text, Inter)
- Netlify Functions (serverless) for AI insight proxy
- Optional: Anthropic Claude API for AI insights

## File Structure

```
GitaVerse/
├── index.html                  Main app shell
├── style.css                   Spiritual dark/gold theme, mobile-first
├── app.js                      All logic: rotation, fetch, audio, AI
├── manifest.json               PWA manifest
├── sw.js                       Service worker (offline support)
├── icon.svg                    Om symbol app icon
├── server.py                   Local dev server with AI proxy
└── netlify/
    └── functions/
        └── ai-insight.js       Netlify Function — proxies AI requests to Anthropic
```
