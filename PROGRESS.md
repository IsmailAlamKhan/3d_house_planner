# Progress

## Deviations
- (none yet)

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
