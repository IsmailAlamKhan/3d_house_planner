import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Vec3 } from '../scene3d/camera/views';
import { useExportFlags } from './flags';

export interface CaptureOptions {
  /** Pixels per on-screen pixel (the largest the graphics card allows is used if 4× is too big). */
  scale: 1 | 2 | 4;
  format: 'png' | 'jpeg';
  /** PNG only: leave the sky out so the picture has an alpha channel. */
  transparent: boolean;
  /** Hide the grid, helpers, selection and measurements. */
  presentation: boolean;
  /** Look from here instead of where the camera is now (orbit mode). */
  pose?: { position: Vec3; target: Vec3 };
}

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
  /** The scale actually used (may be lower than asked when the GPU limit was reached). */
  scale: number;
}

type CaptureFn = (o: CaptureOptions) => Promise<CaptureResult>;
let current: CaptureFn | null = null;

/** True while a 3D view is mounted and can be photographed. */
export const hasScene = (): boolean => current !== null;

export function captureScene(o: CaptureOptions): Promise<CaptureResult> {
  if (!current) return Promise.reject(new Error('The 3D view is not open.'));
  return current(o);
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The picture could not be created.'))),
      type,
      quality,
    ),
  );

/** Lives inside the Canvas and lets the export dialog take pictures of the live 3D view. */
export function ExportBridge() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    current = async (o) => {
      const flags = useExportFlags.getState();
      const before = { presentation: flags.presentation, transparent: flags.transparent };
      flags.set({ presentation: o.presentation, transparent: o.transparent && o.format === 'png' });
      await frames(3); // let React and the renderer apply the clean look
      const { gl, scene, camera, size } = get();
      const controls = get().controls as OrbitControlsImpl | null;
      const from = { position: camera.position.clone(), target: controls?.target.clone() };
      try {
        if (o.pose) {
          camera.position.set(...o.pose.position);
          controls?.target.set(...o.pose.target);
          controls?.update();
        }
        const limit = Math.min(gl.capabilities.maxTextureSize, 8192);
        const scale = Math.max(
          1,
          Math.min(o.scale, Math.floor(limit / Math.max(size.width, size.height, 1))),
        );
        const ratio = gl.getPixelRatio();
        gl.setPixelRatio(scale);
        gl.setSize(size.width, size.height, false);
        try {
          gl.render(scene, camera);
          const blob = await toBlob(
            gl.domElement,
            o.format === 'png' ? 'image/png' : 'image/jpeg',
            o.format === 'jpeg' ? 0.92 : undefined,
          );
          return { blob, width: gl.domElement.width, height: gl.domElement.height, scale };
        } finally {
          gl.setPixelRatio(ratio);
          gl.setSize(size.width, size.height, false);
        }
      } finally {
        camera.position.copy(from.position);
        if (from.target) controls?.target.copy(from.target);
        controls?.update();
        useExportFlags.getState().set(before);
      }
    };
    return () => {
      current = null;
    };
  }, [get]);
  return null;
}
