#!/usr/bin/env python3
"""
Download all 700 Bhagavad Gita verses from the pinned GitHub commit
of vedicscriptures.github.io and produce:

  data/verses.json      — trimmed (7 translators) for GitaVerse app
  data/verses-full.json — complete raw data (22 translators) for archive

Source: https://raw.githubusercontent.com/vedicscriptures/vedicscriptures.github.io/e42101a/slok/{ch}/{v}/index.json
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

# Verse counts per chapter (as available in the API — 701 total; ch1 has 47)
CHAPTER_VERSE_COUNTS = [
    47, 72, 43, 42, 29, 47,
    30, 28, 34, 42, 55, 20,
    35, 27, 20, 24, 28, 78,
]
# Note: Some editions count ch1 as 46 verses (700 total). The API has 47.

BASE_URL = "https://raw.githubusercontent.com/vedicscriptures/vedicscriptures.github.io/e42101a/slok"

# Translators to keep in the trimmed version (app priority order + Prabhupada)
KEEP_TRANSLATORS = ["siva", "gambir", "tej", "purohit", "adi", "san", "prabhu"]

# Fields to keep at the top level (besides translator keys)
KEEP_TOP_FIELDS = ["_id", "chapter", "verse", "slok", "transliteration", "wordmeanings"]


def fetch_verse(chapter: int, verse: int, retries: int = 3) -> dict | None:
    """Fetch a single verse JSON from the pinned commit."""
    url = f"{BASE_URL}/{chapter}/{verse}/index.json"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "GitaVerse-Downloader/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(1 * (attempt + 1))
            else:
                print(f"  FAILED {chapter}:{verse} after {retries} attempts: {e}", file=sys.stderr)
                return None


def trim_verse(raw: dict) -> dict:
    """Keep only the fields the app needs."""
    trimmed = {}
    for field in KEEP_TOP_FIELDS:
        if field in raw:
            trimmed[field] = raw[field]
    for key in KEEP_TRANSLATORS:
        if key in raw:
            trimmed[key] = raw[key]
    return trimmed


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    data_dir = os.path.join(project_root, "data")
    os.makedirs(data_dir, exist_ok=True)

    all_full = {}
    all_trimmed = {}
    total = sum(CHAPTER_VERSE_COUNTS)
    downloaded = 0
    failed = 0

    print(f"Downloading {total} verses...")

    for ch_idx, count in enumerate(CHAPTER_VERSE_COUNTS, start=1):
        print(f"  Chapter {ch_idx} ({count} verses)...", end=" ", flush=True)
        ch_ok = 0
        for v in range(1, count + 1):
            raw = fetch_verse(ch_idx, v)
            if raw:
                key = f"{ch_idx}_{v}"
                all_full[key] = raw
                all_trimmed[key] = trim_verse(raw)
                ch_ok += 1
                downloaded += 1
            else:
                failed += 1
            # Be polite to GitHub — small delay between requests
            time.sleep(0.05)
        print(f"{ch_ok}/{count} OK")

    # Write full archive
    full_path = os.path.join(data_dir, "verses-full.json")
    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(all_full, f, ensure_ascii=False, separators=(",", ":"))
    full_size = os.path.getsize(full_path) / (1024 * 1024)

    # Write trimmed app data
    trimmed_path = os.path.join(data_dir, "verses.json")
    with open(trimmed_path, "w", encoding="utf-8") as f:
        json.dump(all_trimmed, f, ensure_ascii=False, separators=(",", ":"))
    trimmed_size = os.path.getsize(trimmed_path) / (1024 * 1024)

    print(f"\nDone! {downloaded}/{total} downloaded, {failed} failed.")
    print(f"  data/verses-full.json: {full_size:.1f} MB (archive)")
    print(f"  data/verses.json:      {trimmed_size:.1f} MB (app bundle)")


if __name__ == "__main__":
    main()
