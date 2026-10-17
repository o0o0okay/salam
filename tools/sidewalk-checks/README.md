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
node tools/sidewalk-checks/flyover-guards.mjs  # splitter-nose guards, posts, clear lanes and repeatable placement
node tools/sidewalk-checks/flyover-signs.mjs  # the bridge's own signage: nameplates, billboards, sign gantries
node tools/sidewalk-checks/estates.mjs  # residential estates: curved road, houses clear of it, cul-de-sac, deterministic
node tools/sidewalk-checks/junctions.mjs  # three-way junctions (closed streets, barriers), roundabout chains, spawn rule
node tools/sidewalk-checks/police-chase.mjs  # a pursuer has to reach a player parked beside / under a flyover (behavioural)
node tools/sidewalk-checks/route-levels.mjs  # the map's road route keeps a flyover's deck road and its ground lanes apart
node tools/sidewalk-checks/mark-ring.mjs  # the mark's light: its breathing circle, and the car arriving on it (on the mark's level)
node tools/sidewalk-checks/radar.mjs  # the radar: the map's picture in tiles (where the world is), the chase on its rim, the search zone
node tools/sidewalk-checks/street-furniture.mjs  # half the hydrants (the rest of each block unchanged), metered parking bays, red telephone boxes
node tools/sidewalk-checks/ramp-pitch.mjs  # every vehicle follows a flyover's ramps: no nose or tail in the concrete, and the street stays the street
node tools/sidewalk-checks/plan-fuel.mjs  # filling station: forecourt plan + front elevation, 3 brands
node tools/sidewalk-checks/plan-shops.mjs  # shopping street: block plan + a parade, shop by shop
node tools/sidewalk-checks/plan-airunit.mjs  # police air unit: the searchlight pool on the road + the beacon cycle
node tools/sidewalk-checks/plan-roadworks.mjs  # one closed lane: the slabs as laid, the kit around them, the old slab
node tools/sidewalk-checks/plan-flyover.mjs  # grade-separated interchange: plan + two sections
node tools/sidewalk-checks/solid-index.mjs  # the solid index (solidsNear) returns exactly what the old 3x3 scan returned
node tools/sidewalk-checks/districts.mjs  # district map: all four present, mostly one region each, the block mix per district, estates only in suburbs
node tools/sidewalk-checks/car-models.mjs  # merged car bodies: triangles kept, geometry shared and bounded, light materials per car
node tools/sidewalk-checks/ice-cream.mjs  # the ice cream van: its model and lettering, its share of the traffic, its chime
node tools/sidewalk-checks/garbage-truck.mjs  # the garbage truck: its model in three liveries, its open mouth, its flashing beacons, its share of the traffic
node tools/sidewalk-checks/log-spill.mjs  # log trucks spill their load: the logs come off a hard hit, roll, hurt the cars and knock the street down, break up, crumble away
node tools/sidewalk-checks/site-passage.mjs  # a construction frame's open ground floor: cars drive in under the first floor, tall ones stop at it, the camera comes down under it
node tools/sidewalk-checks/shot.mjs  # flat-shaded snapshot of any view (NO_MERGE=1): node shot.mjs out.png eyeX eyeY eyeZ lookX lookY lookZ
```

node tools/sidewalk-checks/boot-check.mjs  # imports every game module in order (catches load-time breakage)

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
* the grade-separated interchange (`js/flyover.js`) exists at its one junction: all four neighbouring blocks
  raise their own quarter of it (the deck stands 7.2 m up — 6.2 m of headroom under the slab, so a bus or a fire
  engine drives under it without ducking — and the embankment's solid body is sliced finely enough that no
  stretch of ramp is left standing over an at-grade gap), the deck's driving surface is exactly the height cars
  are settled on, the
  approach slabs lie on their ramps, the parapets leave the drivable width the physics holds cars inside, the
  crossing street's underpass stays clear, and nothing (props, trees, pickups, parked cars, roadworks) is
  planted in the concrete
* the at-grade street beside the structure is a real street: four lanes wide (14.0 m — twice the 7.0 m street it
  was, which was itself twice the 3.5 m lane before it) and its extra width comes out of the *frontage* — the
  building line on those sides steps back by `FLY.frontage` (11.4 m, `FLY.atGrade` − 2.6: the strip the old kerb
  used to stand in), and everything drawn up to that line moves with it: the lot and yard pads, the downtown
  building grid, the suburban house grid, the industrial sheds and their container rows, the mall (building,
  wing, painted rows and bays) and the pinned campuses (hospital, fire station, school, filling station, drawn
  from an offset centre so their walls, solids, bays and fences all shift together) and the front hedges. The
  walkway behind the kerb therefore keeps its width, the city's usual building line is still 12.0 m, and beside
  the lane it stands at 23.4 m (building faces), with the kerb stone at 22.0–22.5 m and the walk up to 24.0 m.
  The lane runs the whole length of the blocks that front the junction *and through the junction*, so the
  pavement on the sides that do *not* carry it stops at `roadEdge()` (22.0 m) instead of at the road edge (8 m)
  — a kerb standing where the lane has to pass would dead-end it at every block. No tree pit, piece of street
  furniture or kerbside bay is planted on it, and the OVERPASS plate is moved out to stand on the pavement
  behind it. Everything the block stands along the lane or the pavement behind it measures from `kerbIn(si)`
  (`PAVE_IN` + `FLY.atGrade` on a lane side), so the streetlights, hydrants, bins, post-boxes, meters and the
  kerbside cars all stepped out with the kerb in one move. The check drives the lane's centre line on both sides
  of the flying road for a whole block, through the structure's own footprint, and fails on the first metre that
  is blocked by the concrete, cut by a raised pavement, or has a solid or a ground-level baked piece (pad,
  walkway strip, path) lying on it — and around every interchange it fails if a building or container stands
  inside the stepped-back building line. The junction that closes the lane off at its far end signals it with
  poles standing 13 m out from the junction centre, which is the pavement behind the kerb at a plain junction:
  with the kerb out at `roadEdge()` (22 m) a pole left at that offset would stand in the carriageway right where
  the ramp comes down, so it steps out onto the pavement behind the widened kerb. The real
  `js/trafficLights.js` runs inside the Node harness and every chunk reports where its poles went, so the suite
  fails on a signal pole standing in the lane (the module used to be stubbed out there, and a pole in the lane
  went unnoticed until it was seen in a screenshot)
* the junctions that sit one block either side of an interchange are opened out the way the flyover does it:
  their pavement corners are cut back on the diagonal by `FLY.chamfer` (4.0 m, measured along each kerb from the
  corner where the two kerbs meet), so the side street runs into them slanted rather than square, and the kerb
  stone, the paving, the border course and the soil beds all turn 45° together on the cut — the pavement's own
  corner piece, rotated about its centre, with its outer face landing exactly on the diagonal. What is left
  between the two faces is the mouth the cut opened, and nothing stands in it any more: the tree rows start past
  it (`stripStops` + the cut + 6 m at each end, the same answer the pavement itself starts from), the hedges,
  the streetlights, the hydrants, the bins, the post-boxes and the meters all ask `cutClear` before they are
  placed, and a kerbside car cannot be parked in it either. The crossings at those junctions are ordinary ones —
  square across the road, painted in the texture's own stripe size and step (0.94 m of stripe to 1.5625 m) — but
  they stand just past the cut, where the kerb a pedestrian actually steps off is: the far end of the cut and not
  the edge of the junction. Each block paints its own half, from its own side of the centre line out to its own
  kerb, so the two halves are one continuous row. The crossings the texture drew for the street before it was
  widened — the ones that now sit in the mouth of the lane — are covered with a coat of the road's own asphalt
  (its material over a plain patch of its texture) so a driver sees one crossing where a pedestrian has one. The suite proves all of it off the
  real geometry: no pavement piece of any kind reaches into the lane beside the structure (the cut's own kerb
  run is pinned to the kerb line, and a rotated piece is tested as the box it is rather than as its bounding
  box), and a sweep of the props and trees around the two junctions beside each interchange finds none of them
  standing inside a cut corner
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
* a parade's window kit comes back centred on its own shop (checked by building a probe parade and measuring
  the kits): the block places that kit at the shop's world position, so a kit carrying the shop's offset along
  the parade as well would move the pane twice and stand the end windows 9-18 m out in the street
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
* a closed lane (a road-resurfacing site) is laid as dark tarmac: several slabs with seams, thin and flush with
  the street, and every site carries its warning sign and cones — the single warm-grey rectangle it used to be
  sat 9 cm proud of the asphalt with the lane markings cut off at its edge, and read as a beige sheet on the road
* the wanted-level air unit's searchlight is held on the player's car: the pool of light is centred on the car
  at every speed (it used to be aimed 0.7 s ahead, which is 28 m past the car at 40 m/s), it sweeps blue then
  red on the police beacon cycle instead of being a plain white spot, and the whole update is driven frame by
  frame through `js/helicopter.js` to prove no NaN and no drift (see `heliLight.js` / `heli-harness.mjs`)
* no wall may stand inside the rotor's reach of the deck, and the deck, its rotor and the whole tail have to
  stay on the roof that carries them (this is what stopped the blades cutting through the neighbouring wing)

`heavyhit.mjs` stitched `js/traffic.js`, `js/collisions.js`, `js/flying.js` and `js/wrecks.js` into one
runnable module — with the game's real `createCar` / `driveCar` / `syncCarMesh` lifted verbatim out of
`js/vehicle.js` — and drove a real car into a real bay: a full-speed ram must never launch a parked
ambulance, must cost it about two or three rams to wreck, must leave one fire burning on the spot, and then
nothing may come back to that bay, not after ten seconds and not after ninety. The wreck that is left has to
be a live one: the test then pins the throttle against the burning hull for five seconds and requires it to
slide metres off its bay with its flames riding along, without ever letting the player drive through it.

`police-chase.mjs` stitches `js/police.js`, `js/flying.js`, `js/collisions.js` and the game's own car physics onto
the world module and parks the player beside an interchange with the hand brake on — the reported case, a player
hiding rather than fleeing. The flying road's carriageway at grade ends at its abutment, so a pursuer that simply
aimed at a player beside the structure drove into the embankment, was thrown off it by its own avoidance probe, and
then followed a grid waypoint round the block: from the driver's seat, police circling the bridge instead of coming
for the car. A pursuer on the ground now reads the whole interchange — it crosses at the junction box under the deck
while that is still ahead of it, otherwise on the ground past the ramp's foot where the retaining walls end, holding
the lane it is in until then — and a pursuer up on the structure with the player below drives on to a ramp in the
lane it already occupies instead of steering at the parapets. The test hands it the hard starts: the player in the
at-grade lane, under the deck, and beside the abutment, with pursuers coming from the avenue's own lanes, the far
at-grade lane, the deck, the ramps and the cross street, and requires the car on the player, at his own height,
every time.

The bridge trap is the second half of that test. A player who sits on the deck, slow, for five seconds has one end of
the structure closed by a checkpoint (up to three cruisers parked across the deck, eight metres beyond the span's end,
on the side he faces) while the cruisers at the other end drive up their ramp and ram him. The harness requires the
checkpoint to park two cruisers on the deck and his hp to reach zero within 45 s; a player below the deck, in a junction
box, must never be given a trap role. Each run prints whether the trap closed, how many cruisers parked and when, and
when the car was destroyed. `structureLevel()` in `js/flyover.js` is the test the trap reads: 'deck' or 'under' or clear,
from the car's own height. The height probe checks six points against it. A trapped player can still be arrested: the
existing BUSTED rule in `js/update.js` applies on the deck as anywhere else, and the test does not model it. A few seeds
still leave one cruiser at the checkpoint, or let the rams push the car off the far ramp.

The shopping streets come from `buildShopParadeMesh()` / `buildShopFrontMesh()` in `js/world.js`: fourteen
invented businesses (cafe, bakery, pizza, market, pharmacy, books, barber, donuts, flowers, hardware, laundry,
shoes, arcade, grill), each with its own fascia colour, striped awning, blade sign, lit window pane with
silhouetted goods, a door with an OPEN plate and a few outdoor props. Each shopfront registers its own
`ch.shop` record and a 'shopfront' solid. The parade hands each shop's glass back as its own kit and the block
places that kit at the shop's world position (the kit keeps its window centred on the shop, so the pane and its
pivot are the shopfront itself); `breakShopFront()` in `js/collisions.js` takes the pane out above
5 m/s and the frame stops being a wall, so the car rolls on into the shop mouth. A pane placed twice — the
kit offset *and* the shop's world position — used to lay a 7.6 x 2.35 m cream/green sheet in the carriageway
outside every shopping centre; §2d-4a keeps that from coming back. `plan-shops.png` draws a
block and one parade from the built parts, and `heavyhit.mjs` crawls into a window and then hits it at 16 m/s.

The filling station comes from `buildFuelStationMesh()` in `js/world.js`: three invented brands (a white
canopy with the red band, the yellow-and-red one, and the cool blue night canopy) each build a flat roof with
a lit underside, the brand name on the fascia and the sides, two islands with two dispensers apiece, a glazed
convenience store with a lit interior and a tall price pylon on the kerb. The four dispensers are separate
destructible solids (`ch.pumps`): `breakPump()` in `js/collisions.js` shears one off its island above 6 m/s,
tumbles it with the wreckage, and leaves the spilled fuel burning; `heavyhit.mjs` checks that a gentle nudge
leaves it standing and a fast hit does not.

The school comes from `buildSchoolMesh()` in `js/world.js`, one per district plus a pinned one on the block
`(0,1)` straight up the street the player starts on. Every campus is a classroom wing with two bands of
windows and its own entrance lobby (`SCHOOL` board, clock, canopy, steps), a taller gymnasium signed
`GYMNASIUM`, and a grass yard closed off by a chain-link fence that can be torn down: a low concrete plinth, posts every 3 m,
two rails and a light mesh panel, with real collision volumes (`o.fence` solids) so a car cannot roll through it
until it does. The fence is drawn as seven runs that leave exactly two openings — a 6 m school gate in front of
the entrance path and a 4 m service gate by the lot. Each run is handed to the block as stand-alone tear-off
panels (15 across the yard, up to 8 m each: the rails, the mesh panel and the posts standing over it), recorded
as a solid of its own wired to the panel a car hits (`ch.fencePanels`). A hit over `FENCE_BREAK_V` (4 m/s,
divided by `sqrt(mass)` — about 15 km/h in the player's car, while a 9 km/h roll-up still just stops) calls
`breakFence()` in `js/collisions.js`: that panel's solid is dropped and the panel leaves the block, seats
itself on the `flyingFloor` so nothing pops upward, and tumbles off as its own piece while the concrete
plinth stays where it was poured. Only the panel the hit lands on comes down (the ones within
`FENCE_CHAIN_R` of it at most) — the rest of the line carries on standing, so the yard opens exactly where
the car went in and stays fenced everywhere else. §2c-2 checks that every panel is its own solid and its own
owned mesh and that the panels tile their runs exactly with a post every 3 m; `heavyhit.mjs` rolls into the
fence at 9 km/h (it holds), bumps it at 15 km/h (the panel comes off its plinth), watches the torn panel
tumble and settle without sinking through the asphalt, and then drives 18 m in through the gap into the yard
while the panels either side stand their ground. Inside the yard sit the playground (swings, a slide on a 45° roof, a
climbing frame, a see-saw, a sandbox, two spring riders on colour tiles and flag poles) and a marked basketball
court with two hoops; every piece is recorded on the chunk as a named mark (`ch.schoolPlayground`) and checked
to stand inside the fence and off the pavement. Out front is the lot: three rows of staff bays and, along the
kerb, a marked yellow bus stand of three bays where the yellow school buses stand from the first frame
(`ch.busSlots`). The bus itself is a new vehicle kind in `js/carModels.js` (`schoolbus`): bonnet, black grille
and chrome bumper, flat-sided yellow body with three black rub rails and a window band, black `SCHOOL BUS`
boards over both ends with four warning lamps, a stop arm, mirrors, yellow hubs and a white roof panel; it is
parked (never spawned as traffic), it weighs 4.4 so it behaves like the heavy vehicle it is when rammed, and —
like the fire fleet and the hospital's ambulances — a wrecked bus is never replaced: its burnt hulk stays in
its bay. `plan-school.png` draws the block in plan and the building line in elevation; `run.mjs` §2c-2 and
`parking.mjs` hold the fence, the playground, the fleet and the 20 % ceiling that counts the buses.

The police air unit (`js/helicopter.js` + `js/heliLight.js`) aims its searchlight at the car itself, never at a
lead position, so the pool of light stays under the car however fast it is going; around that it is given a
small hand-flown sway — two slow waves across the car (left/right) and two along its heading (up/down the road),
plus a rise and fall of the aim height — so that even on a dead-straight run the circle drifts instead of being
welded to the roof. The beam is aimed a little short of that point, by exactly the distance the cone's axis
travels between the aim height and the tarmac (about a metre from 38 m up), which puts the middle of the lit
circle on the car rather than past its nose, and a light trailing filter sweeps the pool through a hard turn
(lead-compensated, so it introduces no lag at all on a straight). Its colour rides the police beacon cycle:
blue (0x2a6cff) at one end, red (0xff3b30) at the other, both always present, never plain white, with the
brightness pulsing on the same cycle — the same two colours as the light bars on the cruisers.

The roadworks come from the construction-site branch of `generateChunk`: one block in five closes a lane and
dresses it in one of four site styles (cone taper, barrier corridor, dig site, equipment yard). The resurfacing
itself is now three to five dark tarmac slabs laid end to end with a little sideways jitter and a seam between
them, 4 cm thick and 2 cm proud of the asphalt, and the site is registered on the chunk as `ch.roadworks` so
`run.mjs` can assert it: luminance under 80/255 (`#3b3f4a` is the street), no slab over 9.5 m long, in a lane
(0.6-8 m from the road centre line), and a warning sign plus cones within the site's own span. Every style now
lays cones along its patch — the equipment yard used to mark its works with nothing but two drums, which is how
a bare rectangle ended up reading as a sheet on the street in the first place. `plan-roadworks.png` draws one
site in plan, its profile, and the palette this pass replaced.

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
* everything a block builds is *owned* by that block. `bake()`/`bakeRing()`/`mergeSlice()` register their
  merged geometries on `ch.geos`, and the stand-alone merges — street props, bus shelters, scaffolding, shop
  windows, fuel dispensers — register through `own(ch, ...)` on `ch.owned`, which `disposeChunk()` releases.
  That last list was missing: a block that streamed out left the merged geometry of its props, shelters,
  scaffolding, windows and dispensers in the GPU for the rest of the session. Measured against real three.js,
  every kilometre driven stranded roughly 4,500 geometry buffers (a three minute run reached 31,000); after the
  fix the live geometry count stays flat at ~3,200 however far the car goes, which is what stopped long runs
  from getting heavier. §2g in `run.mjs` builds a fresh shopping street, disposes it, and fails if any piece the
  block owns survives.
