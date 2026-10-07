# Sidewalk check tools

Small Node-only harness that runs the game's real chunk generator (`js/world.js`) against stubbed
Three.js objects, so the procedural sidewalks can be validated without a browser.

```bash
node tools/sidewalk-checks/run.mjs    # invariant checks (exits non-zero on failure)
node tools/sidewalk-checks/plan.mjs   # renders plan views to plan-styles.png / plan-verge-closeup.png
node tools/sidewalk-checks/plan-intersection.mjs   # close-up of one intersection (red line = legal road edge)
node tools/sidewalk-checks/plan-parking.mjs   # mall carpark at night / morning / midday / evening
node tools/sidewalk-checks/plan-hospital.mjs  # hospital car park plan + front elevation + its occupancy table
node tools/sidewalk-checks/plan-helicopter.mjs  # air ambulance close-up: side / front / top
node tools/sidewalk-checks/plan-firestation.mjs  # fire station plan + front elevation + the appliances on station
node tools/sidewalk-checks/parking.mjs   # drives the live parking system frame by frame (behavioural)
node tools/sidewalk-checks/heavyhit.mjs  # drives a real car into a parked ambulance / fire engine (behavioural)
node tools/sidewalk-checks/plan-fuel.mjs  # filling station: forecourt plan + front elevation, 3 brands
node tools/sidewalk-checks/plan-shops.mjs  # shopping street: block plan + a parade, shop by shop
```

`run.mjs` checks, across a 25-block lattice:

* no NaN geometry while merging chunk meshes
* every solid stays inside its block
* street trees stand on the sidewalk, never inside a building or prop
* grass-verge blocks keep their trees in the grass strip; paved blocks keep them in soil beds
* tree pits never overlap the kerbs, and bed edging is always 4 bars per bed
* all four paving styles appear, each with the bands it is supposed to have
* the paving band spans exactly `PAVE_IN + kerb` … `PAVE_OUT` from the road centre line
* no band of any block reaches into a crossing street: every sidewalk strip stays `PAVE_IN` or more away
  from both road centre lines that bound its chunk (this is what kept paving out of the intersections)
* neighbouring strips are not coplanar at block corners (2 mm lift prevents z-fighting)
* car parks follow the shared rule `lotCars(bays, fixed, phase, floor)` from `js/world.js`: at midnight a mall
  keeps 2-3 ordinary cars, never more than 20% of the lot is taken at any hour (ambulances included), and
  midday is busier than midnight
* every hospital block holds two to three ambulances parked in its own car park (three overnight, two by
  day when one unit is out on a call), none of them inside a building volume, and the hospital pinned at
  block (-1,0) is always generated next to the spawn
* every fire station holds three to five appliances, always at least one large engine and one small squad,
  each standing in front of its own bay door without overlapping another appliance, a wall, or the hose
  tower; the station pinned at block (0,-1) is always generated on the block the player starts beside, and
  a 400-station sweep proves every rolled fleet stays in the 3-5 range with both vehicle classes and a door
  line that fits inside its own hall
* every bay of a car park is accounted for exactly once (a standing car, a free bay, or a permanent roster
  slot), every parked car carries the volume it can hand back, and the live occupancy never exceeds the 20%
  ceiling at any hour
* every permanent roster bay names a real vehicle kind and a colour, so the relief path can never call
  `buildCar(undefined)` (that threw inside the frame loop and froze the game); the harness `buildCar` stub is
  deliberately strict and throws on an unknown kind, which is how this class of bug gets caught in Node
