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

`plan.mjs` draws the generated band rectangles, tree pits and street furniture as top-down plans — the
same data the renderer consumes — which is how the paving styles were eyeballed during development.

Both scripts are development tools only; the game itself needs none of this.
