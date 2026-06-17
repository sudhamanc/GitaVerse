/* ============================================================
   GitaVerse — app.js
   Daily Bhagavad Gita shloka without a database.

   How "daily, no-repeat" works (pure math, zero server):
   ── Build an ordered list of all 700 verse refs [ch, v].
   ── Shuffle it once with a fixed seed (always the same order).
   ── Index into it: daysSinceEpoch % 700  → today's verse.
   ── Navigation lets users look at ±N days around today.
   ── Fetched verse data is cached in localStorage.
   ============================================================ */

'use strict';

// ── Frontend Logger (console only, no user access) ───────────────

function glog(level, ...args) {
  if (level === 'error') console.error('[GV]', ...args);
  else console.log('[GV]', ...args);
}

function withTimeout(promise, ms, label = 'Request timeout') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise
  ]);
}

// ── Constants ─────────────────────────────────────────────────

const EPOCH = new Date('2024-01-01T00:00:00Z'); // Day 0

// Verse counts per chapter (standard 700-verse edition)
const CHAPTER_VERSE_COUNTS = [
  46, 72, 43, 42, 29, 47,
  30, 28, 34, 42, 55, 20,
  35, 27, 20, 24, 28, 78
];

const CHAPTER_NAMES = [
  'Arjuna Vishada Yoga — The Yoga of Arjuna\'s Grief',
  'Sankhya Yoga — The Yoga of Knowledge',
  'Karma Yoga — The Yoga of Action',
  'Jnana Karma Sanyasa Yoga — Knowledge & Renunciation',
  'Karma Vairagya Yoga — The Yoga of Renunciation',
  'Atmasamyama Yoga — The Yoga of Self-Restraint',
  'Jnana Vijnana Yoga — Knowledge & Wisdom',
  'Akshara Brahma Yoga — The Yoga of Imperishable Brahman',
  'Raja Vidya Guhya Yoga — Royal Knowledge & Secret',
  'Vibhuti Yoga — The Yoga of Divine Glories',
  'Vishvarupa Darshana Yoga — Vision of the Cosmic Form',
  'Bhakti Yoga — The Yoga of Devotion',
  'Kshetra Kshetrajna Yoga — The Field & Its Knower',
  'Gunatraya Vibhaga Yoga — The Three Qualities',
  'Purushottama Yoga — The Supreme Person',
  'Daivasura Sampad Yoga — Divine & Demoniac Natures',
  'Shraddhatraya Vibhaga Yoga — Threefold Faith',
  'Moksha Sanyasa Yoga — Liberation & Renunciation'
];

// Local verse data — bundled from vedicscriptures.github.io (pinned commit e42101a)
// Contains 7 translators: siva, gambir, tej, purohit, adi, san, prabhu
let VERSE_DATA = null; // loaded on first use from data/verses.json



// ── Deterministic verse list ────────────────────────────────

/**
 * Mulberry32 — fast seeded PRNG (same seed → same sequence, always).
 * @param {number} seed
 * @returns {() => number} function returning [0, 1)
 */
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the full ordered list of {chapter, verse} for all 700 shlokas. */
function buildAllVerses() {
  const list = [];
  for (let ch = 1; ch <= 18; ch++) {
    for (let v = 1; v <= CHAPTER_VERSE_COUNTS[ch - 1]; v++) {
      list.push({ chapter: ch, verse: v });
    }
  }
  return list; // 700 entries
}

/**
 * Deterministically shuffle arr using Fisher-Yates + mulberry32(seed).
 * The same seed always produces the same order — no storage needed.
 */