* a burnt-out parked vehicle does not stay a static wall: when one wrecks it becomes a real car entity
  (`makeHulk` in `js/collisions.js`, built from the game's own `createCar` so it is a complete vehicle),
  so the player can shove it out of the way while it keeps burning, it stays at the level of the lot it
  was parked on, and `js/wrecks.js` `tickHulks` never cleans it up
* a heavy parked vehicle is not a shell to toss around: `HEAVY_MASS` in `js/world.js` decides which parked
  vehicles (ambulances and fire appliances at 2.5 and above) take a hit like a moving car — they shift a little,
  lose the rammer nearly all of its speed, build up damage and finally burn in place, while light parked cars
  keep the arcade launch; the shove and damage rules are pure functions and are checked for monotonicity
  (heavier must shift less and take less damage), for never exceeding 1.6 m per hit, and for turning a
  full-speed ram into two or three hits on an ambulance rather than a one-hit kill
* a launched car tumbles about its own centre with its body extents attached, and `flyingFloor()` in
  `js/flying.js` holds its lowest corner above the asphalt on every frame of the flight; `heavyhit.mjs`
  integrates a real launch and fails if the body dips under its floor or floats
* the frame budget is protected: sign lettering is merged once per string and shared (a check asserts two
  identical signs hand back the same geometry), no block may merge more than 2600 geometries, a single
  streaming call never builds more than its budget of view blocks, the ring beyond the view is built hidden
  (so nothing outside the view ring is ever drawn), and no geometry transform goes non-finite while generating
* a shopping street carries ten storefronts (two parades of five different businesses each, out of fourteen
  kinds), with names, awnings, lit window displays and outdoor props; downtown blocks hang one to three
  storefronts on the face that looks at the street, and the first-come shopfront keeps the scaffolding away
* no storefront, market stall or parking bay of a shopping street ever stands on the pavement, and no bay
  overlaps a shopfront: the court rows are clear of the parades
* a shop window is a real collision volume that pokes out of its wall; a hit above 5 m/s takes the pane out of
  the frame and leaves the frame open, a crawl only rattles it, and the shop carries on trading behind it
* every filling station has a lit canopy high enough to drive under (6.3 m) and wide enough to cover its whole
  island line, exactly four full-size dispensers standing under it (2.2-2.7 m tall, ~1.1 m across, with the lit
  lightbox, big displays, nozzles and hoses a real one has), and no dispenser or bay inside the store or the
  price pylon; the station pinned at block (-1,-1) is always generated one block from the spawn
* the forecourt registers fifteen bays and a floor of two cars, so the day/night curve keeps it busy at every
  hour (two cars overnight, three at midday) without ever passing the 20% ceiling
* a fuel dispenser blast is sized so it clears the forecourt: everything within 9.5 m takes damage that falls
  off with distance (420 raw at the centre plus a 700 point-blank bonus), which kills a pursuit sedan, a SWAT
  roadblock and even an armoured bearcat caught on the pump, while a bearcat at the edge survives; the shock
  wave shoves cars off the pumps, the player is hurt but their own car is never destroyed, and the fire runs to
  the dispenser beside it on a short fuse (`tickPumpFuses`, called from the update loop)
* nothing respawns: a wrecked appliance or ambulance is never replaced — its burnt hulk stays in its bay,
  still solid, for the rest of the run, and the roster counts only the units that are actually there (the
  night ambulance is the one bay that was never filled, so it still comes on)
* an ordinary car park bay that a crash emptied is refilled by a fresh arrival after `RELIEF_DELAY` (10 s),
  and no other bay is emptied to paper over the gap: `parking.mjs` drives the real system frame by frame and
  fails if a bay is refilled sooner, or if a wreck respawns, or if the day curve stops producing the right
  number of cars
* every hospital rooftop carries a helipad with an air ambulance on it: both rotors present and turning,
  the beacons registered, and the deck at least a rotor-radius wide
* no wall may stand inside the rotor's reach of the deck, and the deck, its rotor and the whole tail have to
  stay on the roof that carries them (this is what stopped the blades cutting through the neighbouring wing)

`heavyhit.mjs` stitched `js/traffic.js`, `js/collisions.js`, `js/flying.js` and `js/wrecks.js` into one
runnable module — with the game's real `createCar` / `driveCar` / `syncCarMesh` lifted verbatim out of
`js/vehicle.js` — and drove a real car into a real bay: a full-speed ram must never launch a parked
ambulance, must cost it about two or three rams to wreck, must leave one fire burning on the spot, and then
nothing may come back to that bay, not after ten seconds and not after ninety. The wreck that is left has to
be a live one: the test then pins the throttle against the burning hull for five seconds and requires it to
slide metres off its bay with its flames riding along, without ever letting the player drive through it.

The shopping streets come from `buildShopParadeMesh()` / `buildShopFrontMesh()` in `js/world.js`: fourteen
invented businesses (cafe, bakery, pizza, market, pharmacy, books, barber, donuts, flowers, hardware, laundry,
shoes, arcade, grill), each with its own fascia colour, striped awning, blade sign, lit window pane with
silhouetted goods, a door with an OPEN plate and a few outdoor props. Each shopfront registers its own
`ch.shop` record and a 'shopfront' solid; `breakShopFront()` in `js/collisions.js` takes the pane out above
5 m/s and the frame stops being a wall, so the car rolls on into the shop mouth. `plan-shops.png` draws a
block and one parade from the built parts, and `heavyhit.mjs` crawls into a window and then hits it at 16 m/s.

The filling station comes from `buildFuelStationMesh()` in `js/world.js`: three invented brands (a white
canopy with the red band, the yellow-and-red one, and the cool blue night canopy) each build a flat roof with
a lit underside, the brand name on the fascia and the sides, two islands with two dispensers apiece, a glazed
convenience store with a lit interior and a tall price pylon on the kerb. The four dispensers are separate
destructible solids (`ch.pumps`): `breakPump()` in `js/collisions.js` shears one off its island above 6 m/s,
tumbles it with the wreckage, and leaves the spilled fuel burning; `heavyhit.mjs` checks that a gentle nudge
leaves it standing and a fast hit does not.

Performance notes (the streaming redesign in this batch):
* `textBlocks()` builds each sign string once and caches the merged geometry, so a shop name costs one shared
  geometry instead of ~150 separate letter boxes.
* `generateChunk(cx, cz, defer)` can hand the merge to the streamer: the chunk's group goes into the scene
  immediately (with the road and paving it draws directly) and `flushChunk()` gathers and merges a few hundred
  pieces per frame inside a 2.5 ms budget, so a block with 600+ pieces no longer lands in a single frame.
* `updateChunks` works to a time budget (6 ms of building, 3 ms of merging, 4 ms of prefetch) rather than a
  block count, keeps one ring of blocks beyond the view built but hidden, and hides/shows blocks as the view
  moves. Callers pass 999 to build everything synchronously (boot and world reset).
* static sub-assemblies (hospital, fire station, filling station, shop parades) are baked into the chunk rather
  than merged in a pass of their own, and props are merged per prop, which cuts draw calls.
* `js/renderer.js` exposes quality tiers (render resolution + shadow-map size) and turns the shadow map into a
  cadence instead of a per-frame redraw; `js/main.js` walks the tiers from a rolling frame-time average.
* `js/update.js` refreshes the HUD text and the radar canvas at ~20 Hz instead of 60.

`plan.mjs` draws the generated band rectangles, tree pits and street furniture as top-down plans — the
same data the renderer consumes — which is how the paving styles were eyeballed during development.

Both scripts are development tools only; the game itself needs none of this.
