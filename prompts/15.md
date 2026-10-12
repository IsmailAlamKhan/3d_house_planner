# Prompt 15 — Villa & Site Mode (rooms, outdoors, landscaping)

## Reference
`docs/reference-villa.png` — a luxury single-storey villa on a plot: a central open "Living & Dining" hall (28′×18′) with a foyer at the front; bedrooms, closets and baths along the left wing; a right wing with bedroom, gaming room, guest room and baths; kitchen and utility; gym, sauna and spa; and, around the building, a garden lounge, infinity pool with deck, outdoor dining under a pergola, kids' play area, front garden with fountain, a covered two-car parking bay, a pedestrian gate and a vehicle gate. Warm lights glow everywhere in the evening look.

## Goal
Let a user design this kind of home too — not only a duplex inside an apartment shell. Add a **site (plot) mode** where the building sits on a plot with outdoor zones, and extend the room/library/AI/lighting features to cover it. Everything stays free, local and procedural (no downloaded assets).

## Tasks
1. **Project kind & site model**
   - Add `project.kind: 'apartment' | 'villa'` (default `apartment`; old files migrate to it) and `project.site`: `plot: Point[]` (boundary polygon), `gates: {id, kind: 'pedestrian'|'vehicle', position, direction}[]`, and `zones: SiteZone[]` where a zone is `{id, name, type: 'garden'|'lawn'|'pool'|'deck'|'patio'|'parking'|'play'|'path'|'water-feature', polygon, material}`.
   - In villa mode the shell footprint is the **building outline** inside the plot; the plot is drawn as a ground layer around it. The wizard (prompt 8) offers "Apartment" or "Villa on a plot" and asks for plot size and building footprint (rectangle, L, U, or custom).
   - Levels: allow 1–3 levels; the stair/void logic from prompts 2–8 must keep working for villas with 2+ levels, and a single-level villa needs no stair.
2. **More room types** (extend the `RoomType` enum, schemas, i18n, 2D colours, area schedule, checker defaults): `foyer, walk-in-closet, gym, sauna, spa, game-room, garage, laundry, pantry, home-theatre, prayer, outdoor-dining`. Give each sensible defaults (min width, minimum area, window need, plumbing need, default floor material) in `ai/layout/defaults.ts` and `checks/types.ts`.
3. **Site editing in 2D**: a "Site" tool group to draw/edit zones (polygon like the room tool), place gates, and pick the zone type and surface. Zones render beneath the building with type colours and labels (name + area), and appear on a separate "Site" level so the level panel can hide/lock them. Undoable, snapping like walls.
4. **3D ground & landscaping**
   - Generate the plot ground (grass by default), zone surfaces (lawn, paving, wooden deck, gravel), a **pool** (water volume with a translucent animated-free water material and a coping border), pergola, low boundary walls/fences with gates, steps/paths.
   - New procedural catalog items (build3D + draw2D, same registry as prompt 5): trees (broad, palm, conifer), shrubs/hedge, flower bed, lounge set, outdoor dining set, sun lounger, trampoline, slide/play frame, fountain, pergola, parasol, BBQ, car (two colours), garden light, gate (pedestrian and sliding vehicle), pool ladder. Add interior items needed by the reference: gym equipment (treadmill, bench, rack), sauna bench, hot tub/spa, gaming desk with monitors, home-theatre sofa + screen, walk-in-closet shelving, car-bay marking.
   - New materials: grass, water, paving stone, decking wood, gravel, pool tile (procedural, real-world UV scale like prompt 6).
   - Garden lights and pool lights are lamp items; in the Evening/Night presets they glow (reuse the lamp mechanism, respecting the quality light cap — add emissive-only glow for the rest).
5. **Look**: add a **"Plan view"** camera preset — a near top-down angled view with the roof/ceilings hidden (dollhouse) and soft ambient occlusion — and a "Marketing render" lighting preset (Evening with warm interior lights and site lights on) so a design can look like the reference image. Offer "Export image" of the current 3D view (PNG) from the export menu stub.
6. **Checks** (extend prompt 8's panel): vehicle gate leads to a parking zone wide enough for N cars (2.7 m each); pedestrian gate connects to the entrance by a path/paving; pool has a safety note if no fence/gate within 1.2 m; every bedroom still needs a window; garage has an exterior opening; plot setbacks (configurable, default 1.5 m) — building must stay inside plot minus setback.
7. **AI & templates**: extend `DesignIntent` with `site` (zones to create) and new room types; extend the offline generator keywords (villa, pool, garden, garage, gym, sauna, game room, parking for N cars, guest room, closet); add template **"Luxury villa"** that reproduces the layout in the reference (central hall, two wings, foyer, rear garden with pool, covered parking) scaling to the plot. The solver gets a wing layout strategy (central open hall + side wings) in addition to the duplex strategy.
8. **Docs**: update `docs/ARCHITECTURE.md` (site model, new layers), README (villa mode), and `PROGRESS.md`.

## Acceptance criteria
- A user can create a Villa project, draw a plot with a building outline, add a pool, deck, lawn, parking bay and gates, and see them in 2D and 3D.
- The "Luxury villa" template (and the offline brief "luxury villa with pool, garden, 2-car garage, gym and sauna") produces a valid layout resembling the reference: foyer + central hall, wings of bedrooms/baths, kitchen, gym/sauna, rear garden with pool, covered parking; all checks run without crashing and unmet constraints are reported in plain language.
- Evening/Night presets show glowing interior and garden lights; the Plan-view preset looks like a top-down model.
- Existing apartment/duplex projects load and behave exactly as before (migration test).
- typecheck, lint, unit tests, build and Playwright pass.

## Out of scope
Terrain/slope, roads beyond the gate, multi-plot neighbourhoods, photoreal textures.
