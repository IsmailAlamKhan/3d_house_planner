import { useEffect, useMemo, useRef } from 'react';
import { useT } from '../i18n';
import { detectRoomPolygons } from '../geometry/rooms';
import type { Vec2 } from '../geometry/vec';
import { computeWallPolygons, type WallSeg } from '../geometry/walls';
import { useModel } from '../model/store';
import type { Wall } from '../model/types';
import { formatLength } from '../ui/units';
import { useDraft } from './draftStore';
import { fitToShell, interaction as inter, planSvgRef, typedEndpoint } from './interaction';
import { ColumnsLayer, DimensionLabel, Grid, RoomsLayer, ShellLayer } from './layers';
import { PlanToolbar } from './PlanToolbar';
import { usePlanStore } from './planStore';

const WALL_FILL = { exterior: '#334155', interior: '#475569', partition: '#64748b' } as const;
const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

/** 2D floor plan viewport: grid, shell, rooms, walls and the drawing tools. */
export function PlanCanvas() {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const project = useModel((s) => s.project);
  const activeLevelId = useModel((s) => s.activeLevelId);
  const selection = useModel((s) => s.selection);
  const tool = useModel((s) => s.tool);
  const { view, size, showGhosts, showAllDimensions, roomMode, toast, snapResult } = usePlanStore();
  const { chain, typed, roomPts, measure, drag, preview, hover, spaceDown, panning } = useDraft();

  // Track size, fit once per project.
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      usePlanStore.getState().setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    usePlanStore.getState().setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (size.w > 0 && fittedFor.current !== project.id) {
      fittedFor.current = project.id;
      fitToShell();
    }
  }, [size.w, size.h, project.id]);

  // Non-passive wheel + window key handling.
  useEffect(() => {
    const svg = planSvgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', inter.onWheel, { passive: false });
    window.addEventListener('keydown', inter.onKeyDown);
    window.addEventListener('keyup', inter.onKeyUp);
    return () => {
      svg.removeEventListener('wheel', inter.onWheel);
      window.removeEventListener('keydown', inter.onKeyDown);
      window.removeEventListener('keyup', inter.onKeyUp);
    };
  }, []);

  // Switching tool or level abandons any half-finished drawing.
  useEffect(() => {
    useDraft.getState().reset();
  }, [tool, activeLevelId]);

  const units = project.units;
  const level = project.levels.find((l) => l.id === activeLevelId);
  const selectedIds = useMemo(() => new Set(selection.ids), [selection]);

  const overrides = useMemo(() => new Map(preview.map((g) => [g.id, g])), [preview]);
  const walls: Wall[] = useMemo(
    () =>
      project.walls
        .filter((w) => w.levelId === activeLevelId)
        .map((w) => {
          const o = overrides.get(w.id);
          return o ? { ...w, start: o.start, end: o.end } : w;
        }),
    [project.walls, activeLevelId, overrides],
  );
  const rooms = useMemo(
    () => project.rooms.filter((r) => r.levelId === activeLevelId),
    [project.rooms, activeLevelId],
  );
  const columns = useMemo(
    () => project.columns.filter((c) => c.levelId === activeLevelId),
    [project.columns, activeLevelId],
  );
  const wallPolys = useMemo(() => computeWallPolygons(walls), [walls]);
  const previewRooms = useMemo(
    () =>
      preview.length
        ? detectRoomPolygons(walls).map((polygon, i) => ({
            id: `p${i}`,
            polygon,
            type: 'other' as const,
            name: '',
          }))
        : null,
    [preview.length, walls],
  );
  const ghostPolys = useMemo(() => {
    if (!showGhosts) return [];
    return project.levels
      .filter((l) => l.id !== activeLevelId && l.visible)
      .flatMap((l) => {
        const ws: WallSeg[] = project.walls.filter((w) => w.levelId === l.id);
        return [...computeWallPolygons(ws).values()];
      });
  }, [showGhosts, project.levels, project.walls, activeLevelId]);

  // Draft geometry (walls being drawn).
  const typedPt = tool === 'wall' ? typedEndpoint() : null;
  const hoverPt = typedPt ?? hover?.point ?? null;
  const draftChain: Vec2[] =
    tool === 'wall' && chain.length ? [...chain, ...(hoverPt ? [hoverPt] : [])] : [];
  const draftSegs: WallSeg[] = [];
  for (let i = 0; i + 1 < draftChain.length; i++) {
    const a = draftChain[i]!;
    const b = draftChain[i + 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) {
      draftSegs.push({
        id: String(i),
        start: a,
        end: b,
        thickness: project.settings.defaultWallThickness,
      });
    }
  }
  const draftWallPolys = [...computeWallPolygons(draftSegs).values()];

  const roomDraft: Vec2[] =
    tool === 'room' && roomPts.length && hover
      ? roomMode === 'rect'
        ? [
            roomPts[0]!,
            { x: hover.point.x, y: roomPts[0]!.y },
            hover.point,
            { x: roomPts[0]!.x, y: hover.point.y },
          ]
        : [...roomPts, hover.point]
      : [];

  const px = 1 / view.scale;
  const handleWalls = selection.type === 'wall' ? walls.filter((w) => selectedIds.has(w.id)) : [];
  const dimWalls = showAllDimensions
    ? walls
    : walls.filter((w) => selection.type === 'wall' && selectedIds.has(w.id));
  const levelWallIds = new Set(walls.map((w) => w.id));
  const openings = project.openings.filter((o) => levelWallIds.has(o.wallId));
  const wallById = new Map(walls.map((w) => [w.id, w]));

  const cursor = panning
    ? 'grabbing'
    : spaceDown
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair';
  const box = drag?.kind === 'box' ? drag : null;

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden bg-slate-100">
      <svg
        ref={(el) => {
          planSvgRef.current = el;
        }}
        data-testid="plan-canvas"
        className="h-full w-full touch-none select-none"
        style={{ cursor }}
        role="img"
        aria-label="2D floor plan"
        onPointerDown={(e) => inter.onPointerDown(e.nativeEvent)}
        onPointerMove={(e) => inter.onPointerMove(e.nativeEvent)}
        onPointerUp={(e) => inter.onPointerUp(e.nativeEvent)}
        onPointerCancel={(e) => inter.onPointerUp(e.nativeEvent)}
        onPointerLeave={inter.onPointerLeave}
        onDoubleClick={inter.onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <Grid view={view} size={size} />
          <ShellLayer footprint={project.shell.footprint} />

          {ghostPolys.map((poly, i) => (
            <polygon
              key={i}
              points={pts(poly)}
              fill="none"
              stroke="#94a3b8"
              strokeOpacity={0.55}
              strokeDasharray="4 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}

          {previewRooms ? (
            <RoomsLayer
              rooms={previewRooms}
              selected={new Set()}
              view={view}
              units={units}
              labels={false}
            />
          ) : (
            <RoomsLayer
              rooms={rooms}
              selected={selection.type === 'room' ? selectedIds : new Set()}
              view={view}
              units={units}
            />
          )}

          {walls.map((w) => {
            const poly = wallPolys.get(w.id);
            if (!poly) return null;
            const sel = selection.type === 'wall' && selectedIds.has(w.id);
            return (
              <polygon
                key={w.id}
                points={pts(poly)}
                fill={sel ? '#0284c7' : WALL_FILL[w.type]}
                stroke={sel ? '#0c4a6e' : '#0f172a'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {openings.map((o) => {
            const w = wallById.get(o.wallId)!;
            const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
            const ux = (w.end.x - w.start.x) / len;
            const uy = (w.end.y - w.start.y) / len;
            const c = { x: w.start.x + ux * o.offset, y: w.start.y + uy * o.offset };
            const ang = (Math.atan2(uy, ux) * 180) / Math.PI;
            const th = w.thickness + 0.02;
            return (
              <g
                key={o.id}
                transform={`translate(${c.x} ${c.y}) rotate(${ang})`}
                pointerEvents="none"
              >
                <rect
                  x={-o.width / 2}
                  y={-th / 2}
                  width={o.width}
                  height={th}
                  fill={o.kind === 'window' ? '#bae6fd' : '#ffffff'}
                  stroke="#0f172a"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {o.kind === 'window' && (
                  <line
                    x1={-o.width / 2}
                    x2={o.width / 2}
                    y1={0}
                    y2={0}
                    stroke="#0369a1"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          })}

          <ColumnsLayer
            columns={columns}
            view={view}
            selected={selection.type === 'column' ? selectedIds : new Set()}
          />

          {dimWalls.map((w) => (
            <DimensionLabel
              key={`d${w.id}`}
              a={w.start}
              b={w.end}
              offset={w.thickness / 2 + 12 * px}
              view={view}
              units={units}
            />
          ))}

          {handleWalls.flatMap((w) =>
            [w.start, w.end].map((p, i) => (
              <circle
                key={`${w.id}${i}`}
                cx={p.x}
                cy={p.y}
                r={5 * px}
                fill="#fff"
                stroke="#0284c7"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )),
          )}

          {/* Drawing previews */}
          {draftWallPolys.map((poly, i) => (
            <polygon
              key={i}
              points={pts(poly)}
              fill="#0ea5e9"
              fillOpacity={0.45}
              stroke="#0284c7"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
          {draftChain.slice(0, -1).map((a, i) => (
            <DimensionLabel
              key={`c${i}`}
              a={a}
              b={draftChain[i + 1]!}
              offset={project.settings.defaultWallThickness / 2 + 12 * px}
              view={view}
              units={units}
            />
          ))}
          {roomDraft.length > 1 && (
            <>
              <polygon
                points={pts(roomDraft)}
                fill="#0ea5e9"
                fillOpacity={0.15}
                stroke="#0284c7"
                strokeWidth={2}
                strokeDasharray="6 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              {roomDraft.map((a, i) => (
                <DimensionLabel
                  key={`r${i}`}
                  a={a}
                  b={roomDraft[(i + 1) % roomDraft.length]!}
                  offset={12 * px}
                  view={view}
                  units={units}
                />
              ))}
            </>
          )}
          {measure && (
            <g pointerEvents="none">
              {(() => {
                const b = measure.b ?? hover?.point;
                if (!b) return null;
                return (
                  <>
                    <line
                      x1={measure.a.x}
                      y1={measure.a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#e11d48"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle cx={measure.a.x} cy={measure.a.y} r={4 * px} fill="#e11d48" />
                    <circle cx={b.x} cy={b.y} r={4 * px} fill="#e11d48" />
                    <DimensionLabel
                      a={measure.a}
                      b={b}
                      offset={12 * px}
                      view={view}
                      units={units}
                      color="#be123c"
                    />
                  </>
                );
              })()}
            </g>
          )}
          {box && (
            <rect
              x={Math.min(box.a.x, box.b.x)}
              y={Math.min(box.a.y, box.b.y)}
              width={Math.abs(box.b.x - box.a.x)}
              height={Math.abs(box.b.y - box.a.y)}
              fill="#0ea5e9"
              fillOpacity={0.12}
              stroke="#0284c7"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {/* Snap indicator */}
          {snapResult && snapResult.kind !== 'none' && tool !== 'select' && (
            <SnapMarker kind={snapResult.kind} at={snapResult.point} px={px} />
          )}
          {drag && snapResult && snapResult.kind !== 'none' && tool === 'select' && (
            <SnapMarker kind={snapResult.kind} at={snapResult.point} px={px} />
          )}
          {tool === 'wall' &&
            chain.length > 0 &&
            hover &&
            ['angle', 'parallel', 'perpendicular'].includes(hover.snap.kind) && (
              <line
                x1={chain[chain.length - 1]!.x}
                y1={chain[chain.length - 1]!.y}
                x2={hover.point.x}
                y2={hover.point.y}
                stroke="#f59e0b"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
        </g>
      </svg>

      <PlanToolbar />

      {level && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-slate-600 shadow-sm">
          {level.name}
          {level.locked && ' 🔒'}
        </div>
      )}
      {tool === 'wall' && chain.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-slate-800/90 px-3 py-1.5 text-sm text-white shadow">
          {typed
            ? `${t('hud.length')}: ${typed}${typedPt ? ` (${formatLength(Math.hypot(typedPt.x - chain[chain.length - 1]!.x, typedPt.y - chain[chain.length - 1]!.y), units)})` : ''}`
            : t('hud.lengthHint')}
        </div>
      )}
      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white shadow"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function SnapMarker({ kind, at, px }: { kind: string; at: Vec2; px: number }) {
  const r = 6 * px;
  const common = {
    fill: 'none',
    stroke: '#f59e0b',
    strokeWidth: 2,
    vectorEffect: 'non-scaling-stroke' as const,
    pointerEvents: 'none' as const,
  };
  if (kind === 'endpoint')
    return <rect x={at.x - r} y={at.y - r} width={r * 2} height={r * 2} {...common} />;
  if (kind === 'midpoint')
    return (
      <polygon
        points={`${at.x},${at.y - r} ${at.x + r},${at.y + r} ${at.x - r},${at.y + r}`}
        {...common}
      />
    );
  if (kind === 'grid')
    return <circle cx={at.x} cy={at.y} r={2.5 * px} fill="#f59e0b" pointerEvents="none" />;
  return <circle cx={at.x} cy={at.y} r={r} {...common} />;
}
