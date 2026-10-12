# Architecture

## Stack
Vite + React 18 + TypeScript (strict, `noUncheckedIndexedAccess`). 3D: `three` + `@react-three/fiber` + `drei`.
State: `zustand` + `immer`, undo/redo via `zundo` (wired in prompt 2). Validation: `zod`. Styling: Tailwind CSS 3 + `lucide-react`.
Persistence: `idb-keyval` (IndexedDB). Tests: Vitest + Testing Library (unit), Playwright (e2e smoke, runs against `vite preview` on :4173).
Path alias `@/` → `src/`.

## Single source of truth
The **project JSON** (data model, prompt 2) is the only design state. The 2D plan, 3D scene, exports and AI features
read from it or write to it through store actions (all undoable). The 3D scene never holds design state of its own.
Ephemeral UI state (view mode, active tab, drawers) lives in `src/ui/uiStore.ts` and is never saved in the project.

## Units
Lengths are stored in **meters**, angles in **radians**. Conversion to metric/feet-inches happens only in the UI layer.

## Folders
| Folder | Purpose |
|---|---|
| `src/app` | App shell: `App`, `TopBar`, `LeftSidebar`, `RightSidebar`, `StatusBar` |
| `src/model` | Data model types, zod schemas, store, operations |
| `src/geometry` | Pure geometry utils (2D math, polygons, wall joins) |
| `src/plan2d` | 2D floor plan editor (`PlanCanvas`, SVG) |
| `src/scene3d` | 3D scene generation & rendering (`SceneCanvas`) |
| `src/catalog` | Drag-and-drop library (doors, windows, furniture) |
| `src/materials` | Materials & textures |
| `src/ai` | Prompt-to-model features (Ollama) |
| `src/export` | Export features |
| `src/ui` | Shared UI: `Drawer`, `uiStore` |
| `src/i18n` | Key-based translations: `en.ts` defines keys; `registerLanguage(lang, dict)` adds a language; `useT()` hook |

## Layout
Top bar (name, undo/redo, 2D/3D/Split, export) · left sidebar (Library/Levels/AI tabs) · center viewport(s) ·
right Properties panel · bottom status bar. Below the `lg` breakpoint sidebars become drawers (`ui/Drawer`).

## Adding modules
New features add a folder-scoped module that reads the project via selectors and mutates via store actions; add i18n
keys to `en.ts`; add unit tests for pure logic; extend `e2e/` for UI flows.

## Data model & store (prompt 2)
- `model/schemas.ts` (Zod) is the source of truth for types (`model/types.ts` infers them). `SCHEMA_VERSION` = 1; `migrate.ts` upgrades by `schemaVersion` then validates.
- Coordinates: plan `(x, y)` → world `(x, elevation, y)`. Level `elevation` = top of that level's floor, derived by `recomputeLevels` (below.elevation + below.floorToCeiling + this.slab).
- Stair: `position` = bottom-center of first step, `rotation` = ascent direction (0 = +x, π/2 = +y).
- `model/integrity.ts`: pure rules (min wall length, opening fit/overlap, items inside shell footprint).
- `model/ops/*`: pure functions mutating an immer draft `Project`; they throw `ModelError` on rule violations.
- `model/store.ts`: `useModel` (project, selection, activeLevelId, tool, viewMode) with immer + zundo (history = `project` only).
  `apply(fn)` / `edit(fn)` runs ALL ops in `fn` as one undoable step (this is the batch/transaction mechanism; a throw discards the whole edit).
  `loadProject` replaces the project and clears history. `undo()/redo()` also repair active level/selection.
- `persistence/`: `storage` (IndexedDB via idb-keyval, memory backend in tests), `repo` (list/save/rename/duplicate/delete), `autosave` (1 s debounce), `bootstrap` (reopen last project).
- `model/io.ts`: JSON import/export (validated). `model/sample.ts`: sample duplex in a 10 × 12 m shell.
- UI: `app/LevelsPanel`, `app/ProjectsDialog`, `app/useShortcuts` (Ctrl/Cmd+Z, +Shift+Z, Ctrl+Y). `ui/uiStore` keeps only ephemeral UI state.

