import { polygonBounds } from '../geometry/polygon';
import { snap, type SnapResult } from '../geometry/snap';
import { type Vec2, dist, length, normalize, scale, add, sub } from '../geometry/vec';
import { MIN_WALL_LENGTH } from '../model/integrity';
import * as ops from '../model/ops';
import { ModelError } from '../model/ops';
import { NO_SELECTION, edit, useModel } from '../model/store';
import type { Selection } from '../model/types';
import { parseLength } from '../ui/units';
import { useDraft } from './draftStore';
import { carriedId, useCatalogDrag } from '../catalog/dragStore';
import {
  deleteSelectedCatalog,
  evaluateOpeningMove,
  freePoint,
  moveItemTo,
  placeCatalogEntry,
  slideOpening,
  updateCatalogHover,
} from '../catalog/actions';
import { getEntry, itemSize } from '../catalog';
import { placeExistingItem, snapAngle } from '../catalog/placement';
import { boxSelect, hitTest, type ItemBox, type OpeningBox } from './hit';
import { openingFrame } from './symbols';
import { computeEndpointMove, computeWallMove, wallsOnRoomOutline } from './moves';
import { usePlanStore } from './planStore';
import { fitBounds, panBy, toWorld, zoomAt } from './view';

const SNAP_PX = 10;
const DRAG_START_PX = 3;

function activeLevel() {
  const { project, activeLevelId } = useModel.getState();
  return project.levels.find((l) => l.id === activeLevelId);
}

function toast(message: string) {
  usePlanStore.getState().setToast(message);
  setTimeout(() => {
    if (usePlanStore.getState().toast === message) usePlanStore.getState().setToast(null);
  }, 3500);
}

/** Runs an edit on the active level, turning model-rule violations into a friendly on-canvas message. */
function tryEdit<T>(
  fn: (p: ReturnType<typeof useModel.getState>['project'], levelId: string) => T,
): T | undefined {
  const level = activeLevel();
  if (!level) return undefined;
  if (level.locked) {
    toast(`"${level.name}" is locked. Unlock it in the Levels panel to edit.`);
    return undefined;
  }
  try {
    return edit((p) => fn(p, level.id));
  } catch (e) {
    toast(e instanceof ModelError ? e.message : 'Something went wrong with that edit.');
    return undefined;
  }
}

function levelData() {
  const { project, activeLevelId } = useModel.getState();
  const walls = project.walls.filter((w) => w.levelId === activeLevelId);
  const wallIds = new Set(walls.map((w) => w.id));
  const items: ItemBox[] = [];
  for (const it of project.items) {
    if (it.levelId !== activeLevelId) continue;
    const entry = getEntry(it.catalogId);
    const size = entry ? itemSize(entry, it.scale) : { w: 0.5, d: 0.5, h: 0.5 };
    items.push({ id: it.id, position: it.position, rotation: it.rotation, w: size.w, d: size.d });
  }
  const openings: OpeningBox[] = [];
  for (const o of project.openings) {
    if (!wallIds.has(o.wallId)) continue;
    const wall = walls.find((w) => w.id === o.wallId)!;
    const f = openingFrame(o, wall);
    openings.push({
      id: o.id,
      center: f.center,
      angle: (f.angle * Math.PI) / 180,
      width: o.width,
      thickness: wall.thickness,
    });
  }
  return {
    project,
    walls,
    rooms: project.rooms.filter((r) => r.levelId === activeLevelId),
    columns: project.columns.filter((c) => c.levelId === activeLevelId),
    items,
    openings,
  };
}

function snapAt(raw: Vec2, opts: { anchor?: Vec2; exclude?: Set<string> } = {}): SnapResult {
  const { project, walls } = levelData();
  const { view, snapEnabled, gridSize } = usePlanStore.getState();
  const fp = project.shell.footprint;
  const segments = [
    ...walls.filter((w) => !opts.exclude?.has(w.id)),
    ...fp.map((p, i) => ({ start: p, end: fp[(i + 1) % fp.length]! })),
  ];
  return snap(raw, {
    enabled: snapEnabled,
    gridSize,
    tolerance: SNAP_PX / view.scale,
    segments,
    anchor: opts.anchor,
  });
}

