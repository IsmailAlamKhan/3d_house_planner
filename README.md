# Duplex Designer

Design a two-level home in 2D and 3D — **free, private, and it works offline**. Draw walls and rooms, drop in
furniture, change materials, walk through your design in first person, check it for problems, and export plans, 3D
models and a cost estimate. An optional AI assistant (running on your own computer) can design a layout from a
sentence.

> **Indicative only — consult a licensed architect/engineer.** Plans, quantities and checks are aids for planning,
> not construction documents.

- Runs in any modern browser; installable as an app (PWA); optional desktop build (Tauri).
- No account, no server, no tracking. Projects are stored in your browser (IndexedDB) and can be saved as `.json`.
- English and Bengali (বাংলা), light and dark themes, keyboard- and touch-friendly.

## Quick start

Requirements: **Node.js 20+** (22 recommended).

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command                             | What it does                                                                |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                       | Development server (also builds the snapshot viewer first)                  |
| `npm run build`                     | Type-check and produce the production build in `dist/`                      |
| `npm run preview`                   | Serve `dist/` locally (the end-to-end tests use this)                       |
| `npm run typecheck` / `lint`        | TypeScript (strict) and ESLint                                              |
| `npm test`                          | Unit tests (Vitest)                                                         |
| `npm run test:coverage`             | Unit tests with coverage for `model/`, `geometry/`, `ai/` (≥ 80 % enforced) |
| `npm run test:e2e`                  | Playwright end-to-end tests (builds and serves the app itself)              |
| `npm run tauri:dev` / `tauri:build` | Desktop app (see below)                                                     |

First run of the end-to-end tests: `npx playwright install chromium`.

## What you can do

- **Villa mode** — design a house on a plot: draw the plot, add a pool, deck, lawn, garden, patio, parking and play areas, place gates, and see a landscaped 3D ground with trees, a pool, a pergola, a fence and garden lights. 12 extra room types (foyer, gym, sauna, spa, game room, home theatre …), a **Luxury villa** template, villa checks (setbacks, gates, parking, pool safety) and a **Marketing render** look.
- **New project wizard** — apartment or villa on a plot; rectangle, L-shape, U-shape or any polygon; ceiling heights; columns, beams, plumbing points, the
  entrance and existing facade windows (locked); then start empty, from one of four templates, or with the AI.
- **2D plan** — walls with typed lengths, rooms detected automatically, snapping, dimensions, undo/redo for everything.
- **Library** — 77 doors, windows, furniture, outdoor and fitness pieces; drag and drop (or tap, then tap) into the plan or the 3D view.
- **Materials & light** — 46 procedural materials (incl. grass, water, paving, decking), paint colours, eyedropper, time of day, evening/night/marketing looks.
- **3D** — orbit, **walkthrough** (WASD, collision, stairs), top view, section cuts, isolate a room, x-ray, measure,
  minimap, saved views.
- **Checks** — headroom on stairs, unreachable rooms, missing windows, drains, minimum areas, door swings; click a
  problem to see it. Area schedule included.
- **Present** — one click to a magazine-style render: cutaway top-down or 3/4 views at dusk with warm lights, plants and decor, crisp room labels (name and size), auto-decorate, PNG export at 1×–4×, and an optional path-traced high-quality still.
- **Enhance with AI** (optional) — turn a presentation render into a photoreal mood image with Stable Diffusion XL + ControlNet in a local ComfyUI container (`docker compose --profile render up -d`); labels are re-applied crisply afterwards.
- **Notes** pinned to the plan, **design options** (Option A/B/C) with a synced side-by-side comparison.
- **Export** — images (1×/2×/4×), PDF plan set to scale (1:50/1:100), GLB and OBJ, SVG and DXF per level, bill of
  materials with your own unit costs (CSV), and a **read-only snapshot** `.html` that opens offline anywhere.
- **Help** — first-run tour, command palette (**Ctrl/Cmd+K**), shortcut sheet (**?**).

## The AI Assistant

Open the **AI Assistant** tab.

