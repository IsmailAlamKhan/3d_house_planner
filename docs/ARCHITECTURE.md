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

## Module map (final)

| Folder                                   | Purpose                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app`                                | Shell: `App`, `TopBar`, sidebars, panels, dialogs, `ErrorBoundary`, `HistoryPanel`                                                              |
| `src/model`                              | Zod schemas/types, `store` (zustand + immer + zundo), `ops/*` (every edit), migration, sample project                                           |
| `src/geometry`                           | Pure 2D math: polygons, wall joins, room detection (`rooms.ts`), snapping                                                                       |
| `src/plan2d`                             | SVG plan editor: interaction state machine, hit-testing, symbols                                                                                |
| `src/scene3d`                            | Pure generators → `SceneBuilder` (cached parts) → R3F scene; `camera/` (orbit, walk, top, sections, isolation, measure, minimap); `clipping.ts` |
| `src/catalog`                            | 49 procedural items with 2D/3D builders, placement rules, library panel                                                                         |
| `src/materials`                          | Material library, procedural textures, picker helpers                                                                                           |
| `src/ai`                                 | Provider abstraction, schemas, pipeline (validate + repair + fallback), layout solver, offline generator, edit ops                              |
| `src/checks`                             | Constraint rules (stairs, reachability, windows, drains, areas, door swings), area schedule                                                     |
| `src/wizard`, `src/templates`            | New-project wizard and the four starter templates                                                                                               |
| `src/export`                             | PDF/SVG/DXF/GLB/OBJ/PNG/BOM/snapshot builders and the export dialog                                                                             |
| `src/viewer`                             | Second Vite entry: the read-only snapshot viewer (built to `public/viewer/`)                                                                    |
| `src/notes`, `src/options`               | Pinned notes; design options and comparison                                                                                                     |
| `src/reference`                          | Reference spec (Zod), the exact builder, project → spec export, fidelity report, walkthrough check                                              |
| `src/underlay`                           | Reference pictures: rectification maths glue, 2D layer, 3D decal, setup dialog, panel, "Compare with reference" view                            |
| `src/ai/vision`                          | "Recreate from picture": label / region extraction with a local vision model, geometry clean-up, review screen, spec builder                    |
| `src/custom`                             | The user's own `.glb` models and textures (app-server assets, `/api/assets`)                                                                    |
| `src/commands`, `src/onboarding`         | Command palette, shortcut sheet; first-run tour                                                                                                 |
| `src/prefs`, `src/i18n`, `src/theme.css` | Language/theme/motion preferences; English + Bengali; colour tokens                                                                             |
| `src/persistence`                        | IndexedDB repo, autosave, 20-version history, bootstrap                                                                                         |
| `src/pwa`, `src/platform`                | Service worker registration/install prompt; browser file-download adapter                                                                       |
| `src/perf`                               | Stress project and performance budgets (tests)                                                                                                  |
| `src/ui`                                 | `Modal`, `Drawer`, `PopoverMenu`, units, `uiStore`                                                                                              |
| `server/`                                | `/api/ai` proxy to the user's local model (dev and preview servers)                                                                             |

## Data flow

```mermaid
flowchart LR
  subgraph Inputs
    UI2D[2D plan editor] --> OPS
    LIB[Library drag/drop] --> OPS
    PROPS[Properties panel] --> OPS
    WIZ[New-project wizard] --> OPS
    AI[AI assistant] -->|validated JSON| SOLVER[Layout solver / edit ops] --> OPS
    CMD[Commands, notes, options] --> OPS
  end
  OPS["model/ops (pure, throws ModelError)"] --> STORE[(zustand store: Project JSON + undo history)]
  STORE -->|selectors| PLAN[2D SVG renderer]
  STORE --> GEN[scene3d generators + PartCache] --> R3F[R3F scene]
  STORE --> CHECKS[checks engine] --> UI[Checks panel, pins, toasts]
  STORE --> EXPORT[export builders: PDF, SVG, DXF, GLB, OBJ, BOM, snapshot]
  STORE -->|debounced| PERSIST[(IndexedDB: project + last 20 versions)]
  PERSIST -->|bootstrap, restore| STORE
  AI <-->|/api/ai, localhost only| OLLAMA[(Ollama / local server)]
  EXPORT --> FILES[Browser download]
  SW[Service worker] -.caches.-> APP[App shell + lazy chunks + viewer]
```

Rules that keep this tidy: only `model/ops` mutate the project; the AI never writes geometry (the solver does); the
3D scene and exports only read; transient state (camera, tool, dialogs) lives outside the project and is never undone.

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

## Component library (prompt 5)

- `catalog/` is a typed registry (`CATALOG`, `getEntry`, `entriesByCategory`, `openingStyles`). Each `CatalogEntry`: `catalogId`, `nameKey` (i18n), `category`, `placement` (`wall` | `floor` | `wall-mounted` | `ceiling`), `defaultSize {w,d,h}`, `props` (schema of adjustable properties) + `defaults`, `build3D(props, size, ctx)` (procedural three.js `Group`, origin bottom-centre, front = +z) and `draw2D(props, size, ctx)` (SVG symbol in metres). 49 entries in `entries/openings.tsx`, `furniture.tsx`, `kitchenBath.tsx` — all built from primitives, no assets.
- Doors/windows are `Opening`s (new `props` field for style options such as frame colour; `catalogId` is the style). Everything else is an `Item` whose size is `defaultSize × scale` (x = width, y = height, z = depth) and whose `props` hold colours/variants. Unknown ids fall back to the default style for the opening kind.
- Doors and windows in 3D are catalog models positioned on the wall (`generators/openings.ts`); furniture is `generators/items.ts`. Both produce `ObjectPart`s (a positioned `Object3D`) next to the baked-geometry `Part`s; selection tint / clipping create shared material variants (`scene3d/objectView.ts`).
- `catalog/placement.ts` (pure, tested): `placeOnWall` (nearest wall, fit/height/overlap checks, nudges next to neighbours up to one width, dimensions to both corners), `placeItem` (15° rotation snap, back-to-wall snapping with the front facing into the room, wall-mounted must be on a wall, ceiling items hang from the ceiling, must stay inside the shell, non-blocking clearance warnings vs other items / columns / walls). `catalog/actions.ts` applies results to the store (`placeCatalogEntry`, `moveItemTo`, `slideOpening`, rotate/nudge/duplicate/delete) as single undo steps; messages go through `i18n.tf`.
- Library UI (`catalog/LibraryPanel.tsx`): category tabs + search; cards drag with HTML5 DnD (`dragStore.dragId`) or tap to “arm” (`armedId`) then tap/click the destination (touch friendly). Thumbnails are rendered once from `build3D` by one shared WebGL renderer (`thumbnails.ts`) and cached; no-WebGL falls back to a letter tile.
- 2D (`plan2d/interaction.ts`, `symbols.tsx`, `hit.ts`): items/openings drawn with `draw2D`, hit-tested before walls, dragged with live ghost + messages, rotate handle (15° steps), ghost with distance-to-corner dimensions while carrying a door/window. 3D (`scene3d/DropTarget.tsx`, `pick.ts`): drop/click raycasts to the active level's floor (wall surface for doors/windows); drei `TransformControls` move/rotate gizmo on a single selected item (`sceneStore.gizmoMode`).
- App-wide keys (`app/useManipulationShortcuts.ts`): R rotate 90° (Shift+R back), Ctrl/Cmd+D duplicate, arrows nudge 5 cm (Shift 25 cm; slides doors along walls), Delete, Esc cancels a carried item. Properties for items/openings: `app/CatalogProps.tsx`.
- `window.__duplex.getProject()` is a read-only debug hook used by e2e tests.

## Materials, textures & lighting (prompt 6)

- `materials/library.ts`: `MATERIALS` (id, `nameKey`, categories floor/wall/ceiling/surface, colour, procedural `texture` kind, `textureScale` = metres covered by one repeat, roughness/metalness). Custom paint is any id of the form `paint:#rrggbb`. Generator keys (`slab`, `frame`, …) are internal ids. `resolveDef/resolveMaterial` map any id (incl. unknown → flat grey) to a render spec; `project.materials` overrides still apply.
- `materials/textures.ts`: canvas-painted, seamless, seeded textures (wood planks light/dark, herringbone-style parquet, square/subway/large tiles, marble, concrete, carpet, brick, slats, wallpaper stripes/damask/dots, laminate, brushed metal), cached; `repeat = 1 / textureScale`. No canvas (tests) → flat colour.
- **Real-world UVs**: generators emit UVs in metres (ShapeGeometry/ExtrudeGeometry coordinates for floors, ceilings, slabs and wall faces; `boxProjectUV` for furniture), so a tile is the same size on every wall/room (tested).
- Picking: `app/MaterialPicker.tsx` swatch grid in Properties for wall inside/outside faces, room floor/ceiling and a furniture item's main surface (`props.material`, swaps the item's main colour for a textured library material). Shortcuts: `paintRoomWalls` (room-facing face of every wall around the room), `paintLevelWalls/Floors/Ceilings`. Left/right of a wall maps to inside/outside via `insideSign` (`model/integrity`).
- Eyedropper tool (`I`, 2D and 3D toolbars): first click copies a surface's material (`materials/eyedropper.ts`, `Surface` = wall face | floor | ceiling | item), further clicks paint it; Alt+click copies again; each paint is one undo step.
- Lighting (`scene3d/lighting.ts`, pure + tested): `sunAt(time, compass)` (east 06:00 → south 13:00 → west 20:00, warm when low), `moonAt`, `skyFor`, presets Morning/Noon/Evening/Night (`interiorLightsOn` for evening/night). Compass is `project.settings.compass` (undoable); time/preset/quality/FPS are view prefs in `sceneStore`. `scene3d/SceneLights.tsx`: sun with shadows, hemisphere sky light, local `RoomEnvironment` PMREM (no network), vertex-gradient sky dome, point lights for lamp items (`CatalogEntry.lamp`, emissive lamp meshes marked `userData.lamp`) limited by quality.
- Quality (`scene3d/quality.ts`): Low (no shadows/AA/AO, 4 lamps), Medium (1024 shadows, env, 8 lamps), High (2048 shadows, SSAO via lazy `AmbientOcclusion` chunk, 12 lamps, 2 shadow lamps); `Auto` uses `detectQuality` (GPU string, cores, memory, touch). Changing quality remounts the canvas (AA is fixed at context creation). Optional FPS readout in the Light & quality popover.

## AI assistant (prompt 7)

- **Never raw geometry.** The model only produces a `DesignIntent` (levels → rooms with type, name, target area, min width, adjacency `door|open`, exterior-wall preference, plumbing, `above`) or an `EditResponse` (list of `EditOperation`s). Both are Zod schemas in `ai/schemas.ts`; `jsonSchemaOf` uses Zod 4's built-in `z.toJSONSchema` (so `zod-to-json-schema` is not needed) and is passed to Ollama as `format` / OpenAI `response_format`.
- **Providers** (`ai/provider.ts`): `LLMProvider.generate(req) → text`. Ollama (default `qwen3:14b`, `/api/chat`, `stream:false`, `think:false`, temperature 0.2, `num_ctx` 8192) and OpenAI-compatible (LM Studio / llama.cpp) both go through the app's own `POST /api/ai`; the browser never contacts Ollama. `server/aiProxy.ts` (Node handler, reused by prompt 13's server) takes an envelope `{target, baseUrl?, path, method?, body?}`, allow-lists `/api/chat` `/api/tags` (Ollama) and `/chat/completions` `/models` (OpenAI-compatible, private hosts only), limits bodies to 1 MB, 180 s timeout, and queues generations one at a time. A small Vite plugin mounts it on dev and preview servers. Settings (provider, model, base URL) are in `ai/provider.ts` (`useAiSettings`, localStorage) with a "Test connection" that lists installed models.
- **Pipeline** (`ai/pipeline.ts`): compact prompt (`ai/prompts.ts`: rules + 2 examples + project summary from `ai/summary.ts`, never the project JSON) → model → strip fences/`<think>` → Zod validate → on failure ONE repair round-trip with the errors → otherwise fall back. `ProviderUnreachable`/`ProviderError`/`AiOutputError` all end in the offline generator (or the rule-based edit reader) with a plain-language note; abort is propagated, never turned into a fallback. Unvalidated output never reaches the project.
- **Offline generator** (`ai/offline.ts`): keyword rules (counts, number words, "for N people", open-plan, study, utility, balcony, en-suite, style words, stair type) → `DesignIntent`; deterministic variations. `ai/offlineEdit.ts`: regexes for the common edit commands.
- **Layout solver** (`ai/layout/`, deterministic, seeded): `solveLayout(intent + shell facts) → LayoutPlan`. Largest inner rectangle of the shell; stair hall placed in a corner near the entrance (same rectangle on every level, stair centred in it, void comes from the stair); remainder split into ≤ 2 rectangles; rooms ordered by an adjacency chain (plus seeded shuffles) and tiled by a squarified treemap; candidates scored for min widths, aspect, unmet adjacency, windows/exterior walls, wet rooms near plumbing, stacked bathrooms, reachability; best wins. Areas are scaled/capped per room type; partitions snap onto structural columns when it keeps rooms wide enough. Then merged wall segments, doors (requested + a reachability tree that keeps bedrooms private), archways for open-plan links, entrance door, windows, default furniture (`furnish.ts`, collision/door-swing aware) and plain-language warnings for anything unmet. `applyPlan` writes it into the project inside ONE store `apply` (keeps shell + columns, repeats columns per level) and re-detects/names rooms.
- **Edits** (`ai/edit/`): `lookup.ts` (fuzzy room/level/material/catalog resolution), `walls.ts` (`moveWallLine`: pushes a whole straight wall; walls ending on it follow so rooms stay closed; refuses outer walls, tiny rooms, doors that no longer fit), `apply.ts` (`applyEditOps` — resize/move/add/remove/rename/material/items/openings/stair), `diff.ts` (`describeChanges` → "Living room 42.0 → 49.0 m²", "Move the wall between … by 1.0 m"). The UI previews on a copy (`produce`) and applies via one `store.apply` = one undo step; any error aborts everything.
- **UI** (`ai/AiPanel.tsx`, `aiStore.ts`, `AiSettingsPanel.tsx`, `PlanThumb.tsx`): provider/model status, Design | Edit modes, example chips, "Add furniture", Generate / "Generate 3 variations" (sequential, each result appears when ready; a dead model is not retried for the remaining variations), elapsed time + Cancel, option cards with level thumbnails, notes and Apply / Discard; edit preview with Apply / Discard.

## Duplex features (prompt 8)

- `src/wizard/shell.ts` (pure): `footprintOf`, `validateFootprint`, `planHeights`, `projectFromConfig`, `addFacadeWindows` (locked openings from `shell.windows`); `ShellWizard.tsx` is the 4-step UI opened from "New project" (`uiStore.wizardOpen`); `finish.ts` lays a template into the shell.
- `src/templates/`: four `DesignIntent`s solved by `solveLayout` (so they adapt to any shell).
- `src/checks/`: pure `runChecks(project)` → `CheckIssue[]`; `areaSchedule`; `focusIssue` selects, switches level/view and flashes the target; `isVoidRoom` excludes "Open to below" pseudo-rooms from all rules and areas.
- Model additions: `shell.beams`, `shell.windows`, `Opening.locked` (geometry edits and delete throw `ModelError`), `settings.checks`.
- Double height: `Room.doubleHeight` → `doubleHeightVoids` (slab opening above) + `generateVoidBalustrade`; `copyWallsFromBelow` op; stairs have a 2D symbol on both levels.

## Camera & inspection (prompt 9)

- `scene3d/camera/cameraStore.ts` (transient zustand, never in the project): mode, fly request, live pose, walker, section, isolation, x-ray, measurements. Only `project.views` (saved views, with thumbnail and section) is persisted.
- Pure modules: `views.ts` (presets, top pose, easing), `walk.ts` (walk world from walls/columns/stairs/voids; `moveWalker`, `floorAt`, `spawnWalker`), `section.ts` (planes and analytic caps), `focus.ts`, `isolation.ts`, `measure.ts`, `minimapFrame.ts`.
- React/three: `CameraSystem` (orbit/top rigs, transitions, capture), `WalkRig`, `SectionRig` (caps + drag handle), `MeasureOverlay`, DOM overlays `CameraToolbar`, `SavedViewsStrip`, `Minimap`, `WalkHud`.
- `scene3d/clipping.ts`: every model material registers itself; `setSectionPlanes` updates their `clippingPlanes` (the sky/grid stay unclipped).
- The scene hides nothing in walk mode (all levels, walls up); isolation/x-ray decide per-part ghosting in `ModelScene`.
- `window.__duplex.getCamera()` is a read-only test hook like `getProject()`.

## Export & sharing (prompt 10)

- `src/export/`: pure builders — `planSvg.tsx` (static per-level SVG in plan metres, paper-sized strokes; reuses the editor's symbols via `renderToStaticMarkup`), `pdf.ts` (jsPDF; `Placement` records every drawing's size in mm), `dxf.ts`, `model3d.ts` (GLB via GLTFExporter, OBJ/MTL writer), `bom.ts` (quantities, pricing, CSV), `snapshot.ts` (self-contained HTML).
- `bridge.tsx` registers a capture function from inside the Canvas; `scene.ts` opens the 3D view if needed (`withScene`) and takes the hero picture; `flags.ts` switches presentation/transparent looks.
- `ExportDialog.tsx` (tabs: Images, PDF plans, 3D model, Plan files, Costs, Share). Unit costs live in `project.costs` and change through `setUnitCost`/`setCurrency` ops (undoable, saved with the project).
- Snapshot viewer: `src/viewer/` is a second Vite entry (`vite.viewer.config.ts`, IIFE + CSS) built into `public/viewer/`; `fetchViewerBundle()` loads it at export time and `buildSnapshotHtml` inlines it with the project JSON.

## Polish & accessibility (prompt 11)

- `src/prefs/prefsStore.ts`: language/theme/motion/tourSeen (localStorage) applied to `<html>` (`lang`, `data-theme`, `data-motion`). Colours are CSS variables in `src/theme.css`, mapped into Tailwind in `tailwind.config.js`.
- `src/ui/Modal.tsx` is the one accessible dialog (used by every dialog and the drawers/bottom sheets); `modalOpen()` makes global shortcuts stand down.
- `src/commands/`: command registry + palette, shortcut sheet data, key formatting. `src/onboarding/`: tour.
- `src/notes/` and `src/options/`: pinned notes; design options (`project.options` + `currentOption`, ops in `model/ops/options.ts`; the compare dialog renders projects through `SceneProjectProvider`).
- i18n: `bn.ts` must contain every `en.ts` key; `ModelError` carries a translation key so `e.message` follows the language; `fmtNum` formats numbers per locale.

## Villa & site mode (prompt 15)

- Model: `project.kind` (`apartment` | `villa`, default `apartment`) and `project.site` = `{ plot, gates, zones, setback }`. Both have Zod defaults, so older files load unchanged (no schema-version bump; covered by a migration test). A zone is `{ id, name, type, polygon, material, covered }`; a gate is `{ id, kind, position, direction, width }`. In a villa `shell.footprint` is the **building outline** inside the plot; items may stand anywhere on the plot (`model/integrity.ts: itemArea`).
- Ops: `model/ops/site.ts` (`setPlot`, zone/gate add/update/delete, `snapToPlot`, `buildingWithinSetback`); delete/duplicate/notes cover `zone` and `gate`. All inside `store.apply`, so undo/redo works.
- 2D: `plan2d/SiteLayer.tsx` draws the plot, zones (type colours, name + area) and gates _beneath_ the building; the Levels panel has a "Site" row to hide/lock it; tools `plot`, `zone`, `gate` in `PlanToolbar` + `interaction.ts` (snapping like walls); `fitToShell` frames the whole plot for villas.
- 3D: `scene3d/generators/site.ts` (pure): ground (grass, with the pools cut out) and a lower surround, zone surfaces, pool (water below the rim, tiled basin, coping), pergola / roof for covered zones, plot fence with gaps and pillars at the gates, gate leaves. `SceneBuilder.build` returns the level scenes plus `.site` (cached in `PartCache`); `ModelScene` renders it; `export/model3d.ts` adds it to GLB/OBJ.
- Catalog: category `outdoor` (`catalog/entries/outdoor.tsx`): trees, shrub, hedge, flower bed, lounge/dining sets, sun lounger, trampoline, play frame, fountain, pergola, parasol, BBQ, car, garden light (lamp), pool ladder, car-bay marking; interiors: treadmill, gym bench, squat rack, sauna bench, hot tub, gaming desk, theatre sofa + screen, closet shelving. Materials: grass, water, paving stone, decking, gravel, pool tile (`ground` category).
- Look: lighting preset **Marketing render** (golden hour, every lamp on; lamps beyond the point-light cap still glow emissively) and camera preset **Plan view** (near top-down + dollhouse).
- Checks (`checks/site.ts`, villas only): setback / building inside plot, vehicle gate → parking zone with room for the planned cars (2.7 × 5.2 m each), pedestrian gate → entrance by a path, pool barrier within 1.2 m, garage opening to the outside.
- AI: `DesignIntent` gained `strategy` (`duplex` | `wings`) and `site` (zones with a `side` relative to the entrance, `cars`). `ai/offlineVilla.ts` reads villa briefs; the solver's **wings strategy** (`solve.ts: wingsCandidate`) fixes a foyer at the front and a central hall and tiles the rest into two wings; bedrooms with an attached bath/closet are laid out as one block and split (`groupSuites`/`expandSuites`). `ai/layout/site.ts: planSite` places zones in the strips around the building (path + pedestrian gate on the entrance axis, vehicle gate by the parking zone) and furnishes them; `applyPlan` writes the zones/gates/items. Template `VILLA_TEMPLATE` ("Luxury villa") in `templates/`.
- Wizard: "Apartment / duplex" or "Villa on a plot" (plot size, rectangle/L/U/custom building, 1–3 storeys); the building is placed towards the back of the plot, the entrance faces the front, and a pedestrian gate + path are created.

## Presentation renders (prompt 15)

- `src/present/` is transient UI state plus pure helpers; nothing in it is saved in the project except what the actions change (items from auto-decorate, parapet wall heights).
  - `presentStore.ts` (zustand; look, accent, effects and label style persist in localStorage), `presets.ts` (`cutawayPose` frames one level for the top-down and 3/4 cutaways; `lightingFor` maps Dusk / Daylight / Night to lighting modes), `actions.ts` (`enterPresent` sets dollhouse + cut walls + level isolation, flies the camera and remembers what to restore; `exitPresent`).
  - Labels: `labels.ts` (pure: `roomLabels`, `roomDimensions` in feet-inches or metres, `projectLabels` with a camera's projection × view matrix, `drawLabels` on a 2D canvas). Labels are a **vector overlay** (`LabelsOverlay`, fed by `LabelsProjector` inside the Canvas) and are composited again on exported pictures (`render.ts: composePicture`), never part of the 3D scene.
  - Look: `PresentationFx` (postprocessing: SSAO, bloom on emissive lamps, ACES tone mapping, vignette, SMAA; shared with exports through `fxBridge`), `AccentLights` (soft ceiling glow in rooms without a lamp, under wall cabinets, path lights; within the quality light budget), lighting preset `dusk` (blue hour, all lamps on).
  - Stills: `export/bridge.tsx` `captureScene` takes `fx` (render through the composer) and `pathTrace` (progressive `three-gpu-pathtracer`, `present/pathTrace.ts`; cancellable; any failure falls back to the normal render and says so). `three-mesh-bvh` is pinned to 0.9.16 through an npm `overrides` entry because the path tracer needs ≥ 0.9.15 and drei asks for 0.7.
  - Export: `render.ts` captures at 1×/2×/4×, optional transparent background, labels on/off, and always draws the footer "Design render — indicative only".
- Decor catalog (`catalog/entries/decor.tsx`, category `decor`, plus `outdoor` additions): plants in 3 sizes × 4 species, wall art, table lamp, vase/bowl, TV wall unit, spa tub, planter box, small tree, grass patch, fire pit, plunge pool (organic/rect), balustrade, pedestrian and sliding vehicle gates; rugs gained patterns.
- Room type `outdoor` (terrace, balcony, garden): no ceiling (`generateRoomCeiling`), outdoor floor materials, and `setRoomParapet` turns the walls around it into a 1 m parapet (undoable).
- `present/decorate.ts: autoDecorateProject` places decor per room through the normal placement rules (clearances respected, skips rooms that already have each kind) inside one `apply`, so it is one undo step.

## AI image enhancement with ComfyUI (prompt 16)

- Server: `server/gpuQueue.ts` is the **one GPU queue** for both AI design jobs (`/api/ai`, `aiProxy.ts`) and render jobs; strictly one at a time. A render is preceded by `unloadOllama` (`/api/ps` + `keep_alive: 0`) and followed by ComfyUI `/free`. `server/render/` holds `comfy.ts` (the only ComfyUI endpoints used: `/upload/image`, `/prompt`, `/history`, `/view`, `/free`, `/interrupt`, `/system_stats` and the progress websocket — opened _before_ the prompt is queued), `workflow.ts` (fills the versioned template `server/comfy/workflows/enhance_sdxl.json`: img2img + depth ControlNet, optional canny ControlNet and 1.5× second pass), `renderApi.ts` (`/api/render/enhance`, `/jobs/:id`, `/results[...]`, re-run). `/api/health` reports `render: {configured, reachable}`.
- Storage: `<DATA_DIR>/renders/<id>/{meta.json, before.png, depth.png, edge.png, result.png}` (parameters, seed, camera and labels in `meta.json`).
- Browser (`src/render/`): `protocol.ts` (Zod schemas shared with the server), `promptBuilder.ts` (+ 5 style presets), `enhance.ts` (renders colour/depth/edge passes of the _same camera_ through `captureScene({pass, longSide})`; `present/passes.ts` swaps materials for a normalised-depth or normal material while keeping each mesh's clipping planes), `edges.ts` (Sobel on normals + depth), `compose.ts` (re-applies vector labels with the stored camera matrix and the "AI-enhanced" badge), `enhanceStore.ts`, `EnhanceDialog.tsx` (prompt editor, queue/progress, gallery with a before/after slider, re-run with a new seed, download, delete).
- Docker: optional compose profile `render` (`comfyui`, `comfyui-init`, volume `comfyui-models`, no published port).

## Render pipeline and lighting (prompt 17)

- **One colour pipeline for every tier** (`scene3d/RenderPipeline.tsx`): the Canvas is `flat` (renderer tone mapping off) because three.js only tone-maps when drawing to the screen; the pipeline is scene (linear, half-float) → N8AO (world-space radius 0.5 m; none / half / full resolution by tier) → bloom (emissive only) → exposure (EV slider) → **AgX tone mapping exactly once** → vignette (presentation) → FXAA (Low) / SMAA. Exports and the path tracer's fallback render through the same composer (`export/bridge.tsx`).
- **Quality tiers** (`scene3d/quality.ts`) change cost, not look: shadows on everywhere (sun map 1024 / 2048 / 4096), lamps 8 / 16 / 32 with 0 / 2 / 4 shadow-casting, window skylights 6 / 10 / 14, AO none (blobs under furniture, `ContactBlobs`) / half / full. Quality changes apply live (no remount).
- **Realistic vs design lighting** (`sceneStore.lightStyle`, `auto` = design in the split view, realistic otherwise; `L` / "Work light"): realistic interiors only get daylight through windows and lamps that are on. Mechanism: `scene3d/skyMix.ts` patches every standard material so hemisphere and environment light are multiplied by `uSkyMix` — 1 for outdoor materials (`@out` suffix on material keys: exterior wall faces, roofs, the site, garden items) and the shared _night visibility_ (default 2 %) for everything indoors; sun and lamps are untouched. Window skylights are one `RectAreaLight` per exterior window facing into its room (`windowLightSpecs`, strength from the sun's height). Ceilings, upper slabs and roofs hidden from the camera (dollhouse, cutaway, hidden levels) are drawn as **shadow-only meshes** in `ModelScene`, so they still block the sun.
- **Light fixtures**: catalog `lamp` = `{y, lumens, kelvin, beam?}`; items override `lumens` / `kelvin` / `beam` in their props. `project.lights = {master: auto|on|off, rooms, items}` is saved with the project but changed through `setLights`, which pauses undo history (and undo/redo keep the current switches). `scene3d/lights.ts` resolves item → room → master → preset (evening: living areas on, bedrooms off). Only the nearest `maxLights` emit; the rest glow. Clicking a lamp's glowing part, the room bulb button (`RoomLightButtons`), the Properties switches and "All on/off" all call `setLights`.
- **Whites**: `capAlbedo` caps linear albedo at 0.88 for library and catalog materials; warm / cool / oak whites; catalog boxes are `RoundedBoxGeometry` with ~1.4 cm bevels.
- **Debug**: `?debug=render` shows `debug/RenderDebugPanel.tsx` (every effect and light type on/off, renderer colour space / tone mapping / exposure / pipeline chain). `window.__duplex` gained `stores`, `measureLuminance` and `worldToScreen` for the visual tests (`e2e/lighting.spec.ts`, reference pictures in `tests/visual/`).

## Reference Villa: trace from the picture and build it 1:1 (prompt 18)

- **Geometry** (`geometry/homography.ts`, pure, tested): a 4-point homography (DLT, 8 × 8 solve) `rectifyFromCorners(corners, width, depth, origin)` maps picture pixels onto the plan in metres; `scaleFromTwoPoints` is the scale-only mode; `rectifyRaster` warps an RGBA raster bilinearly (alpha fades at the picture's edge).
- **Reference pictures** (`project.underlays[]`, `UnderlaySchema`): `source` is an uploaded asset on the app server (`/api/assets`, kind `image`), a copy in this browser's IndexedDB (static hosting) or a plain URL; `transform` is the homography found at setup (plus `setup` — the marked points and real size — so it can be reopened), `offset`/`rotation` are the user's fine adjustments, then `opacity`, `visible`, `locked`, `onTop`, `show3d`. `model/ops/underlay.ts` is the only way to change them (undoable; a locked picture only accepts lock/visible/opacity changes). `underlay/matrix.ts` composes Translate(offset)·RotateAbout(centre)·transform; `rectify.ts` + `useRectified` warp the picture once per setup into a cached PNG; `UnderlayLayer` draws it in the plan SVG (under or over the walls), `Decal3D` as a faint ground decal, `StatusBar` reads picture pixels under the cursor ("Measure from image").
- **Compare with reference** (`underlay/CompareView.tsx`, state in `underlay/uiStore.ts`): the straightened picture on the left, a top-down render on the right, one draggable divider. Opening it remembers and then sets the 3D look (ground floor only, roofs off, walls cut low, dusk), puts the orthographic top camera over the rectangle the picture was set up on (zoom is pixels per metre, so the picture is placed with the same rule: `left = W/2 + (x − cx) · zoom`) and shows the picture only once the camera reports that pose. Closing puts everything back.
- **Reference spec** (`reference/spec.ts`): a human-written description of a plan in feet or metres (rooms as rectangles or polygons, openings by a point on a wall, zones, gates, items and rows of items, stairs, roofs, saved views, the underlay, and `designs[]` — the first becomes the project's own design, the others design options). `Design` now also carries outdoor `zones`, `gates`, and for villas the building `footprint` and `entrance`.
- **Exact builder** (`reference/build.ts`, `buildProject`): no solver, no tiling. Walls come from the shared-edge graph of the room polygons (edges cut at every touching corner; owned by one room = exterior, by two = interior); doors snap to the nearest wall; items are placed where the spec says (ceiling and wall pieces get the library's default elevation). Everything is one project; the report lists overlaps, enclosed gaps, unreachable rooms (the checks' reachability rule), a walk from the gates (`reference/walkthrough.ts`: doors, the staircase, outdoor areas that touch) and whatever could not be placed.
- **Export and script**: `Export → Share → Reference spec (.json)` (`reference/export.ts`, `projectToSpec`); `npm run reference:build -- reference/villa.spec.json [--out file] [--server url]` builds, saves to the app server (replacing the same id) and writes `reference/FIDELITY.md` (`reference/fidelity.ts`: every room and area against its label, the picture and each option; the inventory table; the build report).
- **The villa** (`reference/villa.spec.json`, authored by `scripts/author-villa-spec.ts`, which is committed so the spec can be regenerated): Option B is _measured_ — walls are named lines read at one or more places on the picture; the four corners that straighten it are fitted so those lines come out straight; each room carries its `pic` box and `reference/villa.test.ts` maps it back through the homography and requires every edge within 0.5 ft. Option A gives each labelled room exactly its label. Both options are furnished by the same rules (124 inventory elements, the same in both), doors are moved or made pocket doors so no door swings into furniture, and the nine pieces the catalogue lacked are procedural entries in `catalog/entries/reference.tsx`.
- `public/reference/villa-reference.png` is a copy of `reference/villa-reference.png` that the app serves (`source.kind = 'url'`); the service worker does not precache it (`globIgnores`).

## Recreate from a picture (prompt 19)

- **Server** (`server/vision/visionApi.ts`): `POST /api/vision { prompt, system?, images[], schema? }` asks the one model named by `OLLAMA_VISION_MODEL` (default `qwen3-vl:8b-instruct`; the plain `qwen3-vl:8b` tag is a _thinking_ model whose hidden reasoning made every call ~200 s and ignores `think:false`). It runs as a `vision` job on the shared `GpuQueue`; `beforeSwitch` unloads Ollama's models when vision and design jobs alternate (and `beforeRender` before ComfyUI), but not between two vision calls, so a picture is read tile by tile with the model staying loaded. `/api/health` reports `vision: {model, installed}`.
- **Pipeline** (`src/ai/vision/`, the model only reads, code does the geometry): `extract.ts` = pass 1 labels (whole picture and every tile) + pass 2 boxes per overlapping tile (`assemble.ts`: tiles, tile → pixel boxes, merging duplicates and pieces cut by a tile border — a side lying on a tile edge is not trusted — label ↔ box matching with confidence); `labels.ts` parses printed sizes (`14' x 12'`, `4.2 × 3.6 m`, feet-inches) and classifies names into room / zone types; `cleanup.ts` scales, snaps near-equal edges, closes gaps, removes overlaps (rooms outrank zones) and fits rooms to their printed size (Option A) or leaves them as pictured (B); `toSpec.ts` turns rooms into a reference spec (spanning-tree doors from the foyer, entrance, windows, gate, path, roofs) for the Prompt 18 builder; `items.ts` is the optional furniture pass (names → catalogue ids); `rectifyPicture.ts` straightens with four corners (same homography as the underlay) or asks the model for the plan's outline.
- **UI**: AI tab → "Describe it" (solver, unchanged) or "Recreate from picture" → `RecreateDialog`: corners / real size (optional) → reading progress → review (picture with confidence-coloured boxes, editable list, add / remove) → Build exact / as labelled / as pictured / both. The picture is put under the plan as a reference picture; the whole build is one undo step.
- **Evaluation**: `npm run ai:eval:vision` (`scripts/ai-eval-vision.ts`, `--oracle` checks the harness, `--server` goes through `/api/vision`). Results: `reference/EVAL_VISION.md`.
