# Hosting Duplex Designer on a Windows PC

One PC (for example Ryzen 7 7700, RTX 4060 Ti 16 GB, 64 GB RAM) runs everything for free: the web app, a small
server that stores your projects, and a local AI model through **Ollama**. Everybody at home uses it from a phone,
tablet or laptop on the same Wi-Fi. No account, no subscription, no cloud.

**Docker is the recommended way** (below). The native PowerShell way is described afterwards ("Option B").

```
phone / laptop ──Wi-Fi──▶  app :8080  ──▶  ollama (internal network only, GPU)
                              │
                              └── SQLite in the app-data volume (shared projects, last 20 versions each)
```

Only the app port is reachable from the network. Ollama has no published port.

## Option A — Docker (recommended)

### Prerequisites (once)

1. **Docker Desktop** with the **WSL2 backend** — https://www.docker.com/products/docker-desktop/
2. A **current NVIDIA driver** for Windows (GeForce/Studio driver from nvidia.com). GPU support for WSL2 comes with the
   driver — do **not** install a separate CUDA driver inside WSL.
3. In Docker Desktop: *Settings → General → Start Docker Desktop when you sign in* (so everything comes back after a
   reboot; the containers use `restart: unless-stopped`).
4. Give WSL2 enough memory so a model that does not fit completely in video memory can spill into system RAM. Create
   `%UserProfile%\.wslconfig`:

   ```ini
   [wsl2]
   memory=24GB
   swap=8GB
   ```

   then run `wsl --shutdown` and restart Docker Desktop. (At least 16 GB; 24 GB is comfortable with 64 GB of RAM.)

### Check that Docker can use the GPU

```powershell
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

You should see your RTX 4060 Ti. If not, update the NVIDIA driver and restart Docker Desktop. (Verified: driver
610.88, Docker Desktop 28.4 / WSL2; the first run downloads the small CUDA image.) If `docker` says it cannot
connect to `dockerDesktopLinuxEngine`, Docker Desktop is not running yet: start it and wait until the engine is up.

### Start

```powershell
git clone <this repository> ; cd <folder>
copy .env.example .env          # optional: change PORT, OLLAMA_MODEL, set APP_PASSWORD
docker compose up -d
```

The first start builds the app image (about 3 minutes; it compiles the native `better-sqlite3` module on Node 22 —
the build needs no Python or compiler on your PC, it all happens inside Docker). That starts the app, Ollama (with
the GPU) and a one-time job that downloads the model (`qwen3:14b` is 9.3 GB: about 20 minutes at 8–9 MB/s). If Docker
Desktop restarts while the download runs, the download starts again from the beginning: just run
`docker compose up -d` again and wait. The app is
usable right away: until the model has arrived the AI tab says *"Downloading the AI model…"* and the built-in offline
generator is used. Watch progress with `docker compose logs -f ollama-init`.

Open `http://localhost:8080` on the PC, or the PC's address on your phone (`ipconfig` → IPv4, e.g.
`http://192.168.1.23:8080`).

> **If `http://localhost:8080` gives an empty reply or "connection reset"** right after Docker Desktop restarted,
> a stale WSL port forward (`wslrelay.exe`) is holding port 8080. Run `docker compose restart app` (or
> `docker compose up -d --force-recreate app`); if it persists, set another `PORT` in `.env`.
>
> **If you already run Ollama natively on Windows** it uses port 11434 on this PC. The Docker Ollama needs no host
> port, so nothing clashes, and the two do not share models.

### Check that generation runs on the GPU

Start an AI generation in the app, and while it runs:

```powershell
docker compose exec ollama ollama ps
```

The `PROCESSOR` column should say **100% GPU**. (If it shows a CPU/GPU split the model does not fit in video
memory: choose a smaller model, see *Choosing a model*.) Health check: `http://localhost:8080/api/health`.

