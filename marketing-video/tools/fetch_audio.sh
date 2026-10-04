#!/bin/bash
# Downloads the 17 generated narration clips (Higgsfield / ElevenLabs v4 Turbo, voice "Sterling")
# into audio/s01.mp3 ... audio/s17.mp3. Needs outbound access to d8j0ntlcm91z4.cloudfront.net.
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, subprocess, os, sys
urls = json.load(open("audio_urls.json"))
ok = 0
for k, v in urls.items():
    f = f"audio/s{int(k):02d}.mp3"
    if os.path.exists(f) and os.path.getsize(f) > 2000:
        ok += 1; continue
    url = f"https://d8j0ntlcm91z4.cloudfront.net/user_3BudNbwTPR5TFgBbxF9LJMaO7Ej/{v}.mp3"
    r = subprocess.run(["curl", "-sS", "-m", "90", "-o", f, "-w", "%{http_code}", url], capture_output=True, text=True)
    if r.stdout.strip() == "200": ok += 1
    else: print("failed", k, r.stdout, r.stderr[:80])
print(f"downloaded {ok}/{len(urls)}")
sys.exit(0 if ok == len(urls) else 1)
PY
