import { TransformControls } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Mesh,
  MeshBasicMaterial,
} from 'three';
import { useModel } from '../../model/store';
import { setSectionPlanes } from '../clipping';
import { flatMulti } from '../generators/common';
import { useCamera } from './cameraStore';
import { modelBox } from './views';
import { type Caps, type Rect, sectionCaps, sectionPlanes } from './section';

const CAP_COLOR = '#1f2937';
const OFFSET = 0.004;

function verticalGeometry(axis: 'x' | 'z', at: number, rects: Rect[]): BufferGeometry | null {
  if (!rects.length) return null;
  const pos: number[] = [];
  for (const r of rects) {
    const a = axis === 'x' ? [at, r.y0, r.u0] : [r.u0, r.y0, at];
    const b = axis === 'x' ? [at, r.y0, r.u1] : [r.u1, r.y0, at];
    const c = axis === 'x' ? [at, r.y1, r.u1] : [r.u1, r.y1, at];
    const d = axis === 'x' ? [at, r.y1, r.u0] : [r.u0, r.y1, at];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** Solid faces drawn on the cut planes, so sectioned walls, slabs and columns read as solid. */
function CapMeshes({ caps, flip }: { caps: Caps; flip: boolean }) {
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: CAP_COLOR,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );
  const horizontal = useMemo(
    () =>
      caps.horizontal ? flatMulti(caps.horizontal.shapes, caps.horizontal.y - OFFSET, true) : null,
    [caps.horizontal],
  );
  const vertical = useMemo(
    () =>
      caps.vertical
        ? verticalGeometry(
            caps.vertical.axis,
            caps.vertical.pos + (flip ? OFFSET : -OFFSET),
            caps.vertical.rects,
          )
        : null,
    [caps.vertical, flip],
  );
  useEffect(() => () => horizontal?.dispose(), [horizontal]);
  useEffect(() => () => vertical?.dispose(), [vertical]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <>
      {horizontal && <mesh geometry={horizontal} material={material} name="section-cap-h" />}
      {vertical && <mesh geometry={vertical} material={material} name="section-cap-v" />}
    </>
  );
}

/** A translucent plane you can drag (along its normal) to move the vertical cut across the model. */
function SectionHandle() {
  const v = useCamera((s) => s.section.vertical);
  const setSection = useCamera((s) => s.setSection);
  const project = useModel((s) => s.project);
  const [handle, setHandle] = useState<Mesh | null>(null);
  const m = modelBox(project);
  if (!v.on) return null;
  const alongX = v.axis === 'x';
  const width = alongX ? m.depth : m.width;
  const position: [number, number, number] = alongX
    ? [v.pos, m.top / 2, m.cz]
    : [m.cx, m.top / 2, v.pos];
  return (
    <>
      <mesh
        ref={setHandle}
        name="section-handle"
        position={position}
        rotation={[0, alongX ? Math.PI / 2 : 0, 0]}
      >
        <planeGeometry args={[width + 2, m.top + 1]} />
        <meshBasicMaterial
          color="#0ea5e9"
          transparent
          opacity={0.1}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {handle && (
        <TransformControls
          object={handle}
          mode="translate"
          showX={alongX}
          showY={false}
          showZ={!alongX}
          size={0.7}
          onObjectChange={() =>
            setSection({ vertical: { ...v, pos: alongX ? handle.position.x : handle.position.z } })
          }
        />
      )}
    </>
  );
}

/** Clips the whole scene with the enabled section planes and draws solid caps on the cuts. */
export function SectionRig() {
  const section = useCamera((s) => s.section);
  const project = useModel((s) => s.project);
  useEffect(() => {
    setSectionPlanes(sectionPlanes(section));
    return () => setSectionPlanes([]);
  }, [section]);
  const caps = useMemo(() => sectionCaps(project, section), [project, section]);
  return (
    <>
      <CapMeshes caps={caps} flip={section.vertical.flip} />
      <SectionHandle />
    </>
  );
}
