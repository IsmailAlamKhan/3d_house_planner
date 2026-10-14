# syntax=docker/dockerfile:1.7
# Blender 4.2 LTS (pinned, checksum-verified) + the small job runner for studio renders. GPU through the NVIDIA runtime.
# Build context: the repository root (docker compose does this).

FROM node:22.20.0-bookworm-slim AS node

FROM debian:bookworm-slim
ARG BLENDER_VERSION=4.2.23
ARG BLENDER_SHA256=bea0eb3146be13eae6225409a117b215184f41b7f79e799f97cb3abb8f6dc404
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl xz-utils ca-certificates \
      libgl1 libegl1 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libx11-6 libxext6 libgomp1 \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/blender.tar.xz "https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
 && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum -c - \
 && mkdir -p /opt/blender && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
 && rm /tmp/blender.tar.xz
# Node only for the runner (a dependency-free ES module)
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /opt/runner
COPY docker/blender/runner.mjs docker/blender/render.py docker/blender/bake.py docker/blender/studio_common.py ./

# OptiX / CUDA come from the host driver through the NVIDIA container runtime
ENV NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,graphics,utility \
    BLENDER=/opt/blender/blender JOBS_DIR=/data/studio ASSETS_DIR=/assets PORT=9000
EXPOSE 9000
# Startup check: Cycles must report an OptiX or CUDA device (the app shows the reason when it does not)
HEALTHCHECK --interval=60s --timeout=90s --start-period=30s --retries=2 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then(r=>r.json()).then(h=>process.exit(h.ready?0:1)).catch(()=>process.exit(1))"
CMD ["node", "runner.mjs"]
