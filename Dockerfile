# syntax=docker/dockerfile:1.7
# Duplex Designer: the production web build plus the small app server (static files, /api/ai, /api/projects).

# ── 1. Build the web app and bundle the server ─────────────────────────────────────────────────────────────────
FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Playwright's browsers are only for end-to-end tests: never download them while building the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# better-sqlite3 (native, no prebuilt binaries, needs Node >= 22) is compiled in the "deps" stage; the build needs no install scripts.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm run build:server

# ── 1b. One-shot asset downloader (the "assets-init" compose service): fetches the CC0 models, textures and skies listed in
#    assets/manifest.json, checks their hashes and converts them into the pack the app serves at /pack ─────────────────
FROM build AS assets
ENV ASSETS_DIR=/app/assets
CMD ["npx", "tsx", "scripts/assets-download.ts"]

# ── 2. The only native runtime dependency: better-sqlite3, compiled for this exact image ───────────────────────
FROM node:22.20.0-bookworm-slim AS deps
WORKDIR /srv
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /tmp/app-package.json
RUN node -e "const v=require('/tmp/app-package.json').dependencies['better-sqlite3']; \
require('fs').writeFileSync('package.json', JSON.stringify({name:'duplex-runtime',private:true,dependencies:{'better-sqlite3':v}}))" \
 && npm install --omit=dev --no-audit --no-fund

# ── 3. Runtime: slim, non-root, nothing but the build, the bundled server and better-sqlite3 ────────────────────
FROM node:22.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/data ASSETS_DIR=/assets
WORKDIR /srv
COPY --from=deps /srv/node_modules ./node_modules
COPY --from=build /app/server-dist ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data /srv
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
