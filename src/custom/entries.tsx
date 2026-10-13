import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { CATEGORIES, type CatalogCategory, type CatalogEntry } from '../catalog/types';
import { FILL, R, STROKE } from '../catalog/svg';
import { type AssetMeta, assetFileUrl, customItemId } from './protocol';
import { fitModel, loadModel } from './glb';

/** Grey see-through box shown where a model goes until its file has loaded (or if it cannot be loaded). */
const PLACEHOLDER = new MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.45 });

let previews = 0;

/** A throw-away entry used to draw the preview in the "add a model" dialog (never registered in the catalogue). */
export function previewEntry(
  root: Object3D,
  size: { w: number; h: number; d: number },
): CatalogEntry {
  return {
    catalogId: `custom:preview-${++previews}`,
    nameKey: 'cat.custom',
    category: 'custom',
    placement: 'floor',
    defaultSize: size,
    props: [],
    defaults: {},
    build3D: () => fitModel(root, size),
    draw2D: () => null,
  };
}

/** A catalogue entry for one of the user's uploaded 3D models. */
export function customEntry(asset: AssetMeta): CatalogEntry {
  const m = asset.model!;
  const category: CatalogCategory = (CATEGORIES as string[]).includes(m.category)
    ? (m.category as CatalogCategory)
    : 'custom';
  // The file is only fetched when something needs it (the library thumbnail or a placed copy).
  let loading: Promise<Object3D> | undefined;
  let loaded: Object3D | undefined;
  const load = (): Promise<Object3D> =>
    (loading ??= loadModel(asset.id, assetFileUrl(asset.id)).then((root) => (loaded = root)));
  return {
    catalogId: customItemId(asset.id),
    nameKey: 'cat.custom',
    customName: asset.name,
    get ready() {
      return load().catch(() => undefined);
    },
    category,
    placement: m.placement,
    mountHeight: m.placement === 'wall-mounted' ? (m.mountHeight ?? 1.4) : undefined,
    defaultSize: { w: m.w, d: m.d, h: m.h },
    minScale: 0.1,
    maxScale: 10,
    props: [],
    defaults: {},
    build3D(_props, size) {
      const g = new Group();
      if (loaded) {
        // Already downloaded: show the real model at once (thumbnails are drawn synchronously).
        g.add(fitModel(loaded, size));
        return g;
      }
      const box = new Mesh(new BoxGeometry(size.w, size.h, size.d), PLACEHOLDER);
      box.position.y = size.h / 2;
      g.add(box);
      void load().then(
        (root) => {
          g.remove(box);
          box.geometry.dispose();
          g.add(fitModel(root, size));
        },
        () => undefined, // keep the placeholder: the file is missing or not a model
      );
      return g;
    },
    draw2D(_props, size) {
      return (
        <g>
          <R x={-size.w / 2} y={-size.d / 2} w={size.w} h={size.d} fill={FILL} rx={0.03} />
          {/* A short line on the front edge shows which way the item faces. */}
          <line
            x1={-size.w * 0.25}
            y1={size.d / 2 - 0.04}
            x2={size.w * 0.25}
            y2={size.d / 2 - 0.04}
            stroke={STROKE}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    },
  };
}
