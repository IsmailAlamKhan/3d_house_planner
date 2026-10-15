# Duplex Designer

Design a two-level home in 2D and 3D — **free, private, and it works offline**. Draw walls and rooms, drop in
furniture, change materials, walk through your design in first person, check it for problems, and export plans, 3D
models and a cost estimate. An optional AI assistant (running on your own computer) can design a layout from a
sentence.

> **Indicative only — consult a licensed architect/engineer.** Plans, quantities and checks are aids for planning,
> not construction documents.

- Runs in any modern browser; installable as an app (PWA).
- No account, no server, no tracking. Projects are stored in your browser (IndexedDB) and can be saved as `.json`.
- English and Bengali (বাংলা), light and dark themes, keyboard- and touch-friendly.

## Quick start

Requirements: **Node.js 22+** (the server uses better-sqlite3 13).

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command                             | What it does                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                       | Development server (also builds the snapshot viewer first)                                                           |
| `npm run build`                     | Type-check and produce the production build in `dist/`                                                               |
| `npm run preview`                   | Serve `dist/` locally (the end-to-end tests use this)                                                                |
| `npm run typecheck` / `lint`        | TypeScript (strict) and ESLint                                                                                       |
| `npm test`                          | Unit tests (Vitest)                                                                                                  |
| `npm run test:coverage`             | Unit tests with coverage for `model/`, `geometry/`, `ai/` (≥ 80 % enforced)                                          |
| `npm run test:e2e`                  | Playwright end-to-end tests (builds and serves the app itself)                                                       |
| `npm run reference:build -- <spec>` | Build a reference spec (e.g. `reference/villa.spec.json`) into a project, save it to the app and write `FIDELITY.md` |

First run of the end-to-end tests: `npx playwright install chromium`.

## What you can do

- **Villa mode** — design a house on a plot: draw the plot, add a pool, deck, lawn, garden, patio, parking and play areas, place gates, and see a landscaped 3D ground with trees, a pool, a pergola, a fence and garden lights. 12 extra room types (foyer, gym, sauna, spa, game room, home theatre …), a **Luxury villa** template, villa checks (setbacks, gates, parking, pool safety) and a **Marketing render** look.
- **New project wizard** — apartment or villa on a plot; rectangle, L-shape, U-shape or any polygon; ceiling heights; columns, beams, plumbing points, the
  entrance and existing facade windows (locked); then start empty, from one of four templates, or with the AI.
- **2D plan** — walls with typed lengths, rooms detected automatically, snapping, dimensions, undo/redo for everything.
- **Library** — 77 doors, windows, furniture, outdoor and fitness pieces; drag and drop (or tap, then tap) into the plan or the 3D view.
- **Lighting** — realistic (dark unless daylight comes in or a light is on) or even design lighting (`L`), light fixtures with brightness / colour temperature and per-fixture, per-room and global switches, exposure and night-visibility controls, three graphics tiers that look the same and differ only in cost.
- **Materials & light** — 46 procedural materials (incl. grass, water, paving, decking), paint colours, eyedropper, time of day, evening/night/marketing looks.
- **3D** — orbit, **walkthrough** (WASD, collision, stairs), top view, section cuts, isolate a room, x-ray, measure,
  minimap, saved views.
- **Checks** — headroom on stairs, unreachable rooms, missing windows, drains, minimum areas, door swings; click a
  problem to see it. Area schedule included.
