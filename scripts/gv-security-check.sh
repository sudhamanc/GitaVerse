#!/usr/bin/env bash
set -u

BASE="https://dailygitaverse.netlify.app/.netlify/functions/ai-insight"
APP_ORIGIN="https://dailygitaverse.netlify.app"
FP="security-test-fp-001"

VALID_PAYLOAD='{"chapter":2,"verse":47,"slok":"कर्मण्येवाधिकारस्ते...","transliteration":"karmaṇy-evādhikāras te...","translation":"You have a right to action, not to its fruits."}'
INVALID_PAYLOAD='{"chapter":99,"verse":1,"slok":"x","transliteration":"x","translation":"x"}'

echo "=== 1) Probe ==="
curl -i -sS -X POST "$BASE" -H "content-type: application/json" -d '{"probe":true}'
echo

echo "=== 2) GET should be 405 ==="
curl -i -sS -X GET "$BASE"
echo

echo "=== 3) Invalid JSON should be 400 ==="
curl -i -sS -X POST "$BASE" -H "content-type: application/json" -d '{"chapter":2,'
echo

echo "=== 4) Oversized body should be 413 ==="
BIG_JSON=$(python3 - <<'PY'
print('{"blob":"' + ('a' * 13050) + '"}')
PY
)
curl -i -sS -X POST "$BASE" -H "content-type: application/json" --data "$BIG_JSON"
echo

echo "=== 5) Direct call should be 403 CAPTCHA_REQUIRED ==="
curl -i -sS -X POST "$BASE" -H "content-type: application/json" -H "x-client-fingerprint: $FP" -d "$VALID_PAYLOAD"
echo

echo "=== 6) Fake captcha token should still be 403 ==="
curl -i -sS -X POST "$BASE" -H "content-type: application/json" -H "x-client-fingerprint: $FP" -H "x-turnstile-token: fake-token" -d "$VALID_PAYLOAD"
echo

echo "=== 7) Browser-like invalid payload should be 422 (not 403) ==="
curl -i -sS -X POST "$BASE" \
  -H "content-type: application/json" \
  -H "origin: $APP_ORIGIN" \
  -H "referer: $APP_ORIGIN/" \
  -H "sec-fetch-site: same-origin" \
  -H "user-agent: Mozilla/5.0" \
  -H "x-client-fingerprint: ${FP}-browser" \
  -d "$INVALID_PAYLOAD"
echo

echo "=== 8) Repeated direct calls: expect 403 then 429 ==="
for i in $(seq 1 15); do
  code=$(curl -sS -o /tmp/gv_resp.txt -w "%{http_code}" -X POST "$BASE" \
    -H "content-type: application/json" \
    -H "x-client-fingerprint: ${FP}-rate" \
    -d "$VALID_PAYLOAD")
  body=$(tr '\n' ' ' < /tmp/gv_resp.txt)
  echo "Attempt $i -> HTTP $code | $body"
done
