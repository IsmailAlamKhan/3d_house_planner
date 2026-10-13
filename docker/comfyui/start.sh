#!/bin/sh
# Starts ComfyUI once comfyui-init has finished downloading the models (they only appear under their real names when
# complete). Until then this container just waits, so "docker compose up -d" never blocks on the 12 GB download and
# the app reports "image service still starting".
set -eu
M=/models
until [ -f "$M/checkpoints/sd_xl_base_1.0.safetensors" ] \
   && [ -f "$M/controlnet/controlnet-depth-sdxl-1.0.fp16.safetensors" ] \
   && [ -f "$M/controlnet/controlnet-canny-sdxl-1.0.fp16.safetensors" ]; do
  echo "waiting for the models to finish downloading (docker compose logs -f comfyui-init)..."
  sleep 20
done
echo "models present, starting ComfyUI"
exec python main.py --listen 0.0.0.0 --port 8188 --disable-auto-launch
