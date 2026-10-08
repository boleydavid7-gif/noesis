#!/usr/bin/env bash
# Turns any recording into a small, seamless loop for Noesis.
#   scripts/make-ambient-loop.sh recording.wav rain      -> public/audio/ambient/rain.ogg
# Names to use: rain, fire, wind, room. The recording should be at least 30 seconds.
set -euo pipefail
input="${1:?recording file}"
name="${2:?rain | fire | wind | room}"
fade=4
length=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$input")
end=$(awk -v l="$length" 'BEGIN { printf "%.3f", (l > 150 ? 150 : l) }')
out="$(dirname "$0")/../public/audio/ambient/${name}.ogg"
ffmpeg -y -v error -t "$end" -i "$input" -filter_complex "
[0:a]atrim=0:${fade},asetpts=PTS-STARTPTS[head];
[0:a]atrim=${fade}:$(awk -v e="$end" -v f="$fade" 'BEGIN{print e-f}'),asetpts=PTS-STARTPTS[mid];
[0:a]atrim=$(awk -v e="$end" -v f="$fade" 'BEGIN{print e-f}'):${end},asetpts=PTS-STARTPTS[tail];
[tail][head]acrossfade=d=${fade}[x];
[mid][x]concat=n=2:v=0:a=1,loudnorm=I=-26:TP=-3[out]" \
  -map "[out]" -ac 1 -ar 44100 -c:a libvorbis -b:a 64k "$out"
echo "Wrote $out ($(du -h "$out" | cut -f1)). Add its details to public/audio/ambient/credits.json."
