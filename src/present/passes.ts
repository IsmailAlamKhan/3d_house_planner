import {
  Box3,
  type Camera,
  Color,
  type Material,
  Mesh,
  MeshNormalMaterial,
  type Object3D,
  ShaderMaterial,
  type Scene,
  Vector3,
} from 'three';

export type RenderPass = 'depth' | 'normals';

/** Normalised depth: near = white, far = black, between `near` and `far` metres from the camera. */
function depthMaterial(near: number, far: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uNear: { value: near }, uFar: { value: far } },
    vertexShader: `
      varying float vDepth;
      #include <clipping_planes_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      uniform float uNear;
      uniform float uFar;
      varying float vDepth;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        float d = clamp((vDepth - uNear) / max(uFar - uNear, 0.001), 0.0, 1.0);
        gl_FragColor = vec4(vec3(1.0 - d), 1.0);
      }`,
    clipping: true,
    toneMapped: false,
  });
}

/** Near and far distance (along the view direction) of everything drawn, so the depth range uses the full 0–1. */
export function depthRange(scene: Scene, camera: Camera): { near: number; far: number } {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const origin = camera.getWorldPosition(new Vector3());
  let near = Infinity;
  let far = 0;
  const box = new Box3();
  const corner = new Vector3();
  scene.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible || o.userData?.sky) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      const d = corner.sub(origin).dot(forward);
      near = Math.min(near, d);
      far = Math.max(far, d);
    }
  });
  if (!Number.isFinite(near) || far <= near) return { near: 0.1, far: 100 };
  return { near: Math.max(0.1, near - 0.2), far: far + 0.2 };
}

/**
 * Swaps every material for a depth or normal material (keeping each mesh's own clipping planes, so cut walls look the
 * same), hides the sky, lines and glass, and makes the background black. Returns a function that puts everything back.
 */
export function applyPass(scene: Scene, camera: Camera, pass: RenderPass): () => void {
  const swapped: { mesh: Mesh; material: Material | Material[] }[] = [];
  const hidden: Object3D[] = [];
  const { near, far } = depthRange(scene, camera);
  const made: Material[] = [];
  const cache = new Map<string, Material>();
  const variant = (planes: unknown): Material => {
    const key = planes
      ? String(
          planes instanceof Array
            ? planes.map((p) => p.constant + ':' + p.normal.toArray().join(',')).join('|')
            : 'x',
        )
      : '';
    let m = cache.get(key);
    if (!m) {
      m = pass === 'depth' ? depthMaterial(near, far) : new MeshNormalMaterial();
      (m as ShaderMaterial).clippingPlanes = (planes as never) ?? null;
      cache.set(key, m);
      made.push(m);
    }
    return m;
  };
  scene.traverse((o) => {
    if (
      o.userData?.sky ||
      (o as { isLine?: boolean }).isLine ||
      (o as { isPoints?: boolean }).isPoints
    ) {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
      return;
    }
    if (!(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // Glass would show up as a solid sheet: leave windows open in the depth and edge passes.
    if (mats.some((m) => m.transparent && m.opacity < 1)) {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
      return;
    }
    swapped.push({ mesh: o, material: o.material });
    const planes = mats[0]?.clippingPlanes ?? null;
    o.material = Array.isArray(o.material)
      ? o.material.map(() => variant(planes))
      : variant(planes);
  });
  const before = { background: scene.background, environment: scene.environment, fog: scene.fog };
  scene.background = new Color(0x000000);
  scene.environment = null;
  scene.fog = null;
  return () => {
    for (const s of swapped) s.mesh.material = s.material;
    for (const h of hidden) h.visible = true;
    scene.background = before.background;
    scene.environment = before.environment;
    scene.fog = before.fog;
    for (const m of made) m.dispose();
  };
}