function deterministicShuffle(arr, seed) {
  const a = [...arr];
  const rand = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build once at startup (cached in module scope)
const ALL_VERSES    = buildAllVerses();              // [{ chapter, verse }, …] × 700
const DAILY_ORDER   = deterministicShuffle(ALL_VERSES, 20240101); // Fixed seed

/**
 * Return how many full UTC days have elapsed since EPOCH.
 * Ensures every device in every timezone resolves the same "today" verse.
 */
function utcDaysSinceEpoch() {
  const now = new Date();
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const utcEpoch = Date.UTC(EPOCH.getUTCFullYear(), EPOCH.getUTCMonth(), EPOCH.getUTCDate());
  return Math.floor((utcToday - utcEpoch) / 86400000);
}

/** Get today's index (0–699). */
const TODAY_DAY_INDEX = utcDaysSinceEpoch();

/** Resolve a day-offset to { chapter, verse, dayIndex, isToday } */
function getVerseForOffset(offset) {
  const dayIndex = TODAY_DAY_INDEX + offset;
  const idx      = ((dayIndex % DAILY_ORDER.length) + DAILY_ORDER.length) % DAILY_ORDER.length;
  return {
    ...DAILY_ORDER[idx],
    dayIndex,
    cyclePosition: idx + 1,     // 1-based position within 700-day cycle
    isToday: offset === 0
  };
}

// ── API & Cache ────────────────────────────────────────────────

const CACHE_PREFIX = 'gv_verse_';
const CACHE_VER    = 'v2';

function cacheKey(chapter, verse) {
  return `${CACHE_PREFIX}${CACHE_VER}_${chapter}_${verse}`;
}

/** Load from localStorage cache. Returns null if not cached. */
function loadFromCache(chapter, verse) {
  try {
    const raw = localStorage.getItem(cacheKey(chapter, verse));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Save to localStorage cache (silent on quota errors). */
function saveToCache(chapter, verse, data) {
  try {
    localStorage.setItem(cacheKey(chapter, verse), JSON.stringify(data));
  } catch { /* quota exceeded — ignore */ }
}

/**
 * Load the bundled verse data JSON (fetched once, then cached in memory).
 */
async function ensureVerseData() {
  if (VERSE_DATA) return VERSE_DATA;
  glog('info', 'Loading bundled verse data...');
  const res = await fetch('data/verses.json');
  if (!res.ok) throw new Error(`Failed to load verse data: HTTP ${res.status}`);
  VERSE_DATA = await res.json();
  glog('info', `Loaded ${Object.keys(VERSE_DATA).length} verses from local bundle`);
  return VERSE_DATA;
}

/**
 * Load verse data: cache → local bundle.
 * Returns normalised { slok, transliteration, translation, attribution,
 *                      wordMeanings, commentary, audioUrl } or throws.
 */
async function loadVerse(chapter, verse) {
  // 1. Cache hit
  const cached = loadFromCache(chapter, verse);
  if (cached) {
    glog('info', 'Verse loaded from cache');
    return cached;
  }

  // 2. Load from bundled data
  const data = await ensureVerseData();
  const key = `${chapter}_${verse}`;
  const raw = data[key];
  if (!raw) {
    throw new Error(`Verse ${chapter}:${verse} not found in local data`);
  }

  const normalised = normaliseVerseData(raw, chapter, verse);
  saveToCache(chapter, verse, normalised);
  return normalised;
}

/**
 * Normalise the raw API response into a consistent shape.
 * The Vedic Scriptures API has multiple translators keyed by short name
 * (siva = Sivananda, purohit = Purohit, tej = Tejomayananda, gambir = Gambhirananda …)
 */
function normaliseVerseData(raw, chapter, verse) {
  // Pick best available English translation (priority order)
  const translators = [
    { key: 'siva',    name: 'Swami Sivananda'      },
    { key: 'gambir',  name: 'Swami Gambhirananda'  },
    { key: 'tej',     name: 'Swami Tejomayananda'  },
    { key: 'purohit', name: 'Swami Purohit'        },
    { key: 'adi',     name: 'Swami Adidevananda'   },
    { key: 'san',     name: 'Dr. Sankaranarayan'   },
  ];

  let translation  = '';
  let attribution  = '';
  let commentary   = '';

  for (const t of translators) {
    const entry = raw[t.key];
    if (entry && entry.et) {
      // Skip entries that say "did not comment" — fall through to next translator
      if (entry.et.toLowerCase().includes('did not comment')) continue;
      translation = entry.et;
      attribution = t.name;
      commentary  = entry.ec || entry.sc || '';
      break;
    }
  }

  // Audio: current per-verse Sanskrit recitations are served from gita-audio.jkyog.org
  // URL format: 3-digit chapter + '_' + 3-digit verse (e.g. 002_047.mp3)
  const chPad = String(chapter).padStart(3, '0');
  const vPad  = String(verse).padStart(3, '0');
  const audioUrl = `https://gita-audio.jkyog.org/audio/sanskrit/gita_audios/${chPad}_${vPad}.mp3`;

  return {
    chapter,
    verse,
    slok:          raw.slok || raw.text || '',
    transliteration: raw.transliteration || raw.roman || '',
    translation,
    attribution,
    wordMeanings:  raw.wordmeanings || raw.word_meanings || raw.wordMeanings || '',
    commentary,
    reflection:    raw.reflection || '',
    story:         raw.story || '',
    audioUrl
  };
}

// ── Audio ─────────────────────────────────────────────────────

let audioState = 'idle'; // idle | loading | playing | paused | error
const AUDIO_PROBE_TIMEOUT_MS = 9000;
const AUDIO_AVAILABILITY = new Map();
let AUDIO_SETUP_SEQ = 0;

function checkAudioAvailability(url) {
  if (AUDIO_AVAILABILITY.has(url)) {
    return Promise.resolve(AUDIO_AVAILABILITY.get(url));
  }

  return new Promise((resolve) => {
    const probe = document.createElement('audio');
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeEventListener('loadedmetadata', onSuccess);
      probe.removeEventListener('canplay', onSuccess);
      probe.removeEventListener('error', onFailure);
      probe.src = '';
      try { probe.load(); } catch { /* ignore */ }
      AUDIO_AVAILABILITY.set(url, ok);
      resolve(ok);
    };

    const onSuccess = () => finish(true);
    const onFailure = () => finish(false);

    const timer = setTimeout(() => finish(false), AUDIO_PROBE_TIMEOUT_MS);

    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', onSuccess, { once: true });
    probe.addEventListener('canplay', onSuccess, { once: true });
    probe.addEventListener('error', onFailure, { once: true });
    probe.src = url;
    probe.load();
  });
}

async function setupAudioIfAvailable(verseData) {
  const seq = ++AUDIO_SETUP_SEQ;
  const audioRow = document.getElementById('audioRow');
  if (!audioRow) return;

  audioRow.classList.add('hidden');
  const isAvailable = await checkAudioAvailability(verseData.audioUrl);

  if (seq !== AUDIO_SETUP_SEQ) return;

  if (!isAvailable) {
    glog('info', 'Audio unavailable for this verse in current network/region');
    return;
  }

  audioRow.classList.remove('hidden');
  setupAudio(verseData);
}

function setupAudio(verseData) {
  const audioEl    = document.getElementById('audioEl');
  const audioBtn   = document.getElementById('audioBtn');
  const btnLabel   = document.getElementById('audioBtnLabel');
  const playIcon   = document.getElementById('audioPlayIcon');

  audioState = 'idle';
  audioEl.src = '';
  let audioLoadTimer = null;

  function clearAudioTimer() {
    if (audioLoadTimer) {
      clearTimeout(audioLoadTimer);
      audioLoadTimer = null;
    }
  }

  function setBtn(state) {
    audioBtn.classList.toggle('playing', state === 'playing');
    audioBtn.classList.toggle('loading', state === 'loading');

    if (state === 'loading') {
      btnLabel.textContent = 'Loading…';
      playIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>';
    } else if (state === 'playing') {
      btnLabel.textContent = 'Pause';
      playIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>';
    } else if (state === 'error') {
      btnLabel.textContent = 'TTS — Listen';
      playIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 14,8 4,14"/></svg>';
    } else {
      btnLabel.textContent = 'Listen in Sanskrit';
      playIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 14,8 4,14"/></svg>';
    }
  }

  // Audio element events
  audioEl.addEventListener('canplay', () => {
    clearAudioTimer();
    if (audioState === 'loading') {
      audioState = 'playing';
      setBtn('playing');
      audioEl.play().catch(() => {});
    }
  }, { once: true });

  audioEl.addEventListener('error', () => {
    clearAudioTimer();
    audioState = 'idle';
    setBtn('idle');
    glog('error', 'Audio playback error for URL:', verseData.audioUrl);
  }, { once: true });

  audioEl.addEventListener('ended', () => {
    audioState = 'idle';
    setBtn('idle');
  });

  audioEl.addEventListener('pause', () => {
    if (audioState === 'playing') {
      audioState = 'paused';
      btnLabel.textContent = 'Resume';
    }
  });

  audioEl.addEventListener('play', () => {
    audioState = 'playing';
    setBtn('playing');
  });

  audioBtn.onclick = () => {
    if (audioState === 'idle') {
      // Try server audio first
      audioState = 'loading';
      setBtn('loading');
      audioEl.src = verseData.audioUrl;
      audioEl.load();
      audioLoadTimer = setTimeout(() => {
        if (audioState === 'loading') {
          audioEl.src = '';
          audioState = 'idle';
          setBtn('idle');
          glog('error', 'Audio load timed out:', verseData.audioUrl);
        }
      }, 12000);
    } else if (audioState === 'loading') {
      // Cancel
      clearAudioTimer();
      audioEl.src = '';
      audioState = 'idle';
      setBtn('idle');
    } else if (audioState === 'playing') {
      audioEl.pause();
    } else if (audioState === 'paused') {
      audioEl.play().catch(() => {});
    }
  };

  setBtn('idle');
}

// ── UI Rendering ──────────────────────────────────────────────

function formatDate(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function showLoading() {
  document.getElementById('stateLoading').classList.remove('hidden');
  document.getElementById('stateError').classList.add('hidden');
  document.getElementById('shlokaCard').classList.add('hidden');
}

function showError(msg) {
  document.getElementById('stateLoading').classList.add('hidden');
  document.getElementById('stateError').classList.remove('hidden');
  document.getElementById('shlokaCard').classList.add('hidden');
  document.getElementById('errorMsg').textContent = msg;
}

function showCard() {
  document.getElementById('stateLoading').classList.add('hidden');
  document.getElementById('stateError').classList.add('hidden');
  document.getElementById('shlokaCard').classList.remove('hidden');
}

function renderVerse(verseRef, verseData) {
  LAST_VERSE_DATA = verseData;
  // Verse badge
  document.getElementById('chNum').textContent  = verseRef.chapter;
  document.getElementById('vNum').textContent   = verseRef.verse;
  document.getElementById('chName').textContent = CHAPTER_NAMES[verseRef.chapter - 1];

  // Sanskrit
  document.getElementById('sanskritText').textContent  = verseData.slok;
  document.getElementById('translitText').textContent  = verseData.transliteration;

  // Translation
  document.getElementById('translationText').textContent  = verseData.translation || '(Translation unavailable)';
  document.getElementById('translationAttrib').textContent =
    verseData.attribution ? `— ${verseData.attribution}` : '';

  // Commentary accordion
  const accCommentary = document.getElementById('accordionCommentary');
  if (verseData.commentary) {
    document.getElementById('commentaryText').textContent = verseData.commentary;
    accCommentary.classList.remove('hidden');
  } else {
    accCommentary.classList.add('hidden');
  }

  // Story accordion
  const accStory = document.getElementById('accordionStory');
  if (verseData.story) {
    document.getElementById('storyText').textContent = verseData.story;
    accStory.classList.remove('hidden');
  } else {
    accStory.classList.add('hidden');
  }

  // Reflection card
  const reflectionCard = document.getElementById('reflectionCard');
  if (verseData.reflection) {
    document.getElementById('reflectionText').textContent = verseData.reflection;
    reflectionCard.classList.remove('hidden');
  } else {
    reflectionCard.classList.add('hidden');
  }

  // Day strip
  const cycleText = `Verse ${verseRef.cyclePosition} of 700`;
  document.getElementById('dayProgress').textContent = cycleText;

  // Audio
  setupAudioIfAvailable(verseData);

  // AI section: show/hide setup vs. content
  refreshAiSection(verseData);

  showCard();
}

// ── Day Navigation ────────────────────────────────────────────

let currentOffset = 0;

function updateHistoryButton() {
  const btn = document.getElementById('yesterdayBtn');
  if (!btn) return;
  btn.textContent = currentOffset === 0 ? '← Yesterday' : '↺ Back to Today';
}

async function navigateTo(offset) {
  glog('info', 'navigateTo called, offset:', offset);
  currentOffset = offset === -1 ? -1 : 0;
  const verseRef = getVerseForOffset(currentOffset);
  glog('info', 'Today\'s verse: Chapter', verseRef.chapter, 'Verse', verseRef.verse, '(cycle', verseRef.cyclePosition, ')');

  // Day strip
  const label = currentOffset === 0 ? 'Today' : 'Yesterday';
  document.getElementById('dateDisplay').textContent = `${label} · ${formatDate(currentOffset)}`;
  document.getElementById('dayProgress').textContent = `Verse ${verseRef.cyclePosition} of 700`;
  updateHistoryButton();

  // Reset accordions
  resetAccordions();

  showLoading();

  try {
    glog('info', 'Loading verse data...');
    const data = await loadVerse(verseRef.chapter, verseRef.verse);
    glog('info', 'Verse loaded successfully');
    renderVerse(verseRef, data);
  } catch (err) {
    glog('error', 'Failed to load verse:', err.message);
    showError(`Could not load Chapter ${verseRef.chapter}, Verse ${verseRef.verse}. ` +
              `Check your connection or try again. (${err.message})`);
  }
}

function resetAccordions() {
  document.querySelectorAll('.accordion-trigger').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
    btn.querySelector('.accordion-icon').style.transform = '';
  });
  document.querySelectorAll('.accordion-panel').forEach(panel => {
    panel.classList.add('hidden');
  });
}

// ── Accordions ─────────────────────────────────────────────────

function initAccordion(triggerId, panelId) {
  const trigger = document.getElementById(triggerId) ||
    document.querySelector(`[aria-controls="${panelId}"]`);
  const panel   = document.getElementById(panelId);
  if (!trigger || !panel) return;

  trigger.addEventListener('click', () => {
    const expanded = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!expanded));
    panel.classList.toggle('hidden', expanded);
  });
}

