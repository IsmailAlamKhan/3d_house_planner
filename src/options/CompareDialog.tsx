import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { areaSchedule } from '../checks/areas';
import { runChecks } from '../checks';
import { formatArea } from '../ui/units';
import { useT } from '../i18n';
import { allDesigns, projectForDesign } from '../model/ops';
import { useModel } from '../model/store';
import type { Project } from '../model/types';
import { type Vec3, presetPose } from '../scene3d/camera/views';
import { ModelScene } from '../scene3d/ModelScene';
import { QUALITY, resolveQuality } from '../scene3d/quality';
import { InteriorLights, SceneLights } from '../scene3d/SceneLights';
import { SceneProjectProvider } from '../scene3d/sceneProject';
import { Modal } from '../ui/Modal';
import { useUiStore } from '../ui/uiStore';
import { designTitle } from './OptionsPanel';
import { type Side, useCompare } from './compareStore';

const close = 'rounded p-1 hover:bg-slate-100';

/** One camera shared by both views: moving either one moves the other. */
function SyncedOrbit({ side, project }: { side: Side; project: Project }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);
  const applying = useRef(false);
  const seen = useRef(0);

  // Start from the standard isometric view, or from where the other side already is.
  useEffect(() => {
    if (!controls) return;
    const shared = useCompare.getState().pose;
    const { size } = get();
    const pose = shared ?? {
      ...presetPose(project, 'iso', size.width / Math.max(size.height, 1)),
      nonce: 0,
    };
    camera.position.set(...pose.position);
    controls.target.set(...pose.target);
    controls.update();
    seen.current = shared?.nonce ?? 0;
  }, [controls, camera, get, project]);

  useEffect(() => {
    if (!controls) return;
    const onChange = () => {
      if (applying.current) return;
      useCompare
        .getState()
        .publish(side, camera.position.toArray() as Vec3, controls.target.toArray() as Vec3);
    };
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  }, [controls, camera, side]);

  useFrame(() => {
    const p = useCompare.getState().pose;
    if (!p || !controls || p.source === side || p.nonce === seen.current) return;
    seen.current = p.nonce;
    applying.current = true;
    camera.position.set(...p.position);
    controls.target.set(...p.target);
    controls.update();
    applying.current = false;
  });
  return null;
}

function DesignView({ project, side, label }: { project: Project; side: Side; label: string }) {
  const t = useT();
  const quality = resolveQuality('auto');
  const q = QUALITY[quality === 'high' ? 'medium' : quality];
  const lights = quality === 'high' ? 'medium' : quality;
  const stats = useMemo(() => {
    const a = areaSchedule(project);
    const issues = runChecks(project);
    return {
      usable: a.total.usable,
      rooms: project.rooms.length,
      items: project.items.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity !== 'error').length,
    };
  }, [project]);
  return (
    <section
      aria-label={label}
      data-testid={`compare-${side}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <h3 className="px-2 py-1 text-sm font-semibold">{label}</h3>
      <div className="relative min-h-0 flex-1 bg-slate-200">
        <Canvas
          shadows={q.shadows}
          dpr={q.dpr}
          camera={{ position: [15, 14, 20], fov: 45, near: 0.1, far: 800 }}
          gl={{ antialias: q.antialias }}
        >
          <SceneProjectProvider value={{ project, readOnly: true }}>
            <SceneLights quality={lights} />
            <InteriorLights quality={lights} />
            <ModelScene />
          </SceneProjectProvider>
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.1}
            maxPolarAngle={Math.PI * 0.495}
          />
          <SyncedOrbit side={side} project={project} />
        </Canvas>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 px-2 py-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="inline">{t('areas.usable')}: </dt>
          <dd className="inline font-medium">{formatArea(stats.usable, project.units)}</dd>
        </div>
        <div>
          <dt className="inline">{t('export.rooms')}: </dt>
          <dd className="inline font-medium">{stats.rooms}</dd>
        </div>
        <div>
          <dt className="inline">{t('options.furniture')}: </dt>
          <dd className="inline font-medium">{stats.items}</dd>
        </div>
        <div>
          <dt className="inline">{t('sidebar.checks')}: </dt>
          <dd className="inline font-medium">
            {stats.errors} / {stats.warnings}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Two designs of the same home side by side in synced 3D views. */
export function CompareDialog() {
  const t = useT();
  const open = useUiStore((s) => s.compareOpen);
  const setOpen = useUiStore((s) => s.setCompareOpen);
  const live = useModel((s) => s.project);
  const designs = useMemo(() => allDesigns(live), [live]);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);

  useEffect(() => {
    if (open) useCompare.getState().reset();
  }, [open]);

  if (!open) return null;
  const left = leftId && designs.some((d) => d.id === leftId) ? leftId : (designs[0]?.id ?? '');
  const right =
    rightId && designs.some((d) => d.id === rightId)
      ? rightId
      : (designs[1]?.id ?? designs[0]?.id ?? '');
  const leftProject = projectForDesign(live, left);
  const rightProject = projectForDesign(live, right);
  const nameOf = (id: string) => {
    const d = designs.find((x) => x.id === id);
    return d ? designTitle(d, t) : '';
  };
  const select = (side: Side, value: string, onChange: (v: string) => void) => (
    <label className="flex items-center gap-1 text-sm">
      {side === 'left' ? t('options.left') : t('options.right')}
      <select
        aria-label={side === 'left' ? t('options.left') : t('options.right')}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {designs.map((d) => (
          <option key={d.id} value={d.id}>
            {designTitle(d, t)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      label={t('options.compareTitle')}
      className="h-[92vh] max-w-6xl"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2">
        <h2 className="font-semibold">{t('options.compareTitle')}</h2>
        {select('left', left, setLeftId)}
        {select('right', right, setRightId)}
        <span className="hidden flex-1 text-xs text-slate-500 md:block">{t('options.hint')}</span>
        <button
          aria-label={t('options.close')}
          title={t('options.close')}
          className={`${close} ml-auto`}
          onClick={() => setOpen(false)}
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2 sm:flex-row">
        {leftProject && <DesignView project={leftProject} side="left" label={nameOf(left)} />}
        {rightProject && <DesignView project={rightProject} side="right" label={nameOf(right)} />}
      </div>
    </Modal>
  );
}
