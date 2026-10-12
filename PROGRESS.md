# Progress

## Deviations
- Prompt 7: Zod 4 ships `z.toJSONSchema`, so `zod-to-json-schema` is not used.
- Prompt 6: "herringbone" is a chevron-style parquet, not a true herringbone.

## Prompt 1 — Project Setup & Architecture — DONE
- [x] Scaffold, scripts, folder structure, app shell, 3D + 2D canvases, i18n, docs, tests
Summary: Vite/React/TS app with responsive shell (drawers on narrow screens), working 2D/3D/Split switching, placeholder R3F scene and SVG grid, key-based i18n, unit + Playwright smoke tests.
Limitations: Initial bundle >500 kB (three.js); code-splitting can come later.

## Prompt 2 — Core Data Model, Store, Undo/Redo, Persistence — DONE
- [x] Zod schemas/types, integrity rules, ops, batch via `apply`, zundo store, IndexedDB autosave + project list, JSON import/export with migration hook, sample project, undo/redo UI + shortcuts, Levels panel
Summary: Full model with validated ops; one `apply` call = one undo step; sample duplex round-trips through JSON; project manager dialog (new/open/duplicate/rename/delete/import/export).
Limitations: no UI for deleting/reordering levels yet (ops for reorder exist); stair/column UI comes in later prompts.

## Prompt 3 — 2D Floor Plan Editor — DONE
- [x] Pan/zoom/pinch canvas, adaptive grid, shell + hatched columns, ghost levels toggle
- [x] Snapping (grid 0.05/0.1/0.25, endpoints, midpoints, 0/45/90, parallel/perpendicular) with indicators
- [x] Tools: select (click/shift/box/drag/endpoint drag), wall chain with typed lengths, room (rect/polygon), measure, delete
- [x] Room detection + reconciliation, area labels, live dimensions, mitred wall rendering
- [x] Properties panel (walls/rooms, multi-select); level lock; units toggle in status bar
Summary: Rooms are derived from walls (`syncRooms`) and kept in step with every edit. Unit tests cover wall joins, rectangle / L-shaped / partitioned room detection, snapping, hit testing, moves and plan ops; Playwright draws a 4×3 m room with typed lengths, selects and deletes a wall, and undoes.
Limitations: room area uses centerlines (not clear inside area); islands inside a room don't cut holes; doors/windows are drawn as simple gaps until the catalog prompt; drag-moving a room also drags neighbours' shared walls.

## Prompt 4 — 3D Model Generation From the Plan — DONE
- [x] Generators: walls (holes/notches, mitres, face materials), frames/leaves/glass, slabs, room floors, ceilings, flat roofs/skylights, columns, stairs (straight/L/U/spiral + railings + validation)
- [x] Per-entity memoization with disposal; level stacking at elevations; click-to-select synced with 2D/Properties; selection highlight
- [x] View options: all vs active-and-below, walls up/cut 1.2 m/transparent, dollhouse, doors ajar, camera reset
- [x] Generator tests for every entity type (bounds, volumes via divergence theorem, hole counts) and cache/selection tests
Summary: The sample duplex renders in 3D with both slabs, a headroom-based stair void, stairs, openings and trim. Edits in 2D rebuild only affected entities (test: changing one wall rebuilds < 10 cache entries).
Limitations: doubleHeight rooms open the slab above but their walls are not extended; stair void starts where headroom < 2 m (steps before that sit under the slab); selection highlight is a tint + 1px edge outline (drei Outlines rendered artefacts on non-smooth geometry); no textures yet.