function initAccordions() {
  // Find all accordions by their triggers
  document.querySelectorAll('.accordion-trigger').forEach(trigger => {
    const panelId = trigger.getAttribute('aria-controls');
    const panel   = panelId ? document.getElementById(panelId) : null;
    if (!panel) return;

    trigger.addEventListener('click', () => {
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!expanded));
      panel.classList.toggle('hidden', expanded);
    });
  });
}

// ── AI Insight (Anthropic API, optional) ─────────────────────

// Always proxied through /.netlify/functions/ai-insight (works on
// Netlify AND the local dev server).  The proxy uses a server-side
// key when available, or the user's own key sent in x-api-key.
let HAS_SERVER_KEY = false;   // true when the server has its own key
let LAST_VERSE_DATA = null;
let CAPTCHA_REQUIRED = false;
let TURNSTILE_SITE_KEY = '';
let TURNSTILE_TOKEN = '';
let TURNSTILE_WIDGET_ID = null;
let TURNSTILE_SCRIPT_PROMISE = null;
let CLIENT_FP = '';

function getClientFingerprint() {
  if (CLIENT_FP) return CLIENT_FP;
  const raw = [
    navigator.userAgent || '',
    navigator.language || '',
    navigator.platform || '',
    Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  ].join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  CLIENT_FP = `gv_${Math.abs(hash).toString(36)}`;
  return CLIENT_FP;
}

