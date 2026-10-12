import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Suspense, lazy, useEffect, useMemo } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { polygonBounds } from '../geometry/polygon';
import { useModel } from '../model/store';
import { validateStair } from './generators/stairs';
import { ModelScene } from './ModelScene';
import { DropTarget } from './DropTarget';
import { FpsMeter } from './FpsMeter';
import { InteriorLights, SceneLights } from './SceneLights';
import { QUALITY, resolveQuality } from './quality';
import { carriedId, useCatalogDrag } from '../catalog/dragStore';
import { SceneToolbar } from './SceneToolbar';
import { selectFrom3d } from './select';
import { useSceneStore } from './sceneStore';

// Loaded only when High quality asks for it, keeping the postprocessing library out of the main bundle.
const AmbientOcclusion = lazy(() => import('./AmbientOcclusion'));

/** Frames the apartment whenever a project is opened or the user asks to reset the camera. */
function CameraRig() {
  // `makeDefault` publishes the controls here once they exist, so framing waits for them.
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const getState = useThree((s) => s.get);
  const projectId = useModel((s) => s.project.id);
  const resetKey = useSceneStore((s) => s.cameraResetKey);
  useEffect(() => {
    const { shell, levels } = useModel.getState().project;
    const b = polygonBounds(shell.footprint);
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.y + b.max.y) / 2;
    const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 4);
    const top = Math.max(shell.maxHeight, ...levels.map((l) => l.elevation + l.floorToCeiling));
    const { camera, size } = getState();
    // Pull back further when the viewport is narrow (e.g. split view) so the whole apartment fits.
    const fit = 1 / Math.min(1, size.width / Math.max(size.height, 1));
    camera.position.set(cx + span * 0.9 * fit, top + span * 0.9 * fit, cz + span * 1.3 * fit);
    camera.updateProjectionMatrix();
    controls?.target.set(cx, top / 3, cz);
    controls?.update();
  }, [getState, controls, projectId, resetKey]);
  return null;
}

function StairWarnings() {
  const project = useModel((s) => s.project);
  const issues = useMemo(
    () => project.stairs.flatMap((s) => validateStair(project, s).map((m) => m)),
    [project],
  );
  if (!issues.length) return null;
  return (
    <ul
      role="status"
      className="pointer-events-none absolute bottom-2 left-2 max-w-xs space-y-1 text-xs"
    >
      {issues.map((m, i) => (
        <li key={i} className="rounded bg-amber-100/95 px-2 py-1 text-amber-900 shadow-sm">
          ⚠ {m}
        </li>
      ))}
    </ul>
  );
}

/** Why the carried library item can't go where the pointer is (or a clearance warning), over the 3D view. */
function CarryMessage() {
  const carried = useCatalogDrag(carriedId);
  const hover = useCatalogDrag((s) => s.hover);
  if (!carried || !hover) return null;
  const ev = hover.evaluation;
  const msg = !ev.ok
    ? ev.message
    : ev.kind === 'item' && ev.placement.warnings.length
      ? ev.placement.warnings.join(' ')
      : null;
  if (!msg) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-14 max-w-sm -translate-x-1/2 rounded-md bg-slate-800/90 px-3 py-1.5 text-center text-sm text-white shadow"
    >
      {msg}
    </div>
  );
}

/** 3D viewport: the live model generated from the project, with orbit controls and click-to-select. */
export function SceneCanvas() {
  const choice = useSceneStore((s) => s.quality);
  const showFps = useSceneStore((s) => s.showFps);
  const quality = useMemo(() => resolveQuality(choice), [choice]);
  const q = QUALITY[quality];
  const night = useSceneStore((s) => s.lighting.mode === 'night');
  return (
    <div data-testid="scene-canvas" className="relative h-full w-full bg-slate-200">
      {/* Antialiasing is fixed when the GL context is created, so a quality change remounts the canvas. */}
      <Canvas
        key={quality}
        shadows={q.shadows}
        dpr={q.dpr}
        camera={{ position: [15, 14, 20], fov: 45, near: 0.1, far: 800 }}
        gl={{ localClippingEnabled: true, antialias: q.antialias }}
        onPointerMissed={(e) => {
          if (!useCatalogDrag.getState().armedId) selectFrom3d(undefined, e.shiftKey);
        }}
      >
        <SceneLights quality={quality} />
        <InteriorLights quality={quality} />
        <Grid
          position={[0, -0.25, 0]}
          args={[60, 60]}
          cellSize={1}
          sectionSize={5}
          cellColor={night ? '#26304f' : '#b6c0cc'}
          sectionColor={night ? '#34406a' : '#8794a3'}
          fadeDistance={60}
          infiniteGrid
        />
        <ModelScene />
        <DropTarget />
        <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.495} />
        <CameraRig />
        {showFps && <FpsMeter />}
        {q.ao && (
          <Suspense fallback={null}>
            <AmbientOcclusion />
          </Suspense>
        )}
      </Canvas>
      <SceneToolbar />
      <StairWarnings />
      <CarryMessage />
    </div>
  );
}