* `js/renderer.js` exposes quality tiers (render resolution + shadow-map size) and turns the shadow map into a
  cadence instead of a per-frame redraw; `js/main.js` walks the tiers from a rolling frame-time average.
* `js/update.js` refreshes the HUD text and the radar canvas at ~20 Hz instead of 60.
* the air unit's searchlight update is allocation-free (it reuses its vectors) and never toggles
  `light.visible`, because a change in the visible light count makes three.js recompile every material.

`plan.mjs` draws the generated band rectangles, tree pits and street furniture as top-down plans — the
same data the renderer consumes — which is how the paving styles were eyeballed during development.

Both scripts are development tools only; the game itself needs none of this.

### Flyover parapet penetration regression

`heavyhit.mjs` checks the whole oriented vehicle footprint against the inside face of each parapet,
not just the car centre and half-width. It reproduces the sideways-car penetration (previously 1.09 m),
a car shoved outside the unpadded structure lookup, and a police ram after the first wall pass.
The same-frame post-pair collision pass must remove the overlap before mesh synchronization.
A 1,440-case sweep covers both bridge axes, both walls, twelve headings, six vehicle sizes (including
school bus and tanker), the deck, both ramps and their low approaches. Below-deck/above-coping cases
must remain untouched. The existing climb, descent, crest-hop and underpass behaviour checks still run.

