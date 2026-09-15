#!/usr/bin/env bash
# Hand the FOMO login in your Chrome over to the Railway reader.
#
# Copies the `privy:*` localStorage keys from a signed-in fomo.family tab into
# the fomo-reader's FOMO_SESSION_B64 variable. The value is piped straight into
# Railway and never printed.
#
# After it succeeds, stop using that FOMO account in Chrome. Privy rotates the
# refresh token on every use, so two browsers sharing one login sign each other
# out within the hour.
#
#   bash apps/fomo-reader/scripts/handover-session.sh
set -uo pipefail
cd "$(dirname "$0")/../../.."

tmp=$(mktemp)
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT

echo "Reading the FOMO login from Chrome..."
browser-use > "$tmp" 2>&1 <<'PY'
import json, base64, time
new_tab("https://fomo.family")
wait_for_load()
entries = {}
for _ in range(15):
    time.sleep(2)
    entries = json.loads(js(
      "JSON.stringify(Object.fromEntries(Object.keys(localStorage)"
      ".filter(k => k.startsWith('privy:')).map(k => [k, localStorage.getItem(k)])))"
    ))
    if entries.get("privy:refresh_token"):
        break
print("DIAG url=" + page_info()["url"])
print("DIAG privy_keys=" + str(len(entries)))
print("DIAG has_refresh_token=" + str(bool(entries.get("privy:refresh_token"))))
if entries.get("privy:refresh_token"):
    print("SESSION_B64=" + base64.b64encode(json.dumps(entries).encode()).decode())
PY
status=$?

# Everything except the secret line, so a failure explains itself.
grep -v '^SESSION_B64=' "$tmp" | tail -15

payload=$(grep '^SESSION_B64=' "$tmp" | cut -d= -f2- || true)
if [ "$status" -ne 0 ] || [ -z "$payload" ]; then
  echo
  echo "No FOMO login copied (browser-use exit $status)."
  echo "Check Chrome is open and signed in at fomo.family, then run this again."
  exit 1
fi

if printf '%s' "$payload" | railway variables --service fomo-reader --skip-deploys --set-from-stdin FOMO_SESSION_B64 >/dev/null; then
  echo "FOMO_SESSION_B64 set on fomo-reader (${#payload} chars). Value not shown."
else
  echo "Railway refused the variable. Run 'railway whoami' and check the project link."
  exit 1
fi
