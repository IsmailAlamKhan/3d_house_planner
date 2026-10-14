import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Vec3 } from '../scene3d/camera/views';
import { Matrix4, type OrthographicCamera, type PerspectiveCamera } from 'three';
import { getComposer } from '../present/fxBridge';
import { type RenderPass, applyPass } from '../present/passes';
import { type PathTraceOptions, pathTraceInto } from '../present/pathTrace';
import { useExportFlags } from './flags';

export interface CaptureOptions {
  /** Pixels per on-screen pixel (the largest the graphics card allows is used if 4× is too big). */
  scale: 1 | 2 | 4;
  format: 'png' | 'jpeg';
  /** PNG only: leave the sky out so the picture has an alpha channel. */
  transparent: boolean;
  /** Hide the grid, helpers, selection and measurements. */
  presentation: boolean;
  /** Render a guide pass instead of the colour picture: normalised depth (near = white) or surface normals. Same camera and size as the colour render. */
  pass?: RenderPass;
  /** Make the longer side this many pixels (overrides `scale`; used for the enhancement inputs). */
  longSide?: number;
  /** Render through the presentation post-processing (bloom, SSAO, tone mapping) when it is on. */
  fx?: boolean;
  /** Path-trace the picture (progressively) instead of rasterizing it. Falls back to a normal render when it cannot run. */
  pathTrace?: Omit<PathTraceOptions, 'background'> & { background: string };
  /** Look from here instead of where the camera is now (orbit mode). */
  pose?: { position: Vec3; target: Vec3 };
}

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
  /** The scale actually used (may be lower than asked when the GPU limit was reached). */
  scale: number;
  /** The camera's projection × view matrix at the moment of capture (for projecting labels onto the picture). */
  viewProjection: number[];
  /** `cancelled`: the path tracer was stopped (the picture is partial). `fallback`: why the normal render was used. */
  pathTraced?: 'done' | 'cancelled';
  fallback?: string;
}

type CaptureFn = (o: CaptureOptions) => Promise<CaptureResult>;
let current: CaptureFn | null = null;

/** The live camera as the studio renderer needs it (world matrix, projection kind, field of view / view height). */
export interface CameraInfo {
  matrixWorld: number[];
  kind: 'perspective' | 'ortho';
  fov: number;
  orthoHeight?: number;
  near: number;
  far: number;
  /** Width / height of the 3D view. */
  aspect: number;
}
let cameraInfo: (() => CameraInfo) | null = null;

/** The camera of the 3D view right now, or null when no 3D view is open. */
export const describeCamera = (): CameraInfo | null => cameraInfo?.() ?? null;

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
    cameraInfo = () => {
      const { camera, size } = get();
      camera.updateMatrixWorld();
      const ortho = camera as OrthographicCamera;
      const isOrtho = 'isOrthographicCamera' in camera;
      return {
        matrixWorld: camera.matrixWorld.toArray(),
        kind: isOrtho ? 'ortho' : 'perspective',
        fov: isOrtho ? 45 : (camera as PerspectiveCamera).fov,
        orthoHeight: isOrtho ? (ortho.top - ortho.bottom) / ortho.zoom : undefined,
        near: camera.near,
        far: camera.far,
        aspect: size.width / Math.max(size.height, 1),
      };
    };
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
        const scale = o.longSide
          ? Math.min(o.longSide, limit) / Math.max(size.width, size.height, 1)
          : Math.max(
              1,
              Math.min(o.scale, Math.floor(limit / Math.max(size.width, size.height, 1))),
            );
        const ratio = gl.getPixelRatio();
        gl.setPixelRatio(scale);
        gl.setSize(size.width, size.height, false);
        let restorePass: (() => void) | null = null;
        try {
          restorePass = o.pass ? applyPass(scene, camera, o.pass) : null;
          // The pipeline is the picture (tone mapping lives in it), so every colour capture goes through it.
          const composer = o.pass ? null : getComposer();
          let pathTraced: 'done' | 'cancelled' | undefined;
          let fallback: string | undefined;
          if (o.pathTrace) {
            try {
              get().setFrameloop('never');
              pathTraced = await pathTraceInto(gl, scene, camera, o.pathTrace);
            } catch (e) {
              fallback = e instanceof Error ? e.message : String(e);
              gl.render(scene, camera);
            } finally {
              get().setFrameloop('always');
            }
          } else if (composer) {
            composer.setSize(size.width, size.height, false);
            composer.render();
          } else gl.render(scene, camera);
          restorePass?.();
          restorePass = null;
          camera.updateMatrixWorld();
          const viewProjection = new Matrix4()
            .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            .toArray();
          const blob = await toBlob(
            gl.domElement,
            o.format === 'png' ? 'image/png' : 'image/jpeg',
            o.format === 'jpeg' ? 0.92 : undefined,
          );
          return {
            blob,
            width: gl.domElement.width,
            height: gl.domElement.height,
            scale,
            viewProjection,
            pathTraced,
            fallback,
          };
        } finally {
          restorePass?.();
          gl.setPixelRatio(ratio);
          gl.setSize(size.width, size.height, false);
          getComposer()?.setSize(size.width, size.height, false);
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
      cameraInfo = null;
    };
  }, [get]);
  return null;
}
