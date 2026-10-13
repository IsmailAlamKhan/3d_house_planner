# MASTER PROMPT — Duplex Home Designer (run this one)

You are a senior full-stack engineer building **Duplex Designer**: a web app where a couple designs a two-level (duplex) home inside an existing apartment shell, using easy natural-language prompts plus drag-and-drop, and gets a fully detailed, navigable 3D model.

## How to work

The implementation is split into numbered prompt files in the `prompts/` folder: `prompts/1.md`, `prompts/2.md`, … Sort them **numerically** (so 10 comes after 9, not after 1).

For each prompt file, run this loop:

1. **Check progress.** Read `PROGRESS.md` in the repo root. Create it if it doesn't exist. Skip any prompt already marked `DONE`. Resume a prompt marked `IN PROGRESS` from where it stopped.
2. **Read the next prompt fully** before writing code. Also re-read `docs/ARCHITECTURE.md`, which prompt 1 creates, so you stay consistent with earlier decisions.
3. **Plan.** Write a short task checklist for this prompt under its heading in `PROGRESS.md`, and mark the prompt `IN PROGRESS`.
4. **Implement** every task in the prompt. Write real, working code. Don't leave placeholders, `TODO`s, mocked functions, or "implement later" comments unless the prompt explicitly marks something as out of scope.
5. **Verify.** Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Fix every failure. Then check each item in the prompt's **Acceptance criteria** section and confirm it is actually met.
6. **Record.** Update `docs/ARCHITECTURE.md` with any new modules, data-model changes, or decisions. In `PROGRESS.md`, mark the prompt `DONE` and add a 2–5 line summary plus any known limitations.
7. **Commit.** Run `git add -A && git commit -m "Prompt N: <title>"`.
8. **Continue** immediately with the next numbered prompt. Don't stop to ask for confirmation between prompts.

## Rules that apply to every prompt

- **Single source of truth.** The project JSON (the data model from prompt 2) is the only state. The 2D plan, 3D scene, exports, and AI features all *read from* or *write to* it. Never let the 3D scene hold design state that isn't in the model.
- **Units.** Store all lengths internally in **meters** and angles in **radians**. Convert only at the UI layer (metric or feet-inches).
- **Every mutation is undoable.** All edits go through store actions that the undo/redo history captures.
- **Validate at boundaries.** Use Zod for anything loaded, imported, or produced by AI.
- **Keep it shippable.** Leave the app runnable and the build green after every prompt, so earlier features never break.
- **Tests.** Add unit tests for pure logic (geometry, model operations, AI parsing). Add or extend Playwright smoke tests for major UI flows.
- **Code quality.** Use TypeScript strict mode, small focused modules, and no `any` without a comment explaining why.
- **When blocked.** If something truly can't be done (a missing dependency, an impossible requirement), choose the simplest reasonable alternative. Document it in `PROGRESS.md` under "Deviations" and continue. Only stop if continuing would break the project.
- **Verify on the real machine.** The owner's Windows PC (RTX 4060 Ti 16 GB, Docker Desktop) is the target. Anything that needs a GPU must be verified there with the committed `npm run test:gpu` harness, not only on software GL. Never leave important work in throw-away scripts: commit it.
- **Reference villa.** `reference/villa-reference.png` is the design the owners want recreated (prompts 18–23). Fidelity to it is judged in the app's "Compare with reference" view.
- **Scope.** Don't add features from later prompts early, except minimal stubs that a prompt explicitly asks for.

## Context about the product

- **Users:** two non-technical people designing their own home. Ease of use beats power-user features. Use clear labels, friendly defaults, and forgiving interactions.
- **Building type:** a duplex unit with two connected floors and an internal staircase, built within an existing apartment shell. That shell has a fixed footprint, a height limit, fixed structural columns, and fixed entry and plumbing points.
- **Cost:** everything must be free to run. AI runs locally via Ollama on the owner's Windows PC (RTX 4060 Ti 16 GB). No paid APIs or cloud services are required.
- **Disclaimer:** the app is for visualization and planning, not construction documents. Show an "Indicative only — consult a licensed architect/engineer" note on exports.

## Finish

When every prompt in `prompts/` is `DONE`:
1. Run the full verification once more.
2. Write a `README.md` covering setup, run, build, features, and how to use the AI prompt feature.
3. Write a final summary in `PROGRESS.md`.

Start now with the lowest-numbered prompt that isn't done.
