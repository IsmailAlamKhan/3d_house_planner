# Hosting Duplex Designer on a Windows PC

One PC (for example Ryzen 7 7700, RTX 4060 Ti 16 GB, 64 GB RAM) runs everything for free: the web app, a small
server, and a local AI model through **Ollama**. Everybody at home uses it from a phone, tablet or laptop on the same
Wi-Fi. No account, no subscription, no cloud.

```
phone / laptop ──Wi-Fi──▶  app server :8080  ──▶  Ollama 127.0.0.1:11434 (this PC only)
```

Only the app server is reachable from the network. Ollama stays bound to `127.0.0.1`.

## 1. Install the prerequisites (once)

1. **Node.js 20 or newer (LTS)** — https://nodejs.org
2. **Ollama for Windows** — https://ollama.com/download/windows (start it once; it then runs in the tray)
3. **Git** (or download the project as a zip).

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
overloaded. The AI step takes roughly 30–60 s with `qwen3:14b`. With Ollama stopped, the app still works and uses its
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