## 2D plan editor (prompt 3)
- `geometry/walls.ts` `computeWallPolygons(walls, {join, miterLimit})`: wall outlines with mitred (or butt) joins at shared endpoints. Reused by 3D.
- `geometry/rooms.ts`: `detectRoomPolygons(segments)` splits centerlines at crossings/T-junctions and traces minimal faces; `matchRooms` pairs detected faces with existing rooms by overlap (IoU) so names/types survive edits. Room areas are measured on wall **centerlines**; islands (a closed loop fully inside another room) do not cut a hole in the outer room.
- `geometry/snap.ts`: endpoint → midpoint → angle (0/45/90 + parallel/perpendicular to walls) → grid snapping.
- `model/ops/plan.ts`: `syncRooms`, `addWallChain`, `addRoomWithWalls`, `setWallGeometry`, `deleteWallsAndSync`, `deleteRoomWithWalls`. Rooms are derived from walls: every wall edit re-runs `syncRooms` for the level inside the same undoable `apply`.
- `plan2d/`: `view.ts` (pan/zoom/fit/grid maths), `hit.ts` (hit testing, box select), `moves.ts` (wall/endpoint/room moves with connected walls following), `draftStore.ts` (transient drawing/drag state), `interaction.ts` (pointer + keyboard handlers, tools: V select, W wall, R room (rect/poly), M measure, Del), `planStore.ts` (view, cursor, and view prefs: snap on/off, grid size, ghost levels, all dimensions — saved in localStorage, not in the project), `layers.tsx`, `PlanCanvas.tsx`, `PlanToolbar.tsx`.
- While dragging, walls are previewed from draft state and committed in ONE `apply` on pointer-up; a wall chain is committed as one undo step on finish.
- `app/PropertiesPanel.tsx`: wall/room fields incl. multi-selection ("Mixed"); `ui/units.ts`: format/parse lengths and areas (metric or ft/in). Project `settings` now only holds `defaultWallThickness`.

## 3D generation (prompt 4)
- Geometry is generated per entity by pure functions in `scene3d/generators/*` (model → `Part`s = `BufferGeometry` + material keys + the entity a click selects). Parts are in **level-local** coordinates: plan `(x, y)` → `(x, height above the level's floor, y)`; the scene places each level group at `level.elevation`.
- Walls: wall elevation `Shape` (+ holes; doors are notches in the outline, no CSG) extruded by thickness, ends slid to the shared mitre from `computeWallPolygons`. Material groups: `[leftFace, rightFace, edges]`; for exterior walls the left/right faces are mapped to inside/outside by testing against the shell footprint.
- `generators/voids.ts`: slab openings = stair voids (only where headroom < 2 m, from `layoutStair`), `void` roofs, and doubleHeight rooms on the level below. Boolean work on plan polygons uses `polygon-clipping` (`subtractPolygons`).
- `generators/stairs.ts`: `layoutStair` (riser ≈ 0.18 m from level elevation difference, tread ≥ 0.25 m, straight/L/U/spiral, railings), `validateStair` (fits shell? headroom? comfort? skipped level?) — warnings are shown on the 3D canvas.
- `scene3d/cache.ts` `PartCache` + `sceneModel.ts` `SceneBuilder`: per-entity memoization keyed on entity identity (+ dependencies); stale geometries are disposed. `ModelScene` renders levels; `sceneStore` holds view prefs (levels shown, walls up/cut/transparent, dollhouse, doors ajar). Cut mode rebuilds walls at 1.2 m and clips trim with a plane; dollhouse hides ceilings and flat roofs.
- Clicking a mesh calls `selectFrom3d` → shared selection in `useModel` (and switches the active level), so 2D and Properties follow; selected parts are tinted and edge-outlined.
- `materials/index.ts` resolves material keys to render specs (full library comes in a later prompt).
