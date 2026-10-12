import { Canvas } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { useEffect } from 'react';
import { useT } from '../i18n';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { CameraSystem } from '../scene3d/camera/CameraSystem';
import { CameraToolbar } from '../scene3d/camera/CameraToolbar';
import { MeasureOverlay } from '../scene3d/camera/MeasureOverlay';
import { Minimap } from '../scene3d/camera/Minimap';
import { SavedViewsStrip } from '../scene3d/camera/SavedViewsStrip';
import { SectionRig } from '../scene3d/camera/SectionRig';
import { WalkHud } from '../scene3d/camera/WalkHud';
import { ModelScene } from '../scene3d/ModelScene';
import { QUALITY, resolveQuality } from '../scene3d/quality';
import { InteriorLights, SceneLights } from '../scene3d/SceneLights';
import { type LevelFilter, useSceneStore } from '../scene3d/sceneStore';

function LevelsBar() {
  const t = useT();
  const { levelFilter, dollhouse, setPref } = useSceneStore();
  const levels = useModel((s) => s.project.levels);
  const active = useModel((s) => s.activeLevelId);
  const setActive = useModel((s) => s.setActiveLevel);
  const opts: { id: LevelFilter; label: string }[] = [
    { id: 'all', label: t('view3d.allLevels') },
    { id: 'below', label: t('view3d.activeBelow') },
  ];
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 text-xs shadow-sm">
      {opts.map((o) => (
        <button
          key={o.id}
          aria-pressed={levelFilter === o.id}
          onClick={() => setPref('levelFilter', o.id)}
          className={`rounded px-2 py-1 ${levelFilter === o.id ? 'bg-sky-100 font-semibold text-sky-700' : 'text-slate-600'}`}
        >
          {o.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-slate-200" />
      {[...levels]
        .sort((a, b) => a.index - b.index)
        .map((l) => (
          <button
            key={l.id}
            aria-pressed={active === l.id}
            onClick={() => setActive(l.id)}
            className={`rounded px-2 py-1 ${active === l.id ? 'bg-sky-100 font-semibold text-sky-700' : 'text-slate-600'}`}
          >
            {l.name}
          </button>
        ))}
      <button
        aria-pressed={dollhouse}
        onClick={() => setPref('dollhouse', !dollhouse)}
        className={`rounded px-2 py-1 ${dollhouse ? 'bg-sky-100 font-semibold text-sky-700' : 'text-slate-600'}`}
      >
        {t('view3d.dollhouse')}
      </button>
    </div>
  );
}

/** The read-only viewer: the model with orbit, walkthrough, top view, sections, isolation and measuring. */
export function ViewerApp({ project, exportedAt }: { project: Project; exportedAt: string }) {
  const t = useT();
  useEffect(() => {
    useModel.getState().loadProject(project);
  }, [project]);
  const quality = resolveQuality('auto');
  const q = QUALITY[quality === 'high' ? 'medium' : quality];
  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="flex flex-wrap items-center gap-x-3 border-b border-slate-200 bg-white px-3 py-1.5 text-sm">
        <h1 className="font-semibold">{project.name}</h1>
        <span className="text-xs text-slate-500">
          {t('share.readOnly')} · {exportedAt}
        </span>
        <span className="ml-auto text-xs italic text-slate-500">{t('export.disclaimer')}</span>
      </header>
      <div data-testid="viewer-canvas" className="relative min-h-0 flex-1">
        <Canvas
          shadows={q.shadows}
          dpr={q.dpr}
          camera={{ position: [15, 14, 20], fov: 45, near: 0.1, far: 800 }}
          gl={{ localClippingEnabled: true, antialias: q.antialias }}
        >
          <SceneLights quality={quality === 'high' ? 'medium' : quality} />
          <InteriorLights quality={quality === 'high' ? 'medium' : quality} />
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
          <SectionRig />
          <MeasureOverlay />
          <CameraSystem />
        </Canvas>
        <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
          <LevelsBar />
          <CameraToolbar readOnly />
        </div>
        <SavedViewsStrip readOnly />
        <Minimap />
        <WalkHud />
      </div>
    </div>
  );
}
