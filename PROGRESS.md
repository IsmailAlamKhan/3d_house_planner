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
  - re-run of the tuned prompt after Prompt 15 (`/tmp/eval2.log`, 05:21): identical — 15/15 schema-valid, 15/15 solver, repair 3/15 (simple-2br, minimal, style-light), brief followed 12/15, 73.2 s average
Not verified here: the PowerShell scripts were written but not run (no Windows machine); the server itself is covered by unit tests (static files, SPA fallback, health, proxy allow-list, streaming + queue, password flow).

## Prompt 14 — Dockerize Everything (GPU) + Shared Project Storage — DONE (image build not run locally)
- [x] Shared storage: `/api/projects` (list, create, get, update with `baseRevision`, delete, versions, restore) on SQLite (`better-sqlite3`, `$DATA_DIR/app.db`); every write validated by the same Zod schema/migration the frontend uses (imported directly from `src/model`); last 20 versions per project; protected by the session cookie when `APP_PASSWORD` is set
- [x] Frontend: the server is the source of truth, IndexedDB the offline cache (`persistence/sync.ts`, `syncStore.ts`); offline edits are marked dirty and pushed when the server returns; remote changes are picked up every 10 s; "This project was changed on another device" dialog (reload theirs / save mine as a copy / overwrite); a fresh device opens the newest shared project instead of its untouched sample; sync status in the status bar; static hosting keeps the old local-only behaviour
- [x] `Dockerfile` (pinned `node:20.18.1-bookworm-slim`, 3 stages: build → native deps for better-sqlite3 → slim non-root runtime with `HEALTHCHECK`), `.dockerignore`; the server is bundled by esbuild (`npm run build:server`)
- [x] `docker-compose.yml` (app + `ollama/ollama:0.12.3` with NVIDIA GPU reservation, healthcheck `ollama list`, **no published Ollama port**, `ollama-init` one-shot model pull, volumes `app-data` / `ollama-data`, `restart: unless-stopped`), `docker-compose.host-ollama.yml` (both files validate with `docker compose config`); the AI tab shows "Downloading the AI model…" while Ollama is up but the model is missing
- [x] `docs/HOSTING_WINDOWS.md` rewritten Docker-first (Docker Desktop + WSL2, NVIDIA driver only, GPU check with `nvidia-smi`, `ollama ps` shows 100 % GPU, `.wslconfig` memory, auto-start, updating, firewall/Tailscale), native PowerShell second
- [x] Backups: `scripts/backup.{sh,ps1}` / `restore.{sh,ps1}` using SQLite's online backup inside the container (`node cli.mjs backup|restore`); restore swaps the data in one transaction while the app runs; weekly Task Scheduler entry documented; tested (unit test with a live database, and by hand against the bundled server)
- [x] CI: `docker` job builds the image, validates both compose files and runs `scripts/docker-smoke.sh` (health, app shell, create/list, stale-update refused with 409, backup → delete → restore, restart persistence) with the app container alone
Tests: 33 server tests (store, API, sync between two simulated devices incl. conflict/copy/overwrite/offline/delete, backup/restore) and 2 Playwright tests against the real app server (project appears on a second device; offline edit + concurrent edit → conflict dialog → save as copy).
Gap: Docker Desktop on this Mac fails every build with a containerd I/O error (host storage problem, unrelated to the project), so the image itself and `docker compose up` were not run here; the compose files were validated with `docker compose config`, the bundled server and CLI were run natively, and the CI job builds and smoke-tests the image. GPU acceleration can only be verified on the Windows PC.