Measured on an RTX 4060 Ti 16 GB with `qwen3:14b`: `ollama ps` shows **10 GB, 100% GPU, context 4096**;
`nvidia-smi` shows about 12 GB used in total while generating (about 2.6 GB is the desktop itself); a 300-token
answer takes about 12 s (≈ 25 tokens/s); the app's own design generation takes 24 s on average
(15 sample briefs, see the AI quality note in `PROGRESS.md`).

### Projects are shared between devices

Projects are stored on the server (SQLite in the `app-data` volume). A design made on a phone appears on the laptop
within about 10 seconds. Each browser keeps an offline copy: edits made while the Wi-Fi is down sync when the server is
reachable again. If two devices edit the **same** project at once, the second save shows *"This project was changed on
another device"* and lets you reload theirs, save yours as a copy, or overwrite — nothing is lost silently. Each
project keeps its last 20 versions on the server.

Data survives `docker compose down` and `docker compose up -d` (named volumes `app-data` and `ollama-data`). Only
`docker compose down -v` deletes them.

### Updating

```powershell
git pull
docker compose build
docker compose up -d
```

### Native Ollama instead of the container

If you prefer Ollama installed directly on Windows (Option B's Ollama), keep only the app in Docker:

```powershell
docker compose -f docker-compose.yml -f docker-compose.host-ollama.yml up -d
```

The app then reaches Ollama through `http://host.docker.internal:11434`.

### Backups

`scripts\backup.ps1` (Windows) or `scripts/backup.sh` copies the database out of the volume into
`backups\app-<timestamp>.db` using SQLite's online backup — safe while the app is running, never a raw file copy.
`scripts\restore.ps1 <file>` puts a backup back (while the app runs; a harmless `rm: cannot remove
'/tmp/restore-….db'` warning at the end is expected). Running the shell scripts from **Git Bash** works too: the
scripts set `MSYS_NO_PATHCONV=1` so Git Bash does not rewrite `/tmp/...` arguments.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 backups\app-20260101-120000.db
```

Weekly backup with **Task Scheduler**: *Create Task…* → *Triggers*: *Weekly*, Sunday 03:00 → *Actions*: *Start a
program* `powershell.exe`, arguments
`-ExecutionPolicy Bypass -File "C:\path\to\project\scripts\backup.ps1"`, *Start in* `C:\path\to\project`. Copy the
`backups` folder to another disk or cloud drive now and then.

### AI image enhancement with ComfyUI ("Enhance render")

The **Present** panel in the 3D view can turn a presentation render into a photoreal mood image with **Stable Diffusion
XL + ControlNet** running in **ComfyUI**, on the same GPU as Ollama. **It needs no extra setup:** the same
`docker compose up -d` that starts the app also builds and starts ComfyUI and downloads its models once (about 12 GB,
20–40 minutes at home-internet speed; the first build of the ComfyUI image takes a few more minutes). Until the models
have arrived the app works as usual and the *Enhance* button says the image service is still starting.

Where to find it: 3D view → **Present** (clapperboard icon) → *Cutaway* view → scroll down → **Enhance with AI…**.

```powershell
docker compose logs -f comfyui-init      # watch the first-time model download; it logs the disk used at the end
```

- The `comfyui` service is built from `docker/comfyui/Dockerfile` (CUDA PyTorch base image, ComfyUI pinned to release
  v0.9.2) and has **no published port**: only the app container reaches it (`COMFYUI_URL=http://comfyui:8188`).
- `comfyui-init` downloads the models into the `comfyui-models` volume (resumable, sizes verified, revisions pinned to
  exact commits of the official repositories) and exits.
- **One GPU at a time.** A 14 B language model (about 9–10 GB) and SDXL (about 7–9 GB) do not fit together on a 16 GB
  card. The app server keeps one queue for AI design jobs and render jobs: before a render it unloads the language model
  (`keep_alive: 0`), after it it asks ComfyUI to free its memory, and the app shows who is ahead of you in the queue.
- The enhancement always works on the render **without labels**; crisp room labels and the badge "AI-enhanced mood
  image — not to scale" are drawn on top afterwards. Results (with their prompt, seed and settings) are kept in the
  `app-data` volume with the project.
- To stop it and free the disk: `docker compose stop comfyui` (models stay in the volume) or
  `docker volume rm <project>_comfyui-models`.

**Model and software licenses** (personal use is fine; you are responsible for checking them for any other use):

| Component | Source | License |
| --- | --- | --- |
| Stable Diffusion XL base 1.0 (`sd_xl_base_1.0.safetensors`, 6.9 GB) | `stabilityai/stable-diffusion-xl-base-1.0` on Hugging Face | CreativeML Open RAIL++-M |
| SDXL depth ControlNet (`controlnet-depth-sdxl-1.0`, fp16, 2.5 GB) | `diffusers/controlnet-depth-sdxl-1.0` | CreativeML Open RAIL++-M |
| SDXL canny ControlNet (optional edge pass, fp16, 2.5 GB) | `diffusers/controlnet-canny-sdxl-1.0` | CreativeML Open RAIL++-M |
| ComfyUI v0.9.2 | `comfyanonymous/ComfyUI` | GPL-3.0 |
| `three-gpu-pathtracer` (the in-browser path-traced still, prompt 15) | npm | MIT |

The Open RAIL++-M license allows use and redistribution of the model and its outputs but forbids certain uses (for
example illegal, harmful or deceptive ones); read it at huggingface.co before using images commercially.

### Firewall and remote access

Allow inbound TCP on the app port for **Private** networks only; never Public; never open 11434 (it is not published
at all in Docker). For use away from home use **Tailscale**; **do not port-forward** the router. See the sections below.

---

## Option B — native (PowerShell scripts, no Docker)

## 1. Install the prerequisites (once)

1. **Node.js 22 or newer (LTS)** — https://nodejs.org
2. **Ollama for Windows** — https://ollama.com/download/windows (start it once; it then runs in the tray)
3. **Git** (or download the project as a zip).
4. **A C++ build toolchain.** `better-sqlite3 13` (Node 22+) has no prebuilt Windows binary, so `npm install`
   compiles it. You need **Python 3** and the **"Desktop development with C++"** workload of *Visual Studio Build
   Tools* (`winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`).
   With only Visual Studio **2026** installed, npm's bundled node-gyp (11.x) does not recognise it and fails with
   *"find VS … unknown version"*. Either install the 2022 Build Tools as above, or compile once with a newer
   node-gyp: `npm i --prefix %TEMP%\ng node-gyp@latest`, then in `node_modules\better-sqlite3` run
   `node %TEMP%\ng\node_modules\node-gyp\bin\node-gyp.js rebuild` (verified: node-gyp 13.1 + VS 2026 works).
   If you do not want a compiler on the PC, use Option A (Docker).

## 2. Set up and start

Open *PowerShell* in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1
powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1
```

`setup.ps1` checks Node and Ollama, runs `npm install` and `npm run build`, creates `.env` from `.env.example`, and
downloads the model (`ollama pull`). `start.ps1` makes sure Ollama is running, starts the server and prints the
addresses, e.g.

```
On this PC:        http://localhost:8080
From your phone:   http://192.168.1.23:8080   (same Wi-Fi)
```

Open the second address on a phone connected to the same Wi-Fi. (If it does not load, see *Firewall* below.)
`start.ps1` lists **every** IPv4 address of the PC, including virtual ones (WSL, Hyper-V, VPN, Tailscale): use the one
that starts like your router's network (`192.168.x.x`). Verified on Windows PowerShell 5.1 (`setup.ps1` and
`start.ps1` both ran; health check OK against a native Ollama).

### Settings (`.env`)

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port of the app |
| `HOST` | `0.0.0.0` | `0.0.0.0` = reachable on the LAN; `127.0.0.1` = this PC only |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | `qwen3:14b` | Model suggested in the app's AI settings |
| `APP_PASSWORD` | *(empty)* | If set, every device must enter it once (session cookie, 30 days) |

Check that everything is up: open `http://localhost:8080/api/health` — it shows the model and whether Ollama is
reachable.

## 3. Choosing a model

The model is a **setting**, not a code change: `OLLAMA_MODEL` in `.env` (and "Model" in the AI settings of the app).
Any Ollama model that can follow a JSON schema works.

| Model | Size | Notes |
| --- | --- | --- |
| `qwen3:14b` (default) | ≈ 9 GB | Fits fully in 16 GB of video memory with room for context. Best quality/speed balance. |
| `qwen3:8b` | ≈ 5 GB | Faster; slightly weaker on unusual briefs. |
| `gemma3:12b` | ≈ 8 GB | Good alternative. |
| `mistral-small` (24B) | ≈ 14 GB+ | Larger and slower; tight on 16 GB and may spill into system RAM. |

**Speed rule of thumb:** a model must fit in the graphics card's memory to be fast. Spilling into system RAM still works
(the 64 GB make that possible) but is several times slower. Change the model: edit `OLLAMA_MODEL`, run
`ollama pull <model>`, restart `start.ps1`.

One generation runs at a time; others wait in a queue ("Waiting for AI… (1 ahead of you)") so the GPU is never
overloaded. The AI step takes roughly 25–50 s with `qwen3:14b` on an RTX 4060 Ti (24 s average over the 15 sample briefs). With Ollama stopped, the app still works and uses its
built-in offline generator.

## 4. Start automatically

**Task Scheduler (simplest)**

1. Open *Task Scheduler* → *Create Task…*
2. *General*: name `Duplex Designer`; tick *Run only when user is logged on*.
3. *Triggers*: *At log on*.
4. *Actions*: *Start a program* → Program `powershell.exe`, Arguments
   `-ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\path\to\project\scripts\windows\start.ps1"`.
5. *Settings*: tick *If the task fails, restart every 1 minute*.

**As a service with NSSM (starts at boot, before login)**

```powershell
winget install nssm
nssm install DuplexDesigner "C:\Program Files\nodejs\npx.cmd" "tsx server/index.ts"
nssm set DuplexDesigner AppDirectory "C:\path\to\project"
nssm set DuplexDesigner Start SERVICE_AUTO_START
nssm start DuplexDesigner
```

(Ollama's tray app starts at login; for a boot-time service run Ollama as a service too, or accept that AI waits
until someone logs in — the app itself keeps working with the offline generator.)

## 5. Firewall (Private networks only)

Windows asks the first time Node listens on the network. Choose **Private networks** only. Or add the rule yourself
(administrator PowerShell):

```powershell
New-NetFirewallRule -DisplayName "Duplex Designer" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Do **not** allow it on *Public* networks. Do not open the Ollama port (11434) at all.

## 6. Using it away from home

Use **Tailscale** (free for personal use): install it on the PC and on your phone, sign in to the same account, then
open `http://<pc-tailscale-name>:8080` anywhere. Traffic is encrypted and nothing is exposed to the internet.

**Do not port-forward your router** to this PC. The app server is meant for a trusted home network; if you ever need
more than that, set `APP_PASSWORD` and still prefer Tailscale.

## Troubleshooting

- *Phone cannot open the address* — same Wi-Fi? Firewall rule for *Private*? `HOST` must be `0.0.0.0`. Some routers
  have "client isolation"/"guest network" settings that block devices from each other.
- *"Waiting for AI…" forever* — someone else's long generation is running; Cancel is available in the AI tab.
- *Not reachable / uses the offline generator* — open `/api/health`; if `ollama.reachable` is false start the Ollama
  app. If `modelInstalled` is false run `ollama pull qwen3:14b`.
- *Slow answers* — try `qwen3:8b`, and close other GPU-heavy apps (games, video editors).
