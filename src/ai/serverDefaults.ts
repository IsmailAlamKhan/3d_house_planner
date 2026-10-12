import { useAiSettings } from './provider';

const KEY = 'duplex-designer:ai-settings';

/**
 * When the app is served by our own server, ask it which model it was set up for (`OLLAMA_MODEL`) and use that as the
 * default — unless the person has already chosen settings on this device.
 */
export async function applyServerDefaults(): Promise<void> {
  try {
    if (localStorage.getItem(KEY)) return;
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const h = (await res.json()) as { model?: string };
    if (h.model && typeof h.model === 'string') useAiSettings.setState({ model: h.model });
  } catch {
    // Static hosting or no server: keep the built-in default.
  }
}
