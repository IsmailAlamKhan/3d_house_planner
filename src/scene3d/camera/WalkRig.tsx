import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useModel } from '../../model/store';
import { useCamera } from './cameraStore';
import {
  EYE_HEIGHT,
  type WalkInput,
  type Walker,
  advanceWalker,
  buildWalkWorld,
  forward,
  levelIndexAt,
  nearestStandable,
  spawnWalker,
} from './walk';
import { modalOpen } from '../../ui/modalOpen';

/** Touch joystick and keyboard share this: the latest requested movement. */
export const joystick = { x: 0, y: 0 };

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable);

const LOOK_SPEED = 0.004;
const MAX_PITCH = 1.3;

/**
 * First-person camera at eye height on the active level: WASD/arrows to move (Shift runs), drag to look around,
 * touch joystick on phones, walls block you, stairs take you to the next level, Esc exits.
 */
export function WalkRig() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const project = useModel((s) => s.project);
  const world = useMemo(() => buildWalkWorld(project), [project]);
  const walker = useRef<Walker>(useCamera.getState().walker ?? spawnWalker(project, world));
  const keys = useRef(new Set<string>());
  const acc = useRef(0);
  const lastLevel = useRef(-1);
  const teleport = useCamera((s) => s.teleport);

  useEffect(() => {
    // Start (or continue) at the entrance; the world may have changed under us, so re-validate.
    const start = useCamera.getState().walker ?? spawnWalker(useModel.getState().project, world);
    walker.current = start;
    useCamera.getState().setWalker(start);
    return () => useCamera.getState().setWalker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (modalOpen()) return;
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        useCamera.getState().setMode('orbit');
        return;
      }
      keys.current.add(e.key.toLowerCase());
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Drag to look around (mouse, pen or touch).
  useEffect(() => {
    const el = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const downH = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      const w = walker.current;
      walker.current = {
        ...w,
        yaw: w.yaw - (e.clientX - last.x) * LOOK_SPEED,
        pitch: Math.max(
          -MAX_PITCH,
          Math.min(MAX_PITCH, w.pitch - (e.clientY - last.y) * LOOK_SPEED),
        ),
      };
      last = { x: e.clientX, y: e.clientY };
    };
    const upH = (e: PointerEvent) => {
      last = null;
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerdown', downH);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', upH);
    el.addEventListener('pointercancel', upH);
    return () => {
      el.removeEventListener('pointerdown', downH);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', upH);
      el.removeEventListener('pointercancel', upH);
    };
  }, [gl]);

  // Minimap click: jump to the nearest standable spot on the level we are on.
  useEffect(() => {
    if (!teleport) return;
    const level = world.levels.find((l) => l.index === levelIndexAt(world, walker.current));
    if (!level) return;
    const spot = nearestStandable(world, level, { x: teleport.x, y: teleport.y });
    if (spot) walker.current = { ...walker.current, x: spot.x, y: spot.y, floor: spot.floor };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teleport?.nonce]);

  useFrame((_, dt) => {
    const k = keys.current;
    const input: WalkInput = {
      forward:
        (k.has('w') || k.has('arrowup') ? 1 : 0) -
        (k.has('s') || k.has('arrowdown') ? 1 : 0) -
        joystick.y,
      strafe: (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + joystick.x,
      turn:
        (k.has('arrowright') || k.has('e') ? 1 : 0) - (k.has('arrowleft') || k.has('q') ? 1 : 0),
      run: k.has('shift'),
    };
    const w = advanceWalker(world, walker.current, input, Math.min(dt, 0.1));
    walker.current = w;
    camera.position.set(w.x, w.floor + EYE_HEIGHT, w.y);
    camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');

    // Following the stair onto another level makes that level the active one.
    const idx = levelIndexAt(world, w);
    if (idx !== lastLevel.current) {
      lastLevel.current = idx;
      const level = world.levels.find((l) => l.index === idx);
      if (level && useModel.getState().activeLevelId !== level.id)
        useModel.getState().setActiveLevel(level.id);
    }

    acc.current += dt;
    if (acc.current > 0.1) {
      acc.current = 0;
      const f = forward(w.yaw);
      useCamera.getState().setWalker(w);
      useCamera.getState().setLive({
        position: [w.x, w.floor + EYE_HEIGHT, w.y],
        target: [w.x + f.x, w.floor + EYE_HEIGHT, w.y + f.y],
        heading: Math.atan2(f.y, f.x),
      });
    }
  });

  return null;
}
