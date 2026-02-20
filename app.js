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

// ── Constants ─────────────────────────────────────────────────

const EPOCH = new Date('2024-01-01T00:00:00'); // Day 0

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

// Primary public API — no auth required, CORS open
// Returns JSON with slok, transliteration, siva.et (Sivananda translation), etc.
const API_PRIMARY = 'https://vedicscriptures.github.io/slok';

// Fallback: a handful of the most famous shlokas so the app works offline on first load
const OFFLINE_FALLBACK = {
  '2_47': {
    slok: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥ ४७॥',
    transliteration: 'karmaṇy-evādhikāras te mā phaleṣhu kadāchana\nmā karma-phala-hetur bhūr mā te saṅgo \'stvakarmaṇi',
    siva: { et: 'You have a right to perform your prescribed duties, but you are not entitled to the fruits of your actions. Never consider yourself the cause of the results of your activities, and never be attached to not doing your duty.' },
    purohit: { et: 'You have the right to work, but never to the fruit of work. You should never engage in action for the sake of reward, nor should you long for inaction.' },
    wordmeanings: 'karmaṇi—in prescribed duties; eva—certainly; adhikāraḥ—right; te—of you; mā—never; phaleṣhu—in the fruits; kadāchana—at any time; mā—never; karma-phala—results of the activities; hetuḥ—cause; bhūḥ—become; mā—never; te—your; saṅgaḥ—attachment; astu—be; akarmaṇi—in inaction'
  },
  '2_20': {
    slok: 'न जायते म्रियते वा कदाचि\nन्नायं भूत्वा भविता वा न भूयः ।\nअजो नित्यः शाश्वतोऽयं पुराणो\nन हन्यते हन्यमाने शरीरे ॥ २०॥',
    transliteration: 'na jāyate mriyate vā kadāchin\nnāyaṁ bhūtvā bhavitā vā na bhūyaḥ\najo nityaḥ śhāśhvato \'yaṁ purāṇo\nna hanyate hanyamāne śharīre',
    siva: { et: 'The soul is never born, nor does it ever die at any time. It has not come into being, does not come into being, and will not come into being. It is unborn, eternal, ever-existing, and primeval. The soul is not slain when the body is slain.' },
    wordmeanings: 'na—never; jāyate—is born; mriyate—dies; vā—or; kadāchin—at any time; na—never; ayam—this soul; bhūtvā—having once existed; bhavitā—will again exist; vā—or; na—not; bhūyaḥ—further; ajaḥ—unborn; nityaḥ—eternal; śhāśhvataḥ—permanent; ayam—this; purāṇaḥ—ancient; na hanyate—is not killed; hanyamāne—being killed; śharīre—the body'
  },
  '4_7': {
    slok: 'यदा यदा हि धर्मस्य ग्लानिर्भवति भारत ।\nअभ्युत्थानमधर्मस्य तदात्मानं सृजाम्यहम् ॥ ७॥',
    transliteration: 'yadā yadā hi dharmasya glānir bhavati bhārata\nabhyutthānam adharmasya tadātmānaṁ sṛjāmy aham',
    siva: { et: 'Whenever there is a decline of righteousness, O Bharata, and a rise of unrighteousness, then I manifest Myself.' },
    wordmeanings: 'yadā yadā—whenever; hi—certainly; dharmasya—of righteousness; glāniḥ—decline; bhavati—is; bhārata—Arjuna (descendant of Bharata); abhyutthānam—rise; adharmasya—of unrighteousness; tadā—at that time; ātmānam—myself; sṛjāmi—manifest; aham—I'
  },
  '9_26': {
    slok: 'पत्रं पुष्पं फलं तोयं यो मे भक्त्या प्रयच्छति ।\nतदहं भक्त्युपहृतमश्नामि प्रयतात्मनः ॥ २६॥',
    transliteration: 'patraṁ puṣhpaṁ phalaṁ toyaṁ yo me bhaktyā prayachchhati\ntad ahaṁ bhaktyupahṛitam aśhnāmi prayatātmanaḥ',
    siva: { et: 'Whoever offers Me with devotion a leaf, a flower, a fruit, or water — that devout offering from a pure-hearted person, I accept.' },
    wordmeanings: 'patram—a leaf; puṣhpam—a flower; phalam—a fruit; toyam—water; yaḥ—who; me—to me; bhaktyā—with devotion; prayachchhati—offers; tat—that; aham—I; bhakti-upahṛitam—offered with devotion; aśhnāmi—accept; prayata-ātmanaḥ—one in pure consciousness'
  },
  '18_66': {
    slok: 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज ।\nअहं त्वा सर्वपापेभ्यो मोक्षयिष्यामि मा शुचः ॥ ६६॥',
    transliteration: 'sarva-dharmān parityajya mām ekaṁ śharaṇaṁ vraja\nahaṁ tvāṁ sarva-pāpebhyo mokṣhayiṣhyāmi mā śhuchaḥ',
    siva: { et: 'Abandoning all duties, take refuge in Me alone. I will liberate you from all sins. Do not grieve.' },
    wordmeanings: 'sarva-dharmān—all varieties of dharma; parityajya—abandoning; mām—unto Me; ekam—only; śharaṇam—surrender; vraja—go; aham—I; tvām—you; sarva—all; pāpebhyaḥ—from sins; mokṣhayiṣhyāmi—will liberate; mā—do not; śhuchaḥ—grieve'
  }
};

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
 * Return how many full days have elapsed since EPOCH in local time.
 * Always yields the same number for the same calendar date regardless of time.
 */
