# AGENTS.md — notes for coding agents

ESCAPE ROAD is a browser low-poly police chase game written in plain ES modules with Three.js.
There is no bundler and no build step. `index.html` loads `js/main.js`; Three.js comes from the CDN
import map (`three@0.160.0`). `package.json` pins the same version as a dev dependency so the Node
tools can run it locally.

## Setup and commands

```bash
npm install          # once: installs three 0.160.0 into node_modules/ (git-ignored)
npm run check        # boot check + the full sidewalk/invariant suite. Run before every commit.
npm run boot         # imports every js/ module in order (catches load-time breakage)
npm test             # invariant checks over the procedural city (tools/sidewalk-checks/run.mjs)
npm run serve        # static preview on port 8000 (open it in a browser to play)
```

Add `?debug` to the page URL (e.g. `http://localhost:8000/?debug`) to show the performance overlay from
`js/perf.js`: fps, frame / update / render ms, draw calls, triangles, geometry and texture counts, plus
the car and chunk counts. It is off by default and the frame loop does not time anything without it.

The audit scripts in `tools/sidewalk-checks/` are documented in its `README.md`. Most `plan-*.mjs`
scripts overwrite the committed PNGs in that folder. Run `git checkout -- tools/sidewalk-checks/*.png`
afterwards unless the user asked to update those images. `shot.mjs` takes an output path, so point it at
`/tmp`.

## Where things are

- `js/world.js` — chunk generation (blocks, buildings, sidewalks, trees, props, parked cars), chunk
  streaming (`updateChunks`) and disposal (`disposeChunk`). Every block is an 80 m square chunk. The top
  of the file documents the chunk record (`ch`), its solids and the geometry lifecycle.
- `js/campus.js` — the hospital (with the air ambulance and the box-pixel lettering), fire station, school
  and filling station builders. `js/shops.js` — shop kits and high-street parades.
- `js/assets.js` — shared materials, textures and geometry (window glass, brick facades, road, paving).
- `js/flyover.js` — the grade-separated interchange numbers (imported by world.js and the harness).
- `js/trafficLights.js`, `js/carModels.js`, `js/props.js`, `js/trees.js` — street furniture and vehicles.
- `js/collisions.js`, `js/damage.js` — car-vs-world and car-vs-car collisions and all damage.
  `ENV_DMG` in `js/config.js` scales the damage from hits on the scenery (walls, trees, props).
- `js/config.js` — difficulty table and tunables. Prefer changing a constant here to editing logic.

## Conventions

- Keep to the existing style: plain ES modules, no new dependencies unless they are needed, and no
  build tooling without asking.
- Procedural geometry is baked into the chunk with `add(...)` and merged per material; pieces that
  must be individually breakable use `own(ch, ...)` and register their solids in `ch.solids`.
- A new building or footprint must stay inside the block bounds (`loX/hiX/loZ/hiZ`) and never reach a
  road. `tools/sidewalk-checks/run.mjs` enforces this and the other invariants; keep it green.
- Do not hard-code a block type for a fixed coordinate unless the tests and the spawn layout are updated
  together (see `generateChunk` in `js/world.js`).
- Don't commit generated output (PNGs from the tools, `node_modules/`, logs).

## Git

- Work on the branch the session names (currently `arena/4047c709-salam`); push only to it.
- Run `npm run check` before committing. Keep commits focused, and say in the message what changed and
  which checks were run.
