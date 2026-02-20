# GitaVerse — Daily Bhagavad Gita

A beautiful, no-backend daily Bhagavad Gita shloka app that works on any browser and installs on your phone as a PWA.

## Features

- **One shloka per day** — cycles through all 700 verses, no repeats for ~2 years
- **No database, no server** — pure math selects today's verse (deterministic shuffle by day-since-epoch)
- **Offline-first PWA** — install on your phone from Chrome/Safari, works offline after first load
- **Sanskrit** (Devanagari) + **transliteration** + **English translation** + word meanings
- **Sanskrit audio** — streamed from IIT Kanpur's Gita Supersite; falls back to browser TTS
- **AI Insight** (optional) — brings in Claude to give a modern, personal take on the verse (needs Anthropic API key)
- **Navigate freely** — browse any day's verse with Prev/Next buttons

## How to Run

No build step. Just serve the files with any static server:

```bash
# Python
python3 -m http.server 8080

# Node (npx)
npx serve .

# Or just open index.html in a browser (some features need a server for CORS)
```

Then open `http://localhost:8080` in your browser. On mobile, use Chrome → "Add to Home Screen" or Safari → Share → "Add to Home Screen" to install as a PWA.

## Do I Need an LLM?

**No** — the app works great without one. The Bhagavad Gita already has excellent scholarly translations (Swami Sivananda, Swami Gambhirananda, etc.) that cover the meaning faithfully.

**With an LLM** (optional): the "✨ AI Insight" feature uses Claude to give you a warm, conversational interpretation connecting the verse's wisdom to modern daily life. To enable it, add your [Anthropic API key](https://console.anthropic.com) in Settings.

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

## Data Source

Translations from the **[Vedic Scriptures API](https://vedicscriptures.github.io)** (Swami Sivananda and others, CC-licensed). Sanskrit audio from **[IIT Kanpur Gita Supersite](https://www.gitasupersite.iitk.ac.in)**.

Fetched verses are cached in `localStorage` for offline use.

## Tech Stack

- Vanilla HTML / CSS / JavaScript — no framework, no build tool
- PWA: `manifest.json` + Service Worker (`sw.js`)
- Fonts: Google Fonts (Noto Sans Devanagari, Crimson Text, Inter)
- Optional: Anthropic Claude API for AI insights

## File Structure

```
GitaVerse/
├── index.html      Main app shell
├── style.css       Spiritual dark/gold theme, mobile-first
├── app.js          All logic: rotation, fetch, audio, AI
├── manifest.json   PWA manifest
├── sw.js           Service worker (offline support)
└── icon.svg        Om symbol app icon
```
