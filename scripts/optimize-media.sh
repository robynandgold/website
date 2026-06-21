#!/usr/bin/env bash
#
# Optimize site media in place, keeping every filename and extension
# unchanged so all HTML / JS / products.json references stay valid.
#
#   - Images (jpg/jpeg/png): cap the long edge at 1600px, recompress,
#     strip metadata. Small images are left effectively untouched.
#   - Videos (mp4/mov): re-encode to H.264 (CRF 28), cap width at 1080px,
#     drop the (unused) audio track, enable faststart for web playback.
#
# Idempotent: a marker file is written on success and the script exits
# early if it already exists, so re-runs never double-compress.
#
# Requires: ImageMagick (`convert`) and ffmpeg on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMG_DIR="$ROOT/src/images"
MARKER="$IMG_DIR/.media-optimized"

if [ -f "$MARKER" ]; then
  echo "Media already optimized (marker $MARKER present) - skipping."
  exit 0
fi

echo "==> Optimizing JPEGs"
find "$IMG_DIR" -type f \( -iname '*.jpg' -o -iname '*.jpeg' \) -print0 |
  while IFS= read -r -d '' f; do
    convert "$f" -auto-orient -strip -resize '1600x1600>' \
      -interlace JPEG -quality 82 "$f.tmp" && mv "$f.tmp" "$f"
  done

echo "==> Optimizing PNGs"
find "$IMG_DIR" -type f -iname '*.png' -print0 |
  while IFS= read -r -d '' f; do
    convert "$f" -auto-orient -strip -resize '1600x1600>' \
      -define png:compression-level=9 "$f.tmp" && mv "$f.tmp" "$f"
  done

echo "==> Re-encoding videos"
find "$IMG_DIR" -type f \( -iname '*.mp4' -o -iname '*.mov' \) -print0 |
  while IFS= read -r -d '' f; do
    ext="${f##*.}"
    tmp="${f%.*}.opt.${ext}"
    # -nostdin: ffmpeg must not read the loop's stdin (the find pipe), or it
    # swallows the file list and hangs.
    ffmpeg -nostdin -y -loglevel error -i "$f" \
      -vf "scale='min(1080,iw)':'-2'" \
      -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p \
      -an -movflags +faststart "$tmp" && mv "$tmp" "$f"
  done

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$MARKER"
echo "==> Done. Marker written to $MARKER"