function localDaysSinceEpoch() {
  const now   = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ep    = new Date(EPOCH.getFullYear(), EPOCH.getMonth(), EPOCH.getDate());
  return Math.floor((local - ep) / 86400000);
}

/** Get today's index (0–699). */
const TODAY_DAY_INDEX = localDaysSinceEpoch();

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
const CACHE_VER    = 'v1';

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
 * Fetch verse data from the public Vedic Scriptures API.
 * API: https://vedicscriptures.github.io/slok/{chapter}/{verse}/
 * Response includes: slok, transliteration, siva, tej, purohit, wordmeanings, …
 */
async function fetchFromAPI(chapter, verse) {
  const url = `${API_PRIMARY}/${chapter}/${verse}/`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Load verse data: cache → API → offline fallback (for famous shlokas).
 * Returns normalised { slok, transliteration, translation, attribution,
 *                      wordMeanings, commentary, audioUrl } or throws.
 */
async function loadVerse(chapter, verse) {
  // 1. Cache hit
  const cached = loadFromCache(chapter, verse);
  if (cached) return cached;

  // 2. Try API
  let raw;
  try {
    raw = await fetchFromAPI(chapter, verse);
  } catch (err) {
    // 3. Offline fallback for a handful of famous shlokas
    const fb = OFFLINE_FALLBACK[`${chapter}_${verse}`];
    if (fb) {
      raw = fb;
    } else {
      throw err; // propagate to caller
    }
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
    if (entry && (entry.et || entry.ht)) {
      translation = entry.et || entry.ht || '';
      attribution = t.name;
      commentary  = entry.sc || entry.hc || '';
      break;
    }
  }

  // Audio: IIT Kanpur Gita Supersite provides per-verse Sanskrit audio
  // URL format (0-padded chapter, 0-padded verse)
  const chPad = String(chapter).padStart(2, '0');
  const vPad  = String(verse).padStart(3, '0');
  const audioUrl = `https://www.gitasupersite.iitk.ac.in/gita/audio/gBGShankara_${chPad}${vPad}.mp3`;

  return {
    chapter,
    verse,
    slok:          raw.slok || raw.text || '',
    transliteration: raw.transliteration || raw.roman || '',
    translation,
    attribution,
    wordMeanings:  raw.wordmeanings || raw.word_meanings || raw.wordMeanings || '',
    commentary,
    audioUrl
  };
}

// ── Audio ─────────────────────────────────────────────────────

let audioState = 'idle'; // idle | loading | playing | paused | error

function setupAudio(verseData) {
  const audioEl    = document.getElementById('audioEl');
  const audioBtn   = document.getElementById('audioBtn');
  const btnLabel   = document.getElementById('audioBtnLabel');
  const playIcon   = document.getElementById('audioPlayIcon');

  audioState = 'idle';
  audioEl.src = '';

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
    if (audioState === 'loading') {
      audioState = 'playing';
      setBtn('playing');
      audioEl.play().catch(() => fallbackTTS(verseData));
    }
  }, { once: true });

  audioEl.addEventListener('error', () => {
    audioState = 'error';
    setBtn('error');
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
    } else if (audioState === 'loading') {
      // Cancel
      audioEl.src = '';
      audioState = 'idle';
      setBtn('idle');
    } else if (audioState === 'playing') {
      audioEl.pause();
    } else if (audioState === 'paused') {
      audioEl.play().catch(() => {});
    } else if (audioState === 'error') {
      // TTS fallback
      fallbackTTS(verseData);
    }
  };

  setBtn('idle');
}

