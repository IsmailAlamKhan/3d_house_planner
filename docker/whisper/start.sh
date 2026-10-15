#!/bin/sh
# Downloads the speech model once (resumable), then serves it. whisper.cpp's server listens on :8080 inside the
# compose network (no published port).
set -eu
MODEL="/models/${MODEL_FILE}"
if [ ! -s "$MODEL" ]; then
  echo "downloading ${MODEL_FILE} (about 0.6 GB)"
  curl -fL --retry 5 --retry-delay 5 -C - -o "$MODEL.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}"
  # A full model is far bigger than any error page.
  if [ "$(wc -c < "$MODEL.part")" -lt 400000000 ]; then
    echo "ERROR: the download is too small — delete it and start again" >&2
    exit 1
  fi
  mv "$MODEL.part" "$MODEL"
fi
exec whisper-server -m "$MODEL" --host 0.0.0.0 --port 8080 -l auto
