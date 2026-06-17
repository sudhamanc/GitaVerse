#!/usr/bin/env python3
"""
Generate reflection prompts and story contexts for all 701 verses using Claude Haiku.
Adds 'reflection' and 'story' fields to data/verses.json.

Requires: ANTHROPIC_API_KEY environment variable
Model: claude-haiku-4-5-20251001
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

MODEL = "claude-haiku-4-5-20251001"
API_URL = "https://api.anthropic.com/v1/messages"
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

if not API_KEY:
    print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
VERSES_PATH = os.path.join(PROJECT_ROOT, "data", "verses.json")

# Priority order for finding English translation
TRANSLATORS = ["siva", "gambir", "tej", "purohit", "adi", "san", "prabhu"]


def get_english_translation(verse_data: dict) -> str:
    """Get best English translation for a verse."""
    for key in TRANSLATORS:
        entry = verse_data.get(key, {})
        et = entry.get("et", "")
        if et and "did not comment" not in et.lower():
            return et
    return ""


def call_claude(prompt: str, max_tokens: int = 150) -> str:
    """Call Claude Haiku API and return the text response."""
    payload = json.dumps({
        "model": MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode("utf-8")

    req = urllib.request.Request(API_URL, data=payload, headers={
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
    })

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["content"][0]["text"].strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        print(f"  API error {e.code}: {body[:200]}", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"  Request failed: {e}", file=sys.stderr)
        return ""


def generate_reflection(chapter: int, verse: int, translation: str) -> str:
    """Generate a single-sentence daily reflection prompt."""
    prompt = (
        f"For Bhagavad Gita Chapter {chapter}, Verse {verse} with this translation:\n"
        f'"{translation[:300]}"\n\n'
        "Write a single-sentence daily reflection prompt (15-25 words) that gives the reader "
        "a practical, actionable thing to notice or do today. Start with \"Today, ...\" "
        "Be warm, specific, and grounded in modern life. Output ONLY the one sentence, nothing else."
    )
    return call_claude(prompt, max_tokens=60)


def generate_story(chapter: int, verse: int, translation: str) -> str:
    """Generate Mahabharata battlefield context."""
    prompt = (
        f"For Bhagavad Gita Chapter {chapter}, Verse {verse} with this translation:\n"
        f'"{translation[:300]}"\n\n'
        "In 40-60 words, describe the Mahabharata battlefield context: who is speaking, "
        "what just happened, and why this verse is said at this moment. "
        "Write as vivid narrative prose in present tense. No headers or bullets. "
        "Output ONLY the narrative, nothing else."
    )
    return call_claude(prompt, max_tokens=120)


def main():
    with open(VERSES_PATH, "r", encoding="utf-8") as f:
        verses = json.load(f)

    total = len(verses)
    print(f"Generating reflections + stories for {total} verses (model: {MODEL})...")

    done = 0
    skipped = 0

    for key, vdata in verses.items():
        # Skip if already generated
        if vdata.get("reflection") and vdata.get("story"):
            skipped += 1
            continue

        chapter = vdata.get("chapter", 0)
        verse = vdata.get("verse", 0)
        translation = get_english_translation(vdata)

        if not translation:
            print(f"  {key}: no English translation, skipping")
            skipped += 1
            continue

        # Generate reflection if missing
        if not vdata.get("reflection"):
            reflection = generate_reflection(chapter, verse, translation)
            if reflection:
                vdata["reflection"] = reflection

        # Generate story if missing
        if not vdata.get("story"):
            story = generate_story(chapter, verse, translation)
            if story:
                vdata["story"] = story

        done += 1
        if done % 20 == 0:
            print(f"  {done}/{total - skipped} generated...")
            # Save progress periodically
            with open(VERSES_PATH, "w", encoding="utf-8") as f:
                json.dump(verses, f, ensure_ascii=False, separators=(",", ":"))

        # Rate limit: ~50 requests/min for Haiku (we do 2 per verse)
        time.sleep(0.6)

    # Final save
    with open(VERSES_PATH, "w", encoding="utf-8") as f:
        json.dump(verses, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nDone! Generated: {done}, Skipped (already done): {skipped}")
    print(f"File: {VERSES_PATH}")


if __name__ == "__main__":
    main()