async function ensureTurnstileScript() {
  if (window.turnstile) return;
  if (TURNSTILE_SCRIPT_PROMISE) return TURNSTILE_SCRIPT_PROMISE;

  TURNSTILE_SCRIPT_PROMISE = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return TURNSTILE_SCRIPT_PROMISE;
}

async function ensureCaptchaToken() {
  if (!CAPTCHA_REQUIRED) return true;
  if (TURNSTILE_TOKEN) return true;

  const wrap = document.getElementById('captchaWrap');
  const content = document.getElementById('aiInsightContent');
  content.classList.remove('hidden');
  wrap.classList.remove('hidden');

  if (!TURNSTILE_SITE_KEY) {
    document.getElementById('aiText').textContent = 'CAPTCHA is required but site key is not configured.';
    return false;
  }

  try {
    await ensureTurnstileScript();
  } catch {
    document.getElementById('aiText').textContent = 'Could not load CAPTCHA. Please refresh.';
    return false;
  }

  if (TURNSTILE_WIDGET_ID === null) {
    const widget = document.getElementById('turnstileWidget');
    widget.innerHTML = '';
    TURNSTILE_WIDGET_ID = window.turnstile.render(widget, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'dark',
      callback: (token) => {
        TURNSTILE_TOKEN = token;
        wrap.classList.add('hidden');
      },
      'expired-callback': () => {
        TURNSTILE_TOKEN = '';
        wrap.classList.remove('hidden');
      },
      'error-callback': () => {
        TURNSTILE_TOKEN = '';
        wrap.classList.remove('hidden');
      }
    });
  }

  return !!TURNSTILE_TOKEN;
}

