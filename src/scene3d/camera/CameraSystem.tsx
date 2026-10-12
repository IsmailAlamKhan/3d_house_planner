import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Camera, OrthographicCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { addView } from '../../model/ops';
import { useModel } from '../../model/store';
import { useSceneStore } from '../sceneStore';
import { useCamera } from './cameraStore';
import { focusTarget, poseForFocus } from './focus';
import { type Vec3, lerp3, presetPose, smoothstep, topPose } from './views';
import { WalkRig } from './WalkRig';

interface Pose {
  position: Vec3;
  target: Vec3;
  zoom?: number;
}

/** Last orbit pose per project, so leaving walk/top mode returns to where you were. */
const lastOrbit = new Map<string, Pose>();

const TRANSITION_SECONDS = 0.7;
const round = (v: number) => Math.round(v * 1000) / 1000;

const isOrtho = (c: Camera): c is OrthographicCamera => 'isOrthographicCamera' in c;

function poseOf(camera: Camera, controls: OrbitControlsImpl | null): Pose {
  return {
    position: camera.position.toArray() as Vec3,
    target: (controls?.target.toArray() ?? [0, 0, 0]) as Vec3,
    zoom: isOrtho(camera) ? camera.zoom : undefined,
  };
}

/** Puts the camera (and the orbit target) at a pose. Plain function: the three.js objects are mutated outside React render. */
function applyPose(camera: Camera, controls: OrbitControlsImpl | null, pose: Pose): void {
  camera.position.set(...pose.position);
  controls?.target.set(...pose.target);
  if (pose.zoom !== undefined && isOrtho(camera)) camera.zoom = pose.zoom;
  if ('updateProjectionMatrix' in camera) (camera as OrthographicCamera).updateProjectionMatrix();
  controls?.update();
}

/** Converts the rendered canvas into a small JPEG thumbnail. */
export function makeThumbnail(source: HTMLCanvasElement, width = 160): string {
  const h = Math.max(1, Math.round((width * source.height) / Math.max(source.width, 1)));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = h;
  c.getContext('2d')?.drawImage(source, 0, 0, width, h);
  return c.toDataURL('image/jpeg', 0.7);
}