const sel = (type: Selection['type'], ids: string[]): Selection =>
  ids.length ? { type, ids } : NO_SELECTION;

export function finishWallChain(): void {
  const { chain } = useDraft.getState();
  if (chain.length >= 2) {
    const ids = tryEdit((p, level) => ops.addWallChain(p, level, chain));
    if (ids?.length) useModel.getState().setSelection(sel('wall', ids));
  }
  useDraft.getState().reset();
}

function finishPolygonRoom(): void {
  const { roomPts } = useDraft.getState();
  if (roomPts.length >= 3) commitRoom(roomPts);
  useDraft.getState().reset();
}

function commitRoom(polygon: Vec2[]): void {
  const id = tryEdit((p, level) => ops.addRoomWithWalls(p, level, polygon));
  if (id) useModel.getState().setSelection(sel('room', [id]));
}

export function deleteSelected(): void {
  const { selection } = useModel.getState();
  if (!selection.type) return;
  if (selection.type === 'item' || selection.type === 'opening') {
    if (ensureEditable()) deleteSelectedCatalog();
    return;
  }
  if (selection.type === 'column')
    return toast('Structural columns are fixed and cannot be deleted.');
  tryEdit((p) => {
    if (selection.type === 'wall') ops.deleteWallsAndSync(p, selection.ids);
    else if (selection.type === 'room')
      selection.ids.forEach((id) => ops.deleteRoomWithWalls(p, id));
    else ops.deleteSelection(p, selection);
  });
  useModel.getState().setSelection(NO_SELECTION);
}

export function fitToShell(): void {
  const { size } = usePlanStore.getState();
  if (!size.w || !size.h) return;
  const b = polygonBounds(useModel.getState().project.shell.footprint);
  usePlanStore.getState().setView(fitBounds(b.min, b.max, size));
}

/** Typed-length helpers (wall tool). */
function typedEndpoint(): Vec2 | null {
  const { chain, typed, hover } = useDraft.getState();
  const anchor = chain[chain.length - 1];
  if (!anchor || !typed) return null;
  const len = parseLength(typed, useModel.getState().project.units);
  if (len === null || len < MIN_WALL_LENGTH) return null;
  // Follow an angle guide when one is active so typed lengths come out square.
  const guided = hover && ['angle', 'parallel', 'perpendicular'].includes(hover.snap.kind);
  let dir = hover ? normalize(sub(guided ? hover.point : hover.raw, anchor)) : { x: 1, y: 0 };
  if (length(dir) === 0) dir = { x: 1, y: 0 };
  return add(anchor, scale(dir, len));
}
export { typedEndpoint };

function ensureEditable(): boolean {
  const level = activeLevel();
  if (level?.locked) {
    toast(`"${level.name}" is locked. Unlock it in the Levels panel to edit.`);
    return false;
  }
  return !!level;
}

