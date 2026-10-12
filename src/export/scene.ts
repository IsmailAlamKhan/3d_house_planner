import { useModel } from '../model/store';
import { useCamera } from '../scene3d/camera/cameraStore';
import { type Vec3, presetPose } from '../scene3d/camera/views';
import { captureScene, hasScene } from './bridge';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });

async function waitFor(test: () => boolean, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (test()) return true;
    await frames(2);
  }
  return test();
}

/**
 * Makes sure the 3D view is open in orbit mode (opening it behind the scenes if the user is in 2D only, and leaving a
 * walkthrough or top view), runs `fn`, then puts the view back the way it was.
 */
export async function withScene<T>(fn: () => Promise<T>): Promise<T> {
  const model = useModel.getState();
  const cam = useCamera.getState();
  const before = { view: model.viewMode, mode: cam.mode };
  if (cam.mode !== 'orbit') cam.setMode('orbit');
  if (model.viewMode === '2d') model.setViewMode('split');
  if (!(await waitFor(hasScene, 8000))) throw new Error('The 3D view could not be opened.');
  await frames(6); // let the model build
  try {
    return await fn();
  } finally {
    if (useModel.getState().viewMode !== before.view) useModel.getState().setViewMode(before.view);
    if (before.mode !== 'orbit') useCamera.getState().setMode(before.mode);
  }
}

/** A clean isometric picture of the whole home (used on the PDF cover). */
export async function captureHero(project = useModel.getState().project): Promise<string> {
  return withScene(async () => {
    const el = document.querySelector('[data-testid="scene-canvas"]');
    const aspect = el ? el.clientWidth / Math.max(el.clientHeight, 1) : 1.6;
    const pose = presetPose(project, 'iso', aspect);
    const { blob } = await captureScene({
      scale: 2,
      format: 'jpeg',
      transparent: false,
      presentation: true,
      pose: { position: pose.position as Vec3, target: pose.target as Vec3 },
    });
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  });
}
