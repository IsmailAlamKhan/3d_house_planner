import {
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { disposeObject } from './three';
import { type CatalogEntry, withDefaults } from './types';

const SIZE = 128;
const cache = new Map<string, string | null>();
let renderer: WebGLRenderer | null | undefined;

function getRenderer(): WebGLRenderer | null {
  if (renderer !== undefined) return renderer;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setPixelRatio(1);
  } catch {
    renderer = null; // no WebGL (tests, very old devices): the library shows an icon instead
  }
  return renderer;
}

/**
 * Renders a catalog entry once to a small PNG data URL (cached). Returns null when WebGL isn't available.
 * Uses one shared renderer so the browser's WebGL context limit is never hit.
 */
export function renderThumbnail(entry: CatalogEntry): string | null {
  if (cache.has(entry.catalogId)) return cache.get(entry.catalogId) ?? null;
  const r = getRenderer();
  if (!r) {
    cache.set(entry.catalogId, null);
    return null;
  }
  try {
    const model = entry.build3D(withDefaults(entry, {}), entry.defaultSize, {
      swing: 'left',
      open: true,
      outward: -1,
    });
    const scene = new Scene();
    scene.add(new HemisphereLight('#ffffff', '#9aa3ad', 1.1), new AmbientLight('#ffffff', 0.35));
    const sun = new DirectionalLight('#ffffff', 1.4);
    sun.position.set(2, 4, 3);
    scene.add(sun, model);
    const box = new Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new Sphere());
    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    const dist = (Math.max(sphere.radius, 0.1) / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
    // Doors and windows look best head-on; furniture from a three-quarter view.
    const dir =
      entry.placement === 'wall' ? new Vector3(0.25, 0.1, 1) : new Vector3(0.9, 0.75, 1.1);
    camera.position.copy(sphere.center).add(dir.normalize().multiplyScalar(dist));
    camera.lookAt(sphere.center);
    r.setClearColor(0x000000, 0);
    r.render(scene, camera);
    const url = r.domElement.toDataURL('image/png');
    disposeObject(model);
    cache.set(entry.catalogId, url);
    return url;
  } catch {
    cache.set(entry.catalogId, null);
    return null;
  }
}

export const cachedThumbnail = (id: string): string | null | undefined => cache.get(id);