The police chase suite retains its original time limits: police brake only for a sharp lateral exit
into the at-grade lane, rather than relying on the old ability to cut through the wall. No persistent
maximum-speed change is made.

### Map route across an interchange

The map's road route (`js/map.js`) treats an interchange as two roads, one above the other: the **deck road** (the
main road's own carriageway, up a ramp, over the deck, down the far ramp) and the **ground road** (the at-grade lane on
each side of the structure, 15 m from the main road's centre line, which crosses the street under the deck at grade).
They meet only at the junctions beyond the ramps' feet. A place joins only the road of its own level: a car riding a
ramp or the deck joins the deck road, a car at grade (beside the structure or under the deck) joins the ground roads,
and a mark inside the structure's outline joins the deck road, anywhere else the roads at grade.
`route-levels.mjs` covers all 16 interchanges (4 long bridges), both sides, from cars all round them: a pin on the lane
beside a ramp is reached along that lane and never from the ramp above it (the old route ran up the ramp); a pin on a
ramp or the deck is reached over the deck road; a pin on the street under the deck is reached on that street; a route
changes level only at grade and never runs through a ramp's embankment; a car on the lane or under a deck gets a route
(it used to get none: the lane is further than the 12 m a car may step onto a street); the live route is given up when
the car is on the other level; the 3D arrows lie on the road the route is on; and away from interchanges the route
lengths are the plain grid's.