## Prompt 5 — Drag-and-Drop Component Library — DONE
- [x] Typed catalog with 49 procedural entries (doors, windows, living, dining, bedroom, kitchen, bathroom, other), 3D builders + 2D symbols
- [x] Library panel (tabs, search, cached thumbnails), drag & drop into 2D and 3D, tap-to-place alternative
- [x] Wall snapping with corner distances, refusals with clear messages, back-to-wall + 15° rotation snapping, clearance warnings
- [x] Move/rotate in 2D (drag, rotate handle) and 3D (TransformControls); R, Ctrl+D, arrows, Delete
- [x] Properties for furniture (size, rotation, elevation, colours/variants) and doors/windows (style, size, sill, swing, mirror, offset, frame colours)
Summary: Doors and windows are catalog-styled openings that cut real holes in 3D walls; furniture is catalog items scaled from default sizes. Placement rules are pure and unit-tested; Playwright covers drag from library to 2D and 3D, tap-to-place, move/slide drags, keyboard manipulation and refusals.
Limitations: dining chairs and similar sets are one item (not separable); bay windows project outward but do not extend the wall; gizmo in 3D works on furniture only (doors/windows are moved in 2D or with arrow keys); no collision blocking (warnings only).

## Prompt 6 — Materials, Textures & Lighting — DONE
- [x] Material library with 40 presets and procedural, seamless, cached canvas textures; custom paint colours; real-world UV scale on every surface
- [x] Swatch-grid picker for wall faces, floors, ceilings, furniture surfaces; "same for this room / level"; eyedropper (2D + 3D)
- [x] Sun with time of day (06–20) + compass, shadows, sky dome + local environment light, Morning/Noon/Evening/Night presets, emissive lamps + point lights (capped by quality)
- [x] Low/Medium/High (+Auto) quality: shadows, AA, pixel ratio, SSAO on High only; FPS readout
Summary: Floors and walls keep one real-world pattern size everywhere (unit-tested via UV spans); the sun sweeps east→south→west so window shadows move; Evening/Night switch the sample's lamps on. Measured ~120 fps on an Apple-GPU laptop at High with the sample duplex.
Deviations: "herringbone" is a chevron-style parquet (alternating slanted planks) rather than a true square-ended herringbone; sample project gained four lamp items so lighting presets show something.
Limitations: lamp point lights are ranked by distance to the apartment centre, not the camera; item surface materials replace the colour of the main-surface meshes only; no normal/bump maps.

## Prompt 7 — AI Assistant: Prompt-to-Model and Prompt-to-Edit — DONE
- [x] Zod `DesignIntent` / `EditOperation` schemas + JSON Schema for constrained decoding
- [x] Provider abstraction (Ollama default, OpenAI-compatible, offline), `/api/ai` proxy (dev + preview) with allow-list, size/time limits, FIFO queue; settings + Test connection + status
- [x] Layout solver (stair hall, adjacency-aware treemap, plumbing/stacking/column-snapping, doors/windows/entrance, furniture, plain-language warnings) and `applyPlan` as one undo step
- [x] Offline generator (keyword rules) + offline edit reader; automatic fallback with a banner/message
- [x] Edit operations (resize, move wall, add/remove/rename room, materials, items, openings, stair type) with preview diff, single-undo apply, never partial
- [x] Robustness: compact prompts + examples, fence stripping, one repair round-trip, timeout/cancel, invalid output never applied
- [x] UI: Design/Edit modes, examples, 3 variations with thumbnails, Apply/Discard
Summary: "2 bedroom duplex with open kitchen" works with no model: valid 2-level model with stair, doors, windows, rooms and furniture. 83 AI unit tests (schemas, solver incl. unmet-adjacency/L-shaped shell/columns, offline briefs, edit ops, preview diff, pipeline with fake providers, store flows, proxy against a fake Ollama) + 3 Playwright flows.
Limitations: verified against the real Ollama only for the "not reachable / model not installed" paths (Ollama is installed on this Mac but has no models; pulling a multi-GB model was not done) — successful model generations are covered with stubbed responses; the solver works on the largest rectangle inside the shell (warns when it is not a rectangle); `removeRoom` merges rooms instead of leaving a void; no double-height rooms or beams in generated designs (prompt 8).