/** Orbit and top-view cameras: framing, animated transitions, focus, saved views and the live pose for the minimap. */
function OrbitRig({ top }: { top: boolean }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);
  const projectId = useModel((s) => s.project.id);
  const resetKey = useSceneStore((s) => s.cameraResetKey);
  const fly = useCamera((s) => s.fly);
  const focusNonce = useCamera((s) => s.focusNonce);
  const capture = useCamera((s) => s.capture);
  const anim = useRef<{ from: Pose; to: Pose; t: number } | null>(null);
  const acc = useRef(0);
  const lastReset = useRef(resetKey);

  // Frame the apartment when a project opens, the camera is reset, or the mode changes.
  useEffect(() => {
    if (!controls) return;
    const project = useModel.getState().project;
    const { size } = get();
    anim.current = null;
    if (top) {
      applyPose(camera, controls, topPose(project, size));
      return;
    }
    const resetNow = lastReset.current !== resetKey;
    lastReset.current = resetKey;
    const remembered = lastOrbit.get(project.id);
    applyPose(
      camera,
      controls,
      remembered && !resetNow
        ? remembered
        : presetPose(project, 'iso', size.width / Math.max(size.height, 1)),
    );
  }, [controls, camera, get, projectId, resetKey, top]);

  // Remember where the orbit camera was when we leave.
  useEffect(
    () => () => {
      if (!top && controls) lastOrbit.set(projectId, poseOf(camera, controls));
    },
    [controls, camera, top, projectId],
  );

  // Any manual movement cancels a running transition.
  useEffect(() => {
    const stop = () => {
      anim.current = null;
    };
    controls?.addEventListener('start', stop);
    return () => controls?.removeEventListener('start', stop);
  }, [controls]);

  // Smooth move requested from elsewhere (preset views, saved views, focus).
  useEffect(() => {
    if (!fly || !controls) return;
    const from = poseOf(camera, controls);
    anim.current = {
      from,
      to: {
        position: fly.position,
        target: fly.target,
        zoom: top ? (fly.zoom ?? from.zoom) : undefined,
      },
      t: 0,
    };
    // Only a new request starts a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly?.nonce]);

  // F / double-click: bring the selection into view.
  useEffect(() => {
    if (!focusNonce) return;
    const { project, selection } = useModel.getState();
    const f = focusTarget(project, selection);
    if (!f) return;
    const at = camera.position.toArray() as Vec3;
    useCamera
      .getState()
      .flyTo(
        top
          ? { position: [f.center[0], at[1], f.center[2]], target: [f.center[0], 0, f.center[2]] }
          : poseForFocus(f, at),
      );
    // Only a new request starts a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Save the current view with a thumbnail.
  useEffect(() => {
    if (!capture) return;
    const { gl, scene } = get();
    gl.render(scene, camera);
    const thumbnail = makeThumbnail(gl.domElement);
    const pose = poseOf(camera, controls);
    const { section } = useCamera.getState();
    const cutting = section.horizontal.on || section.vertical.on;
    useModel.getState().apply((p) => {
      addView(p, {
        name: capture.name,
        mode: top ? 'top' : 'orbit',
        position: pose.position.map(round) as Vec3,
        target: pose.target.map(round) as Vec3,
        zoom: top ? pose.zoom : undefined,
        section: cutting ? structuredClone(section) : undefined,
        thumbnail,
      });
    });
    // Only a new request saves a view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture?.nonce]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (a && controls) {
      a.t = Math.min(1, a.t + dt / TRANSITION_SECONDS);
      const k = smoothstep(a.t);
      applyPose(camera, controls, {
        position: lerp3(a.from.position, a.to.position, k),
        target: lerp3(a.from.target, a.to.target, k),
        zoom:
          a.to.zoom !== undefined && a.from.zoom !== undefined
            ? a.from.zoom + (a.to.zoom - a.from.zoom) * k
            : undefined,
      });
      if (a.t >= 1) anim.current = null;
    }
    acc.current += dt;
    if (acc.current > 0.1 && controls) {
      acc.current = 0;
      const p = camera.position;
      const t = controls.target;
      const live = useCamera.getState().live;
      const heading = top ? -Math.PI / 2 : Math.atan2(t.z - p.z, t.x - p.x);
      if (
        Math.abs(live.position[0] - p.x) > 1e-3 ||
        Math.abs(live.position[2] - p.z) > 1e-3 ||
        Math.abs(live.heading - heading) > 1e-3
      )
        useCamera.getState().setLive({
          position: [p.x, p.y, p.z],
          target: [t.x, t.y, t.z],
          zoom: isOrtho(camera) ? camera.zoom : undefined,
          heading,
        });
    }
  });

  return null;
}

function sizeInPixels(cam: OrthographicCamera, width: number, height: number): void {
  cam.left = -width / 2;
  cam.right = width / 2;
  cam.top = height / 2;
  cam.bottom = -height / 2;
  cam.updateProjectionMatrix();
}

/** Orthographic camera sized in pixels (so `zoom` means pixels per metre) with pan/zoom-only controls. */
function TopView() {
  const set = useThree((s) => s.set);
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const cam = useMemo(() => {
    const c = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    // R3F's flag: leave the frustum alone on resize (it is sized in pixels below).
    (c as OrthographicCamera & { manual?: boolean }).manual = true;
    return c;
  }, []);
  useEffect(() => sizeInPixels(cam, size.width, size.height), [cam, size.width, size.height]);
  useEffect(() => {
    const previous = get().camera;
    set(() => ({ camera: cam }));
    return () => set(() => ({ camera: previous }));
  }, [cam, set, get]);
  return (
    <OrbitControls
      key="top"
      makeDefault
      camera={cam}
      enableRotate={false}
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning
    />
  );
}

/** Everything about where the camera is and how it moves. Mount inside the Canvas. */
export function CameraSystem() {
  const mode = useCamera((s) => s.mode);
  return (
    <>
      {mode === 'orbit' && (
        <>
          <OrbitControls
            key="orbit"
            makeDefault
            enableDamping
            dampingFactor={0.1}
            maxPolarAngle={Math.PI * 0.495}
          />
          <OrbitRig top={false} />
        </>
      )}
      {mode === 'top' && (
        <>
          <TopView />
          <OrbitRig top />
        </>
      )}
      {mode === 'walk' && <WalkRig />}
    </>
  );
}
