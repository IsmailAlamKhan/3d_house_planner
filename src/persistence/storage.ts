import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';

/** Minimal key/value backend so persistence can be tested without IndexedDB. */
export interface StorageBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  entries(): Promise<[string, unknown][]>;
}

export function createIdbBackend(): StorageBackend {
  let store: UseStore | undefined;
  const s = () => (store ??= createStore('duplex-designer', 'projects'));
  return {
    get: (k) => get(k, s()),
    set: (k, v) => set(k, v, s()),
    del: (k) => del(k, s()),
    entries: async () => (await entries(s())).map(([k, v]) => [String(k), v] as [string, unknown]),
  };
}

export function createMemoryBackend(): StorageBackend {
  const map = new Map<string, unknown>();
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => void map.set(k, structuredClone(v)),
    del: async (k) => void map.delete(k),
    entries: async () =>
      [...map.entries()].map(([k, v]) => [k, structuredClone(v)] as [string, unknown]),
  };
}

let backend: StorageBackend | undefined;

/** The app-wide backend: IndexedDB in browsers, in-memory where IndexedDB is unavailable (tests). */
export function getBackend(): StorageBackend {
  return (backend ??=
    typeof indexedDB === 'undefined' ? createMemoryBackend() : createIdbBackend());
}

export function setBackend(b: StorageBackend | undefined): void {
  backend = b;
}
