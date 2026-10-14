import { Canvas } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { useModel } from '../model/store';
import { validateStair } from './generators/stairs';
import { ModelScene } from './ModelScene';
import { DropTarget } from './DropTarget';
import { FpsMeter } from './FpsMeter';
import { InteriorLights, SceneLights, WindowLights } from './SceneLights';
import { QUALITY, resolveQuality } from './quality';
import { carriedId, useCatalogDrag } from '../catalog/dragStore';
import { SceneToolbar } from './SceneToolbar';
import { selectFrom3d } from './select';
import { effectiveLightStyle, useSceneStore } from './sceneStore';
import { CameraSystem } from './camera/CameraSystem';
import { useCamera } from './camera/cameraStore';
import { MeasureOverlay } from './camera/MeasureOverlay';
import { Minimap } from './camera/Minimap';
import { SavedViewsStrip } from './camera/SavedViewsStrip';
import { SectionRig } from './camera/SectionRig';
import { WalkHud } from './camera/WalkHud';
import { ReflectionProbes } from '../bake/ReflectionProbes';
import { useBake } from '../bake/bakeStore';
import { ExportBridge } from '../export/bridge';
import { NotePins3D } from '../notes/NotePins3D';
import { useExportFlags } from '../export/flags';
import { modalOpen } from '../ui/modalOpen';
import { AccentLights } from '../present/AccentLights';
import { LabelsOverlay } from '../present/LabelsOverlay';
import { LabelsProjector } from '../present/LabelsProjector';
import RenderPipeline from './RenderPipeline';
import { RenderDebugPanel } from '../debug/RenderDebugPanel';
import { ContactBlobs } from './ContactBlobs';
import { RoomLightButtons } from './RoomLightButtons';
import { useUnderlayUi } from '../underlay/uiStore';

/** A phone: a coarse pointer on a small screen. */
const isPhone = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches &&
  Math.min(window.innerWidth, window.innerHeight) < 700;

// Loaded only when High quality asks for it, keeping the postprocessing library out of the main bundle.

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

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable);

/** L (or the "Work light" button): switch between realistic and even design lighting. */
export function toggleWorkLight(): void {
  const scene = useSceneStore.getState();
  const style = effectiveLightStyle(
    scene.lightStyle,
    useModel.getState().viewMode,
    useCamera.getState().mode === 'walk',
    false,
  );
  scene.setPref('lightStyle', style === 'realistic' ? 'design' : 'realistic');
}

/** F focuses the selection; L toggles the work light; Esc stops measuring. */
function useCameraShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen()) return;
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const cam = useCamera.getState();
      if (e.key === 'Escape' && cam.measuring) cam.setMeasuring(false);
      else if ((e.key === 'f' || e.key === 'F') && cam.mode !== 'walk') cam.requestFocus();
      else if (e.key === 'l' || e.key === 'L') toggleWorkLight();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** 3D viewport: the live model generated from the project, with orbit controls and click-to-select. */
export function SceneCanvas() {
  const choice = useSceneStore((s) => s.quality);
  const showFps = useSceneStore((s) => s.showFps);
  const quality = useMemo(() => resolveQuality(choice), [choice]);
  const q = QUALITY[quality];
  const night = useSceneStore((s) => s.lighting.mode === 'night');
  const presentation = useExportFlags((s) => s.presentation);
  // "Compare with reference" wants a clean picture: no light switches, toolbars or minimap on top of the render.
  const comparing = useUnderlayUi((s) => s.compareOpen);
  useCameraShortcuts();
  // phones show the bake (cheap to display) and skip real-time shadows altogether
  const bakedOnPhone = useBake((s) => !!s.applied) && isPhone();
  return (
    <div data-testid="scene-canvas" className="relative h-full w-full bg-slate-200">
      {/* Quality changes apply live (anti-aliasing is done by the render pipeline, not the GL context). */}
      <Canvas
        flat
        shadows={bakedOnPhone ? false : q.shadowType}
        dpr={q.dpr}
        camera={{ position: [15, 14, 20], fov: 45, near: 0.1, far: 800 }}
        gl={{ localClippingEnabled: true, antialias: false }}
        onPointerMissed={(e) => {
          if (!useCatalogDrag.getState().armedId) selectFrom3d(undefined, e.shiftKey);
        }}
      >
        <SceneLights quality={quality} />
        <InteriorLights quality={quality} />
        <WindowLights quality={quality} />
        {!presentation && (
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
        )}
        <ModelScene />
        <ReflectionProbes quality={quality} />
        <ContactBlobs quality={quality} />
        <DropTarget />
        <SectionRig />
        {!presentation && <MeasureOverlay />}
        <ExportBridge />
        <NotePins3D />
        {!comparing && <RoomLightButtons />}
        <CameraSystem />
        {showFps && <FpsMeter />}
        <AccentLights quality={quality} />
        <LabelsProjector />
        <RenderPipeline quality={quality} />
      </Canvas>
      <LabelsOverlay />
      <RenderDebugPanel />
      {!comparing && <SceneToolbar />}
      {!comparing && <SavedViewsStrip />}
      {!comparing && <Minimap />}
      <WalkHud />
      <StairWarnings />
      <CarryMessage />
    </div>
  );
}
