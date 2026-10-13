import { UnderlayLayer } from '../underlay/UnderlayLayer';
import { UnderlayPanel } from '../underlay/UnderlayPanel';
import { beamPolygon } from '../checks/rules';
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
import { ItemSymbol, OpeningSymbol, StairSymbol } from './symbols';
import { carriedId, useCatalogDrag } from '../catalog/dragStore';
import { getEntry, itemSize } from '../catalog';
import { rotateHandlePos } from './hit';
import { usePlanStore } from './planStore';
import { NotesLayer } from '../notes/NotesLayer';
import { SiteLayer } from './SiteLayer';
import { useUiStore } from '../ui/uiStore';

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
  const { view, size, showGhosts, showAllDimensions, roomMode, snapResult, flash } = usePlanStore();
  const {
    chain,
    typed,
    roomPts,
    measure,
    drag,
    preview,
    hover,
    spaceDown,
    panning,
    itemPreview,
    openingPreview,
    stairPreview,
  } = useDraft();
  const carried = useCatalogDrag(carriedId);
  const catalogHover = useCatalogDrag((s) => s.hover);

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
  const activeNoteId = useUiStore((s) => s.activeNoteId);
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
    const activeIndex = project.levels.find((l) => l.id === activeLevelId)?.index ?? 0;
    return project.levels
      .filter((l) => l.id !== activeLevelId && l.visible)
      .flatMap((l) => {
        const ws: WallSeg[] = project.walls.filter((w) => w.levelId === l.id);
        // The level directly below is the one to align with: draw it clearly; other levels stay faint.
        const below = l.index === activeIndex - 1;
        return [...computeWallPolygons(ws).values()].map((poly) => ({ poly, below }));
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
    (tool === 'room' || tool === 'zone' || tool === 'plot') && roomPts.length && hover
      ? tool === 'room' && roomMode === 'rect'
        ? [
            roomPts[0]!,
            { x: hover.point.x, y: roomPts[0]!.y },
            hover.point,
            { x: roomPts[0]!.x, y: hover.point.y },
          ]
        : [...roomPts, hover.point]
      : [];

  const siteVisible = usePlanStore((s) => s.siteVisible);
  const groundId = [...project.levels].sort((a, b) => a.index - b.index)[0]?.id;
  const px = 1 / view.scale;
  const handleWalls = selection.type === 'wall' ? walls.filter((w) => selectedIds.has(w.id)) : [];
  const dimWalls = showAllDimensions
    ? walls
    : walls.filter((w) => selection.type === 'wall' && selectedIds.has(w.id));
  const levelWallIds = new Set(walls.map((w) => w.id));
  const openings = project.openings.filter((o) => levelWallIds.has(o.wallId));
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const items = project.items.filter((i) => i.levelId === activeLevelId);

  // Rotate handle for a single selected item (follows the item while it is being dragged/rotated).
  const selItem =
    selection.type === 'item' && selection.ids.length === 1
      ? items.find((i) => i.id === selection.ids[0])
      : undefined;
  const selEntry = selItem ? getEntry(selItem.catalogId) : undefined;
  const rotateItem =
    selItem && selEntry
      ? (() => {
          const pose = itemPreview?.id === selItem.id ? itemPreview : selItem;
          const size = itemSize(selEntry, selItem.scale);
          return {
            pose: { position: pose.position, rotation: pose.rotation },
            handle: rotateHandlePos(
              {
                id: selItem.id,
                position: pose.position,
                rotation: pose.rotation,
                w: size.w,
                d: size.d,
              },
              px,
            ),
          };
        })()
      : null;

  // Ghost of the library item being carried: green when it can go here, red when it can't.
  const hoverEntry = carried ? getEntry(carried) : undefined;
  let ghost: React.ReactNode = null;
  let ghostMessage: string | null = null;
  if (hoverEntry && catalogHover) {
    const ev = catalogHover.evaluation;
    if (!ev.ok) {
      ghostMessage = ev.message;
      const sz = hoverEntry.defaultSize;
      ghost = (
        <g
          transform={`translate(${catalogHover.point.x} ${catalogHover.point.y})`}
          pointerEvents="none"
          opacity={0.8}
        >
          <rect
            x={-sz.w / 2}
            y={-Math.max(sz.d, 0.15) / 2}
            width={sz.w}
            height={Math.max(sz.d, 0.15)}
            fill="#dc2626"
            fillOpacity={0.2}
            stroke="#dc2626"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    } else if (ev.kind === 'wall') {
      const p = ev.placement;
      const w = wallById.get(p.wallId);
      if (w) {
        const o = {
          id: 'ghost',
          wallId: p.wallId,
          kind: hoverEntry.openingKind ?? 'door',
          catalogId: hoverEntry.catalogId,
          offset: p.offset,
          width: p.width,
          height: p.height,
          sillHeight: p.sillHeight,
          flip: false,
          swing: 'left' as const,
          props: {},
          locked: false,
        };
        const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
        const ux = (w.end.x - w.start.x) / len;
        const uy = (w.end.y - w.start.y) / len;
        const at = (d: number) => ({ x: w.start.x + ux * d, y: w.start.y + uy * d });
        const off = w.thickness / 2 + 16 * px;
        ghost = (
          <g pointerEvents="none">
            <OpeningSymbol
              opening={o}
              wall={w}
              footprint={project.shell.footprint}
              tint="#16a34a"
            />
            <DimensionLabel
              a={at(0)}
              b={at(p.offset - p.width / 2)}
              offset={off}
              view={view}
              units={units}
              color="#15803d"
            />
            <DimensionLabel
              a={at(p.offset + p.width / 2)}
              b={at(len)}
              offset={off}
              view={view}
              units={units}
              color="#15803d"
            />
          </g>
        );
        if (p.nudged) ghostMessage = null;
      }
    } else {
      const p = ev.placement;
      const synthetic = {
        id: 'ghost',
        levelId: activeLevelId,
        catalogId: hoverEntry.catalogId,
        position: p.position,
        elevation: p.elevation,
        rotation: p.rotation,
        scale: { x: 1, y: 1, z: 1 },
        props: {},
      };
      ghost = (
        <g pointerEvents="none">
          <ItemSymbol item={synthetic} tint={p.warnings.length ? '#f59e0b' : '#16a34a'} />
        </g>
      );
      if (p.warnings.length) ghostMessage = p.warnings.join(' ');
    }
  }
  const dragMessage =
    ghostMessage ??
    (itemPreview && itemPreview.messages.length
      ? itemPreview.messages.join(' ')
      : openingPreview?.ok === false
        ? (openingPreview.message ?? null)
        : null);

  const cursor = panning
    ? 'grabbing'
    : spaceDown
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair';
  const box = drag?.kind === 'box' ? drag : null;

  return (
    <div ref={boxRef} className="plan-paper relative h-full w-full overflow-hidden">
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
        onDragOver={(e) => inter.onDragOver(e.nativeEvent)}
        onDragLeave={inter.onDragLeave}
        onDrop={(e) => inter.onDrop(e.nativeEvent)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <Grid view={view} size={size} />
          <UnderlayLayer project={project} levelId={activeLevelId} onTop={false} />
          {project.kind === 'villa' && siteVisible && (
            <SiteLayer
              project={project}
              view={view}
              selected={
                selection.type === 'zone' || selection.type === 'gate' ? selectedIds : new Set()
              }
              dim={groundId !== activeLevelId}
              draft={tool === 'zone' || tool === 'plot' ? roomDraft : []}
            />
          )}
          <ShellLayer footprint={project.shell.footprint} />

          {ghostPolys.map(({ poly, below }, i) => (
            <polygon
              key={i}
              points={pts(poly)}
              fill={below ? '#cbd5e1' : 'none'}
              fillOpacity={below ? 0.35 : 0}
              stroke={below ? '#475569' : '#94a3b8'}
              strokeOpacity={below ? 0.9 : 0.4}
              strokeDasharray={below ? '6 3' : '4 3'}
              strokeWidth={below ? 1.5 : 1}
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
            const isSel = selection.type === 'opening' && selectedIds.has(o.id);
            const pv = openingPreview?.id === o.id ? openingPreview : null;
            const host = pv ? (wallById.get(pv.wallId) ?? w) : w;
            return (
              <OpeningSymbol
                key={o.id}
                opening={o}
                wall={host}
                footprint={project.shell.footprint}
                override={pv ? { offset: pv.offset } : undefined}
                tint={pv && !pv.ok ? '#dc2626' : isSel ? '#0ea5e9' : undefined}
              />
            );
          })}

          {items.map((it) => {
            const pv = itemPreview?.id === it.id ? itemPreview : null;
            const isSel = selection.type === 'item' && selectedIds.has(it.id);
            return (
              <ItemSymbol
                key={it.id}
                item={it}
                override={pv ?? undefined}
                tint={
                  pv
                    ? pv.ok
                      ? pv.messages.length
                        ? '#f59e0b'
                        : '#16a34a'
                      : '#dc2626'
                    : isSel
                      ? '#0ea5e9'
                      : undefined
                }
              />
            );
          })}

          {project.stairs
            .filter((st) => st.fromLevelId === activeLevelId || st.toLevelId === activeLevelId)
            .map((st) => (
              <StairSymbol
                key={st.id}
                project={project}
                stair={st}
                levelId={activeLevelId}
                selected={selection.type === 'stair' && selectedIds.has(st.id)}
                override={
                  stairPreview?.id === st.id
                    ? { position: stairPreview.position, rotation: st.rotation }
                    : undefined
                }
              />
            ))}

          <UnderlayLayer project={project} levelId={activeLevelId} onTop />

          {flash && (
            <rect
              key={flash.key}
              x={flash.min.x}
              y={flash.min.y}
              width={flash.max.x - flash.min.x}
              height={flash.max.y - flash.min.y}
              fill="#f59e0b"
              fillOpacity={0.18}
              stroke="#f59e0b"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              className="plan-flash"
            />
          )}

          {rotateItem && (
            <g pointerEvents="none">
              <line
                x1={rotateItem.pose.position.x}
                y1={rotateItem.pose.position.y}
                x2={rotateItem.handle.x}
                y2={rotateItem.handle.y}
                stroke="#0284c7"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={rotateItem.handle.x}
                cy={rotateItem.handle.y}
                r={7 * px}
                fill="#fff"
                stroke="#0284c7"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={`M ${rotateItem.handle.x - 3 * px},${rotateItem.handle.y} a ${3 * px},${3 * px} 0 1 1 ${3 * px},${3 * px}`}
                fill="none"
                stroke="#0284c7"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          {ghost}

          {project.shell.beams.map((b) => (
            <polygon
              key={b.id}
              data-testid="plan-beam"
              points={beamPolygon(b.start, b.end, b.width)
                .map((q) => `${q.x},${q.y}`)
                .join(' ')}
              fill="none"
              stroke="#64748b"
              strokeWidth={1.2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <NotesLayer
            project={project}
            levelId={activeLevelId}
            view={view}
            activeId={activeNoteId}
          />

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
      <UnderlayPanel />

      {tool === 'select' && walls.every((w) => w.type === 'exterior') && !items.length && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
          <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed border-slate-400 bg-white/90 p-4 text-center text-sm text-slate-700 shadow-sm">
            <p data-testid="empty-plan">{t('empty.plan')}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                className="rounded-md bg-sky-700 px-3 py-1 text-white hover:bg-sky-800"
                onClick={() => useModel.getState().setTool('wall')}
              >
                {t('empty.draw')}
              </button>
              <button
                className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100"
                onClick={() => {
                  useUiStore.getState().setLeftTab('ai');
                  useUiStore.getState().setLeftDrawerOpen(window.innerWidth < 1024);
                }}
              >
                {t('sidebar.ai')}
              </button>
            </div>
          </div>
        </div>
      )}

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
      {dragMessage && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-14 max-w-sm -translate-x-1/2 rounded-md bg-slate-800/90 px-3 py-1.5 text-center text-sm text-white shadow"
        >
          {dragMessage}
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
