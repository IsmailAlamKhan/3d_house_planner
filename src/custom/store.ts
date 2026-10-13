import { create } from 'zustand';
import { registerCustomEntries } from '../catalog';
import { registerCustomTextures } from '../materials';
import { deleteAsset, listAssets, uploadAsset } from './api';
import { customEntry } from './entries';
import { forgetModel } from './glb';
import { type AssetMeta, assetFileUrl, customTextureId } from './protocol';

interface CustomAssets {
  assets: AssetMeta[];
  /** `unavailable`: there is no app server (a static site), so uploads are not possible. */
  status: 'idle' | 'ready' | 'unavailable';
  /** Bumped whenever the catalogue or the textures change, so views that cache them can rebuild. */
  version: number;
  refresh: () => Promise<void>;
  add: (file: Blob, meta: Record<string, unknown>) => Promise<AssetMeta>;
  remove: (id: string) => Promise<void>;
}

/** Puts the assets into the catalogue and the material library. */
export function applyAssets(assets: AssetMeta[]): void {
  registerCustomEntries(assets.filter((a) => a.kind === 'model' && a.model).map(customEntry));
  registerCustomTextures(
    assets
      .filter((a) => a.kind === 'texture' && a.texture)
      .map((a) => ({
        id: customTextureId(a.id),
        name: a.name,
        url: assetFileUrl(a.id),
        scale: a.texture!.scale,
      })),
  );
}

export const useCustomAssets = create<CustomAssets>((set, get) => ({
  assets: [],
  status: 'idle',
  version: 0,
  async refresh() {
    const list = await listAssets();
    if (!list) {
      set({ status: 'unavailable' });
      return;
    }
    applyAssets(list);
    set({ assets: list, status: 'ready', version: get().version + 1 });
  },
  async add(file, meta) {
    const a = await uploadAsset(file, meta);
    await get().refresh();
    return a;
  },
  async remove(id) {
    await deleteAsset(id);
    forgetModel(id);
    await get().refresh();
  },
}));
