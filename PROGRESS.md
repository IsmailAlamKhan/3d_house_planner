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