- **Design**: describe the home ("3-bedroom duplex, open kitchen and living downstairs, master bedroom with attached
  bath upstairs"), press **Generate** (or **Generate 3 variations**), look at the options, press **Apply**. Applying is
  one undo step. The solver — not the model — draws the walls, so layouts always fit your shell.
- **Edit**: say what to change ("make the kitchen 1 meter wider", "paint the living room sage", "add a plant to the
  study"), **Preview change** shows exactly what will change, **Apply** or **Discard**.

For a villa, start a **Villa on a plot** project (New project → "Villa on a plot", enter the plot and building size),
then open the AI tab and write e.g. _"luxury villa with pool, garden, 2-car garage, gym and sauna"_ — the design has a
foyer and a central hall with two wings of rooms and the outdoor areas around it. The **Luxury villa** template in the
wizard does the same without typing.

### Setting up a model (all optional, all local)

The default is **Ollama** on your own PC:

```bash
# install Ollama from https://ollama.com, then
ollama pull qwen3:14b      # default; qwen3:8b is faster
```

Open **AI settings** in the tab, press **Test connection**. Other choices: any OpenAI-compatible local server
(LM Studio, llama.cpp), or "offline generator only". **If no model is reachable the built-in offline generator is used
automatically**, so the feature always works.

**Privacy:** there are no API keys and no cloud calls. The browser talks to the app's own `/api/ai` endpoint, which
forwards only to `localhost` addresses (an allow-list in `server/aiProxy.ts`). Your briefs and designs never leave your
computer. (On static hosting such as GitHub Pages the `/api/ai` proxy does not exist, so the offline generator is used;
to use a model from a hosted copy, run the app locally.)

## Run everything with Docker (recommended for a home server)

```bash
cp .env.example .env     # optional: PORT, OLLAMA_MODEL, APP_PASSWORD
docker compose up -d     # app + Ollama (NVIDIA GPU) + one-time model download
```

Open `http://localhost:8080` (or the PC's address from a phone on the same Wi-Fi). Projects are stored on the server
(SQLite, last 20 versions each) and shared between devices; browsers keep an offline copy and sync when the server is
back; simultaneous edits raise a conflict dialog instead of overwriting. Ollama is not published to the network. Already
running Ollama on Windows? `docker compose -f docker-compose.yml -f docker-compose.host-ollama.yml up -d`. Backups:
`scripts/backup.sh` / `scripts\backup.ps1`. Full guide: [docs/HOSTING_WINDOWS.md](docs/HOSTING_WINDOWS.md).

## Installing and offline use

The production build registers a service worker that caches the app shell, every lazily loaded screen, the fonts and
the snapshot viewer. After the first load everything except the AI model works with no network. Chrome/Edge show an
**Install app** button; on iOS use _Share → Add to Home Screen_.

## Desktop app (Tauri 2)

The desktop build wraps the same web build and adds native Open/Save dialogs (`src/platform/index.ts`).

```bash
# one-time: install Rust (https://rustup.rs) and the Tauri prerequisites for your OS
# (https://v2.tauri.app/start/prerequisites/)
npm install
npm run tauri:dev      # desktop window with hot reload
npm run tauri:build    # installers in src-tauri/target/release/bundle/
```

The browser version is unchanged and does not need any of this.

## Deployment

- **GitHub Pages** (included): `.github/workflows/ci.yml` runs lint, type-check, tests, build and the end-to-end tests
  on every push, and on `main` publishes to Pages. Enable _Settings → Pages → Source: GitHub Actions_. The build uses
  `BASE_PATH=/<repo>/` so the app works under `https://<user>.github.io/<repo>/`.
- **Netlify**: connect the repo; `netlify.toml` has the build settings.
- Any static host works: `BASE_PATH=/sub/ npm run build` and upload `dist/`.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map, the data flow diagram and design rules. In short:
the project JSON is the single source of truth (meters and radians), every edit is one undoable `store.apply`, 3D
meshes are generated from the model, and the AI only produces validated JSON that deterministic code turns into walls.

## Performance

Measured on the stress project (2 levels, ~180 walls, ~300 items; see `src/perf/stress.test.ts`): first scene build
~150 ms, rebuild after an edit ~2–4 ms, room detection ~20 ms, checks ~4 ms, layout solver 3–16 ms — all under the
50 ms edit budget, so no Web Worker was needed. The initial JavaScript is split: export, PDF, AI, the wizard and the
comparison view load on demand.

## License and credits

Free to use. 3D by three.js / react-three-fiber; PDF by jsPDF + svg2pdf.js; Bengali text in Noto Sans Bengali
(SIL Open Font License), bundled locally.
