import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  BufferAttribute,
  Color,
  type DirectionalLight,
  type Object3D,
  PCFShadowMap,
  PCFSoftShadowMap,
  PMREMGenerator,
  type RectAreaLight,
  SphereGeometry,
  Vector3,
  VSMShadowMap,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getEntry, itemSize } from '../catalog';
import { pointInPolygon, polygonBounds } from '../geometry/polygon';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { moonAt, skyFor, sunAt, sunVisible, timeOf, type Sun } from './lighting';
import { daylightLevel, kelvinToHex, lampOn, lampParams, lumensToCandela } from './lights';
import { QUALITY, type Quality } from './quality';
import { useExportFlags } from '../export/flags';
import { useCamera } from './camera/cameraStore';
import { useSceneProject } from './sceneProject';
import { effectiveLightStyle, useSceneStore } from './sceneStore';
import { usePresent } from '../present/presentStore';
import { debugRenderEnabled, useDebug } from '../debug/debugStore';
import { setIndoorSky } from './skyMix';

// Area lights need their lookup tables once, before the first material is compiled.
RectAreaLightUniformsLib.init();

/** Scene units for lamps: a 1800 lm ceiling light lights a room about as strongly as daylight through a window. */
export const LAMP_GAIN = 0.05;

/** The lighting style in force (realistic or design) for the current view. */
export function useLightStyle(): 'realistic' | 'design' {
  const pref = useSceneStore((s) => s.lightStyle);
  const viewMode = useModel((s) => s.viewMode);
  const walking = useCamera((s) => s.mode === 'walk');
  const presenting = usePresent((s) => s.active);
  return effectiveLightStyle(pref, viewMode, walking, presenting);
}

/** Sun (or moon), sky light for the outdoors, local environment reflections and the sky dome. */
export function SceneLights({ quality }: { quality: Quality }) {
  const q = QUALITY[quality];
  const lighting = useSceneStore((s) => s.lighting);
  const exposure = useSceneStore((s) => s.exposure);
  const nightVisibility = useSceneStore((s) => s.nightVisibility);
  const style = useLightStyle();
  const sceneProject = useSceneProject();
  const compass = sceneProject.settings.compass;
  const footprint = sceneProject.shell.footprint;
  const plot = sceneProject.kind === 'villa' ? sceneProject.site.plot : [];
  const get = useThree((s) => s.get);
  const transparent = useExportFlags((s) => s.transparent);
  const debug = useDebug((s) => s.flags);
  const dbg = debugRenderEnabled();

  const sun = useMemo(
    () => (sunVisible(lighting) ? sunAt(timeOf(lighting), compass) : moonAt(compass)),
    [lighting, compass],
  );
  const sky = useMemo(() => skyFor(lighting, sun), [lighting, sun]);
  // Realistic: interiors only get the "night visibility" share of sky and environment light. Design: all of it.
  useEffect(() => {
    setIndoorSky(style === 'realistic' && (!dbg || debug.skyMask) ? nightVisibility : 1);
  }, [style, nightVisibility, dbg, debug.skyMask]);
  // For canvases that tone-map in the renderer (snapshot viewer, comparison); the main view does it in the pipeline.
  useEffect(() => {
    get().gl.toneMappingExposure = Math.pow(2, exposure);
  }, [get, exposure]);

  // The shadow camera fits the building (and its nearest surroundings), not the whole plot.
  const { center, radius } = useMemo(() => {
    const b = polygonBounds(footprint);
    const w = b.max.x - b.min.x;
    const d = b.max.y - b.min.y;
    const pad = plot.length >= 3 ? 8 : 2;
    return {
      center: { x: (b.min.x + b.max.x) / 2, z: (b.min.y + b.max.y) / 2 },
      radius: Math.hypot(w, d) / 2 + pad,
    };
  }, [footprint, plot.length]);

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

  // A different shadow quality: new map size and filter take effect after the old shadow map is released.
  useEffect(() => {
    const { gl, scene } = get();
    const light = sunRef.current;
    if (light?.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null;
    }
    const type =
      q.shadowType === 'variance'
        ? VSMShadowMap
        : q.shadowType === 'soft'
          ? PCFSoftShadowMap
          : PCFShadowMap;
    if (gl.shadowMap.type !== type) {
      gl.shadowMap.type = type;
      scene.traverse((o) => {
        const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] })
          .material;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
  }, [get, q.shadowMapSize, q.shadowType]);

  // Image-based light from a procedurally built room (no network fetch): reflections and a little outdoor fill.
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
    get().scene.environmentIntensity =
      q.environment && (!dbg || debug.environment) ? sky.environment : 0;
  }, [get, q.environment, sky.environment, dbg, debug.environment]);

  const dist = radius * 3;
  return (
    <>
      {!transparent && <SkyDome top={sky.top} horizon={sky.horizon} ground={sky.ground} />}
      <hemisphereLight
        args={[sky.top, sky.ground, sky.ambient]}
        visible={!dbg || debug.hemisphere}
      />
      <object3D ref={targetRef} position={[center.x, 0, center.z]} />
      <directionalLight
        ref={sunRef}
        visible={!dbg || debug.sun}
        color={sun.color}
        intensity={
          style === 'realistic' && !sunVisible(lighting) ? sun.intensity * 0.3 : sun.intensity
        }
        position={[
          center.x + sun.direction[0] * dist,
          sun.direction[1] * dist,
          center.z + sun.direction[2] * dist,
        ]}
        castShadow={q.shadows && sun.elevation > 0.02}
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={q.shadowType === 'variance' ? 4 : 1}
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
    <mesh geometry={geometry} renderOrder={-10} frustumCulled={false} userData={{ sky: true }}>
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
  /** Candela × scene gain. */
  intensity: number;
  /** Spotlight: beam angle in degrees and the point it aims at. */
  beam?: number;
  aim?: [number, number, number];
}

