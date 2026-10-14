import { existsSync, readFileSync } from 'node:fs';

export interface ServerConfig {
  port: number;
  host: string;
  ollamaUrl: string;
  /** Where ComfyUI listens (the optional image service); null = not configured. */
  comfyUrl: string | null;
  /** The model the app suggests by default (users can still pick another in AI settings). */
  model: string;
  /** The picture-reading model ("Recreate from picture"); runs on the same GPU queue as everything else. */
  visionModel: string;
  /** A Blender on this machine for studio renders (BLENDER_PATH), or the `blender` service's URL (BLENDER_URL). */
  blenderPath?: string | null;
  blenderUrl?: string | null;
  /** Where the CC0 asset pack lives (`<assetsDir>/pack`, served under /pack). */
  assetsDir?: string;
  /** If set, the whole app asks for this password first. */
  password: string | null;
  /** Folder with the production build. */
  distDir: string;
  /** Where the SQLite database (shared projects) lives. */
  dataDir: string;
}

/** Parses `KEY=value` lines (comments with #, optional quotes) — a tiny .env reader so no extra package is needed. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out[key] = value;
  }
  return out;
}

/** Reads `.env` (if present) and the process environment (which wins). */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  envFile = '.env',
  distDir = 'dist',
): ServerConfig {
  const file = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const get = (k: string) => env[k] ?? file[k];
  const port = Number(get('PORT') ?? 8080);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8080,
    host: get('HOST') || '0.0.0.0',
    ollamaUrl: (get('OLLAMA_URL') || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    comfyUrl: get('COMFYUI_URL') ? get('COMFYUI_URL')!.replace(/\/+$/, '') : null,
    model: get('OLLAMA_MODEL') || 'qwen3:14b',
    visionModel: get('OLLAMA_VISION_MODEL') || 'qwen3-vl:8b-instruct',
    blenderPath: get('BLENDER_PATH') || null,
    blenderUrl: get('BLENDER_URL') ? get('BLENDER_URL')!.replace(/\/+$/, '') : null,
    assetsDir: get('ASSETS_DIR') || 'assets',
    password: get('APP_PASSWORD') ? String(get('APP_PASSWORD')) : null,
    distDir,
    dataDir: get('DATA_DIR') || 'data',
  };
}