async function detectAiMode() {
  glog('info', 'Detecting AI mode...');
  try {
    const res = await withTimeout(fetch('/.netlify/functions/ai-insight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ probe: true }),
    }), 3000, 'AI probe timeout');
    glog('info', 'AI probe response:', res.status);
    // 200 = function exists & server key is configured
    // 503 = function exists but no server key (user key needed)
    if (res.status === 200) {
      HAS_SERVER_KEY = true;
    } else {
      HAS_SERVER_KEY = false;
    }
  } catch (err) {
    glog('info', 'AI probe failed (expected locally):', err.message);
    HAS_SERVER_KEY = false;
  } finally {
    if (LAST_VERSE_DATA) refreshAiSection(LAST_VERSE_DATA);
  }
}

function getApiKey() {
  return localStorage.getItem('gv_anthropic_key') || '';
}

function refreshAiSection(verseData) {
  const hasKey = HAS_SERVER_KEY || !!getApiKey();
  document.getElementById('aiSetupPrompt').classList.toggle('hidden', hasKey);
  document.getElementById('aiInsightContent').classList.toggle('hidden', !hasKey);
  if (!CAPTCHA_REQUIRED || TURNSTILE_TOKEN) {
    document.getElementById('captchaWrap').classList.add('hidden');
  }

  if (hasKey) {
    document.getElementById('aiText').textContent = 'Generating insight…';
    document.getElementById('aiLoading').classList.add('hidden');
    fetchAiInsight(verseData);
  }

  document.getElementById('aiRefresh').onclick = () => fetchAiInsight(verseData);
}

