#!/bin/bash
# Build the Arabic marketing video.
#   ./build.sh            -> uses audio/s01..s17.mp3 if present (voiceover), else renders a silent version
#   NO_AUDIO=1 ./build.sh -> force silent render (burned-in Arabic subtitles only)
set -e
cd "$(dirname "$0")"
[ -d node_modules/playwright-core ] || npm install --no-audit --no-fund
FPS=30; JOBS=${JOBS:-4}
HAVE_AUDIO=0
if [ -z "$NO_AUDIO" ]; then
  tools/fetch_audio.sh || true
  n=$(ls audio/s*.mp3 2>/dev/null | wc -l); [ "$n" -ge 17 ] && HAVE_AUDIO=1
fi
# 1) scene durations follow the real narration length
if [ "$HAVE_AUDIO" = 1 ]; then
  python3 - <<'PY'
import subprocess, json
d = {}
for i in range(1, 18):
    out = subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f"audio/s{i:02d}.mp3"]).decode().strip()
    d[i] = round(float(out), 3)
open("src/durations.js", "w").write("window.DUR=" + json.dumps(d) + ";")
print("narration seconds:", d)
PY
else
  echo "window.DUR={};" > src/durations.js
fi
node tools/probe.cjs > out/timeline.json
TOTAL=$(python3 -c "import json;print(json.load(open('out/timeline.json'))['total'])")
FRAMES=$(python3 -c "import math;print(math.ceil($TOTAL*$FPS))")
echo "duration ${TOTAL}s -> ${FRAMES} frames"
# 2) render frames in parallel
rm -rf out/frames; mkdir -p out/frames
per=$(( (FRAMES + JOBS - 1) / JOBS ))
for j in $(seq 0 $((JOBS-1))); do
  s=$((j*per)); e=$(( (j+1)*per )); [ $e -gt $FRAMES ] && e=$FRAMES
  node tools/render.cjs $s $e out/frames $FPS &
done
wait
# 3) encode (+ voiceover placed at each scene's narration start)
if [ "$HAVE_AUDIO" = 1 ]; then
  ins=""; fc=""; mix=""
  for i in $(seq 1 17); do
    ms=$(python3 -c "import json;print(int(json.load(open('out/timeline.json'))['scenes'][$i-1]['a0']*1000))")
    ins="$ins -i audio/s$(printf %02d $i).mp3"
    fc="$fc[$i:a]adelay=${ms}|${ms},volume=1.15[a$i];"; mix="$mix[a$i]"
  done
  ffmpeg -y -loglevel error -framerate $FPS -i out/frames/f%06d.jpg $ins \
    -filter_complex "${fc}${mix}amix=inputs=17:normalize=0,alimiter=limit=0.95[aout]" \
    -map 0:v -map "[aout]" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k -t $TOTAL \
    out/FFI-HR-marketing-video-ar.mp4
else
  ffmpeg -y -loglevel error -framerate $FPS -i out/frames/f%06d.jpg -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -an \
    out/FFI-HR-marketing-video-ar-silent.mp4
fi
rm -rf out/frames
ls -lh out/*.mp4
