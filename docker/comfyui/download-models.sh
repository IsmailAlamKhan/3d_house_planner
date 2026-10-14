#!/bin/sh
# One-shot model download into the comfyui-models volume (resumable; skips files that are already complete).
# Revisions are pinned to exact commits of the official repositories.
set -eu
MODELS=${MODELS_DIR:-/models}
mkdir -p "$MODELS/checkpoints" "$MODELS/controlnet" "$MODELS/vae" "$MODELS/upscale_models" "$MODELS/ipadapter" "$MODELS/clip_vision"

fetch() { # url, destination, expected size in bytes
  url=$1; dest=$2; size=$3
  if [ -f "$dest" ] && [ "$(wc -c < "$dest")" -eq "$size" ]; then
    echo "ok       $dest"
    return
  fi
  echo "download $dest ($((size / 1048576)) MB)"
  # Download into <name>.part and rename only when complete, so ComfyUI never sees a half-downloaded model.
  # (A partial file from an older run is picked up and resumed.)
  if [ -f "$dest" ]; then mv "$dest" "$dest.part"; fi
  curl -fL --retry 5 --retry-delay 5 -C - -o "$dest.part" "$url"
  if [ "$(wc -c < "$dest.part")" -ne "$size" ]; then
    echo "ERROR: $dest.part has the wrong size — delete it and run again" >&2
    exit 1
  fi
  mv "$dest.part" "$dest"
}

# Stable Diffusion XL base 1.0 (Stability AI, CreativeML Open RAIL++-M)
fetch "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/462165984030d82259a11f4367a4eed129e94a7b/sd_xl_base_1.0.safetensors" \
      "$MODELS/checkpoints/sd_xl_base_1.0.safetensors" 6938078334
# SDXL depth ControlNet (diffusers, CreativeML Open RAIL++-M), fp16
fetch "https://huggingface.co/diffusers/controlnet-depth-sdxl-1.0/resolve/17bb97973f29801224cd66f192c5ffacf82648b4/diffusion_pytorch_model.fp16.safetensors" \
      "$MODELS/controlnet/controlnet-depth-sdxl-1.0.fp16.safetensors" 2502139134
# SDXL canny ControlNet (optional edge pass), fp16
fetch "https://huggingface.co/diffusers/controlnet-canny-sdxl-1.0/resolve/eb115a19a10d14909256db740ed109532ab1483c/diffusion_pytorch_model.fp16.safetensors" \
      "$MODELS/controlnet/controlnet-canny-sdxl-1.0.fp16.safetensors" 2502139136

# ── Enhance v2 (style reference and tiled upscale): ~3.4 GB, see docker/comfyui/MODELS.md for sources and licences ──
# IP-Adapter Plus for SDXL (h94/IP-Adapter, Apache-2.0), at the commit that has the file below
fetch "https://huggingface.co/h94/IP-Adapter/resolve/018e402774aeeddd60609b4ecdb7e298259dc729/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" \
      "$MODELS/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" 847517512
# CLIP ViT-H/14 image encoder (laion, MIT) as shipped with IP-Adapter
fetch "https://huggingface.co/h94/IP-Adapter/resolve/018e402774aeeddd60609b4ecdb7e298259dc729/models/image_encoder/model.safetensors" \
      "$MODELS/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" 2528373448
# Real-ESRGAN x4plus (BSD-3-Clause), the upscale model of the tiled upscale
fetch "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
      "$MODELS/upscale_models/RealESRGAN_x4plus.pth" 67040989

echo "Disk used by the models:"
du -sh "$MODELS"
du -sh "$MODELS"/* 2>/dev/null || true
