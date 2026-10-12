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
