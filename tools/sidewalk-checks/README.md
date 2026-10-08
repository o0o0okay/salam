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
node tools/sidewalk-checks/police-chase.mjs  # a pursuer has to reach a player parked beside / under a flyover (behavioural)
node tools/sidewalk-checks/plan-fuel.mjs  # filling station: forecourt plan + front elevation, 3 brands
node tools/sidewalk-checks/plan-shops.mjs  # shopping street: block plan + a parade, shop by shop
node tools/sidewalk-checks/plan-airunit.mjs  # police air unit: the searchlight pool on the road + the beacon cycle
node tools/sidewalk-checks/plan-roadworks.mjs  # one closed lane: the slabs as laid, the kit around them, the old slab
node tools/sidewalk-checks/plan-flyover.mjs  # grade-separated interchange: plan + two sections
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
