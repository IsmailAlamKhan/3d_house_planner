import { useMemo } from 'react';
import { CanvasTexture, DoubleSide } from 'three';
import { getEntry, itemSize } from '../catalog';
import { QUALITY, type Quality } from './quality';
import { useSceneProject } from './sceneProject';

let blobTexture: CanvasTexture | null = null;
function blob(): CanvasTexture {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTexture = new CanvasTexture(c);
  return blobTexture;
}

/**
 * Low quality only: a soft dark blob under every piece of floor furniture so it never looks like it floats. (Medium and
 * High get real ambient occlusion from the render pipeline instead.)
 */
export function ContactBlobs({ quality }: { quality: Quality }) {
  const project = useSceneProject();
  const on = QUALITY[quality].blobShadows;
  const items = useMemo(() => {
    if (!on) return [];
    return project.items.flatMap((i) => {
      const e = getEntry(i.catalogId);
      const level = project.levels.find((l) => l.id === i.levelId);
      if (!e || !level?.visible || e.placement !== 'floor') return [];
      const s = itemSize(e, i.scale);
      if (s.h < 0.12 || i.elevation > 0.05) return [];
      return [
        {
          id: i.id,
          x: i.position.x,
          z: i.position.y,
          y: level.elevation + 0.006,
          w: s.w,
          d: s.d,
          r: i.rotation,
        },
      ];
    });
  }, [project, on]);
  if (!on) return null;
  return (
    <>
      {items.map((b) => (
        <group key={b.id} position={[b.x, b.y, b.z]} rotation={[0, -b.r, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} raycast={() => null}>
            <planeGeometry args={[b.w * 1.45, b.d * 1.45]} />
            <meshBasicMaterial
              map={blob()}
              transparent
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-2}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}
