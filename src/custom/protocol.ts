/** What the app server (`/api/assets`) and the browser both know about the user's own models and textures. */

export type AssetKind = 'model' | 'texture' | 'image';

export interface AssetMeta {
  id: string;
  kind: AssetKind;
  /** Name shown in the library / material picker. */
  name: string;
  /** File extension without the dot: glb, png, jpg, webp. */
  ext: string;
  size: number;
  createdAt: string;
  /** Models: where it appears and how big it is in the plan (metres). */
  model?: {
    category: string;
    placement: 'floor' | 'wall-mounted';
    w: number;
    d: number;
    h: number;
    mountHeight?: number;
  };
  /** Textures: metres covered by one repeat of the image. */
  texture?: { scale: number };
  /** Reference pictures (an underlay to trace a plan from): size in pixels. */
  image?: { width: number; height: number };
}

/** Id of a custom catalogue item / texture material in a project. */
export const customItemId = (assetId: string): string => `custom:${assetId}`;
export const customTextureId = (assetId: string): string => `tex:${assetId}`;
export const isCustomItemId = (id: string): boolean => /^custom:[a-f0-9]{16}$/.test(id);
export const isCustomTextureId = (id: string): boolean => /^tex:[a-f0-9]{16}$/.test(id);
export const assetOf = (id: string): string => id.slice(id.indexOf(':') + 1);
export const assetFileUrl = (assetId: string): string => `/api/assets/${assetId}/file`;