## Prompt 15 — Villa & Site Mode (rooms, outdoors, landscaping) — DONE
- [x] `project.kind` + `project.site` (plot, gates, zones, setback); old files migrate to `apartment` (test); wizard offers "Villa on a plot" (plot size, rectangle / L / U / custom building, 1–3 storeys); a single-level villa has no stair, 2+ levels keep the stair/void logic
- [x] 12 new room types (foyer, walk-in closet, gym, sauna, spa, game room, garage, laundry, pantry, home theatre, prayer, outdoor dining) with defaults, plan colours, area-schedule/checker minimums, English + Bengali names
- [x] 2D site tools (plot, zone, gate; type + surface pickers), drawn beneath the building with type colours and name + area, "Site" row in the Levels panel (hide/lock), undoable, snapping like walls
- [x] 3D ground and landscaping: grass plot, zone surfaces, pool (water, basin, coping), pergola/roof on covered zones, fence with gates; 6 new procedural materials; 28 new catalog items (outdoor + gym/sauna/spa/gaming/theatre/closet); garden lights are lamps
- [x] "Marketing render" lighting preset and "Plan view" camera preset (near top-down with the roof hidden)
- [x] Checks: setback, vehicle gate → parking for N cars, pedestrian gate → entrance path, pool barrier, garage opening (+ existing bedroom-window rule)
- [x] AI/offline: villa keywords (villa, pool, garden, garage/parking N cars, gym, sauna, spa, game room, guest room, closet, theatre, prayer…), `DesignIntent.strategy`/`site`, solver wings strategy, site planner, template "Luxury villa"
Summary: the brief "luxury villa with pool, garden, 2-car garage, gym and sauna" on an 18 × 16 m building in a 34 × 42 m plot gives a foyer at the front, a 94 m² central living & dining hall, master suite (bedroom + bath + closet), two more bedroom suites, kitchen, laundry, gym with sauna in the wings, and outdoors a covered 2-car parking bay, front garden, pool with deck, covered outdoor dining, garden lounge, play area, a pedestrian gate with path and a vehicle gate; all checks run and report in plain language (tests assert no unreachable rooms and no setback/gate errors). Unit tests (site ops, generators, checks, offline reader, solver, applyPlan, wizard, migration, camera/lighting) and 2 Playwright tests (wizard → template; offline brief → apply) are green.
Deviations: gates are site entities (with their own 3D leaves), not catalog items; the wings strategy is for single-level designs (multi-level villas use the duplex strategy and the villa template drops to one level); plots are drawn freehand but the AI site planner works on the plot's bounding box; the "export image of the 3D view" already existed (Export → Images), so no new stub was added; "soft ambient occlusion" in Plan view is the existing quality-dependent SSAO, not a separate pass.
Limitations: no terrain/slope, roads beyond the gate or neighbouring plots (out of scope); the wing arrangement tiles rooms with a treemap, so a room's attached bathroom can sit behind it rather than beside it; zone surfaces are flat (no steps), and the pool is a tiled box with a flat water plane (no animation).

## Final summary — all 15 prompts DONE

**What exists.** Duplex Designer is a free, local-first design app: a wizard (apartment shell or villa on a plot), a 2D plan editor and a generated 3D model that always agree (the project JSON is the single source of truth, in metres and radians, every edit an undoable `store.apply`), a library of 77 procedural items, 46 procedural materials, lighting presets, walkthrough/sections/measuring, constraint checks, notes and design options, English and Bengali, light/dark, phone-friendly, installable offline (PWA) and optionally a Tauri desktop app. The AI assistant (Ollama or any OpenAI-compatible local server, with a built-in offline generator as fallback) only produces validated JSON; a deterministic solver draws the walls. Exports: PNG/JPEG, PDF plan set to scale, GLB/OBJ, SVG/DXF, bill of materials CSV, and a self-contained read-only snapshot. A Docker setup (app + Ollama on an NVIDIA GPU + shared SQLite project storage) and Windows scripts are included.

**Final verification (this machine, after Prompt 15).** `npm run typecheck` clean · `npm run lint` clean · `npm test`: 489 unit tests in 49 files pass · `npm run test:coverage`: model/geometry/ai ≈ 92 % lines (80 % enforced) · `npm run build` succeeds (PWA precache 47 entries) · `npm run test:e2e`: 55 Playwright tests pass (the shared-storage conflict test is timing-sensitive and passed on a re-run when the whole suite was loading the machine).

**Known gaps (documented per prompt).** Docker image build and GPU acceleration were not run locally (Docker Desktop storage error on this Mac; the CI job builds and smoke-tests the image); `npm run tauri:build` and the PowerShell scripts were not run (no Rust toolchain / Windows PC here). Plans, quantities and checks are indicative only — *consult a licensed architect/engineer* (printed on every export).

**How to use.** See README.md: `npm install && npm run dev`; New project → apartment or villa → template, AI or empty; the AI tab takes a sentence ("3-bedroom duplex with open kitchen", "luxury villa with pool, garden, 2-car garage, gym and sauna").

