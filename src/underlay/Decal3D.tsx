import { useEffect, useState } from 'react';
import { DoubleSide, RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader } from 'three';
import { useModel } from '../model/store';
import type { Underlay } from '../model/types';
import { useRectified } from './useRectified';

function Decal({ u }: { u: Underlay }) {
  const r = useRectified(u);
  const [map, setMap] = useState<Texture | null>(null);
  const url = r?.status === 'ready' ? r.url : null;
  useEffect(() => {
    if (!url) return;
    let live = true;
    const t = new TextureLoader().load(url, (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = tex.wrapT = RepeatWrapping;
      if (live) setMap(tex);
    });
    return () => {
      live = false;
      t.dispose();
    };
  }, [url]);
  if (r?.status !== 'ready' || !map) return null;
  const w = r.bounds.x1 - r.bounds.x0;
  const d = r.bounds.y1 - r.bounds.y0;
  return (
    // Plan (x, y) is world (x, up, y); a plane lying flat is turned −90° about X, which puts its top edge toward −y.
    <mesh
      position={[(r.bounds.x0 + r.bounds.x1) / 2, 0.02, (r.bounds.y0 + r.bounds.y1) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-1}
      userData={{ decal: true }}
    >
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial
        map={map}
        transparent
        opacity={Math.min(1, u.opacity * 0.7)}
        depthWrite={false}
        side={DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Reference pictures that were asked to show as a faint decal on the ground in 3D (handy in the top view). */
export function UnderlayDecals() {
  const underlays = useModel((s) => s.project.underlays);
  return (
    <>
      {underlays
        .filter((u) => u.visible && u.show3d)
        .map((u) => (
          <Decal key={u.id} u={u} />
        ))}
    </>
  );
}
