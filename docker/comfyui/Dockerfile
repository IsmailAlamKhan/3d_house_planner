# ComfyUI for "Enhance with AI" (started by the normal docker compose up -d).
# CUDA-enabled PyTorch base image and a pinned ComfyUI release, so a rebuild never changes behaviour on its own.
FROM pytorch/pytorch:2.9.0-cuda12.6-cudnn9-runtime

# ComfyUI v0.9.2 (GPL-3.0). To update: change the commit, rebuild, and re-test server/comfy/workflows/*.json.
ARG COMFYUI_COMMIT=8f40b43e0204d5b9780f3e9618e140e929e80594

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/ComfyUI
RUN git init . \
 && git remote add origin https://github.com/comfyanonymous/ComfyUI.git \
 && git fetch --depth 1 origin "${COMFYUI_COMMIT}" \
 && git checkout FETCH_HEAD \
 && pip install --no-cache-dir -r requirements.txt "comfy-kitchen==0.2.37"

# Models live in the shared "comfyui-models" volume (downloaded once by the comfyui-init service).
COPY extra_model_paths.yaml /opt/ComfyUI/extra_model_paths.yaml
COPY start.sh /opt/start.sh

RUN useradd --create-home --uid 10001 comfy && chown -R comfy:comfy /opt/ComfyUI
USER comfy
EXPOSE 8188
# The first start waits for the model download (up to hours on a slow line), so the start period is long.
HEALTHCHECK --interval=15s --timeout=5s --start-period=6h --retries=10 \
  CMD curl -fsS http://127.0.0.1:8188/system_stats >/dev/null || exit 1
# No published port in docker-compose.yml: only the app server (same compose network) talks to ComfyUI.
CMD ["sh", "/opt/start.sh"]