### The mark's light and its circle

The marked place stands in the world as a column of red light (`js/markBeam.js`) with a circle of light on the road
round its foot. The circle breathes: it grows from 3.2 m to 5.6 m and shrinks back once every 1.4 s. It is the place to
drive to. Once the car's centre is inside the circle at its largest, the mark is done: it is cleared everywhere (the
map, the radar, the road arrows), and the light goes out in 0.6 s (the circle opens out and fades, the column narrows and
fades). The light stands on the mark's own level, using the same rule as the route (`onDeck` in `js/map.js`): on the
ground for a mark on the street under a deck, on the deck for a mark on the deck, and on a ramp's surface with the circle
tilted to the slope. The car arrives only on that level. `mark-ring.mjs` checks the breathing (range, period,
smoothness), that the mark is finished exactly when the car reaches the circle and not before, and the flourish. It also
checks that a car parked just outside does not finish the mark, and that a fast car crossing the circle between two
frames does (a jump across the map does not). A mark set with the car already on its circle waits until the car has been
off it. Finally it covers the deck, under-deck and ramp levels, and that clearing the mark on the map puts the light out
at once.

### The radar

The radar (`js/radar.js`) shows the map's own picture of the city round the car (`paintGround` in `js/map.js`: the
blocks, the buildings with their roofs, the parks and trees, the water, the streets, the interchanges), turned with the
car, and on it what matters for getting away: each cruiser as an arrow the way it faces, a red line from each one that
sees you, the search zone once they have lost you (the circle round `searchCentre` in `js/police.js`, the 75 m they
patrol), a red-and-white bar across a roadblock or a bridge checkpoint, the spike strips, the pickups and the traffic. The
rim tells the chase: red and blue while they see you, amber while they search, white with no chase. Cruisers and
blockades beyond the edge have marks on the rim in their direction. The radar looks further as the car goes faster (95 m
to the rim standing, 140 m flat out) and dims at night. The picture is made in tiles of one block, a few a frame (one, then
more only while the frame has spent less than 3 ms: a tile takes 1.5 to 5 ms).
`radar.mjs` checks that every building of a block is in its tile where the map has it, mirrored as the map is, and that
the tile has no place names; that each tile lands on the radar exactly where its part of the world is (the car at the
centre, ahead straight up); that the tiles come at most three a frame, nearest first, until the circle is covered, are kept
while the map's data under them is the same and made again when it changes, and that no more than 64 are kept. It also
checks the range (easing, within its bounds), the rim's three states, the search centre (the last sighting moved on along
the car's last motion for up to 5 s, or a hiding car itself), the rim marks (one a cruiser, one a blockade, none past
260 m) and the canvas's pixels on a sharp screen.

