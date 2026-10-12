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