/** Web Speech API fallback — reads the transliteration aloud. */
function fallbackTTS(verseData) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const text = verseData.transliteration || verseData.slok || '';
  if (!text) return;

  const utter   = new SpeechSynthesisUtterance(text);
  utter.rate     = 0.75;
  utter.pitch    = 0.9;
  utter.volume   = 1;

  // Prefer an Indian-English voice if available, for closer Sanskrit pronunciation
  const voices = window.speechSynthesis.getVoices();
  const indVoice = voices.find(v => v.lang === 'hi-IN' || v.lang === 'sa-IN') ||
                   voices.find(v => v.lang.startsWith('en-IN'));
  if (indVoice) utter.voice = indVoice;

  window.speechSynthesis.speak(utter);
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

  // Word meanings accordion
  const wm = verseData.wordMeanings;
  document.getElementById('wordMeaningsText').textContent = wm || '(Not available)';

  // Commentary accordion
  const accCommentary = document.getElementById('accordionCommentary');
  if (verseData.commentary) {
    document.getElementById('commentaryText').textContent = verseData.commentary;
    accCommentary.classList.remove('hidden');
  } else {
    accCommentary.classList.add('hidden');
  }

  // Day strip
  const cycleText = `Verse ${verseRef.cyclePosition} of 700`;
  document.getElementById('dayProgress').textContent = cycleText;

  // Audio
  setupAudio(verseData);

  // AI section: show/hide setup vs. content
  refreshAiSection(verseData);

  showCard();
}

// ── Day Navigation ────────────────────────────────────────────

let currentOffset = 0; // 0 = today

async function navigateTo(offset) {
  currentOffset = offset;
  const verseRef = getVerseForOffset(offset);

  // Day strip
  const dateStr = offset === 0 ? `Today · ${formatDate(0)}`
                : offset === -1 ? `Yesterday · ${formatDate(-1)}`
                : offset === 1  ? `Tomorrow · ${formatDate(1)}`
                : formatDate(offset);
  document.getElementById('dateDisplay').textContent = dateStr;
  document.getElementById('dayProgress').textContent = `Verse ${verseRef.cyclePosition} of 700`;

  // Today button dot
  document.getElementById('todayDot').classList.toggle('is-today', offset === 0);

  // Reset accordions
  resetAccordions();

  showLoading();

  try {
    const data = await loadVerse(verseRef.chapter, verseRef.verse);
    renderVerse(verseRef, data);
  } catch (err) {
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

function getApiKey() {
  return localStorage.getItem('gv_anthropic_key') || '';
}

function refreshAiSection(verseData) {
  const hasKey = !!getApiKey();
  document.getElementById('aiSetupPrompt').classList.toggle('hidden', hasKey);
  document.getElementById('aiInsightContent').classList.toggle('hidden', !hasKey);

  if (hasKey) {
    // Clear previous AI text when verse changes
    document.getElementById('aiText').textContent = '';
    document.getElementById('aiLoading').classList.add('hidden');
  }

  // Keep a reference so the refresh button works
  document.getElementById('aiRefresh').onclick = () => fetchAiInsight(verseData);
}

async function fetchAiInsight(verseData) {
  const key = getApiKey();
  if (!key) return;

  const loadingEl = document.getElementById('aiLoading');
  const textEl    = document.getElementById('aiText');
  const refreshBtn = document.getElementById('aiRefresh');

  loadingEl.classList.remove('hidden');
  textEl.textContent = '';
  refreshBtn.disabled = true;

  const prompt = `You are a wise and compassionate teacher of the Bhagavad Gita.

Here is a shloka from Chapter ${verseData.chapter}, Verse ${verseData.verse}:

Sanskrit: ${verseData.slok}
Transliteration: ${verseData.transliteration}
Standard translation: ${verseData.translation}

Please give a brief (150–200 word), warm, and practical insight about this verse — connecting its wisdom to everyday modern life. Write in plain paragraphs, no bullet points or headers. Speak directly to the reader.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'anthropic-dangerous-direct-browser-calls': 'true'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages:   [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data    = await res.json();
    const insight = data.content?.[0]?.text || '';
    textEl.textContent = insight;
  } catch (err) {
    textEl.textContent = `Couldn't get insight: ${err.message}`;
  } finally {
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

// ── Bootstrap ──────────────────────────────────────────────────

function init() {
  // Navigation — use event delegation to avoid duplicate listener issues
  document.getElementById('navBar').addEventListener('click', (e) => {
    if (e.target.closest('#prevBtn'))  navigateTo(currentOffset - 1);
    if (e.target.closest('#nextBtn'))  navigateTo(currentOffset + 1);
    if (e.target.closest('#todayBtn')) navigateTo(0);
  });

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

  // Accordions
  initAccordions();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* non-fatal */ });
  }

  // Load today
  navigateTo(0);
}

document.addEventListener('DOMContentLoaded', init);
