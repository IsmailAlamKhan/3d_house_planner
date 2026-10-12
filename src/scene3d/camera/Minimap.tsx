import { useMemo } from 'react';
import { useT } from '../../i18n';
import { useModel } from '../../model/store';
import { useCamera } from './cameraStore';
import { fromMap, minimapFrame, toMap } from './minimapFrame';
import { levelIndexAt, buildWalkWorld } from './walk';

const BOX = { width: 168, height: 128 };

/** A small plan in the corner of the 3D view showing where the camera is and which way it looks. */
export function Minimap() {
  const t = useT();
  const project = useModel((s) => s.project);
  const activeLevelId = useModel((s) => s.activeLevelId);
  const mode = useCamera((s) => s.mode);
  const live = useCamera((s) => s.live);
  const walker = useCamera((s) => s.walker);
  const frame = useMemo(() => minimapFrame(project, BOX), [project]);
  const world = useMemo(() => (mode === 'walk' ? buildWalkWorld(project) : null), [project, mode]);
  const levelId =
    mode === 'walk' && walker && world
      ? (world.levels.find((l) => l.index === levelIndexAt(world, walker))?.id ?? activeLevelId)
      : activeLevelId;
  const walls = project.walls.filter((w) => w.levelId === levelId);
  const stairs = project.stairs.filter((s) => s.fromLevelId === levelId || s.toLevelId === levelId);
  const cam = toMap(frame, { x: live.position[0], y: live.position[2] });
  const deg = (live.heading * 180) / Math.PI;
  const outline = project.shell.footprint
    .map((p) => toMap(frame, p))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'walk') return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = fromMap(frame, { x: e.clientX - r.left, y: e.clientY - r.top });
    useCamera.getState().requestTeleport(p.x, p.y);
  };
  return (
    <svg
      role="img"
      aria-label={t('cam.minimap')}
      data-testid="minimap"
      width={frame.width}
      height={frame.height}
      onClick={click}
      className={`pointer-events-auto absolute bottom-2 right-2 rounded-md border border-slate-300 bg-white/90 shadow ${mode === 'walk' ? 'cursor-crosshair' : ''}`}
    >
      <title>{mode === 'walk' ? t('cam.minimapHint') : t('cam.minimap')}</title>
      <polygon points={outline} fill="#f1f5f9" stroke="#64748b" strokeWidth={1.5} />
      {stairs.map((s) => {
        const p = toMap(frame, s.position);
        return <circle key={s.id} cx={p.x} cy={p.y} r={3} fill="#94a3b8" />;
      })}
      {walls.map((w) => {
        const a = toMap(frame, w.start);
        const b = toMap(frame, w.end);
        return (
          <line
            key={w.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#334155"
            strokeWidth={w.type === 'exterior' ? 2 : 1}
          />
        );
      })}
      <g transform={`translate(${cam.x} ${cam.y}) rotate(${deg})`} data-testid="minimap-camera">
        <path d="M 0 0 L 22 -9 A 24 24 0 0 1 22 9 Z" fill="#0ea5e9" fillOpacity={0.25} />
        <circle r={4} fill="#0ea5e9" stroke="white" strokeWidth={1.5} />
      </g>
    </svg>
  );
}
