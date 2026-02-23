"""
Local dev server for GitaVerse.
Serves static files AND proxies /api/insight → Anthropic API,
so browser CORS restrictions are bypassed.

Usage:
  python3 server.py            # reads key from ANTHROPIC_API_KEY env var
  ANTHROPIC_API_KEY=sk-ant-... python3 server.py

Logs are written to backend.log in the project root.
"""

import http.server
import json
import logging
import logging.handlers
import os
import urllib.request
import urllib.error

PORT = 8080
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "backend.log")

# Daily rotating file log (keeps 7 days) + console
formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

file_handler = logging.handlers.TimedRotatingFileHandler(
    LOG_FILE, when="midnight", interval=1, backupCount=7, encoding="utf-8"
)
file_handler.setFormatter(formatter)
file_handler.suffix = "%Y-%m-%d"  # e.g. backend.log.2026-02-23

console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)

logger = logging.getLogger("GitaVerse")
logger.setLevel(logging.INFO)
logger.addHandler(file_handler)
logger.addHandler(console_handler)


class GitaVerseHandler(http.server.SimpleHTTPRequestHandler):
    """Serves static files + proxies POST /api/insight to Anthropic."""

    def end_headers(self):
        # Prevent browser from caching static files during development
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        # Allow the Service Worker scope
        self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def do_POST(self):
        if self.path in ("/api/insight", "/.netlify/functions/ai-insight"):
            self._proxy_insight()
        else:
            self.send_error(404)

    def _proxy_insight(self):
        logger.info("AI insight request received")
        # Read the API key from environment or from the request header
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")

        # Also allow the browser to send the key (for user-provided keys)
        browser_key = self.headers.get("x-api-key", "")
        if browser_key:
            api_key = browser_key

        if not api_key:
            logger.warning("No API key available")
            self._json_response(503, {"error": "No API key. Set ANTHROPIC_API_KEY env var or enter key in Settings."})
            return

        # Read request body
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self._json_response(400, {"error": "Invalid JSON"})
            return

        # Lightweight capability probe used by frontend to detect server-key mode
        if body.get("probe") is True:
            has_server_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
            if not has_server_key:
                self._json_response(503, {"ok": False, "serverKey": False})
                return
            self._json_response(200, {"ok": True, "serverKey": True})
            return

        chapter = body.get("chapter", "")
        verse = body.get("verse", "")
        slok = body.get("slok", "")
        transliteration = body.get("transliteration", "")
        translation = body.get("translation", "")

        prompt = (
            f"You are a wise and compassionate teacher of the Bhagavad Gita.\n\n"
            f"Here is a shloka from Chapter {chapter}, Verse {verse}:\n\n"
            f"Sanskrit: {slok}\n"
            f"Transliteration: {transliteration}\n"
            f"Standard translation: {translation}\n\n"
            f"Please give a brief (150–200 word), warm, and practical insight about this verse — "
            f"connecting its wisdom to everyday modern life. Write in plain paragraphs, no bullet points "
            f"or headers. Speak directly to the reader."
        )

        anthropic_body = json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 300,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()

        req = urllib.request.Request(
            ANTHROPIC_URL,
            data=anthropic_body,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read())
                insight = ""
                if data.get("content"):
                    insight = data["content"][0].get("text", "")
                logger.info("AI insight returned (%d chars)", len(insight))
                self._json_response(200, {"insight": insight})
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()
            try:
                err_data = json.loads(err_body)
                msg = err_data.get("error", {}).get("message", f"HTTP {e.code}")
            except json.JSONDecodeError:
                msg = f"HTTP {e.code}"
            logger.error("Anthropic API error: %s", msg)
            self._json_response(e.code, {"error": msg})
        except Exception as e:
            logger.error("Proxy error: %s", e)
            self._json_response(502, {"error": str(e)})

    def _json_response(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        logger.info("%s", args[0])


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with http.server.HTTPServer(("", PORT), GitaVerseHandler) as httpd:
        logger.info("🕉  GitaVerse dev server running at http://localhost:%d", PORT)
        logger.info("   API key: %s", '✓ set via env' if os.environ.get('ANTHROPIC_API_KEY') else '✗ not set (will use browser key)')
        logger.info("   Backend logs: %s (rotated daily, 7-day retention)", LOG_DIR)
        logger.info("   Press Ctrl+C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
