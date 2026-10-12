import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  BufferAttribute,
  Color,
  type DirectionalLight,
  type Object3D,
  PMREMGenerator,
  SphereGeometry,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getEntry, itemSize } from '../catalog';
import { polygonBounds } from '../geometry/polygon';
import { useModel } from '../model/store';
import { interiorLightsOn, moonAt, skyFor, sunAt, sunVisible, timeOf } from './lighting';
import { QUALITY, type Quality } from './quality';
import { useSceneStore } from './sceneStore';

/** Sun (or moon), soft sky light, local environment reflections and the sky dome. */
export function SceneLights({ quality }: { quality: Quality }) {
  const q = QUALITY[quality];
  const lighting = useSceneStore((s) => s.lighting);
  const compass = useModel((s) => s.project.settings.compass);
  const footprint = useModel((s) => s.project.shell.footprint);
  const get = useThree((s) => s.get);

  const sun = useMemo(
    () => (sunVisible(lighting) ? sunAt(timeOf(lighting), compass) : moonAt(compass)),
    [lighting, compass],
  );
  const sky = useMemo(() => skyFor(lighting, sun), [lighting, sun]);
  const { center, radius } = useMemo(() => {
    const b = polygonBounds(footprint);
    return {
      center: { x: (b.min.x + b.max.x) / 2, z: (b.min.y + b.max.y) / 2 },
      radius: Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y) / 2 + 2,
    };
  }, [footprint]);

  const sunRef = useRef<DirectionalLight>(null);
  const targetRef = useRef<Object3D>(null);
  useEffect(() => {
    const light = sunRef.current;
    if (!light || !targetRef.current) return;
    light.target = targetRef.current;
    const cam = light.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 1;
    cam.far = radius * 8;
    cam.updateProjectionMatrix();
  }, [radius]);

  // Image-based light from a procedurally built room (no network fetch).
  useEffect(() => {
    if (!q.environment) return;
    const { gl, scene } = get();
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [get, q.environment]);
  useEffect(() => {
    get().scene.environmentIntensity = q.environment ? sky.environment : 0;
  }, [get, q.environment, sky.environment]);

  const dist = radius * 3;
  return (
    <>
      <SkyDome top={sky.top} horizon={sky.horizon} ground={sky.ground} />
      <hemisphereLight args={[sky.top, sky.ground, sky.ambient]} />
      <object3D ref={targetRef} position={[center.x, 0, center.z]} />
      <directionalLight
        ref={sunRef}
        color={sun.color}
        intensity={sun.intensity}
        position={[
          center.x + sun.direction[0] * dist,
          sun.direction[1] * dist,
          center.z + sun.direction[2] * dist,
        ]}
        castShadow={q.shadows && sun.elevation > 0.02}
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </>
  );
}

/** A big inverted sphere with a vertical colour gradient (zenith → horizon → ground). */
function SkyDome({ top, horizon, ground }: { top: string; horizon: string; ground: string }) {
  const geometry = useMemo(() => {
    const g = new SphereGeometry(300, 24, 16);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const t = new Color(top);
    const h = new Color(horizon);
    const b = new Color(ground);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 300; // −1 … 1
      if (y >= 0) c.copy(h).lerp(t, Math.pow(y, 0.6));
      else c.copy(h).lerp(b, Math.min(1, -y * 3));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  }, [top, horizon, ground]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={-10} frustumCulled={false}>
      <meshBasicMaterial
        vertexColors
        side={BackSide}
        fog={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

interface Lamp {
  id: string;
  position: [number, number, number];
  color: string;
  intensity: number;
}

/** Point lights for interior lamp items (ceiling lights, pendants, floor lamps) while the interior lights are on. */
export function InteriorLights({ quality }: { quality: Quality }) {
  const q = QUALITY[quality];
  const lighting = useSceneStore((s) => s.lighting);
  const levelFilter = useSceneStore((s) => s.levelFilter);
  const project = useModel((s) => s.project);
  const activeLevelId = useModel((s) => s.activeLevelId);
  const on = interiorLightsOn(lighting);

  const lamps = useMemo<Lamp[]>(() => {
    if (!on) return [];
    const activeIndex = project.levels.find((l) => l.id === activeLevelId)?.index ?? Infinity;
    const out: Lamp[] = [];
    for (const item of project.items) {
      const entry = getEntry(item.catalogId);
      const level = project.levels.find((l) => l.id === item.levelId);
      if (!entry?.lamp || !level?.visible || (levelFilter === 'below' && level.index > activeIndex))
        continue;
      const size = itemSize(entry, item.scale);
      out.push({
        id: item.id,
        position: [
          item.position.x,
          level.elevation + item.elevation + entry.lamp.y(size),
          item.position.y,
        ],
        color: entry.lamp.color,
        intensity: entry.lamp.intensity,
      });
    }
    // Keep the lamps nearest the middle of the apartment when there are more than the quality level allows.
    const b = polygonBounds(project.shell.footprint);
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.y + b.max.y) / 2;
    out.sort(
      (a, c) =>
        Math.hypot(a.position[0] - cx, a.position[2] - cz) -
        Math.hypot(c.position[0] - cx, c.position[2] - cz),
    );
    return out.slice(0, q.maxLights);
  }, [on, project, activeLevelId, levelFilter, q.maxLights]);

  return (
    <>
      {lamps.map((l, i) => (
        <pointLight
          key={l.id}
          position={l.position}
          color={l.color}
          intensity={l.intensity}
          distance={9}
          decay={2}
          castShadow={i < q.shadowLights}
          shadow-mapSize={[512, 512]}
          shadow-bias={-0.002}
        />
      ))}
    </>
  );
}