- **Present** — one click to a magazine-style render: cutaway top-down or 3/4 views at dusk with warm lights, plants and decor, crisp room labels (name and size), auto-decorate, PNG export at 1×–4×, and an optional path-traced high-quality still.
- **Your own furniture and textures** — in the library, **Add your own 3D model…** takes a `.glb` file (binary glTF, from Blender, Sketchfab and most 3D tools; up to 60 MB): name it, check the real size (centimetre and millimetre models are detected), choose where it belongs and whether it stands on the floor or hangs on a wall, and it appears under **My items** like any built-in piece (drag it in, rotate, resize, duplicate). In any material picker, **Upload a texture…** takes a PNG, JPEG or WebP picture and the real-world size of one repeat; it is applied to the surface at once and kept under **My textures** for floors, walls, ceilings and surfaces. Both are stored on the app server (Docker or `start.ps1`), so every device sees them; they are not available on a static website. Custom models are not part of a project file: exporting a project to another server leaves them behind.
- **Enhance with AI** — turn a presentation render into a photoreal mood image with Stable Diffusion XL + ControlNet in a local ComfyUI container that starts with the rest of the stack (`docker compose up -d`; the first start downloads about 12 GB of models); labels are re-applied crisply afterwards. Find it under **Present** (clapperboard icon in the 3D toolbar) → Cutaway view → _Enhance with AI…_.
- **Enhance v2** — the default _Reference villa look_ preset enhances the latest **Studio render** (with its depth and ID passes) instead of the browser view: the reference picture is applied as a style reference (IP-Adapter), pool, bedding, cars, lawn and so on are prompted separately, depth + edge ControlNets lock the layout (checked afterwards, retried with less creativity if walls moved) and an optional tiled 2×/3× upscale fits in 16 GB. Presets: Reference villa look, Subtle polish, Bold restyle, Classic. On the GPU PC `npm run eval:enhance` measures time, VRAM, layout kept and CLIP style similarity. A ComfyUI you run yourself needs `--disable-smart-memory`; model licences are in `docker/comfyui/MODELS.md`.
- **Layout engine v2** — the AI and the wizard plan with a constraint optimiser over ten plan types (stacked, split and loft duplex, villa with wings, courtyard, L around a garden, corridor plans, apartment shells with columns). Generate shows different plans, each with its plan type and a plain-language score; pick one and ask to improve it ("more daylight", "less corridor"). `npm run eval:layout` compares it with the old treemap solver on 30 briefs and writes `reports/layout-eval.png`.
- **Design with AI** — the easiest way to design any villa or duplex. In the AI tab (and from the wizard's first step and the empty plan) start from a sentence (English or বাংলা), a few tappable questions, a floor-plan picture, a sketch (rough boxes or a photo), "like this, but…" (the reference villa, a template or your project) or mood pictures. Every start becomes one editable **Design Brief** (rooms with sizes, must / nice, outdoor features, style, budget, priorities, what was assumed) with a draggable bubble diagram; the copilot then makes three layouts, checks them and fixes its own failures before showing them. Pick one, press Apply, choose a style, and keep talking to it ("make it feel more open", "add a room for my mother on the ground floor with its own bathroom", chips for the common requests, select a room and say "make this bigger"). Everything is previewed and is one undo. Works with no model (keyword reader) and better with a local one; the microphone button appears when the optional speech service runs: `docker compose --profile voice up -d` (whisper.cpp, English and Bengali, no cloud). `npm run eval:copilot` judges it on 40 scenarios.
- **Trace from a picture** — the **Reference picture** button on the plan toolbar takes a photo or render of a plan: click the four corners of a rectangle whose real size you know (or two points and a distance), and the picture is straightened and scaled onto the plan; set its opacity, show it over the plan to check alignment, lock it, nudge or rotate it, and **Compare with reference** to see it beside a top-down render with a draggable divider.
- **Reference Villa** — `reference/villa.spec.json` rebuilds the villa of `reference/villa-reference.png` exactly, as two design options (A: every labelled room at its labelled size; B: proportions measured from the picture, which overlays it wall for wall). `npm run reference:build -- reference/villa.spec.json` saves it to the running app (or `--out villa.json`) and writes `reference/FIDELITY.md`; **Export → Share → Reference spec** writes any project back as such a spec.
- **Recreate from picture** — in the AI tab, **Recreate from picture** reads a floor-plan picture (such as `reference/villa-reference.png`) with a vision model that runs on your own PC (Qwen3-VL 8B Instruct through Ollama; `docker compose` pulls it, or `ollama pull qwen3-vl:8b-instruct`). It finds the labels, printed sizes and rooms; you check and correct them on a review screen; then **Build exact**, **as labelled**, **as pictured** or **both** creates the plan, with the picture underneath. Nothing is built until you press a button. `npm run ai:eval:vision` measures how well it reads.
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

### Real models, textures and sky (free CC0 asset pack)

`docker compose up -d` also runs `assets-init`, which downloads about 300 MB of free (CC0) models, PBR textures and HDRI skies once and converts them (`npm run assets:download` does the same without Docker). Reload the page when it finishes; the villa then shows real models, textures and a photographic sky. Without the pack (or with _Real 3D models and textures_ switched off under _Light & quality_) the built-in models are used. Sources and licences of every asset: [assets/LICENSES.md](assets/LICENSES.md). Frame rate on a real GPU: `npm run test:gpu`.

### Studio render (Blender Cycles, optional)

For pictures like the reference, _Present → Studio render (Blender)_ renders the design offline with Blender Cycles on the NVIDIA GPU (OptiX): Preview, Standard (about 1.5 minutes for the reference villa on an RTX 4060 Ti) or Poster, with a progress bar, cancel and a gallery. _Reference look_ reproduces the dusk mood of the reference picture in one click. Turn it on with `docker compose --profile render up -d`, or, running the server on Windows, install Blender 4.2 and set `BLENDER_PATH` in `.env`. Without it the app works as before and the dialog says how to enable it.

### Baked lighting (optional, needs the Blender service)

_Light & quality → Baked lighting_ bakes the Day, Dusk or Night lighting of the building into lightmaps with Blender (Low about 6 s, Medium about 40 s, High about 5 minutes for the reference villa on an RTX 4060 Ti). The walkthrough then looks like the studio render (warm pools of light, soft bounce light) at 60 fps; furniture keeps live lighting. Editing the design marks the bake out of date ("Lighting out of date — Rebake"); there is an option to rebake after 2 idle minutes.

## Performance

Measured on the stress project (2 levels, ~180 walls, ~300 items; see `src/perf/stress.test.ts`): first scene build
~150 ms, rebuild after an edit ~2–4 ms, room detection ~20 ms, checks ~4 ms, layout solver 3–16 ms — all under the
50 ms edit budget, so no Web Worker was needed. The initial JavaScript is split: export, PDF, AI, the wizard and the
comparison view load on demand.

## License and credits

Free to use. 3D by three.js / react-three-fiber; PDF by jsPDF + svg2pdf.js; Bengali text in Noto Sans Bengali
(SIL Open Font License), bundled locally.
