#!/usr/bin/env bash
# Turns any recording into a small, seamless loop for Noesis.
#   scripts/make-ambient-loop.sh recording.wav rain [start-seconds] [max-seconds]
# writes public/audio/ambient/rain.ogg. Names to use: rain, fire, wind, room.
# Skip a fade-in with start-seconds. The loop is at most max-seconds (default 150).
set -euo pipefail
input="${1:?recording file}"
name="${2:?rain | fire | wind | room}"
start="${3:-0}"
limit="${4:-150}"
fade=4
total=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$input")
length=$(awk -v t="$total" -v s="$start" -v m="$limit" 'BEGIN { l = t - s; printf "%.3f", (l > m ? m : l) }')
tail=$(awk -v l="$length" -v f="$fade" 'BEGIN { print l - f }')
out="$(dirname "$0")/../public/audio/ambient/${name}.ogg"
ffmpeg -y -v error -ss "$start" -t "$length" -i "$input" -filter_complex "
[0:a]atrim=0:${fade},asetpts=PTS-STARTPTS[head];
[0:a]atrim=${fade}:${tail},asetpts=PTS-STARTPTS[mid];
[0:a]atrim=${tail}:${length},asetpts=PTS-STARTPTS[tail];
[tail][head]acrossfade=d=${fade}[x];
[mid][x]concat=n=2:v=0:a=1,loudnorm=I=-26:TP=-3[out]" \
  -map "[out]" -ac 1 -ar 44100 -c:a libvorbis -b:a 64k "$out"
echo "Wrote $out ($(du -h "$out" | cut -f1))."