async function fetchAiInsight(verseData) {
  const loadingEl  = document.getElementById('aiLoading');
  const textEl     = document.getElementById('aiText');
  const refreshBtn = document.getElementById('aiRefresh');

  loadingEl.classList.remove('hidden');
  textEl.textContent = '';
  refreshBtn.disabled = true;

  try {
    // Build headers — include user's key if no server-side key
    const headers = {
      'content-type': 'application/json',
      'x-client-fingerprint': getClientFingerprint()
    };
    if (!HAS_SERVER_KEY) {
      const key = getApiKey();
      if (!key) { textEl.textContent = 'Add your Anthropic API key in Settings.'; return; }
      headers['x-api-key'] = key;
    } else if (CAPTCHA_REQUIRED) {
      const ok = await ensureCaptchaToken();
      if (!ok) {
        textEl.textContent = 'Complete CAPTCHA verification to continue.';
        return;
      }
      headers['x-turnstile-token'] = TURNSTILE_TOKEN;
    }

    const res = await fetch('/.netlify/functions/ai-insight', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chapter:         verseData.chapter,
        verse:           verseData.verse,
        slok:            verseData.slok,
        transliteration: verseData.transliteration,
        translation:     verseData.translation
      })
    });
    const data = await res.json();
    if (!res.ok && data?.error === 'CAPTCHA_REQUIRED') {
      CAPTCHA_REQUIRED = true;
      TURNSTILE_SITE_KEY = data.siteKey || TURNSTILE_SITE_KEY;
      TURNSTILE_TOKEN = '';
      document.getElementById('aiText').textContent = 'Complete CAPTCHA verification to continue.';
      await ensureCaptchaToken();
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const insight = data.insight || '';

    textEl.textContent = insight;
  } catch (err) {
    textEl.textContent = `Couldn't get insight: ${err.message}`;
  } finally {
    if (CAPTCHA_REQUIRED && HAS_SERVER_KEY && window.turnstile && TURNSTILE_WIDGET_ID !== null) {
      TURNSTILE_TOKEN = '';
      window.turnstile.reset(TURNSTILE_WIDGET_ID);
    }
    loadingEl.classList.add('hidden');
    refreshBtn.disabled = false;
  }
}

// ── Settings ──────────────────────────────────────────────────

function openSettings() {
  document.getElementById('drawerOverlay').classList.remove('hidden');
  document.getElementById('settingsDrawer').classList.remove('hidden');
  document.getElementById('drawerOverlay').removeAttribute('aria-hidden');
  document.getElementById('settingsDrawer').removeAttribute('aria-hidden');

  // Hide the API key section if the server already has a key configured
  const keyGroup = document.getElementById('apiKeyInput').closest('.setting-group');
  if (keyGroup) keyGroup.style.display = HAS_SERVER_KEY ? 'none' : '';

  // Populate API key field (masked)
  const key = getApiKey();
  document.getElementById('apiKeyInput').value = key ? key : '';

  // Cache info
  const count = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).length;
  document.getElementById('cacheInfo').textContent = ` (${count} verses cached)`;
}

