import { Group, Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { create } from 'zustand';
import { CATALOG, type CatalogEntry, getEntry } from '../catalog';
import { fitModel, measureModel } from '../custom/glb';
import { bumpPackEpoch } from './epoch';
import { type PackIndex, PackIndexSchema } from './manifest';
import { clearPackTextures, setPackTextures } from './textures';

/**
 * The CC0 asset pack in the browser. `pack.json` (built by `npm run assets:download`) lists real models, PBR texture
 * sets and HDRI skies. When it is there and switched on:
 *  - catalogue items with a model get the real model in 3D (the procedural one is drawn at first and stays if the file
 *    cannot be loaded, so nothing breaks offline, on static hosting or when the pack is missing);
 *  - library materials with a texture set get albedo / normal / roughness maps;
 *  - the sky uses the HDRI of the lighting preset.
 * Switching the pack off puts everything back to procedural without a reload.
 */
export type PackStatus = 'idle' | 'loading' | 'ready' | 'none';

const KEY = 'duplex-designer:asset-pack';
const readEnabled = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

interface PackState {
  status: PackStatus;
  index: PackIndex | null;
  /** The user's switch (default on). */
  enabled: boolean;
  /** Bumped whenever the pack is applied, removed or switched, so cached materials and sky maps are rebuilt. */
  version: number;
  /** Bumped when real models arrive: the scene re-evaluates the items whose model changed (without starting over). */
  modelVersion: number;
  load: (base?: string) => Promise<void>;
  setEnabled: (on: boolean) => void;
}

export const usePack = create<PackState>((set, get) => ({
  status: 'idle',
  index: null,
  enabled: readEnabled(),
  version: 0,
  modelVersion: 0,
  async load(base = '/pack') {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    try {
      const r = await fetch(`${base}/pack.json`, { cache: 'no-cache' });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.includes('json')) throw new Error('no pack');
      const index = PackIndexSchema.parse(await r.json());
      set({ status: 'ready', index });
      apply(get().enabled ? index : null, base);
    } catch {
      set({ status: 'none', index: null });
      if (!applied) return; // nothing was ever swapped in: the scene is already as it should be
      apply(null, base);
    }
    set({ version: get().version + 1 });
  },
  setEnabled(enabled) {
    try {
      localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {
      // a convenience only
    }
    set({ enabled });
    apply(enabled ? get().index : null, '/pack');
    set({ version: get().version + 1 });
  },
}));

/** True when the real models / textures are in use (pack present and switched on). */
export const packActive = (): boolean => {
  const s = usePack.getState();
  return s.enabled && s.status === 'ready' && !!s.index;
};

// ───────────────────────────── catalogue models ─────────────────────────────

const originals = new Map<string, CatalogEntry['build3D']>();
const parsed = new Map<string, Promise<Object3D>>();

async function loadGlb(url: string): Promise<Object3D> {
  let p = parsed.get(url);
  if (!p) {
    // three's loaders are only needed here, so they stay out of the main chunk until a model is wanted
    p = (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return (await loader.loadAsync(url)).scene;
    })();
    p.catch(() => parsed.delete(url));
    parsed.set(url, p);
  }
  return p;
}

const colorCache = new Map<string, MeshStandardMaterial>();

/** Materials whose name matches a recolourable slot take the item's colour (cloned once per colour). */
function recolor(
  root: Object3D,
  slots: PackIndex['models'][number]['recolor'],
  props: Record<string, unknown>,
): void {
  if (!slots.length) return;
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as MeshStandardMaterial;
    for (const s of slots) {
      const color = props[s.prop];
      if (typeof color !== 'string' || !new RegExp(s.slot, 'i').test(m.name)) continue;
      const key = `${m.uuid}|${color}`;
      let c = colorCache.get(key);
      if (!c) {
        c = m.clone();
        c.color.set(color);
        colorCache.set(key, c);
      }
      o.material = c;
    }
  });
}

/** A model's copy for one placed item: stretched to the item's size, recoloured. */
function packModel(
  root: Object3D,
  model: PackIndex['models'][number],
  props: Record<string, unknown>,
  size: { w: number; h: number; d: number },
): Group {
  const g = fitModel(root, size);
  recolor(g, model.recolor, props);
  return g;
}

/** True while the pack's models and textures are swapped in. */
let applied = false;
let bumpTimer: ReturnType<typeof setTimeout> | undefined;
/** A model has arrived: the scene copies items when it draws, so the items using it are rebuilt (once per batch). */
function modelArrived(catalogId: string): void {
  bumpPackEpoch(catalogId);
  clearTimeout(bumpTimer);
  bumpTimer = setTimeout(
    () => usePack.setState((s) => ({ modelVersion: s.modelVersion + 1 })),
    150,
  );
}

function swapIn(entry: CatalogEntry, model: PackIndex['models'][number], base: string): void {
  const original = entry.build3D;
  originals.set(entry.catalogId, original);
  const url = `${base}/${model.file}`;
  const loaded = new Map<string, Object3D>();
  entry.build3D = (props, size, ctx) => {
    const ready = loaded.get(url);
    if (ready) {
      const g = new Group();
      g.add(packModel(ready, model, props, size));
      return g;
    }
    // the procedural model now; once the real file has arrived the scene is rebuilt and this returns the real one
    void loadGlb(url).then(
      (root) => {
        if (!packActive() || loaded.has(url)) return;
        loaded.set(url, root);
        modelArrived(entry.catalogId);
      },
      () => undefined, // the file is missing or broken: keep the procedural model
    );
    return original(props, size, ctx);
  };
  // the library thumbnail waits for the real model so it is drawn once with it
  Object.defineProperty(entry, 'ready', {
    configurable: true,
    get: () =>
      loadGlb(url).then(
        (root) => {
          if (!loaded.has(url)) {
            loaded.set(url, root);
            modelArrived(entry.catalogId);
          }
        },
        () => undefined,
      ),
  });
}

function removeModels(): void {
  for (const [id, build] of originals) {
    const e = getEntry(id);
    if (e) {
      e.build3D = build;
      Object.defineProperty(e, 'ready', { configurable: true, value: undefined });
    }
  }
  originals.clear();
}

function apply(index: PackIndex | null, base: string): void {
  removeModels();
  clearPackTextures();
  applied = !!index;
  if (!index) return;
  for (const m of index.models.filter((x) => x.lod === 0)) {
    const e = CATALOG.find((c) => c.catalogId === m.catalogId);
    if (e) swapIn(e, m, base);
  }
  setPackTextures(
    index.textures.map((t) => ({
      ...t,
      albedo: `${base}/${t.albedo}`,
      normal: t.normal && `${base}/${t.normal}`,
      roughness: t.roughness && `${base}/${t.roughness}`,
      ao: t.ao && `${base}/${t.ao}`,
    })),
  );
}

/** The measured size of a converted model against the catalogue's default size: the largest relative difference. */
export function sizeMismatch(
  model: PackIndex['models'][number],
  entry: Pick<CatalogEntry, 'defaultSize'>,
): number {
  const d = entry.defaultSize;
  return Math.max(
    Math.abs(model.size.w - d.w) / d.w,
    Math.abs(model.size.d - d.d) / d.d,
    Math.abs(model.size.h - d.h) / d.h,
  );
}

export { measureModel };
