import { WebSocket } from 'ws';

/**
 * The few ComfyUI endpoints the app needs: /upload/image, /prompt, /history, /view, /free, /interrupt, /system_stats
 * and the progress websocket. Nothing else is ever forwarded. Every call has a timeout.
 */
export class ComfyClient {
  readonly baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async json<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
    const r = await fetch(this.baseUrl + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    if (!r.ok) throw new ComfyError(`ComfyUI answered ${r.status}`, r.status, text.slice(0, 500));
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Is ComfyUI up? */
  async reachable(timeoutMs = 1500): Promise<boolean> {
    try {
      const r = await fetch(this.baseUrl + '/system_stats', {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** The options of a combo input (checkpoint names, ControlNet files, …) of a node; empty when the node is missing. */
  async choices(node: string, input: string): Promise<string[] | null> {
    try {
      const j = await this.json<
        Record<string, { input?: { required?: Record<string, unknown[]> } }>
      >(`/object_info/${encodeURIComponent(node)}`);
      const spec = j[node]?.input?.required?.[input];
      if (!spec) return null;
      const first = spec[0];
      if (Array.isArray(first)) return first as string[];
      const opts = (spec[1] as { options?: string[] } | undefined)?.options;
      return opts ?? [];
    } catch {
      return null;
    }
  }

  /** Which of these nodes does ComfyUI know (custom node packs installed)? */
  async hasNodes(names: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const n of names) {
      try {
        const j = await this.json<Record<string, unknown>>(`/object_info/${encodeURIComponent(n)}`);
        out[n] = !!j[n];
      } catch {
        out[n] = false;
      }
    }
    return out;
  }

  /** Puts an image in ComfyUI's input folder; returns the stored file name. */
  async upload(name: string, data: Buffer): Promise<string> {
    const form = new FormData();
    form.set('image', new Blob([new Uint8Array(data)], { type: 'image/png' }), name);
    form.set('type', 'input');
    form.set('overwrite', 'true');
    const j = await this.json<{ name: string; subfolder?: string }>(
      '/upload/image',
      { method: 'POST', body: form },
      60_000,
    );
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  async queue(prompt: unknown, clientId: string): Promise<string> {
    const j = await this.json<{ prompt_id: string }>('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: clientId }),
    });
    return j.prompt_id;
  }

  history(promptId: string): Promise<Record<string, HistoryEntry>> {
    return this.json(`/history/${encodeURIComponent(promptId)}`);
  }

  async view(file: { filename: string; subfolder: string; type: string }): Promise<Buffer> {
    const q = new URLSearchParams(file).toString();
    const r = await fetch(`${this.baseUrl}/view?${q}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new ComfyError(`ComfyUI answered ${r.status}`, r.status, '');
    return Buffer.from(await r.arrayBuffer());
  }

  /** Unloads the models and frees GPU memory. */
  async free(): Promise<void> {
    await this.json('/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  }

  /**
   * The saved picture of a finished prompt. ComfyUI announces the end of a prompt on the socket BEFORE it stores the
   * result in /history (with --disable-smart-memory it unloads the models in between: seconds), so a single look can
   * find nothing. Retries until the picture appears, ComfyUI reports an error, or `timeoutMs` has passed (then null).
   */
  async waitForOutput(
    promptId: string,
    timeoutMs = 120_000,
    intervalMs = 500,
  ): Promise<{ filename: string; subfolder: string; type: string } | null> {
    const t0 = Date.now();
    for (;;) {
      const entry = (await this.history(promptId))[promptId];
      const out = firstOutput(entry);
      if (out) return out;
      if (entry?.status?.status_str === 'error')
        throw new ComfyError('ComfyUI could not finish the render', 500, '');
      if (Date.now() - t0 >= timeoutMs) return null;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async interrupt(): Promise<void> {
    await this.json('/interrupt', { method: 'POST' });
  }

  /**
   * Opens the progress websocket for `clientId` (it must be open BEFORE the prompt is queued, or ComfyUI's events for
   * it are missed) and returns a tracker. `wait(promptId)` resolves when that prompt has finished and rejects when it
   * failed, was cancelled or took too long. Falls back to polling /history when the socket cannot be used.
   */
  async track(
    clientId: string,
    onProgress: (step: number, max: number) => void,
    signal: AbortSignal,
    timeoutMs = 15 * 60_000,
  ): Promise<{ wait: (promptId: string) => Promise<void>; close: () => void }> {
    const finished = new Map<string, Error | null>();
    const waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
    let ws: WebSocket | null = null;
    let socketUsable = false;
    const settle = (promptId: string, err: Error | null) => {
      const w = waiters.get(promptId);
      if (w) {
        waiters.delete(promptId);
        if (err) w.reject(err);
        else w.resolve();
      } else finished.set(promptId, err);
    };
    try {
      const url =
        this.baseUrl.replace(/^http/, 'ws') + `/ws?clientId=${encodeURIComponent(clientId)}`;
      ws = new WebSocket(url);
      const socket = ws;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('socket timeout')), 5000);
        socket.once('open', () => {
          clearTimeout(t);
          resolve();
        });
        socket.once('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
      socketUsable = true;
      socket.on('message', (data, isBinary) => {
        if (isBinary) return; // preview images are not used
        let msg: { type?: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        const d = msg.data ?? {};
        const pid = typeof d.prompt_id === 'string' ? d.prompt_id : '';
        if (msg.type === 'progress') onProgress(Number(d.value ?? 0), Number(d.max ?? 0));
        else if (msg.type === 'executing' && d.node === null && pid) settle(pid, null);
        else if (msg.type === 'execution_success' && pid) settle(pid, null);
        else if (msg.type === 'execution_error' && pid)
          settle(
            pid,
            new ComfyError(
              String(d.exception_message ?? 'ComfyUI could not finish the render'),
              500,
              '',
            ),
          );
      });
      socket.on('close', () => {
        socketUsable = false;
      });
    } catch {
      ws = null;
    }
    const close = () => {
      try {
        ws?.close();
      } catch {
        // already closed
      }
    };
    return {
      close,
      wait: (promptId: string) =>
        new Promise<void>((resolve, reject) => {
          if (finished.has(promptId)) {
            const e = finished.get(promptId)!;
            return e ? reject(e) : resolve();
          }
          let poll: NodeJS.Timeout | null = null;
          const cleanup = () => {
            clearTimeout(timer);
            if (poll) clearInterval(poll);
            signal.removeEventListener('abort', onAbort);
          };
          const fail = (e: Error) => {
            cleanup();
            waiters.delete(promptId);
            reject(e);
          };
          const onAbort = () => fail(new ComfyError('Cancelled', 499, ''));
          const timer = setTimeout(
            () => fail(new ComfyError('The render took too long', 504, '')),
            timeoutMs,
          );
          signal.addEventListener('abort', onAbort);
          if (signal.aborted) return onAbort();
          waiters.set(promptId, {
            resolve: () => {
              cleanup();
              resolve();
            },
            reject: fail,
          });
          // Without a working socket (or if its events are lost) /history tells us when the prompt is done.
          poll = setInterval(
            () => {
              this.history(promptId)
                .then((h) => {
                  const e = h[promptId];
                  if (e?.status?.status_str === 'error')
                    settle(
                      promptId,
                      new ComfyError('ComfyUI could not finish the render', 500, ''),
                    );
                  else if (e?.outputs && Object.keys(e.outputs).length) settle(promptId, null);
                })
                .catch(() => undefined);
            },
            socketUsable ? 5000 : 1500,
          );
        }),
    };
  }
}

export interface HistoryEntry {
  status?: { status_str?: string };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

export class ComfyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'ComfyError';
  }
}

/** First image saved by a finished prompt. */
export function firstOutput(
  entry: HistoryEntry | undefined,
): { filename: string; subfolder: string; type: string } | null {
  for (const out of Object.values(entry?.outputs ?? {})) {
    const img = out.images?.[0];
    if (img) return img;
  }
  return null;
}