function closeSettings() {
  document.getElementById('drawerOverlay').classList.add('hidden');
  document.getElementById('settingsDrawer').classList.add('hidden');
  document.getElementById('drawerOverlay').setAttribute('aria-hidden', 'true');
  document.getElementById('settingsDrawer').setAttribute('aria-hidden', 'true');
}

function saveApiKey() {
  const key    = document.getElementById('apiKeyInput').value.trim();
  const status = document.getElementById('apiKeyStatus');

  if (!key) {
    status.textContent = 'Please enter a key.';
    status.className   = 'api-key-status error';
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    status.textContent = 'Key should start with sk-ant-…';
    status.className   = 'api-key-status error';
    return;
  }

  localStorage.setItem('gv_anthropic_key', key);
  status.textContent = '✓ Saved — AI Insights are now enabled.';
  status.className   = 'api-key-status ok';

  // Refresh the AI panel on the current card
  const verseRef = getVerseForOffset(currentOffset);
  const cached   = loadFromCache(verseRef.chapter, verseRef.verse);
  if (cached) refreshAiSection(cached);
}

function clearApiKey() {
  localStorage.removeItem('gv_anthropic_key');
  document.getElementById('apiKeyInput').value = '';
  const status = document.getElementById('apiKeyStatus');
  status.textContent = 'Key cleared.';
  status.className   = 'api-key-status';
}

function clearCache() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
  keys.forEach(k => localStorage.removeItem(k));
  document.getElementById('cacheInfo').textContent = ` (cache cleared)`;
}

// ── Ask Krishna ────────────────────────────────────────────────

async function askKrishna() {
  const input = document.getElementById('askKrishnaInput');
  const btn = document.getElementById('askKrishnaBtn');
  const loading = document.getElementById('askKrishnaLoading');
  const response = document.getElementById('askKrishnaResponse');
  const question = (input.value || '').trim();

  if (!question) return;
  if (question.length > 500) {
    response.textContent = 'Please keep your question under 500 characters.';
    response.classList.remove('hidden');
    return;
  }

  const verseData = LAST_VERSE_DATA;
  if (!verseData) return;

  btn.disabled = true;
  loading.classList.remove('hidden');
  response.classList.add('hidden');

  const apiKey = localStorage.getItem('gv_anthropic_key') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  headers['x-client-fingerprint'] = getClientFingerprint();

  try {
    const res = await withTimeout(fetch('/.netlify/functions/ask-krishna', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chapter: verseData.chapter,
        verse: verseData.verse,
        translation: verseData.translation,
        question
      })
    }), 20000, 'Request timed out');

    const data = await res.json();
    if (!res.ok) {
      response.textContent = data.error || 'Something went wrong. Please try again.';
    } else {
      response.textContent = data.answer || '';
    }
  } catch (err) {
    response.textContent = err.message || 'Could not reach the server. Please try again.';
  }

  loading.classList.add('hidden');
  response.classList.remove('hidden');
  btn.disabled = false;
}

// ── Bootstrap ──────────────────────────────────────────────────

function init() {
  glog('info', '=== GitaVerse init ===');

  // Retry button (in error state)
  document.getElementById('retryBtn').addEventListener('click', () => navigateTo(currentOffset));

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  document.getElementById('drawerOverlay').addEventListener('click', closeSettings);
  document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
  document.getElementById('clearApiKey').addEventListener('click', clearApiKey);
  document.getElementById('clearCache').addEventListener('click', clearCache);
  document.getElementById('aiOpenSettings').addEventListener('click', openSettings);
  document.getElementById('yesterdayBtn').addEventListener('click', () => {
    navigateTo(currentOffset === 0 ? -1 : 0);
  });

  // Accordions
  initAccordions();

  // Ask Krishna
  document.getElementById('askKrishnaBtn').addEventListener('click', askKrishna);
  document.getElementById('askKrishnaInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') askKrishna();
  });

  // SW cleanup + fresh registration (fire-and-forget, never blocks verse load)
  const swClean = window.__swReady || Promise.resolve();
  swClean.then(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* non-fatal */ });
    }
  }).catch(() => {});

  // Load today's verse immediately — don't wait for SW cleanup
  glog('info', 'Starting detectAiMode...');
  detectAiMode().finally(() => {
    glog('info', 'AI mode detected');
  });
  glog('info', 'Loading today\'s verse...');
  navigateTo(0);
}

document.addEventListener('DOMContentLoaded', init);
