import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { polygonBounds } from '../geometry/polygon';
import { useModel } from '../model/store';
import { validateStair } from './generators/stairs';
import { ModelScene } from './ModelScene';
import { SceneToolbar } from './SceneToolbar';
import { selectFrom3d } from './select';
import { useSceneStore } from './sceneStore';

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

/** 3D viewport: the live model generated from the project, with orbit controls and click-to-select. */
export function SceneCanvas() {
  return (
    <div data-testid="scene-canvas" className="relative h-full w-full bg-slate-200">
      <Canvas
        shadows
        camera={{ position: [15, 14, 20], fov: 45, near: 0.1, far: 500 }}
        gl={{ localClippingEnabled: true, antialias: true }}
        onPointerMissed={(e) => selectFrom3d(undefined, e.shiftKey)}
      >
        <color attach="background" args={['#dbe4ee']} />
        <hemisphereLight args={['#ffffff', '#8b95a1', 0.7]} />
        <directionalLight
          position={[14, 24, 10]}
          intensity={1.3}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          shadow-camera-near={1}
          shadow-camera-far={80}
          shadow-bias={-0.0004}
        />
        <Grid
          position={[0, -0.25, 0]}
          args={[60, 60]}
          cellSize={1}
          sectionSize={5}
          cellColor="#b6c0cc"
          sectionColor="#8794a3"
          fadeDistance={60}
          infiniteGrid
        />
        <ModelScene />
        <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.495} />
        <CameraRig />
      </Canvas>
      <SceneToolbar />
      <StairWarnings />
    </div>
  );
}