/**
 * Point and spot lights for the light fixtures that are switched on (their own switch, their room's, the master switch,
 * then the lighting preset). Only the `maxLights` nearest to what you are looking at emit light (8 / 16 / 32 by tier);
 * the rest still glow. The nearest `shadowLights` also cast shadows.
 */
export function InteriorLights({ quality }: { quality: Quality }) {
  const q = QUALITY[quality];
  const lighting = useSceneStore((s) => s.lighting);
  const levelFilter = useSceneStore((s) => s.levelFilter);
  const project = useSceneProject();
  const activeLevelId = useModel((s) => s.activeLevelId);
  // Re-rank the lamps when the view moves by about a metre.
  const focus = useCamera((s) => {
    const t = s.live.target;
    return `${Math.round(t[0])},${Math.round(t[1])},${Math.round(t[2])}`;
  });

  const lampsOn = useDebug((s) => !debugRenderEnabled() || s.flags.interiorLights);
  const lamps = useMemo<Lamp[]>(() => {
    if (!lampsOn) return [];
    const [fx, fy, fz] = focus.split(',').map(Number) as [number, number, number];
    const activeIndex = project.levels.find((l) => l.id === activeLevelId)?.index ?? Infinity;
    const out: Lamp[] = [];
    for (const item of project.items) {
      const entry = getEntry(item.catalogId);
      const level = project.levels.find((l) => l.id === item.levelId);
      if (!entry?.lamp || !level?.visible || (levelFilter === 'below' && level.index > activeIndex))
        continue;
      if (!lampOn(project, item, lighting)) continue;
      const params = lampParams(item)!;
      const size = itemSize(entry, item.scale);
      const y = level.elevation + item.elevation + entry.lamp.y(size);
      out.push({
        id: item.id,
        position: [item.position.x, y, item.position.y],
        color: kelvinToHex(params.kelvin),
        intensity: lumensToCandela(params.lumens) * LAMP_GAIN,
        beam: params.beam,
        aim: params.beam ? [item.position.x, level.elevation, item.position.y] : undefined,
      });
    }
    out.sort(
      (a, b) =>
        Math.hypot(a.position[0] - fx, a.position[1] - fy, a.position[2] - fz) -
        Math.hypot(b.position[0] - fx, b.position[1] - fy, b.position[2] - fz),
    );
    return out.slice(0, q.maxLights);
  }, [project, lighting, levelFilter, activeLevelId, focus, q.maxLights, lampsOn]);

  return (
    <>
      {lamps.map((l, i) =>
        l.beam ? (
          <SpotLamp key={l.id} lamp={l} shadow={i < q.shadowLights} />
        ) : (
          <pointLight
            key={l.id}
            position={l.position}
            color={l.color}
            intensity={l.intensity}
            distance={12}
            decay={2}
            castShadow={i < q.shadowLights}
            shadow-mapSize={[512, 512]}
            shadow-bias={-0.002}
          />
        ),
      )}
    </>
  );
}