export function createInteraction(getSvg: () => SVGSVGElement | null) {
  const pointers = new Map<number, { x: number; y: number }>();
  let lastPan: { x: number; y: number } | null = null;
  let pinch: { d: number } | null = null;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = getSvg()!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const world = (e: { clientX: number; clientY: number }): Vec2 => {
    const s = local(e);
    return toWorld(usePlanStore.getState().view, s.x, s.y);
  };

  function startSelectPress(w: Vec2, raw: PointerEvent): void {
    const { selection, setSelection } = useModel.getState();
    const { view } = usePlanStore.getState();
    const { walls, rooms, columns, items, openings } = levelData();
    const hit = hitTest(w, {
      walls,
      rooms,
      columns,
      items,
      openings,
      selection,
      px: 1 / view.scale,
    });
    const shift = raw.shiftKey;
    const draft = useDraft.getState();
    if (!hit) {
      if (!shift) setSelection(NO_SELECTION);
      useDraft.setState({ drag: { kind: 'box', a: w, b: w } });
      return;
    }
    if (hit.type === 'handle') {
      useDraft.setState({
        drag: {
          kind: 'endpoint',
          wallId: hit.wallId,
          end: hit.end,
          to: walls.find((x) => x.id === hit.wallId)![hit.end],
        },
      });
      return;
    }
    if (hit.type === 'rotate') {
      useDraft.setState({ drag: { kind: 'rotate', id: hit.itemId } });
      return;
    }
    const inSel = selection.type === hit.type && selection.ids.includes(hit.id);
    if (shift) {
      if (selection.type === hit.type) {
        setSelection(
          sel(
            hit.type,
            inSel ? selection.ids.filter((i) => i !== hit.id) : [...selection.ids, hit.id],
          ),
        );
      } else setSelection(sel(hit.type, [hit.id]));
      return;
    }
    if (!inSel) setSelection(sel(hit.type, [hit.id]));
    if (hit.type === 'item') {
      const it = items.find((x) => x.id === hit.id)!;
      useDraft.setState({
        drag: { kind: 'item', id: hit.id, startRaw: w, grab: sub(w, it.position), moved: false },
      });
      return;
    }
    if (hit.type === 'opening') {
      useDraft.setState({ drag: { kind: 'opening', id: hit.id, startRaw: w, moved: false } });
      return;
    }
    if (hit.type === 'wall' || hit.type === 'room') {
      const cur = useModel.getState().selection;
      const ids = cur.type === 'wall' ? cur.ids : cur.type === 'room' ? cur.ids : [hit.id];
      const first =
        hit.type === 'wall'
          ? walls.find((x) => x.id === ids[0])?.start
          : rooms.find((x) => x.id === ids[0])?.polygon[0];
      if (draft.drag === null) {
        useDraft.setState({
          drag: {
            kind: 'move',
            startRaw: w,
            ref: first ?? w,
            ids: hit.type === 'room' ? [] : ids,
            roomId: hit.type === 'room' ? ids[0] : undefined,
            delta: { x: 0, y: 0 },
            moved: false,
            clickHit: inSel ? { type: hit.type, id: hit.id } : undefined,
          },
        });
      }
    }
  }

  function movedWallIds(
    drag: Extract<ReturnType<typeof useDraft.getState>['drag'], { kind: 'move' }>,
  ): string[] {
    const { walls, rooms } = levelData();
    if (drag.roomId) {
      const room = rooms.find((r) => r.id === drag.roomId);
      return room ? wallsOnRoomOutline(walls, room) : [];
    }
    return drag.ids;
  }

  function onPointerDown(e: PointerEvent) {
    const svg = getSvg();
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    const draftS = useDraft.getState();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      useDraft.setState({ drag: null, panning: true });
      return;
    }
    if (e.button === 1 || (e.button === 0 && draftS.spaceDown)) {
      lastPan = local(e);
      useDraft.setState({ panning: true });
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const { tool } = useModel.getState();
    const w = world(e);

    // A library item picked by tap/click: this press is its destination.
    const armed = useCatalogDrag.getState().armedId;
    if (armed) {
      placeCatalogEntry(armed, freePoint(w), { snapWalls: !e.altKey });
      useCatalogDrag.getState().setArmed(null);
      return;
    }

    if (tool === 'select') return startSelectPress(w, e);

    if (tool === 'wall') {
      const anchor = draftS.chain[draftS.chain.length - 1];
      let pt = snapAt(w, { anchor }).point;
      const typedPt = typedEndpoint();
      if (typedPt) pt = typedPt;
      if (!anchor) return void useDraft.setState({ chain: [pt], typed: '' });
      if (dist(pt, anchor) < MIN_WALL_LENGTH) return;
      const next = [...draftS.chain, pt];
      useDraft.setState({ chain: next, typed: '' });
      if (next.length >= 3 && dist(pt, next[0]!) < 1e-6) finishWallChain();
      return;
    }

    if (tool === 'room') {
      const mode = usePlanStore.getState().roomMode;
      const pts = draftS.roomPts;
      const pt = snapAt(w, { anchor: pts[pts.length - 1] }).point;
      if (mode === 'rect') {
        if (pts.length === 0) return void useDraft.setState({ roomPts: [pt] });
        const a = pts[0]!;
        if (Math.abs(pt.x - a.x) < MIN_WALL_LENGTH || Math.abs(pt.y - a.y) < MIN_WALL_LENGTH)
          return;
        commitRoom([a, { x: pt.x, y: a.y }, pt, { x: a.x, y: pt.y }]);
        useDraft.getState().reset();
      } else {
        if (pts.length >= 3 && dist(pt, pts[0]!) < 1e-6) return finishPolygonRoom();
        if (pts.length > 0 && dist(pt, pts[pts.length - 1]!) < MIN_WALL_LENGTH) return;
        useDraft.setState({ roomPts: [...pts, pt] });
      }
      return;
    }

    if (tool === 'measure') {
      const pt = snapAt(w, {
        anchor: draftS.measure && !draftS.measure.b ? draftS.measure.a : undefined,
      }).point;
      if (!draftS.measure || draftS.measure.b) useDraft.setState({ measure: { a: pt } });
      else useDraft.setState({ measure: { a: draftS.measure.a, b: pt } });
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!getSvg()) return;
    const sPos = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sPos);
    const ps = usePlanStore.getState();

    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.d > 0 && d > 0)
        ps.setView(zoomAt(ps.view, (a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d));
      pinch = { d };
      return;
    }
    if (lastPan) {
      ps.setView(panBy(ps.view, sPos.x - lastPan.x, sPos.y - lastPan.y));
      lastPan = sPos;
      return;
    }

    const w = toWorld(ps.view, sPos.x, sPos.y);
    const draft = useDraft.getState();
    const { tool } = useModel.getState();
    const anchor =
      tool === 'wall'
        ? draft.chain[draft.chain.length - 1]
        : tool === 'room'
          ? draft.roomPts[draft.roomPts.length - 1]
          : tool === 'measure' && draft.measure && !draft.measure.b
            ? draft.measure.a
            : undefined;

    const drag = draft.drag;
    if (drag?.kind === 'item') {
      const px = Math.hypot(sPos.x - toScreenX(drag.startRaw), sPos.y - toScreenY(drag.startRaw));
      if (!drag.moved && px < DRAG_START_PX) return;
      const { project } = levelData();
      const item = project.items.find((i) => i.id === drag.id);
      if (!item) return;
      const raw = freePoint(sub(w, drag.grab));
      const r = placeExistingItem(project, item, raw, { snapWalls: !e.altKey });
      useDraft.setState({
        drag: { ...drag, moved: true },
        itemPreview: r.ok
          ? {
              id: drag.id,
              raw,
              position: r.position,
              rotation: r.rotation,
              ok: true,
              messages: r.warnings,
            }
          : {
              id: drag.id,
              raw,
              position: raw,
              rotation: item.rotation,
              ok: false,
              messages: [r.message],
            },
      });
      return ps.setCursor(raw, null);
    }
    if (drag?.kind === 'opening') {
      const px = Math.hypot(sPos.x - toScreenX(drag.startRaw), sPos.y - toScreenY(drag.startRaw));
      if (!drag.moved && px < DRAG_START_PX) return;
      const { project } = levelData();
      const o = project.openings.find((x) => x.id === drag.id);
      if (!o) return;
      const r = evaluateOpeningMove(project, useModel.getState().activeLevelId, o, w);
      useDraft.setState({
        drag: { ...drag, moved: true },
        openingPreview: r.ok
          ? { id: drag.id, raw: w, wallId: r.wallId, offset: r.offset, ok: true }
          : {
              id: drag.id,
              raw: w,
              wallId: o.wallId,
              offset: o.offset,
              ok: false,
              message: r.message,
            },
      });
      return ps.setCursor(w, null);
    }
    if (drag?.kind === 'rotate') {
      const { project } = levelData();
      const item = project.items.find((i) => i.id === drag.id);
      if (!item) return;
      const rot = snapAngle(Math.atan2(-(w.x - item.position.x), w.y - item.position.y));
      useDraft.setState({
        itemPreview: {
          id: drag.id,
          raw: item.position,
          position: item.position,
          rotation: rot,
          ok: true,
          messages: [],
        },
      });
      return ps.setCursor(w, null);
    }
    if (drag?.kind === 'box') {
      useDraft.setState({ drag: { ...drag, b: w } });
      return ps.setCursor(w, null);
    }
    if (drag?.kind === 'endpoint') {
      const { walls } = levelData();
      const moved = computeEndpointMove(walls, drag.wallId, drag.end, w).map((g) => g.id);
      const s = snapAt(w, { exclude: new Set(moved) });
      useDraft.setState({
        drag: { ...drag, to: s.point },
        preview: computeEndpointMove(walls, drag.wallId, drag.end, s.point),
      });
      return ps.setCursor(s.point, s);
    }
    if (drag?.kind === 'move') {
      const px = Math.hypot(sPos.x - toScreenX(drag.startRaw), sPos.y - toScreenY(drag.startRaw));
      if (!drag.moved && px < DRAG_START_PX) return;
      const ids = movedWallIds(drag);
      const { walls } = levelData();
      const rawDelta = sub(w, drag.startRaw);
      const exclude = new Set(computeWallMove(walls, ids, { x: 0, y: 0 }).map((g) => g.id));
      const s = snapAt(add(drag.ref, rawDelta), { exclude });
      const delta = sub(s.point, drag.ref);
      useDraft.setState({
        drag: { ...drag, delta, moved: true },
        preview: computeWallMove(walls, ids, delta),
      });
      return ps.setCursor(s.point, s);
    }

    const carried = carriedId(useCatalogDrag.getState());
    if (carried) updateCatalogHover(w, e.altKey);
    const s = snapAt(w, { anchor });
    useDraft.setState({ hover: { point: s.point, raw: w, snap: s } });
    ps.setCursor(s.point, tool === 'select' ? null : s);
  }

  const toScreenX = (p: Vec2) =>
    p.x * usePlanStore.getState().view.scale + usePlanStore.getState().view.tx;
  const toScreenY = (p: Vec2) =>
    p.y * usePlanStore.getState().view.scale + usePlanStore.getState().view.ty;

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (lastPan || useDraft.getState().panning) {
      lastPan = null;
      useDraft.setState({ panning: false });
      return;
    }
    const draft = useDraft.getState();
    const drag = draft.drag;
    if (!drag) return;
    useDraft.setState({ drag: null, preview: [], itemPreview: null, openingPreview: null });
    if (drag.kind === 'item') {
      const pv = draft.itemPreview;
      if (drag.moved && pv) {
        if (pv.ok) {
          if (!ensureEditable() || !moveItemTo(drag.id, pv.raw, { snapWalls: !e.altKey })) return;
        } else toast(pv.messages[0] ?? '');
      } else if (!e.shiftKey && useModel.getState().selection.ids.length > 1) {
        useModel.getState().setSelection(sel('item', [drag.id]));
      }
      return;
    }
    if (drag.kind === 'opening') {
      const pv = draft.openingPreview;
      if (drag.moved && pv) {
        if (pv.ok) {
          if (ensureEditable()) slideOpening(drag.id, pv.raw);
        } else toast(pv.message ?? '');
      }
      return;
    }
    if (drag.kind === 'rotate') {
      const pv = draft.itemPreview;
      if (pv && ensureEditable())
        tryEdit((p) =>
          ops.rotateItem(p, drag.id, pv.rotation < 0 ? pv.rotation + Math.PI * 2 : pv.rotation),
        );
      return;
    }
    if (drag.kind === 'box') {
      const min = { x: Math.min(drag.a.x, drag.b.x), y: Math.min(drag.a.y, drag.b.y) };
      const max = { x: Math.max(drag.a.x, drag.b.x), y: Math.max(drag.a.y, drag.b.y) };
      if (max.x - min.x < 0.02 && max.y - min.y < 0.02) return;
      const picked = boxSelect(min, max, levelData());
      const cur = useModel.getState().selection;
      const merged =
        e.shiftKey && cur.type && cur.type === picked.type
          ? sel(cur.type, [...new Set([...cur.ids, ...picked.ids])])
          : picked;
      useModel.getState().setSelection(merged);
    } else if (drag.kind === 'endpoint') {
      if (draft.preview.length) tryEdit((p) => ops.setWallGeometry(p, draft.preview));
    } else if (drag.kind === 'move') {
      if (drag.moved) {
        if (draft.preview.length) tryEdit((p) => ops.setWallGeometry(p, draft.preview));
      } else if (drag.clickHit && !e.shiftKey) {
        useModel.getState().setSelection(sel(drag.clickHit.type, [drag.clickHit.id]));
      }
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const s = local(e);
    const ps = usePlanStore.getState();
    ps.setView(zoomAt(ps.view, s.x, s.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
  }

  function onDoubleClick() {
    const { tool } = useModel.getState();
    if (tool === 'wall') finishWallChain();
    else if (tool === 'room' && usePlanStore.getState().roomMode === 'poly') finishPolygonRoom();
  }

  function onPointerLeave() {
    usePlanStore.getState().setCursor(null, null);
  }

  function onKeyDown(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (
      el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable)
    )
      return;
    const store = useModel.getState();
    const draft = useDraft.getState();
    if (e.code === 'Space') {
      e.preventDefault();
      if (!draft.spaceDown) useDraft.setState({ spaceDown: true });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = store.tool;
    const drawing =
      (tool === 'wall' && draft.chain.length > 0) || (tool === 'room' && draft.roomPts.length > 0);

    // Typed exact length while drawing walls.
    if (tool === 'wall' && draft.chain.length > 0) {
      if (
        /^[0-9.,'"]$/.test(e.key) ||
        (draft.typed && /^[a-z]$/i.test(e.key) && /[cmfti]/i.test(e.key))
      ) {
        e.preventDefault();
        return useDraft.setState({ typed: draft.typed + e.key });
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (draft.typed) return useDraft.setState({ typed: draft.typed.slice(0, -1) });
        return useDraft.setState({ chain: draft.chain.slice(0, -1) });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const pt = typedEndpoint();
        if (pt) return useDraft.setState({ chain: [...draft.chain, pt], typed: '' });
        return finishWallChain();
      }
    }
    if (e.key === 'Escape') {
      if (useCatalogDrag.getState().armedId) return useCatalogDrag.getState().setArmed(null);
      if (tool === 'wall' && draft.chain.length) return finishWallChain();
      if (drawing || draft.measure) return draft.reset();
      if (store.selection.type) return store.setSelection(NO_SELECTION);
      if (tool !== 'select') store.setTool('select');
      return;
    }
    if (e.key === 'Enter' && tool === 'room' && draft.roomPts.length) return finishPolygonRoom();
    const catalogSel = store.selection.type === 'item' || store.selection.type === 'opening';
    // Furniture / door / window keys (R rotate, Delete, arrows, Ctrl+D) are handled app-wide.
    if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select' && !catalogSel) {
      e.preventDefault();
      return deleteSelected();
    }
    if (drawing) return;
    const k = e.key.toLowerCase();
    const tools = { v: 'select', w: 'wall', r: 'room', m: 'measure' } as const;
    if (k === 'r' && store.selection.type === 'item') return;
    if (k in tools) store.setTool(tools[k as keyof typeof tools]);
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') useDraft.setState({ spaceDown: false });
  }

  const MIME = 'application/x-duplex-catalog';

  function onDragOver(e: DragEvent) {
    if (!useCatalogDrag.getState().dragId && !e.dataTransfer?.types.includes(MIME)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const w = world(e);
    updateCatalogHover(w, e.altKey);
    usePlanStore.getState().setCursor(w, null);
  }

  function onDragLeave() {
    useCatalogDrag.getState().setHover(null);
  }

  function onDrop(e: DragEvent) {
    const id = e.dataTransfer?.getData(MIME) || useCatalogDrag.getState().dragId;
    useCatalogDrag.getState().setDrag(null);
    useCatalogDrag.getState().setHover(null);
    if (!id) return;
    e.preventDefault();
    const entry = getEntry(id);
    if (!entry) return;
    const w = world(e);
    placeCatalogEntry(id, entry.placement === 'wall' ? w : freePoint(w), { snapWalls: !e.altKey });
  }

  return {
    onDragOver,
    onDragLeave,
    onDrop,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onDoubleClick,
    onPointerLeave,
    onKeyDown,
    onKeyUp,
  };
}

/** The mounted plan <svg>; set by PlanCanvas via a callback ref. */
export const planSvgRef: { current: SVGSVGElement | null } = { current: null };

/** Singleton event handlers for the plan canvas. */
export const interaction = createInteraction(() => planSvgRef.current);