## Prompt 8 — Duplex & Apartment-Shell Features — DONE
- [x] Shell wizard (New project): shape (rectangle / L / custom polygon with validation), slab-to-slab height split with <2.4 m warnings, fixed elements (columns, beams with drop height, entrance, plumbing, facade windows → locked openings), then empty shell / template / AI Assistant
- [x] Four hand-built templates (compact 2BR, 3BR family, open-plan with double-height living, home office) fitted to any shell by the solver
- [x] Checks tab: stair headroom/comfort/fit, beams over stairs, unreachable rooms, entrance, bedroom window, drain distance, min areas, column/door-swing clashes; click an issue to jump, select and flash the target; area schedule (gross/usable/wall, by room type, circulation share)
- [x] Level linking: stairs shown on both levels (UP/DN), draggable; "Copy walls from level below"; double-height rooms (void in the slab above + glass guard along open edges); beams drawn in 2D (dashed) and 3D
- [x] Locked openings (existing facade windows) cannot be moved or deleted, only restyled
Summary: New projects start from the wizard; templates and AI designs keep the shell's fixed elements. 20 new unit tests (wizard shape/height rules, templates at 4 shell sizes incl. L-shape, locked windows, double-height void, copy walls, beams) and 3 Playwright flows (wizard, height refusal, check click-to-highlight).
Deviations: beams are shell-level and drawn on every level; the solver tiles the largest rectangle inside the shell, so facade windows outside it (e.g. in an L-shape's wing) are skipped; the planned "Open to below" void keeps its walls as the guard (a glass rail is generated only for hand-drawn open edges).
Limitations: custom polygon is typed as coordinates (no on-canvas drawing yet); entrance/windows are placed by edge number + distance.

## Prompt 9 — Camera, Navigation & Inspection Tools — DONE
- [x] Camera modes: Orbit (damped; double-click or F focuses the selection), Walkthrough (eye height 1.6 m, WASD/arrows + drag-look, Shift runs, touch joystick, wall/column collision, automatic level change on stairs, Esc exits), Top (orthographic); Front/Back/Left/Right/Isometric with animated transitions
- [x] Saved views (named, thumbnail, camera pose and section cuts) stored in the project JSON; strip with rename/delete
- [x] Section tools: horizontal height slider and a vertical plane (slider or drag the in-scene handle) clip the whole model; solid caps are drawn on the cuts (doors/windows stay open)
- [x] Isolation: only this level, only the selected room (rest ghosted), X-ray; 3D measurement (two clicks → dimension line + label with horizontal/vertical parts); minimap (camera position + heading; click to teleport while walking)
Summary: Walkthrough physics, section caps, views, focus, isolation, measuring and minimap maths are pure modules under `src/scene3d/camera/` (unit-tested, including a BFS over the real walker physics proving a visitor can walk from the entrance, up the stairs and into an upstairs bedroom without crossing a wall). Playwright drives the real walkthrough through the door and up the stairs, minimap teleport, modes/presets, section, saved views, isolation and measuring.
Also fixed (found by running the real model once Ollama had qwen3:14b installed): single-level designs had no interior doors (`planOpenings` had no root room without a stair hall); a "duplex" brief answered with one floor, or fewer bedrooms than asked, is now sent back to the model once (`ai/briefCheck.ts`); e2e AI tests no longer depend on whether a model is installed.
Deviations: section clipping is per material (a registry in `scene3d/clipping.ts`) so the sky and ground are not cut; section caps are computed analytically from walls/slabs/columns (not stencil) so roofs and furniture are not capped; look-around uses drag rather than pointer lock.
Limitations: walkers collide with walls and columns only (not furniture); the cap of a vertical cut through a wall that runs along the plane ignores window sills; the first-person view uses the same High-quality SSAO as the orbit view, which looks grainy on software GL.

## Prompt 10 — Export, Sharing & Reports — DONE
- [x] Images of the 3D view at 1×/2×/4× (PNG or JPEG), optional transparent background, optional presentation style (no grid/helpers/selection); works even when only the plan is showing
- [x] PDF plan set (jsPDF + svg2pdf.js): cover with a 3D hero, one plan per level at 1:50 or 1:100 (rooms, areas, clear sizes, outside wall dimensions, door swings, north arrow, 5 m scale bar), area schedule, materials by room, "Indicative only — consult a licensed architect/engineer." on every page
- [x] GLB (with textures) and OBJ+MTL (flat colours), whole home or one level
- [x] SVG per level and DXF (WALLS, DOORS, WINDOWS, OPENINGS, ROOMS, ROOM_LABELS, COLUMNS, STAIRS, FURNITURE, SHELL layers; millimetres, y up)
- [x] Bill of materials (wall area per finish net of openings, floors, ceilings, openings/furniture/columns/stairs counts) with an editable unit-cost table (selectable currency) saved in the project (`project.costs`), totals per category and overall, CSV export
- [x] "Share read-only snapshot": one self-contained .html (viewer bundle + project JSON, no network) with orbit, walkthrough, top, sections, isolation and measuring; plain project .json export
Summary: Plan SVGs are sized in millimetres with a metre viewBox, so 5 m is 100 mm at 1:50; the PDF places each drawing at exactly that size (unit-tested via `Placement`), and each page also prints a 5 m scale bar so it can be checked on paper. The viewer is built by `npm run build:viewer` (also run by `predev`/`prebuild`) into `public/viewer/` (git-ignored). Playwright downloads a PNG (1× vs 2×), the PDF (5 pages), GLB (glTF 2.0 header, textures embedded), DXF/SVG, the CSV, and opens the snapshot offline from disk.
Also: iso/front/back/side camera presets now fit every corner of the building for any window shape (`fitPose`).
Deviations: the PDF cover image and image export skip SSAO (it is a post-process on the live canvas); OBJ has no textures (MTL has colours/opacity only); slabs, roofs and structural beams are not priced; wall quantities use centre-line lengths.
Limitations: exporting while in walk or top mode temporarily switches to orbit and back; very large 4× images are capped to the GPU limit (8192 px) and the actual size is reported; DXF door arcs are approximate for unusual swings.

## Prompt 11 — UX Polish, Onboarding & Accessibility — DONE
- [x] First-run tour (8 steps: shell wizard → draw/generate → furniture → materials → walk-through → checks → export), spotlight + Next/Back/Skip, auto-starts once, replayable from Help; works as a bottom card on phones
- [x] Discoverability: shortcut tooltips, command palette (Ctrl/Cmd+K, ~50 commands), "?" shortcut sheet, empty-state hint on a blank plan, Ctrl/Cmd+S with a "Saved" toast, "Exported" toasts
- [x] Notes: pin to a spot or to any entity (the pin follows it), shown in 2D and 3D, panel with edit / resolve / delete / show; saved in the project
- [x] Design options: "Save a copy as new option" (Option A, B …), switch, rename, delete, and a synced side-by-side 3D comparison with area/room/check counts; saved in the project
- [x] Bengali (বাংলা) for every string (compiler- and test-enforced), model error messages included; Noto Sans Bengali bundled; Bengali digits/units via Intl; language switcher in Settings and the palette
- [x] Light/dark themes through CSS-variable colour tokens (the drawing area stays on light "paper"), reduced-motion setting + `prefers-reduced-motion`, loading banner and error boundary
- [x] Accessibility: accessible modal (focus trap, Esc, focus restore) for every dialog/drawer, visible focus ring, labels on icon buttons, AA contrast verified for both themes by a test
- [x] Phone/tablet: bottom-sheet panels, wrapping top bar and toolbars, 40 px touch targets; Playwright at 390 × 844 with touch (tap-to-place, tour, language switch)
Summary: Unit tests (Bengali completeness/placeholders/digits, contrast, options, notes) and Playwright (tour, language, theme, palette, shortcuts, dialogs, notes, options + compare, phone) are green.
Deviations: the plan canvas and 3D view keep their light look in dark theme; default level/room names created by the AI/templates are data (English) — only wizard-created names follow the language; the viewer snapshot is English only.
Limitations: no right-to-left or other languages; comparison shows two designs (not three); notes have no author/thread.

## Prompt 12 — Hardening, Performance, Offline/PWA, Desktop Packaging & Deployment — DONE
- [x] Performance: found and fixed a real bottleneck (room matching sampled every room pair: 28.7 s → ~20 ms on a 2-level, ~180-wall, ~300-item stress project, `src/perf/`). Measured: first scene build ~150 ms, edit rebuild 2–4 ms, room detection ~20 ms, checks ~4 ms, solver 3–16 ms — all under the 50 ms budget, so no Web Worker was needed. Export/PDF/AI/wizard/comparison are lazy-loaded (initial JS split).
- [x] Robustness: last-20 autosave history with Restore, "Recover last autosave" on the crash screen, readable (translated) damaged-file messages, unsaved-work warning on closing the tab
- [x] PWA (vite-plugin-pwa): app shell, lazy chunks, fonts and the snapshot viewer cached; install prompt, update notice; Playwright proves reload + Export + snapshot export with the network off
- [x] Desktop: Tauri 2 config (`src-tauri/`), `platform` adapter (browser download/upload vs native dialogs, unit-tested with mocked plugins), `npm run tauri:dev` / `tauri:build`
- [x] Tests: 402 unit tests, coverage of `model/`, `geometry/`, `ai/` ≈ 94 % lines (80 % enforced); 51 Playwright tests incl. the full journey (wizard → offline AI → edit → place → material → walk → PDF + GLB)
- [x] CI/deploy: `.github/workflows/ci.yml` (lint, typecheck, coverage tests, build, e2e, GitHub Pages deploy with `BASE_PATH=/<repo>/`, verified), `netlify.toml`; README and final architecture/Mermaid diagram
Gap: the Rust toolchain is not configured on this machine, so `npm run tauri:build` was not run; the config is committed and follows the Tauri 2 schema. Instancing of repeated catalog items was not added: the measured build/edit times did not call for it.
Limitation: on static hosting there is no `/api/ai` proxy, so the offline generator is used there.

## Prompt 13 — Free Local AI & Self-Hosting on a Windows PC — DONE
- [x] App server (`server/`, plain Node `http`, run with `tsx`): serves `dist/` with SPA fallback, `/api/ai` (allow-listed `/api/chat` + `/api/tags`, 1 MB, 180 s, one generation at a time with a queue), `/api/health` (app + Ollama reachability + installed models), `.env` config (`PORT`, `HOST`, `OLLAMA_URL`, `OLLAMA_MODEL`, `APP_PASSWORD` with a session-cookie login and guess throttling). Ollama stays on 127.0.0.1; only the app server listens on the LAN. Default provider is local Ollama through `/api/ai`; there is no paid-API dependency.
- [x] Windows: `scripts/windows/setup.ps1` / `start.ps1`, `docs/HOSTING_WINDOWS.md` (Task Scheduler and NSSM auto-start, Private-network firewall rule, Tailscale for remote access, no port-forwarding, model table and VRAM guidance); the model is a setting (`OLLAMA_MODEL`, AI settings hint updated in English and Bengali)
- [x] Slow local generation UX: streamed from Ollama (NDJSON through the proxy), "Waiting for AI… (n ahead of you)" while queued, "Thinking… N s" with Cancel; only the final validated answer is applied; 3 variations run one after another and each appears when ready
- [x] `npm run ai:eval`: 15 briefs in `src/ai/fixtures/briefs.ts`, run against the configured model
Results on this Mac with `qwen3:14b` (Ollama 15 briefs):
  - baseline prompt: schema-valid 15/15 = 100 %, solver 15/15 = 100 %, repair round needed 11/15, followed bedroom/level counts 4/15, 40.5 s average
  - tuned prompt (exactly 2 levels, honour counts, vague briefs still get a full design): schema-valid 15/15 = 100 %, solver 15/15 = 100 %, repair needed 3/15, followed the brief 12/15, 73 s average (the machine was busy; first-token latency varies)
Not verified here: the PowerShell scripts were written but not run (no Windows machine); the server itself is covered by unit tests (static files, SPA fallback, health, proxy allow-list, streaming + queue, password flow).