### Street furniture: hydrants, parking meters, telephone boxes

The pavement's hydrants are half as many as before (`HYDRANT_KEEP` in `js/config.js`). A spot is rolled as it always
was, and only the lower half of that roll plants a hydrant. A spot left empty stays taken while the block is laid out, so
nothing else in the block moves: not the furniture, the hedges or the street trees placed after it, and not the trees of
the baked map. On busy blocks (downtown, shopping streets, the bazaar, malls, banks) a kerb side now and then has metered
parking (`METER_SIDE_P`): two to five bays painted on the road along the kerb (6 m long, 2.3 m out), with a red parking
meter at the head of each bay, on the pavement just behind the kerb stone and facing the street. Many a
pavement has a red telephone box, the K6 kiosk (`BOOTH_P` by block type: two busy blocks in three, nearly every bank,
hospital, school and filling station, about 930 on the island). It is 0.91 m square on a dark plinth and 2.5 m high,
glazed in eight rows of three panes on every side. The TELEPHONE sign is in the frieze of all four sides, with a crown in
the arch over each under the domed roof. Its door faces the pavement and its back the street. At night it is lit inside:
its glass glows warm and its signs white (`ASSET.litMats`).
Both have generators of their own and are laid last, where nothing else stands. Both break like any street prop: the
meter spills its coins, the box goes in a shower of glass. A prop's plain colours are now merged into one
vertex-coloured mesh (`mergeStandalone` in `js/chunkBake.js`), so a meter is one draw call, and every prop costs one draw
call plus its glass, glowing or textured parts. `shot.mjs` draws those vertex colours.
`street-furniture.mjs` builds 324 blocks twice, as the game is and with every hydrant spot planted. It checks that they
are the same block in every solid, tree and other prop (meters and booths included), that half the hydrants are left,
and that the hydrants left out are the empty spots. It checks the bays (their sides, corners, bus stops, runs and paint,
and the meter at each bay's head facing the street) and the booths (one at most a block, in as many blocks as
`BOOTH_P` gives their types, behind the kerb, back to the street). With the game's own props it checks that a meter or a booth stands clear of everything else,
that a meter is one mesh and a telephone box three: its plain parts (the roof's vaults merge in with its boxes), its
glass and its signs. It checks that the box has a K6's size and colour and its four signs, that it is lit at night, and
that a car knocks either down.

### Long vehicles on the ramps

A car follows the road by sampling it at its centre and at its two ends (`driveCar` in `js/vehicle.js`): it sits at the
higher of the centre and the ends' mean, and leans by the slope between the ends. Which surface an end stands on, the
ramp or the street under it, is up to `surfaceAt` in `js/flyover.js`. It takes the structure only within `FLY.on` of the
car's own height. A ramp climbs 1 in 6.25, so a probe more than 5 m uphill of a car's centre is more than `FLY.on` above
it. For the fuel tanker and the semis with a box, a flatbed, a lowboy or logs (11 to 12 m long), the uphill end read the
street and the lean came out backwards: nose down into the ramp on the way up, tail into it on the way down, as much as
2.7 m. Now `surfaceAt` takes a `reach`: how far the point is from the car along the road. The same ramp may be up to
`reach * RAMP_SLOPE` higher there, and `driveCar` passes each end its distance. A car at grade still reads the street
under a deck 7.2 m up, because that test passes only within 1.8 m.
`ramp-pitch.mjs` drives every kind in `CAR_DIMS` over four interchanges with the real `driveCar` and `syncCarMesh`: both
roads, one- and two-junction bridges, both ways, at 8 and 18 m/s. It holds the body as drawn against the road under it:
along its whole length the wheel line stays within 0.25 m of the surface. That margin is the lean's deliberate smoothing
as a nose meets a ramp's foot at speed. Halfway up a ramp the body leans at the ramp's grade, nose up, and halfway down
nose down. It then drives every kind at grade across the street under each deck and along the lane beside each structure
(620 drives) and checks that none is lifted onto the concrete.

### The ice cream van

The ice cream van (`icecream` in `js/carModels.js`) is a white step van with a flat-fronted cab and a short bonnet, its
livery band and roof line blue or red. On the kerb side (the van's right: traffic drives on the right) is the serving
window under a striped awning in the other colour of the pair, with the menu board and its row of ice creams under it, a
painted cone beside it and ICE / CREAM by the cab. ICE CREAM runs along the other flank, over painted ice creams, and
across the rear doors. On the roof are the big waffle cone with its three scoops (strawberry, mint and chocolate), the
loudspeaker horn and the cooling unit. It is one civilian car in 25 (`CIV_KINDS` in `js/civilians.js`), about five among
the 130 cars around the player, and it takes its time (6 to 8.5 m/s). As it goes it plays Greensleeves (`updateIce` in
`js/audio.js`), like a music box: the nearest van within 75 m sets the volume, louder the nearer it is. Its notes are
scheduled a little ahead on the audio clock, so the tune keeps its time whatever the frame rate. A note whose time passed
while the frames stalled is skipped, not struck late. The chime is silent while the game is not running and with the
sound off (B), and after a silence it starts from the top.
The pixel lettering it shares with the school bus (`busSignGeometry`) used to set its letters a pixel and a gap apart,
two pixels on top of each other, so the bus boards never read `SCHOOL BUS`. The letters now stand a letter and a gap
apart; the bus's are 0.2 m high (they were 0.32), so the 1.74 m of `SCHOOL BUS` fits its 1.98 m board, centred on it. A
row's run of lit pixels is one box instead of a box a pixel: the same face from two thirds as many boxes.
`ice-cream.mjs` checks the model: inside its `CAR_DIMS` box and 4.3 m to the top of its scoops, the awning out on the kerb
side in the other colour, the livery band, the cone and its three scoops, ICE CREAM on both flanks and across the rear
doors (its letters side by side: the flank's is 2.15 m long), and the body geometry shared by two vans of one livery. It
checks the traffic share, and the chime on a stand-in audio clock: the tune from its first notes and in time at 60 and
20 frames a second, round again after its 37 notes, louder nearer the van, silent from 80 m or with the game not
running, from the top after a silence, and in time after a stall.

### The garbage truck

The garbage truck (`garbage` in `js/carModels.js`) is a rear-loading refuse truck, 8.7 m long on three axles: one under
the cab and a tandem at the back. The flat-fronted cab has a black grille, mirrors, steps, a trim stripe and two amber
beacons on its roof, with the exhaust stack behind it. The compactor body is ribbed down its flanks, with a logo panel (a
recycling triangle) and a red and white reflective strip along its foot; between the axles are the guard rails, the fuel
tank and the battery box. At the back the tailgate's face slopes out over the loading mouth, and the mouth is open: bags,
a blue bin, a carton and odds and ends lie in it, in front of its dark back wall. Under it are the red and white chevron
bar, the crew's steps and grab handles; the hydraulic rams run up the tailgate's sides and two more beacons stand on top.
It comes in three liveries (`GARBAGE_LIVERIES`): green with a white cab, grey with orange trim, and white with a yellow
band. Two trucks of one livery share their geometry. The four beacons are a light material the truck owns, so they are
not merged with the body: `syncCarMesh` (`js/vehicle.js`) flashes them 1.6 times a second, each truck on its own phase,
and they go dark on a wreck. `removeCar` frees that material. It never freed the school bus's and the fire engine's
amber lights either, and now does. The truck is one civilian car in 26 (`CIV_KINDS` in `js/civilians.js`), about five
among the 130 cars around the player. It drives like the cement mixer, heavy and slow, and crawls along its round at
5.5 to 8 m/s.
`garbage-truck.mjs` checks the model in each livery: inside its `CAR_DIMS` box and 3.6 to 4 m high, three axles (one
under the cab, a tandem at the back) with a tyre each side, the cab in its colour with its windscreen, the trim stripe
and the exhaust stack. Rays from behind check that the tailgate's face slopes out over the mouth, that the mouth is open
(every ray goes past the face, and the back wall stands well inside it) with rubbish in four colours or more, and that
the chevron bar is red and white. Rays from the side check the reflective strip on both flanks, and the white truck's
band runs down both flanks. It checks the four beacons, two on the cab roof and two on the tailgate, in an amber light
each truck owns, and the geometry two trucks share. On real cars (`createCar`, `syncCarMesh`) it checks the flashes,
about 1.6 a second and lit for about 0.4 of each, two trucks out of step, the dark wreck and the freed material, and
then the traffic share.

### Log trucks spill their load

A log truck (`logtruck`) that takes a hard hit loses its load. The six logs on its trailer are a group of their own
(`userData.cargo`: three meshes, the bark in two shades and the light cut ends, shared by every log truck), laid out by
`LOG_LOAD` in `js/carModels.js`. A crash that closes faster than `LOG_SPILL_V` (8 m/s, `js/config.js`) takes them off
(`carCar` in `js/collisions.js`), and so does the truck's wreck (`wreckCar` in `js/damage.js`). A nudge in a queue does
not, and a truck spills once. `spillLogs` (`js/logSpill.js`) hides the load and sends six loose logs off from where they
lay, with the truck's own speed, over the side each lay on and on the way the hit shoved the trailer. Until a log is
clear of its truck the trailer bed holds it up and it slides off over the side, so none drops through the trailer.
A loose log is a small body of its own, moved every frame after the cars (`updateLogs`, called from `js/update.js`). It
falls, knocks on the road and hops; it rolls easily across its length and hardly slides along it (`LOG_ROLL_DECEL`,
`LOG_SLIDE_DECEL`), so it ends up lying across the road. Two logs meet as two cylinders: one can come to lie on another
(across its middle, or across two logs), and one held up well off its own middle tips off. Against the world a log goes
through the car tests (`collideSolids`, `collideProps`, `collideTrams`, `collideFlyover`) as a wrecked car of `LOG_MASS`:
it knocks down street props, parked cars, shop windows, bus stops, pumps and fences, breaks a tree when it is fast, and
stops at a wall. Against the cars it has a contact of its own: the two are pushed apart by their masses, and the car is
hurt by the closing speed above `LOG_HIT_MIN` (`LOG_DMG_CAR` a m/s, the player's car `LOG_DMG_PLAYER`). A log at 10 m/s
wrecks a family car and a light patrol car driving into one at speed is wrecked; the armoured tiers take less. A log
the player spilled credits the player with what it wrecks, a civilian it hits panics, and a log that runs into another
log truck spills that load too. The traffic slows for a log lying in its lane and stops short of it on the handbrake
(`logAhead`, used by `civAI`); the police do not, so a spill is something to lead a chase into. The hits knock with a
wooden thud (`sfx.thud`) and shed bark chips.
A log is no wall, though: every blow wears it down. `LOG_HP` (20) is what it can take; a blow between a log and a car
takes `LOG_WEAR` (5) off it for every m/s of closing speed over `LOG_HIT_MIN`, times the reduced mass of the two (the
heavier the car, the harder the blow), once a blow (a car pushing a log along wears it once in 0.3 s, not every frame).
So the player's car breaks a log at about 8 m/s (29 km/h), a family car or the lightest patrol car at about 9, a bus or
a heavy truck at 5 or 6; a slower knock cracks it (a few chips of the light wood fly), and two or three of those break
it. A knock off the world wears it by the speed it loses in it over `LOG_KNOCK_MIN` (6 m/s), times its mass: a log
rolling at a wall at 8 m/s breaks up on it and one at 5 m/s does not, and smashing through a street prop costs it
little. The fall off the trailer and the other logs never wear one. The blow that takes the last of a log breaks it up:
it is out of the street that frame, in three pieces and five long splinters (the logs' own two meshes, scaled), with a
burst of bark and light-wood chips, a puff of dust and a crack (`sfx.splinter`). The car is hurt by the blow as before
and goes on through, losing only the blow that would just have broken the log; the piece in its way flies on ahead of it
and off to the side, the others are knocked aside, and none flies into the car. The pieces tumble, bounce, scrape to a
stop and shrink out in under 2.6 s, and touch nothing: a log stops one car, not every car after it.
A log that nothing breaks crumbles away after a time of its own: the six of a load at 0.85 to 1.15 `LOG_LIFE` (20 s),
1.2 s apart, so a load goes a log at a time, with a little dust, shrinking out with its underside on the road. One far from the player goes at once,
and the oldest go first past `LOG_MAX` (48); a new run starts with no logs and no pieces. The loose logs and the pieces
are drawn with two instanced meshes. The cooldown between log hits on a car (`logHitAt`) is set by `createCar`, so a
new run's player car does not carry the last run's clock.
`log-spill.mjs` checks the load on the trailer: its own group, where `LOG_LOAD` says, every vertex on a log, the cut ends'
rims on the bark's edge, nothing of it left in the body, its geometry shared, and no load on any other vehicle. Then the
spill: a nudge does not and a ram does, once; where each log starts, its turn, its bark and its owner; the way they go;
that they come to rest without ever lying in each other, none worn by the fall; that a wreck and a patrol car's ram
spill a load and a box trailer does not. A log on the road: rolling against sliding, coming to rest, turning as it rolls, lying across one log
or two, tipping off one. The cars: the damage by closing speed, the shove and the panic, a family car wrecked, a light
and an armoured patrol car driving into a log, the takedown credit, the turn from a blow off the middle, the player's
car, the chain spill, logs sliding off the trailer and leaving their own truck alone. The breaking: the wear by the
closing speed and the masses, three knocks of a family car at 5 m/s, one blow worn once however long a car pushes, a
family car against an armoured truck at 6 m/s, the pieces (three and five, where the log lay, their lengths, thrown up,
the one in the car's way on ahead and the others aside, drawn after the logs, never in the car nor in the road, gone in
2.6 s), the car going on at its speed less the blow, the logs cracked and broken in the checks above (a family car's
8 and 12 m/s, the patrol cars, the player's car, the chain spill), the patrol car behind the one that broke a log, and
no pieces in a new run. The street, on real chunks: a prop, a tree (fast, and slow, only cracked), a parked car, a shop
window, a building's wall (slow, whole; fast, broken up). The traffic: what `logAhead` sees, and a real civilian car
driven by `civAI` that stops short of a log lying across its lane. And the clearing and the drawing: `resetWorld`, the
two instanced meshes, each log's own `LOG_LIFE`, crumbling with its underside on the road, the distance, `LOG_MAX`.

### Under a construction frame

The half-built concrete frame on a barred street's building site (`siteOn` in `js/world.js`) has an open ground floor.
A car that breaks through the barricades at the mouth drives in under the first floor and on down the lane between the
two rows of columns (3.9 m clear between their faces), the length of the frame, or out at the side between two columns,
across the 2 m alley and through the frame next door. What stops it there is solid: each of the fourteen columns (with
the box that is drawn) and the brick infill along the ground floor. The footprint stays a solid too, as a roof: its
`headroom` is the first floor's underside (3.2 m), and `collideSolids` and `solidAt` treat it as solid only for a car
whose top is above that. A car's top is `c.height`, the top of its model (`carHeight` in `js/carModels.js`, taken once
a kind). So the patrol cars, the vans, the city bus, the fire engine and the ambulance drive in, and the Juggernaut
(`police5`, its light bar at 3.25 m), the fuel tanker, the cement mixer, the semis, the garbage truck and the ice cream
van stop at the first floor. The school bus is exactly as tall as the opening (3.20 m), so the checks leave it out; as
built it stops. The AI asks with its own height (the pursuers' probes and route search, the traffic's
look-ahead); a sight line or a hiding place asks with none, and the roof is open to it. Whole, the roof is still what
the map draws for the frame, and nothing is spawned or set down under it, so the map data needs no new bake.
The chase camera comes down under the first floor (`roofLimit` in `js/camera.js`). The line from the car up to the camera
has to stay `ROOF_GAP` (0.5 m) under the roof for as long as it is beneath it. The limit is also taken from where the car
will be in `ROOF_LEAD` (0.3 s), so the camera starts down before the nose is under the slab, and it follows the limit
down at `ROOF_RATE` instead of dropping onto it. Under the roof itself it is never let nearer the slab than `ROOF_CLEAR`,
and a shake does not lift it. While the car is under the roof the boom is pulled in by up to `DUCK_PULL` (30%); this
follows the car, not the camera, so the camera is not swung back under a roof it has just left. Far from a roof it is
the camera it always was.
`site-passage.mjs` checks, on thirteen frames along both axes, with a crane and without: the roof (the footprint, its
headroom the first floor's underside), a solid on each column and on the brick infill, nothing else solid, the lane clear
for a car the length of the frame and walled for one too tall, 3.9 m between the columns, the map's building for the
frame and the baked map data. It casts rays against the frame as drawn: up from the lane to the first floor's underside,
along the lane at four heights clear, across onto a column, onto the brick and through the open gaps. With the game's
own physics it drives the player's car through every frame, either way, coming out faster than it went in, and twelve
other vehicles that fit. It checks that the seven too tall stop at the mouth, and it covers the side exits, the alley
crossing, a column and the brick infill stopping a car, and the Juggernaut at full tilt. It checks the AI's probes
(`solidAt` with and without a height, a pursuer's look-ahead: a patrol car drives on in, the Juggernaut backs off),
`carHeight` and the camera. Far from a frame the camera matches its old formula step by step. Through three frames at 4
to 40 m/s, either way, the camera checks are: the line to the car never through the slab, never nearer the slab than
`ROOF_CLEAR`, settled at the slab less `ROOF_GAP`, no jump, the boom pulled in, back up a second after it is out, and
under the roof once. Two more cases are checked: a camera swung in over a frame is under the first floor at once, and a
shake does not lift it.

### Flyover approach nose protection

Each flyover quarter owns one yellow/black drum, red/white chevron plate and blue pass-either-side
sign facing approaching traffic, with three orange/white breakaway delineators ahead of it. The
assembly stands just before the parapet foot, slightly inboard so its full width stays outside the
at-grade carriageway; posts stop before the neighbouring pedestrian crossing. Drums use ordinary
solid collision, and posts use the existing breakable-prop lifecycle (not rigid walls).
`flyover-guards.mjs` checks 16 noses / 48 posts across both axes and mirrored nodes, including
sign orientation, lane/crossing clearance and regeneration. `heavyhit.mjs` drives into a drum and
knocks down a post on each axis. Only registered, position-checked nose posts are exempt from the
sidewalk-furniture placement rule in `run.mjs`; all other road-clearance checks remain unchanged.

### Flyover signage

An interchange is signed, not just built. Each of the four blocks around a junction raises its own share of three
signs, in its own quarter of the structure's frame, the same way it raises its quarter of the deck (the builders
are `buildFlyoverNameboard`, `buildFlyoverBillboard` and `buildFlyoverGantry` in `js/world.js`, and they are
plain geometry — box-pixel lettering, no textures, no HTML overlays — so they bake into the block that owns
them and stream out with it):

* **nameplate** — `OVERPASS` on a blue field with a cream border and four bolt heads, hung on the abutment face
  at each of the bridge's four mouths, one per half of the carriageway (the same split the deck's own halves
  use). It stands in the band between the hazard stripe (top 3.75 m) and the deck slab (7.2 m), and it is read
  by the traffic on the road *at grade* — the driver coming up the street who has to choose the at-grade lane,
  and the pavement behind the kerb. A car up on the ramp cannot see it: its own abutment face is below it, out
  of sight behind the ramp's edge — which is what the mounting is worked out from: the board is 0.78 m deep so
  that its face still stands 0.19 m clear of the leaning concrete at its own bottom edge (3.85 m up) while its
  back is buried 0.59 m in that concrete at its top edge (5.35 m).
* **billboard** — a 5.9 × 2.0 m lit board (lambert with an emissive tint, like the bus shelters' ad panels and
  the fuel canopy's lightboxes, so it reads at night) on the deck's coping, one a bridge, at the middle of the
  span: the structure signed to the city it crosses, and to the player coming up the at-grade lane beside the
  embankment. Its two foot plates sit on the coping's top; its lowest part is 0.36 m above the parapet, so the
  deck's traffic keeps its full clear width (15.55 m).
* **gantry** — a leg standing on each parapet's coping at u = ±9 m (a few metres inside the end of the deck,
  over the bridge's own entry) with a 12.72–13.04 m beam reaching in over the carriageway and a 6.0 × 2.0 m
  sign panel over each half of the road, the two blocks' halves meeting over the centre line. The panel hangs
  0.04 m under the beam's underside and 3.00 m off the deck: above the bridge's own traffic, clear of the
  parapet's inner face — the beam reaches to the centre line, not over the lane's full width — and its base
  plate (0.44 m across, centred on the leg) stops at the parapet face, so nothing leans into the clear width.
  It faces the traffic that has just climbed the ramp.

All three stand above the parapet or hang on the concrete outside the drivable width, so none of them needs a
solid: a car on the deck is already held inside the parapets, and a car at grade never reaches them. The
direction each faces is the load-bearing part — a plate that faced its own approach would be read by nobody —
so `flyover-signs.mjs` checks it from the yaw the block recorded, per axis, per approach and per side: the
plates and the gantries face back along the road (one sign per half of the carriageway, all four approaches
covered), the billboards face out across the street the bridge crosses (both sides, never along the road), the
footprint of each stays inside the structure's own width and below/above the levels it has to keep clear, the
billboard is set well back from the gantry leg on its own quarter (never in the same station), and streaming a
block back in gives the same records. An ordinary four-way junction gains none of it. `plan-flyover.mjs` draws
the marks in its plan (red = gantries and billboards, blue = nameplates) and adds the gantry's own section,
B-B, with the clearances above the deck.