function SpotLamp({ lamp, shadow }: { lamp: Lamp; shadow: boolean }) {
  const ref = useRef<import('three').SpotLight>(null);
  useLayoutEffect(() => {
    const light = ref.current;
    if (!light || !lamp.aim) return;
    light.target.position.set(...lamp.aim);
    light.target.updateMatrixWorld();
  }, [lamp.aim]);
  return (
    <spotLight
      ref={ref}
      position={lamp.position}
      color={lamp.color}
      intensity={lamp.intensity}
      angle={((lamp.beam ?? 55) * Math.PI) / 360}
      penumbra={0.45}
      distance={12}
      decay={2}
      castShadow={shadow}
      shadow-mapSize={[512, 512]}
      shadow-bias={-0.002}
    >
      <object3D />
    </spotLight>
  );
}

/** Daylight reaching the room through a window: one soft area light per exterior window, facing inward. */
export interface WindowLightSpec {
  id: string;
  position: [number, number, number];
  aim: [number, number, number];
  width: number;
  height: number;
}

/** Exterior windows with the direction into the room they open into (skips windows that open into no room). */
export function windowLightSpecs(project: Project): WindowLightSpec[] {
  const out: WindowLightSpec[] = [];
  for (const o of project.openings) {
    if (o.kind !== 'window') continue;
    const wall = project.walls.find((w) => w.id === o.wallId);
    const level = project.levels.find((l) => l.id === wall?.levelId);
    if (!wall || !level) continue;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const c = { x: wall.start.x + (dx / len) * o.offset, y: wall.start.y + (dy / len) * o.offset };
    const n = { x: -dy / len, y: dx / len };
    const probe = wall.thickness / 2 + 0.25;
    const rooms = project.rooms.filter((r) => r.levelId === level.id && r.name !== 'Open to below');
    const insideA = rooms.some((r) =>
      pointInPolygon({ x: c.x + n.x * probe, y: c.y + n.y * probe }, r.polygon),
    );
    const insideB = rooms.some((r) =>
      pointInPolygon({ x: c.x - n.x * probe, y: c.y - n.y * probe }, r.polygon),
    );
    if (insideA === insideB) continue; // between two rooms, or into nothing
    const sign = insideA ? 1 : -1;
    const off = wall.thickness / 2 + 0.03;
    const y = level.elevation + o.sillHeight + o.height / 2;
    out.push({
      id: o.id,
      position: [c.x + n.x * sign * off, y, c.y + n.y * sign * off],
      aim: [c.x + n.x * sign * (off + 1), y, c.y + n.y * sign * (off + 1)],
      width: o.width * 0.92,
      height: o.height * 0.92,
    });
  }
  return out.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 14);
}

const WINDOW_GAIN = 12;

function WindowLight({
  spec,
  intensity,
  color,
}: {
  spec: WindowLightSpec;
  intensity: number;
  color: string;
}) {
  const ref = useRef<RectAreaLight>(null);
  useLayoutEffect(() => {
    ref.current?.lookAt(new Vector3(...spec.aim));
  }, [spec]);
  return (
    <rectAreaLight
      ref={ref}
      position={spec.position}
      width={spec.width}
      height={spec.height}
      intensity={intensity}
      color={color}
    />
  );
}

/** Realistic lighting only: skylight entering through the windows (no shadows, so it is cheap). */
export function WindowLights({ quality }: { quality: Quality }) {
  const project = useSceneProject();
  const lighting = useSceneStore((s) => s.lighting);
  const style = useLightStyle();
  const all = useMemo(() => windowLightSpecs(project), [project]);
  const specs = useMemo(() => all.slice(0, QUALITY[quality].maxWindowLights), [all, quality]);
  const compass = project.settings.compass;
  const sun = useMemo<Sun>(
    () => (sunVisible(lighting) ? sunAt(timeOf(lighting), compass) : moonAt(compass)),
    [lighting, compass],
  );
  const enabled = useDebug((s) => !debugRenderEnabled() || s.flags.windowLights);
  if (style !== 'realistic' || !specs.length || !enabled) return null;
  const day = daylightLevel(lighting, sun);
  const color = new Color('#cfe0ff').lerp(new Color(sun.color), 0.25).getStyle();
  return (
    <>
      {specs.map((s) => (
        <WindowLight key={s.id} spec={s} intensity={WINDOW_GAIN * day} color={color} />
      ))}
    </>
  );
}
