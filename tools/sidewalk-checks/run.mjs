/* Invariant checks for the procedural sidewalk ring (kerbs, paving styles, verges, tree pits, furniture).
   Run:  node tools/sidewalk-checks/run.mjs      (exits non-zero when a check fails) */
import { modulePath } from './harness.mjs';
import { heliModulePath } from './heli-harness.mjs';

const world = await import(modulePath);
const { __merge, __checked, textBlocks, generateChunk, disposeChunk, SHOP_TYPES, buildShopParadeMesh, buildSchoolMesh, chunks, updateChunks, swCapture, CHUNK, PAVE_IN, PAVE_OUT, PAD_IN, WALK_Y, BORDER_W, BED, SLAB, ck, lotCars, FONT3D, ambulanceTarget, RELIEF_DELAY, isHeavyParked, parkedShove, parkedDamage, FLY, RAMP_RUN, rampHeight, surfaceAt, insideFootprint, flyoverQuadrants, flyoverNear, nodeAt, alongOf, latOf, isFlyoverNode, atGradeSide, onAtGradeLane, roadEdge, nearestNode, solidAt } = world;
// every vehicle kind the game can build (js/carModels.js); a bay asking for anything else is a bug
const KNOWN_KINDS = new Set(['player', 'police1', 'police2', 'police3', 'police4', 'police5', 'policeMoto', 'policeUnmarked', 'policeVan', 'civ', 'sedan', 'taxi', 'pickup', 'bus', 'schoolbus', 'hatchback', 'suv', 'van', 'sportscar', 'oldclassic', 'limo', 'cementtruck', 'fueltanker', 'ambulance', 'firetruck', 'firesmall']);

let fails = 0;
const bad = m => { console.log('  x ' + m); fails++; };
const HALF = CHUNK / 2;                                  // block half-size = distance from centre to the road line
const KERB_W = 0.5;                                      // kerb stone width: asphalt edge -> inner face
const BAND_LO = HALF - PAVE_OUT, BAND_HI = HALF - (PAVE_IN + KERB_W);
// Radial offsets of a world point from its block centre, for every axis that lies on the sidewalk ring.
// Near a block corner both axes can fall inside the ring, so callers must accept either candidate — a tree
// on the south strip also has an interior x-offset, and picking the wrong axis is a test bug, not a game bug.
const radialsOf = (x, z, cx, cz) => {
  const dx = Math.abs(x - (cx * CHUNK + HALF)), dz = Math.abs(z - (cz * CHUNK + HALF));
  const band = a => a >= BAND_LO - 0.4 && a <= BAND_HI + 0.4;
  const out = [];
  if (band(dx) && dz <= BAND_HI + 0.4) out.push(dx);
  if (band(dz) && dx <= BAND_HI + 0.4) out.push(dz);
  return out;
};
const radialOf = (x, z, cx, cz) => { const r = radialsOf(x, z, cx, cz); return r.length ? r[0] : -1; };
// distance from a world coordinate to the nearest block edge (0 at the edge, CHUNK/2 at the centre)
const edgeDist = (v, o) => { const l = v - o; return Math.min(l, CHUNK - l); };

// Splitter-nose delineators intentionally stand in the approach, not on a sidewalk. Exempt only
// registered posts in the narrow nose footprint; unrelated furniture still obeys the clear-road checks.
const isNosePost = (ch, p) => p.kind === 'delineator' && (ch.flyover?.guards || []).some(g =>
  Math.abs(g.v) + 0.21 < FLY.halfW && g.posts.some(d => d.x === p.x && d.z === p.z)
  && Math.abs(alongOf(g, p.x, p.z)) > FLY.rampEnd
  && Math.abs(alongOf(g, p.x, p.z)) < FLY.rampEnd + 6);

// ---- 1) generate a lattice of blocks: nothing may throw, and no coordinate may be NaN ----
let spawnStreetTrees = -1;
// The spawn district is visited last, so the resident 25-block lattice afterwards is the district the player
// actually starts in: two shopping centres and the pinned hospital, which the car-park checks below inspect.
for (const [x, z] of [[80, 0], [0, 80], [-80, -80], [160, -160], [400, 240], [-320, 640], [0, 0]]) {
  updateChunks(x, z, 999);
  if (x === 0 && z === 0) {
    const home = [...chunks.values()].find(c => c.cx === 0 && c.cz === 0);
    spawnStreetTrees = home.trees.filter(t => radialOf(t.x, t.z, 0, 0) >= 0).length;
  }
}
console.log(`blocks generated: ${chunks.size}   merged boxes: ${world.__checked.geom}   NaN hits: ${world.__checked.nan}`);
if (world.__checked.nan) bad('NaN coordinates produced while baking blocks');
if (chunks.size !== 25) bad(`expected 25 resident chunks, got ${chunks.size}`);

// ---- 2) per-block invariants: solids inside their block, trees on a surface, no clashes ----
let trees = 0, streetTrees = 0, pits = 0, solids = 0, props = 0;
for (const ch of chunks.values()) {
  const bx = ch.cx * CHUNK + HALF, bz = ch.cz * CHUNK + HALF;
  solids += ch.solids.length; props += ch.props.length; trees += ch.trees.length;
  for (const s of ch.solids) {
    if (![s.x, s.z, s.hx, s.hz].every(Number.isFinite)) bad(`non-finite solid in chunk ${ch.cx},${ch.cz}`);
    if (Math.abs(s.x - bx) > 42 || Math.abs(s.z - bz) > 42) bad(`solid escapes its block at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
  }
  const sw = swCapture.get(ch);
  if (!sw) { bad(`chunk ${ch.cx},${ch.cz} produced no sidewalk`); continue; }
  pits += sw.bed.length;
  if (sw.bedEdge.length !== sw.bed.length * 4) bad(`chunk ${ch.cx},${ch.cz}: ${sw.bed.length} beds but ${sw.bedEdge.length} edging bars (expected 4 per bed)`);
  for (const t of ch.trees) {
    const r = radialOf(t.x, t.z, ch.cx, ch.cz);
    if (r < 0) continue;                                 // interior tree (park / downtown plaza / yard)
    streetTrees++;
    if (t.y < WALK_Y) bad(`street tree at ${t.x.toFixed(1)},${t.z.toFixed(1)} is below the paving (y=${t.y})`);
    for (const s of ch.solids) {
      if (s.tree === t) continue;
      if (s.hx > 0 && Math.abs(t.x - s.x) < s.hx + 1.0 && Math.abs(t.z - s.z) < s.hz + 1.0) bad(`street tree inside a ${s.kind} at ${t.x.toFixed(1)},${t.z.toFixed(1)}`);
    }
    for (const pr of ch.props) if (Math.hypot(t.x - pr.x, t.z - pr.z) < pr.r + 1.0) bad(`street tree on top of prop '${pr.kind}' at ${t.x.toFixed(1)},${t.z.toFixed(1)}`);
  }
  for (const b of sw.bed) {
    const roads = radialsOf(b.x, b.z, ch.cx, ch.cz).map(r => HALF - r);      // distance from the road centre line
    const pit = roads.find(d => Math.abs(d - 9.9) < 0.05);
    if (pit === undefined) { bad(`chunk ${ch.cx},${ch.cz}: pit bed is not at the pit radius (${roads.map(d => d.toFixed(2)).join('/') || 'off the sidewalk'})`); continue; }
    if (pit - BED < PAVE_IN + KERB_W + 0.5) bad(`chunk ${ch.cx},${ch.cz}: pit bed overlaps the kerb stone (inner edge at ${(pit - BED).toFixed(2)})`);
    if (pit + BED > PAVE_OUT - BORDER_W - 0.5) bad(`chunk ${ch.cx},${ch.cz}: pit bed overlaps the border course (outer edge at ${(pit + BED).toFixed(2)})`);
    if (Math.abs(b.y - (WALK_Y + 0.05)) > 1e-9) bad('pit bed is not seated on the paving');
  }
  for (const e of sw.bedEdge) if (e.h !== 0.3) bad('pit edging has the wrong height');
}
console.log(`chunks checked: ${chunks.size}   solids: ${solids}   props: ${props}`);
console.log(`trees: ${trees} (street: ${streetTrees})   tree pits: ${pits}`);
console.log(`spawn block (0,0) street trees: ${spawnStreetTrees}`);
if (spawnStreetTrees < 6) bad(`the spawn block only got ${spawnStreetTrees} street trees`);

// ---- 2b) car parks: a night floor, a 20% ceiling, day busier than night (shared rule from world.js) ----
{
  const counts = [];
  let mallBlocks = 0, hospitalBlocks = 0, ambulances = 0;
  for (const ch of chunks.values()) {
    if ((ch.ambulanceSlots || []).length) ambulances += ch.ambulanceSlots.filter(sl => sl.car).length;
  }
  for (const ch of chunks.values()) {
    const bays = ch.parkingTotal || 0;
    if (!bays) continue;                                   // not a block with a car park
    const fixed = ch.parkingFixed || 0;                    // vehicles parked there for good (ambulances)
    const floor = ch.parkingFloor || 2;
    // env.phase: 0 = 06:00, 0.25 = 12:00, 0.5 = 18:00, 0.75 = 00:00
    const cars = [0.75, 0, 0.25, 0.5].map(ph => lotCars(bays, fixed, ph, floor));   // night / morning / noon / evening
    const atNight = cars[0], atMorning = cars[1], atNoon = cars[2];
    counts.push([bays, fixed, ...cars]);
    if (fixed) hospitalBlocks++; else mallBlocks++;
    // the 20% ceiling counts every vehicle standing in the lot: ambulances (two by day, three at night, see
    // ambulanceTarget) and a school's yellow buses, which stand in their bays the whole run
    const amb = ph2 => ((ch.ambulanceSlots || []).length ? ambulanceTarget(ph2) : 0) + (ch.busSlots || []).filter(sl => sl.car).length;
    const phases = [0.75, 0, 0.25, 0.5];
    const vehicles = (n, i) => n + amb(phases[i]), cap = Math.floor(bays * 0.2);
    cars.forEach((n, i) => { if (vehicles(n, i) > cap) bad(`chunk ${ch.cx},${ch.cz}: ${vehicles(n, i)} vehicles exceeds 20% of ${bays} bays (${cap})`); });
    if (atNight < floor) bad(`chunk ${ch.cx},${ch.cz}: ${atNight} cars at night is below the floor of ${floor}`);
    if (fixed === 0 && (atNight < 2 || atNight > 3)) bad(`chunk ${ch.cx},${ch.cz}: mall has ${atNight} cars at night (want 2-3)`);
    if (atNoon <= atNight) bad(`chunk ${ch.cx},${ch.cz}: ordinary cars are not more numerous by day (${atNight} -> ${atNoon})`);
    if (atMorning < atNight) bad(`chunk ${ch.cx},${ch.cz}: morning emptier than midnight (${atMorning} < ${atNight})`);
  }
  if (!mallBlocks) bad('no shopping-centre block with parking bays was generated');
  if (!hospitalBlocks) bad('no hospital block with ambulances was generated');
  const sample = counts[0];
  if (sample) console.log(`lots: ${mallBlocks} mall + ${hospitalBlocks} hospital blocks (${ambulances} ambulances), sample: ${sample[0]} bays, ${sample[1]} permanent, ordinary cars night/morning/noon/evening ${sample.slice(2).join(' / ')}`);
}

// ---- 2c) hospital: signs, ambulance bays and a permanent ambulance presence ----
{
  const hospitals = [...chunks.values()].filter(ch => (ch.ambulanceSlots || []).length);
  for (const ch of hospitals) {
    const amb = ch.solids.filter(o => o.parked && o.parked.kind === 'ambulance');
    if (amb.length < 2) bad(`chunk ${ch.cx},${ch.cz}: only ${amb.length} ambulance(s) in the car park`);
    // ambulances must sit in front of the campus, not inside a wall
    const walls = ch.solids.filter(o => o.kind === 'building');
    for (const a of amb) {
      const inside = walls.some(w => Math.abs(a.x - w.x) < w.hx && Math.abs(a.z - w.z) < w.hz);
      if (inside) bad(`chunk ${ch.cx},${ch.cz}: an ambulance is parked inside a hospital building`);
    }
  }
  {
    const H = world.buildHospitalMesh(0, 0, Math.random);
    const parts = g => { let n = 0; const walk = o => { n++; for (const c of o.children || []) walk(c); }; walk(g); return n; };
    // The lettering is merged into one mesh per sign now (it used to be one mesh per letter pixel block), so the
    // part count is much lower than it was while the model still carries everything: floors, wings, the pad.
    if (parts(H.group) < 120) bad(`the hospital model is too thin (${parts(H.group)} parts)`);
    if (parts(H.heliMain) < 2 || parts(H.heliTail) < 2) bad('the air ambulance is missing a rotor');
    if (parts(H.heliBody || { children: [] }) < 0) void 0;
    if (!H.heliBeacons || H.heliBeacons.length < 2) bad('the air ambulance has no beacons');
    console.log(`hospital model: ${parts(H.group)} parts + air ambulance with ${parts(H.heliMain)}-part main rotor`);
  }
  const pinned = chunks.get(ck(-1, 0));
  if (!pinned) bad('the pinned hospital block next to the spawn was not generated');
  else if (!(pinned.ambulanceSlots || []).length) bad('the pinned block next to the spawn is not a hospital');
  else console.log(`hospital: ${hospitals.length} campus(es), pinned block (-1,0) has ${pinned.ambulanceSlots.filter(sl => sl.car).length} of ${pinned.ambulanceSlots.length} ambulance bays taken, ${pinned.parkingTotal} bays in total`);
  // the lettering must cover every character a sign uses
  for (const ch2 of 'HOSPITAL EMERGENCY 12345') if (!FONT3D[ch2]) bad(`FONT3D is missing the glyph '${ch2}'`);
  // every hospital rooftop carries a helipad with an air ambulance on it, rotors and all
  for (const ch of hospitals) {
    const h = ch.heli;
    if (!h) { bad(`chunk ${ch.cx},${ch.cz}: hospital has no rooftop helicopter`); continue; }
    const parts = g => { let n = 0; const walk = o => { n++; for (const c of o.children || []) walk(c); }; walk(g); return n; };
    if (parts(h.rotor) < 2) bad(`chunk ${ch.cx},${ch.cz}: main rotor has no blades`);
    if (parts(h.tail) < 2) bad(`chunk ${ch.cx},${ch.cz}: tail rotor has no blades`);
    if (!h.beacons || h.beacons.length < 2) bad(`chunk ${ch.cx},${ch.cz}: air ambulance beacons missing`);
    // the deck sits on a roof, high above the lot and inside the campus
    if (h.y < 6 || h.y > 20) bad(`chunk ${ch.cx},${ch.cz}: helipad deck at height ${h.y.toFixed(2)} m looks wrong`);
    const relX = h.x - (ch.cx * CHUNK + CHUNK / 2), relZ = h.z - (ch.cz * CHUNK + CHUNK / 2);
    if (Math.abs(relX) > 22 || Math.abs(relZ) > 22) bad(`chunk ${ch.cx},${ch.cz}: helipad deck is outside the campus`);
    // the deck must be at least as wide as the rotor, or the blades overhang it
    if (!(h.padR >= h.rotorR + 0.5)) bad(`chunk ${ch.cx},${ch.cz}: pad radius ${h.padR} m is too small for the ${(h.rotorR * 2).toFixed(1)} m rotor`);
    // and the whole deck has to sit on the roof that carries it, so the platform never hangs in mid-air
    const host = (h.volumes || []).find(v => v.top <= h.padY && v.top > h.padY - 3 && Math.abs(v.x - h.padX) <= v.hx && Math.abs(v.z - h.padZ) <= v.hz);
    if (!host) bad(`chunk ${ch.cx},${ch.cz}: the helipad deck is not standing on any campus roof`);
    else {
      const overX = Math.abs(h.padX - host.x) + h.padR - host.hx, overZ = Math.abs(h.padZ - host.z) + h.padR - host.hz;
      if (overX > 0 || overZ > 0) bad(`chunk ${ch.cx},${ch.cz}: the deck overhangs the ${host.name} roof by ${Math.max(overX, overZ).toFixed(2)} m`);
      // The blades and the whole tail must stay on that roof as well. The aircraft faces +z, so its nose and
      // rotor reach towards +z and its tail boom towards -z; signed margins keep both ends honest.
      const front = h.rotorR, tailBack = h.rotorR + 1.9;
      const roofFar = host.z + host.hz, roofNear = host.z - host.hz;
      const frontMargin = roofFar - (h.z + front), tailMargin = (h.z - tailBack) - roofNear;
      if (frontMargin < 0) bad(`chunk ${ch.cx},${ch.cz}: the nose/rotor overhangs the ${host.name} roof by ${(-frontMargin).toFixed(2)} m`);
      if (tailMargin < 0) bad(`chunk ${ch.cx},${ch.cz}: the tail overhangs the ${host.name} roof by ${(-tailMargin).toFixed(2)} m`);
      ch.heliRoof = host.name;
      ch.heliMargin = Math.min(host.hx - Math.abs(h.padX - host.x) - h.padR, frontMargin, tailMargin);
    }
    // and nothing that pokes up to the blade plane may stand within the rotor's reach. This is exactly the
    // bug where the blades cut through the neighbouring wing's wall: the deck used to sit on the low
    // emergency roof with the 21 m tower a couple of metres away.
    const bladeY = h.y + 3.2, reach = h.rotorR + 0.6;
    let worst = null;
    for (const v of h.volumes || []) {
      if (v.top < bladeY - 0.5) continue;                       // lower than the blades: it cannot be hit
      const gap = Math.hypot(Math.max(Math.abs(v.x - h.x) - v.hx, 0), Math.max(Math.abs(v.z - h.z) - v.hz, 0));
      if (!worst || gap < worst.gap) worst = { gap, name: v.name, top: v.top };
      if (gap < reach) bad(`chunk ${ch.cx},${ch.cz}: the ${v.name} (roof ${v.top.toFixed(1)} m) is ${gap.toFixed(2)} m from the helipad centre, inside the rotor's reach (${reach.toFixed(2)} m)`);
    }
    if (worst && worst.gap >= reach) ch.heliClearance = Math.min(ch.heliClearance === undefined ? Infinity : ch.heliClearance, worst.gap);
  }
  // ---- 2c-2) a wrecked car must leave its bay empty for a while, and every parked car must be on the books
  {
    // The parking system refills a bay as soon as its car is gone. That made a rammed fire engine look
    // indestructible: it flew off with the wreckage and a replacement was already standing there.
    if (!(RELIEF_DELAY >= 5)) bad(`RELIEF_DELAY is ${RELIEF_DELAY}s: a rammed car park bay would refill almost instantly`);
    for (const ch of chunks.values()) {
      const bays = ch.parkingTotal || 0;
      if (!bays) continue;
      const standing = ch.lotStanding || [];
      const fixedSlots = (ch.ambulanceSlots || []).length + (ch.fireSlots || []).length + (ch.busSlots || []).length;
      const free = ch.parking.length;
      // every bay of the lot is accounted for exactly once: standing, free, or a permanent roster slot
      const accounted = standing.length + free + fixedSlots;
      if (accounted !== bays) bad(`chunk ${ch.cx},${ch.cz}: ${accounted} bays accounted for out of ${bays} (${standing.length} standing, ${free} free, ${fixedSlots} roster)`);
      // every permanent bay must say which vehicle lives in it: a bay with no type made the parking system
      // call buildCar(undefined) and froze the whole frame loop in the browser
      for (const sl of [...(ch.ambulanceSlots || []), ...(ch.fireSlots || []), ...(ch.busSlots || [])]) {
        if (!sl.kind) bad(`chunk ${ch.cx},${ch.cz}: a roster bay has no vehicle type`);
        else if (!KNOWN_KINDS.has(sl.kind)) bad(`chunk ${ch.cx},${ch.cz}: roster bay wants an unknown vehicle '${sl.kind}'`);
        if (sl.kind && !sl.color) bad(`chunk ${ch.cx},${ch.cz}: roster bay '${sl.kind}' has no colour`);
      }
      // the generator's cars have to be on the books, otherwise the live system tops the lot up on top of them
      for (const rec of standing) {
        if (!rec.car || !rec.car.solid) bad(`chunk ${ch.cx},${ch.cz}: a parked car has no collision volume`);
        else if (!rec.car.solid.base) bad(`chunk ${ch.cx},${ch.cz}: a parked car cannot hand its bay back (no base extents)`);
        if (!rec.slot) bad(`chunk ${ch.cx},${ch.cz}: a parked car has no bay to hand back`);
      }
      // the live target must never exceed the 20% ceiling once the permanent vehicles are counted
      const cap = Math.floor(bays * 0.2);
      for (let ph = 0; ph < 1; ph += 1 / 24) {
        const n = lotCars(bays, ch.parkingFixed || 0, ph, ch.parkingFloor || 2) + ((ch.ambulanceSlots || []).length ? ambulanceTarget(ph) : 0) + (ch.busSlots || []).filter(sl => sl.car).length;
        if (n > cap) bad(`chunk ${ch.cx},${ch.cz}: ${n} vehicles at phase ${ph.toFixed(2)} exceeds the 20% cap (${cap} of ${bays})`);
      }
    }
    const sampleLot = [...chunks.values()].find(c => c.parkingTotal && c.lotStanding);
    if (sampleLot) console.log(`lot books: chunk ${sampleLot.cx},${sampleLot.cz} has ${sampleLot.lotStanding.length} standing + ${sampleLot.parking.length} free + ${(sampleLot.ambulanceSlots || []).length + (sampleLot.fireSlots || []).length} roster slots = ${sampleLot.parkingTotal} bays; car park bay refill delay ${RELIEF_DELAY}s`);
  }
  // ---- 2d) ambulances: never fewer than two, never more than three, at any hour ----
  {
    for (const ch of hospitals) {
      const slots = ch.ambulanceSlots || [];
      if (slots.length < 3) bad(`chunk ${ch.cx},${ch.cz}: only ${slots.length} ambulance bays`);
      const standing = slots.filter(sl => sl.car).length;
      if (standing < 2) bad(`chunk ${ch.cx},${ch.cz}: only ${standing} ambulance(s) standing in the lot`);
      if (standing > 3) bad(`chunk ${ch.cx},${ch.cz}: ${standing} ambulances in the lot (max 3)`);
    }
    let min = 99, max = -1;
    for (let ph = 0; ph < 1; ph += 1 / 48) {                        // sweep a whole day
      const t = ambulanceTarget(ph);
      min = Math.min(min, t); max = Math.max(max, t);
    }
    if (min < 2 || max > 3) bad(`ambulanceTarget leaves the 2-3 range (${min}..${max})`);
    if (ambulanceTarget(0.75) !== 3) bad('the night shift should have all three ambulances home');
    if (ambulanceTarget(0.25) !== 2) bad('one ambulance should be out on a call during the day');
    console.log(`ambulances: ${hospitals.length} campuses with ${hospitals[0] ? hospitals[0].ambulanceSlots.length : 0} bays each, lot target ${min}-${max} across the day (3 at night, 2 by day)`);
  }
  // ---- 2d-2) heavy parked vehicles: they take hits, they do not fly ----
  {
    const heavyKinds = ['ambulance', 'firetruck', 'firesmall'];
    for (const k of heavyKinds) if (!isHeavyParked(world.CAR_DIMS[k].mass)) bad(`'${k}' is not treated as a heavy parked vehicle`);
    for (const k of ['sedan', 'hatchback', 'suv', 'van']) if (isHeavyParked(world.CAR_DIMS[k].mass)) bad(`'${k}' should still be a light, launchable parked car`);
    // shove must stay modest for a truck and never exceed a metre and a half
    const shoveTruck = parkedShove(6.2, 34), shoveAmb = parkedShove(3.4, 34), shoveTap = parkedShove(3.4, 5);
    for (const [name, v] of [['truck', shoveTruck], ['ambulance', shoveAmb], ['light tap', shoveTap]]) {
      if (!(v >= 0 && v <= 1.6)) bad(`parkedShove(${name}) out of range: ${v.toFixed(2)} m`);
    }
    if (shoveTruck >= shoveAmb) bad('the heavier vehicle must shift less than the lighter one');
    if (shoveTap > 0.15) bad(`a 5 m/s tap moves a parked ambulance ${shoveTap.toFixed(2)} m — too much`);
    // damage: light taps do nothing, a real ram needs several hits for a truck, and heavier is tougher
    if (parkedDamage(6.2, 3) !== 0) bad('parkedDamage charges for a parking-speed nudge');
    if (!(parkedDamage(6.2, 34) < parkedDamage(3.4, 34))) bad('the heavier vehicle must take less damage');
    const hits = k => world.CAR_DIMS[k].hp / parkedDamage(world.CAR_DIMS[k].mass, 34);
    const [truckHits, ambHits, smallHits] = [hits('firetruck'), hits('ambulance'), hits('firesmall')];
    if (truckHits < 2) bad(`a full-speed ram totals a fire engine in ${truckHits.toFixed(1)} hits — too easy`);
    if (truckHits > 4) bad(`a fire engine soaks up ${truckHits.toFixed(1)} full-speed rams — too tough to ever burn`);
    if (ambHits < 1.3) bad(`an ambulance dies in ${ambHits.toFixed(1)} hits — its bay would empty itself`);
    if (ambHits > 2.6) bad(`an ambulance needs ${ambHits.toFixed(1)} full-speed hits — too tough`);
    if (smallHits < 1) bad(`the small fire truck survives a full-speed ram (${smallHits.toFixed(2)} hits)`);
    if (!(parkedDamage(3.4, 34) > parkedDamage(6.2, 34))) bad('a heavier parked vehicle must take less damage from the same hit');
    console.log(`heavy parked rules: fire engine shifts ${shoveTruck.toFixed(2)} m and dies in ${truckHits.toFixed(1)} full-speed rams, ambulance ${shoveAmb.toFixed(2)} m / ${ambHits.toFixed(1)} rams, small truck ${smallHits.toFixed(1)}, a 5 m/s tap does nothing`);
  }
  // ---- 2d-3) fuel station: canopy over the pumps, a store, a price pylon, destrctible dispensers ----
  {
    const stations = [...chunks.values()].filter(ch => ch.fuelBrand);
    const pinnedFuel = chunks.get(ck(-1, -1));
    if (!pinnedFuel || !pinnedFuel.fuelBrand) bad('the filling station pinned at (-1,-1) was not generated');
    let pumpCount = 0;
    for (const ch of stations) {
      const C = ch.fuelCanopy, baySet = ch.lotStanding.concat(ch.parking.map(sl => ({ slot: sl })));
      // canopy: high enough to drive under, wide enough to actually cover the whole island line
      if (C.h < 5.4) bad(`chunk ${ch.cx},${ch.cz}: the canopy is only ${C.h} m up — a truck would hit it`);
      if (C.h > 8) bad(`chunk ${ch.cx},${ch.cz}: the canopy is ${C.h} m up — too tall to read as a forecourt`);
      if (C.w < 22 || C.d < 14) bad(`chunk ${ch.cx},${ch.cz}: the canopy (${C.w}x${C.d}) is too small for its islands`);
      // four dispensers, each a solid with its own mesh, all under the canopy and clear of every wall
      if ((ch.pumps || []).length !== 4) bad(`chunk ${ch.cx},${ch.cz}: ${(ch.pumps || []).length} dispensers (want 4)`);
      for (const p of ch.pumps || []) {
        pumpCount++;
        // the dispenser has to be a real, full-height one: a person-sized box is what a filling station's
        // furniture is not (this is the check behind "make the pumps bigger and taller")
        let top = 0, wide = 0, deep = 0;
        p.mesh.traverse(o => { if (o.isMesh && o.pos) { top = Math.max(top, o.pos[1] + o.geometry.h / 2); wide = Math.max(wide, Math.abs(o.pos[0]) + o.geometry.w / 2); deep = Math.max(deep, Math.abs(o.pos[2]) + o.geometry.d / 2); } });
        if (top < 2.2) bad(`chunk ${ch.cx},${ch.cz}: a dispenser is only ${top.toFixed(2)} m tall (want 2.2-2.7)`);
        if (top > 2.7) bad(`chunk ${ch.cx},${ch.cz}: a dispenser is ${top.toFixed(2)} m tall — taller than a real one`);
        if (wide < 0.5 || deep < 0.42) bad(`chunk ${ch.cx},${ch.cz}: a dispenser is too slim (${wide.toFixed(2)} x ${deep.toFixed(2)} m half-extents)`);
        const lx = p.x - ch.cx * CHUNK - CHUNK / 2, lz = p.z - ch.cz * CHUNK - CHUNK / 2;
        if (Math.abs(lx) > C.w / 2 || Math.abs(lz - C.z) > C.d / 2) bad(`chunk ${ch.cx},${ch.cz}: a dispenser stands outside the canopy`);
        if (!p.mesh) bad(`chunk ${ch.cx},${ch.cz}: a dispenser has no mesh to knock over`);
        if (!(p.solid && p.solid.hx > 0)) bad(`chunk ${ch.cx},${ch.cz}: a dispenser has no collision volume`);
        for (const s2 of ch.solids) {
          if (s2.kind === 'building' && Math.abs(s2.x - p.x) < s2.hx + 0.7 && Math.abs(s2.z - p.z) < s2.hz + 0.7) bad(`chunk ${ch.cx},${ch.cz}: a dispenser stands inside the store`);
        }
      }
      // every bay is on the forecourt, clear of the store, the pylon and the columns
      for (const rec of baySet) {
        const b = rec.slot;
        const lx = b.x - ch.cx * CHUNK - CHUNK / 2, lz = b.z - ch.cz * CHUNK - CHUNK / 2;
        if (Math.abs(lx) > 26.4 || Math.abs(lz) > 24.4) bad(`chunk ${ch.cx},${ch.cz}: a bay stands off the forecourt pad`);
        for (const s2 of ch.solids) {
          if (s2.kind !== 'building' && s2.kind !== 'pole' && s2.kind !== 'column' && s2.kind !== 'lamp' && s2.kind !== 'pump') continue;
          if (Math.abs(s2.x - b.x) < s2.hx + b.hx - 0.05 && Math.abs(s2.z - b.z) < s2.hz + b.hz - 0.05) bad(`chunk ${ch.cx},${ch.cz}: a bay overlaps a ${s2.kind}`);
        }
      }
      // and the forecourt itself must never reach the walkway
      if (ch.parkingTotal !== 15) bad(`chunk ${ch.cx},${ch.cz}: ${ch.parkingTotal} bays on the forecourt (want 15)`);
      if ((ch.parkingFloor || 0) < 2) bad(`chunk ${ch.cx},${ch.cz}: fewer than two cars ever stand at the pumps`);
    }
    if (!stations.length) bad('no filling station was generated');
    else console.log(`fuel stations: ${stations.length} block(s), ${pumpCount} dispensers total; pinned (-1,-1) is ${pinnedFuel.fuelBrand} with ${pinnedFuel.pumps.length} pumps and ${pinnedFuel.lotStanding.length} cars on ${pinnedFuel.parkingTotal} bays`);
  }
  // ---- 2c-2) school: a fenced yard with a playground, and the yellow bus fleet in the lot ----
  {
    const schools = [...chunks.values()].filter(ch => (ch.busSlots || []).length);
    if (!schools.length) bad('no school block with a school-bus stand was generated');
    const pinned = chunks.get(ck(0, 1));
    if (!pinned || !(pinned.busSlots || []).length) bad('the pinned school one block from the spawn was not generated');
    let fleetTotal = 0;
    for (const ch of schools) {
      const bx0 = ch.cx * CHUNK, bz0 = ch.cz * CHUNK;
      const yard = ch.schoolYard;
      if (!yard) { bad(`chunk ${ch.cx},${ch.cz}: a school has no yard at all`); continue; }
      // the fence must close the yard, with only the two gates open
      const fence = ch.schoolFence || [];
      const fenceLen = fence.reduce((n, f) => n + 2 * Math.max(f.hx, f.hz), 0);
      if (fence.length < 6) bad(`chunk ${ch.cx},${ch.cz}: the schoolyard fence has only ${fence.length} run(s)`);
      if (fenceLen < 80) bad(`chunk ${ch.cx},${ch.cz}: the schoolyard fence is only ${fenceLen.toFixed(0)} m long`);
      const front = fence.filter(f => Math.abs(f.z - (bz0 + CHUNK / 2)) < 0.3 && f.hx > f.hz).sort((a, b) => a.x - b.x);   // the runs along the lot edge
      if (front.length !== 3) bad(`chunk ${ch.cx},${ch.cz}: the front fence is in ${front.length} piece(s) (want 3, two gates)`);
      else for (let i = 1; i < front.length; i++) {
        const gp = (front[i].x - front[i].hx) - (front[i - 1].x + front[i - 1].hx);
        if (gp < 2 || gp > 8) bad(`chunk ${ch.cx},${ch.cz}: a schoolyard gate is ${gp.toFixed(1)} m wide (want 2-8)`);
      }
      // the fence is real collision: a car must not be able to roll through the yard fence
      const fenceSolids = ch.solids.filter(o => o.fence);
      if (fenceSolids.length !== (ch.fencePanels || []).length) bad(`chunk ${ch.cx},${ch.cz}: ${fenceSolids.length} fence solids for ${(ch.fencePanels || []).length} fence panels`);
      // every run's panels are stand-alone meshes the block owns, each wired to its own solid, so a hit takes
      // down the panel it lands on (breakFence() in js/collisions.js) and the yard opens up where it hit
      const panels = ch.fencePanels || [];
      if (panels.length < fence.length) bad(`chunk ${ch.cx},${ch.cz}: ${panels.length} fence panels for ${fence.length} fence runs`);
      for (const pc of panels) {
        if (pc.broken) bad(`chunk ${ch.cx},${ch.cz}: a fence panel is already torn down on a fresh block`);
        if (!pc.solid || !pc.solid.fence || pc.solid.fencePiece !== pc) bad(`chunk ${ch.cx},${ch.cz}: a fence panel is not wired to the solid a car hits`);
        if (!pc.mesh) bad(`chunk ${ch.cx},${ch.cz}: a fence panel has no mesh - there is nothing to tear off`);
        if (!(pc.hx > 0 && pc.hz > 0)) bad(`chunk ${ch.cx},${ch.cz}: a fence panel has no footprint`);
        if (!pc.group || !pc.group.children.length) bad(`chunk ${ch.cx},${ch.cz}: a fence panel has no geometry`);
        // the panel's meshes must be on the block's books, or a torn fence would pin its geometry for good
        if (pc.mesh) for (const m of pc.mesh.children || []) if (!ch.owned.includes(m.geometry)) bad(`chunk ${ch.cx},${ch.cz}: a fence panel's geometry is not owned by the block`);
      }
      // the playground: the whole set, inside the fence and off the pavement
      const pg = ch.schoolPlayground || [];
      const kinds = new Set(pg.map(p => p.name));
      for (const need of ['swing set', 'slide', 'climbing frame', 'see-saw', 'sandbox', 'basketball hoop', 'entrance'])
        if (!kinds.has(need)) bad(`chunk ${ch.cx},${ch.cz}: the schoolyard has no ${need}`);
      if (pg.filter(p => p.name === 'basketball hoop').length < 2) bad(`chunk ${ch.cx},${ch.cz}: the basketball court has fewer than two hoops`);
      if (pg.length < 9) bad(`chunk ${ch.cx},${ch.cz}: only ${pg.length} playground pieces in the yard`);
      for (const p of pg) {
        if (Math.abs(p.x - yard.x) > yard.hx + 0.6 || Math.abs(p.z - yard.z) > yard.hz + 0.6) bad(`chunk ${ch.cx},${ch.cz}: '${p.name}' stands outside the fenced schoolyard`);
        if (Math.min(edgeDist(p.x, bx0), edgeDist(p.z, bz0)) < PAVE_OUT - 0.1) bad(`chunk ${ch.cx},${ch.cz}: '${p.name}' is out on the pavement`);
      }
      // the fleet: three yellow school buses in the bus stand, clear of the street, heavy like the other heavy parked units
      const buses = ch.solids.filter(o => o.parked && o.parked.kind === 'schoolbus');
      fleetTotal += buses.length;
      if (buses.length < 3) bad(`chunk ${ch.cx},${ch.cz}: only ${buses.length} school bus(es) in the lot (want 3)`);
      if ((ch.busSlots || []).some(sl => !sl.car)) bad(`chunk ${ch.cx},${ch.cz}: a bus bay is empty (the fleet stands from the first frame)`);
      if (ch.parkingFixed !== buses.length) bad(`chunk ${ch.cx},${ch.cz}: the school lot does not reserve its ${buses.length} bus bays`);
      // every bus bay is painted yellow (the stand is marked out on the lot surface)
      const paint = ch.schoolPaint || [];
      for (const sl of ch.busSlots) {
        const under = paint.some(pt => pt.w > 8 && Math.abs(pt.x - sl.x) < 2 && Math.abs(pt.z - sl.z) < 2);
        if (!under) bad(`chunk ${ch.cx},${ch.cz}: a bus bay has no yellow marking under it`);
      }
      const hex = m => (m && m.c !== undefined) ? m.c : (m && m.color ? m.color.getHex() : 0);   // the harness material is a stub
      if (paint.filter(pt => hex(pt.m) === 0xf7b500).length < 3) bad(`chunk ${ch.cx},${ch.cz}: the bus stand is not marked out in yellow`);
      for (const b of buses) {
        if (Math.min(edgeDist(b.x, bx0), edgeDist(b.z, bz0)) < PAVE_IN + 2.5) bad(`chunk ${ch.cx},${ch.cz}: a school bus is out on the street (${Math.min(edgeDist(b.x, bx0), edgeDist(b.z, bz0)).toFixed(2)} m from a block edge)`);
        if (!b.parked.mass || b.parked.mass < 2.5) bad(`chunk ${ch.cx},${ch.cz}: a school bus is too light to be a real weight when it is hit`);
      }
    }
    const S = buildSchoolMesh(0, 0, Math.random);
    const parts = o => { let n = 0; const walk = x => { n++; for (const c of x.children || []) walk(c); }; walk(o); return n; };
    if (parts(S.group) < 130) bad(`the school model is too thin (${parts(S.group)} parts)`);
    if (S.fence.length !== 7) bad(`the school model draws ${S.fence.length} fence runs, want 7 (two gates in the front line)`);
    if ((S.fenceRuns || []).length !== 7) bad(`the school model hands back ${(S.fenceRuns || []).length} fence runs, want 7`);
    let tearOff = 0, longest = 0;
    for (const fr of S.fenceRuns) for (const pc of fr.pieces) { tearOff++; longest = Math.max(longest, pc.hx > pc.hz ? pc.hx * 2 : pc.hz * 2); }
    if (tearOff < 7) bad(`the school fence is built in only ${tearOff} piece(s) - one hit would take a whole run`);
    if (longest > 8.2) bad(`a fence piece is ${longest.toFixed(1)} m long: too much fence to fly off in one go`);
    // the pieces have to tile their run exactly (no gap and no double fence) and every post has to sit on the
    // piece that carries it: piece offsets are measured from the run centre, so an off-by-one would show up here
    for (let i = 0; i < S.fenceRuns.length; i++) {
      const run = S.fenceRuns[i], span = S.fence[i], alongX = run.pieces[0].alongX;
      const len = Math.max(span.hx, span.hz) * 2;
      const sorted = run.pieces.slice().sort((a, b) => (alongX ? a.x - b.x : a.z - b.z));
      let edge = alongX ? span.x - len / 2 : span.z - len / 2, span_ = 0, posts = 0;
      for (const pc of sorted) {
        const half = alongX ? pc.hx : pc.hz, centre = alongX ? pc.x : pc.z;
        if (Math.abs((centre - half) - edge) > 1e-6) bad(`a fence piece starts at ${(centre - half).toFixed(2)} instead of ${edge.toFixed(2)} (${len.toFixed(1)} m run): the line would have a gap`);
        edge = centre + half; span_ = len;
        const kids = pc.group.children.length - 3;                 // panel + two rails, the rest are posts
        posts += kids;
        for (let k = 3; k < pc.group.children.length; k++) {
          const off = alongX ? pc.group.children[k].pos[0] : pc.group.children[k].pos[2];
          if (Math.abs(off) > half + 0.01) bad(`a fence post stands ${Math.abs(off).toFixed(2)} m from its piece centre (piece is ${(half * 2).toFixed(1)} m)`);
        }
      }
      if (Math.abs((edge - (alongX ? span.x + len / 2 : span.z + len / 2))) > 1e-6) bad(`the fence pieces do not reach the end of their ${len.toFixed(1)} m run`);
      const want = Math.ceil(len / 3) + 1;
      if (posts !== want) bad(`a ${len.toFixed(1)} m fence run carries ${posts} posts, want ${want} (one every 3 m plus the end)`);
      // ... and the posts stand at 0, 3, 6 ... metres from the run's own near end, with one closing the far end
      const c0 = alongX ? span.x : span.z, half = len / 2;
      const postAt = pc => {                                        // where a post stands along the run axis
        const out = [];
        for (let k = 3; k < pc.group.children.length; k++) out.push(alongX ? pc.x + pc.group.children[k].pos[0] : pc.z + pc.group.children[k].pos[2]);
        return out;
      };
      const at = sorted.flatMap(postAt).sort((a, b) => a - b);
      if (at.length !== want) bad(`a ${len.toFixed(1)} m run draws ${at.length} posts, want ${want}`);
      else {
        if (Math.abs(at[0] - (c0 - half)) > 1e-6 || Math.abs(at[at.length - 1] - (c0 + half)) > 1e-6) bad(`a ${len.toFixed(1)} m fence run's posts do not reach its two ends`);
        // the posts stand every 3 m from one end of the run, with the far end closed by the last one — either
        // end can be the one the run was laid out from, so both readings are tried and one has to stack up
        const stack = d => d.every((v, k) => (k === d.length - 1 ? Math.abs(v - len) < 1e-6 : Math.abs(v - 3 * k) < 1e-6));
        const fromMin = at.map(p => p - at[0]);
        const fromMax = at.map(p => at[at.length - 1] - p).reverse();
        if (!stack(fromMin) && !stack(fromMax)) {
          const near = at[1] - at[0], far = at[at.length - 1] - at[at.length - 2];
          bad(`a ${len.toFixed(1)} m fence run's posts are not on the 3 m spacing (first gap ${near.toFixed(2)} m, last ${far.toFixed(2)} m)`);
        }
      }
      void span_;
    }
    const posts = S.fenceRuns.reduce((n, fr) => n + fr.pieces.reduce((m, pc) => m + pc.group.children.length - 3, 0), 0);
    console.log(`schools: ${schools.length} campus(es), ${fleetTotal} school buses standing in their bays; a fresh school model is ${parts(S.group)} parts behind ${S.fence.length} fence runs (${tearOff} tear-off pieces, longest ${longest.toFixed(1)} m, ${posts} posts, pieces tile their runs exactly)`);
  }

  // Oriented boxes: the chamfered pavement corners beside a flyover are rotated 45°, so their footprint is not
  // their bounding box. `obbHit` is a plain separating-axis test between such a box and an axis-aligned
  // rectangle; `obbPoint` says whether a point lies inside one.
  const obbPoint = (px, pz, m) => {
    const dx = px - m.x, dz = pz - m.z;
    if (!m.rot) return Math.abs(dx) <= m.w / 2 + 1e-6 && Math.abs(dz) <= m.d / 2 + 1e-6;
    const c = Math.cos(m.rot), sn = Math.sin(m.rot);
    return Math.abs(dx * c - dz * sn) <= m.w / 2 + 1e-6 && Math.abs(dx * sn + dz * c) <= m.d / 2 + 1e-6;
  };

  // ---- 2c-3) the grade-separated interchanges: the main roads fly over some of their junctions ----
  // The city's two main roads carry a flyover every few junctions (js/flyover.js decides where, and the Node
  // suite checks the pattern itself). Each of the four blocks around a junction raises its own quarter of the
  // structure; the road climbs the ramps, crosses on a deck `FLY.deckH` up, and the street it crosses keeps running at
  // grade underneath. These checks are the contract between the concrete built in js/world.js, the surface
  // js/vehicle.js settles every car on, and the world's own furniture: the concrete's top has to BE the surface
  // the physics hands a car (or a car would float above it or sink into it), the two halves of the deck have to
  // meet over the middle of the crossing street (no hole to fall through), the embankment has to be solid for
  // what is at grade and open for what is up on it, and nothing may be planted in the concrete.
  {
    const W = FLY.halfW, th = Math.atan2(FLY.deckH, RAMP_RUN);
    const near2 = (a, b, e = 0.02) => Math.abs(a - b) <= e;
    // The top of a recorded piece at local (u, v): the piece is a box centred at (u, y, v), `w` across, `h` tall
    // and `d` along, tilted by `rot` about the across axis. Returns null outside the piece's own plan.
    const topAt = (p, u, v) => {
      if (Math.abs(v - p.v) > p.w / 2 + 1e-9) return null;
      const a = p.rot, ca = Math.cos(a), sa = Math.sin(a);
      const ds = p.axis === 'z' ? (u - p.u - (p.h / 2) * sa) / ca : (u - p.u + (p.h / 2) * sa) / ca;
      if (Math.abs(ds) > p.d / 2 + 1e-9) return null;
      return p.axis === 'z' ? p.y + (p.h / 2) * ca - ds * sa : p.y + ds * sa + (p.h / 2) * ca;
    };
    // Every flyover the city lays within a kilometre of the start, with the pieces the blocks around it built.
    // The spacing is random (5, 6 or 7 blocks), so the first one is 400 m out and the rest follow from there.
    const nodes = [];
    for (let ix = -13; ix <= 13; ix++) for (let iz = -13; iz <= 13; iz++) { const f = nodeAt(ix, iz); if (f) nodes.push(f); }
    if (!nodes.length) bad('no grade-separated interchange anywhere near the start of the game');
    if (nodeAt(0, 0)) bad('the junction the player starts at is a flyover');
    for (const f of nodes) {
      const key = `${f.axis}@${f.node}`, at = (u, v) => f.axis === 'z' ? [f.road + v, f.node + u] : [f.node + u, f.road + v];
      // the four blocks that front this junction
      const cxs = f.axis === 'z' ? [f.road, f.road - CHUNK] : [f.node, f.node - CHUNK];
      const czs = f.axis === 'z' ? [f.node, f.node - CHUNK] : [f.road, f.road - CHUNK];
      const parts = [], seen = new Set();
      for (const cx of cxs) for (const cz of czs) for (const ch of [chunks.get(ck(cx / CHUNK, cz / CHUNK)), generateChunk(cx / CHUNK, cz / CHUNK, true)]) {
        if (!ch || !ch.flyover) continue;
        for (const p of ch.flyover.pieces) if (p.axis === f.axis && p.node === f.node) {
          const k = `${p.role}|${p.u.toFixed(4)}|${p.v.toFixed(4)}|${p.y.toFixed(4)}`;
          if (!seen.has(k)) { seen.add(k); parts.push(p); }
        }
      }
      if (!parts.length) { bad(`the junction at ${f.axis === 'z' ? `${f.road},${f.node}` : `${f.node},${f.road}`} raised no structure at all`); continue; }
      const of = role => parts.filter(p => p.role === role);
      // ---- the footprint: half the carriageway on this side of the centre line, out to the end of the ramp ----
      for (const p of parts) {
        if (Math.abs(p.v) > W + 0.01) bad(`${key}: a piece sits ${Math.abs(p.v).toFixed(2)} m off the road centre line (half width is ${W})`);
        if (Math.abs(p.u) > FLY.rampEnd + 0.01) bad(`${key}: a piece reaches ${Math.abs(p.u).toFixed(2)} m from the junction, past the end of its ramp (${FLY.rampEnd})`);
      }
      // ---- the deck: the quarters have to meet over the middle of the crossing street ----
      if (of('deck').length !== 4 || of('deck-wear').length !== 4 || of('parapet-deck').length !== 4) {
        bad(`${key}: the blocks raised ${of('deck').length} deck slabs, ${of('deck-wear').length} wearing courses and ${of('parapet-deck').length} deck parapets (want 4 of each)`);
      }
      for (const p of of('deck')) {
        if (!near2(p.u, p.su * FLY.deckHalf / 2) || !near2(p.d, FLY.deckHalf)) bad(`${key}: a deck slab spans u ${p.u.toFixed(2)} ± ${(p.d / 2).toFixed(2)}, not 0..${p.su * FLY.deckHalf}`);
        if (!near2(p.y + p.h / 2 + 0.08, FLY.deckH)) bad(`${key}: a deck's driving surface is at ${(p.y + p.h / 2 + 0.08).toFixed(2)} m, not the ${FLY.deckH} m cars are settled on`);
      }
      // ---- the parapets stand on the structure's outer edge, from the top of the ramp to the middle of the span ---
      for (const p of [...of('parapet-deck'), ...of('parapet-ramp')]) {
        if (!near2(Math.abs(p.v), W - FLY.parapet / 2)) bad(`${key}: a parapet stands ${Math.abs(p.v).toFixed(2)} m off the centre line, not on the edge (${(W - FLY.parapet / 2).toFixed(2)})`);
      }
      if (2 * (W - FLY.parapet) < 12) bad(`${key}: only ${(2 * (W - FLY.parapet)).toFixed(1)} m of drivable width between the parapets`);
      // ---- the approaches, and the invariant that matters most: the concrete's top IS the car surface ----
      // Only the pieces a wheel can rest on count: the wearing courses the slabs carry. The centre-line paint
      // sits a few centimetres proud of the asphalt on purpose, and the parapet, its coping and the hazard
      // boards are furniture standing on the structure, not road surface.
      const DRIVE = new Set(['approach', 'deck-wear']);
      const drivableTop = (u, v) => {
        let t = -Infinity;
        for (const p of parts) if (DRIVE.has(p.role)) { const x = topAt(p, u, v); if (x !== null && x > t) t = x; }
        return t;
      };
      const bottomAt = (p, u, v) => { const t = topAt(p, u, v); return t === null ? null : t - p.h / Math.cos(p.rot); };
      // All four quarters, both sides of the centre line, right out to the end of the ramp.
      for (const su of [1, -1]) for (const sv of [1, -1]) for (const av of [FLY.parapet / 2, W / 2, W - 0.35]) {
        for (let t = 0; t <= FLY.rampEnd; t += 2) {
          const u = su * t, vv = sv * av, [wx, wz] = at(u, vv);
          const phys = surfaceAt(wx, wz, 99), drawn = drivableTop(u, vv);
          if (drawn === -Infinity) { bad(`${key}: nothing is built at u=${u}, v=${vv.toFixed(2)} — a hole in the structure`); continue; }
          if (Math.abs(drawn - phys) > 0.03) bad(`${key}: at u=${u}, v=${vv.toFixed(2)} the asphalt is at ${drawn.toFixed(2)} m but the cars are settled at ${phys.toFixed(2)} m`);
        }
      }
      // Nothing leans out over the lane, and the coping caps the parapet instead of floating above it.
      const EDGE = W - FLY.parapet - 0.02;                                  // the lane's own edge, 2 cm inboard
      for (const p of parts.filter(x => /^(parapet|coping|hazard)/.test(x.role))) for (const sv of [1, -1]) for (const u of [p.u - p.d / 4, p.u, p.u + p.d / 4]) {
        const t = topAt(p, u, sv * EDGE); if (t === null) continue;
        const dt = drivableTop(u, sv * EDGE); if (dt === -Infinity) continue;
        // A board hung on the abutment face sits below the deck, so it only counts as an obstruction if it
        // reaches up to the surface a car is on.
        if (t > dt - 0.2) bad(`${key}: the ${p.role} at u=${u.toFixed(1)} reaches ${t.toFixed(2)} m over the edge of the lane (the asphalt there is ${dt.toFixed(2)} m)`);
      }
      for (const p of parts.filter(x => x.role.startsWith('parapet'))) {
        const c = parts.find(x => x.role === p.role.replace('parapet', 'coping') && Math.sign(x.v) === Math.sign(p.v) && Math.sign(x.u) === Math.sign(p.u));
        if (!c) { bad(`${key}: a ${p.role} has no coping capping it`); continue; }
        const top = topAt(p, p.u, p.v), bot = bottomAt(c, p.u, p.v);
        if (top === null || bot === null) bad(`${key}: a ${p.role} and its coping do not sit over each other`);
        else if (Math.abs(bot - top) > 0.03) bad(`${key}: the coping floats ${(bot - top).toFixed(2)} m above its parapet`);
      }
      // ---- the centre line is carried over the whole structure, and the abutment face is marked ----
      if (of('dash').length < 12) bad(`${key}: carried only ${of('dash').length} centre-line dashes over the interchange`);
      for (const d of of('dash')) if (Math.abs(d.v) > 0.3) bad(`${key}: a centre-line dash is off the road centre line`);
      if (of('hazard').length !== 24) bad(`${key}: marked its abutment faces with ${of('hazard').length} boards (want 24: six per quarter)`);
      // ---- the embankment is solid for what is at grade, and open for what is up on it ----
      // The four blocks' solids, freshly generated once and shared by every probe below (generating them per
      // sample would build the same chunk hundreds of times and eat the heap).
      const blockSolids = [...chunks.values()].flatMap(ch => ch.solids)
        .concat(cxs.flatMap(cx => czs.map(cz => generateChunk(cx / CHUNK, cz / CHUNK, true)).flatMap(ch => ch.solids)));
      // Sampled in the middle of each quarter's own half of the road, not on the shared centre line. A car at
      // grade there must be handed the ground, except where the ramp has all but landed (below the 0.8 m the
      // surface lookup needs before it will pick a car up): there the ramp edge is the road. The solid's own
      // height is checked only while the ramp is well up in the air (2.5 m): nearer the foot the slices have
      // deliberately run out of height, because that is where traffic climbs on.
      for (const sgn of [1, -1]) for (const sv of [1, -1]) for (let u = FLY.deckHalf + 1; u < FLY.rampEnd - 2; u += 1) {
        const [wx, wz] = at(sgn * u, sv * W / 2);
        if (surfaceAt(wx, wz, 0) > 1e-9 && rampHeight(u) > 0.8) bad(`${key}: a car at grade at u=${sgn * u} is being scooped up onto the structure`);
        const wall = blockSolids
          .filter(s => s.kind === 'flyover' && s.maxY !== undefined && Math.abs(s.x - wx) <= s.hx + 1e-6 && Math.abs(s.z - wz) <= s.hz + 1e-6);
        // The wall the flank of the embankment presents: the retaining wall down each side, which is what
        // actually turns a car in the kerb lane away once the slices have run out of height near the ramp's foot.
        const [ex, ez] = at(sgn * u, sv * (W - 0.25));
        const flankWall = blockSolids
          .some(s => s.kind === 'flyover' && s.maxY >= 0.35 && Math.abs(s.x - ex) <= s.hx + 1e-6 && Math.abs(s.z - ez) <= s.hz + 1e-6);
        if (!flankWall) bad(`${key}: the flank of the embankment is open at u=${sgn * u} — a car at grade could drive into the concrete from the side`);
        if (!wall.length) bad(`${key}: the embankment is not solid at grade at u=${sgn * u} — a car could drive through the concrete`);
        // Where the ramp is still well up in the air the wall a car at grade meets has to be a real wall. In the
        // last few metres the ramp has all but landed, so its own low edge is the structure and a solid level
        // with the road is all there is to be (it still stops a car at grade, which is what matters).
        else if (rampHeight(u) > 2.5 && !wall.some(s => s.maxY >= 0.35)) bad(`${key}: the embankment's solid at u=${sgn * u} would not stop anything, and the ramp still stands ${rampHeight(u).toFixed(2)} m up there`);
      }
      // ---- and every solid the structure stands on is inside its own edge: the at-grade lane runs clear ----
      for (const s of blockSolids.filter(x => x.kind === 'flyover' && x.maxY >= 0.35)) {
        const v = Math.abs(latOf(f, s.x, s.z)), hv = f.axis === 'z' ? s.hx : s.hz;
        if (v + hv > FLY.halfW + 0.05) bad(`${key}: a flyover solid reaches ${(v + hv).toFixed(2)} m off the road centre line, past the structure's own edge (${FLY.halfW}) — it would stand in the at-grade lane`);
      }
      console.log(`  interchange ${key}: ${parts.length} pieces on 4 blocks, deck ${FLY.deckH} m over the junction, ramps ${RAMP_RUN} m at 1 in ${(1 / (FLY.deckH / RAMP_RUN)).toFixed(1)}`);
    }
    // ---- the surface the physics hands a car, on both axes ----
    for (const f of nodes) {
      const [ax, az] = f.axis === 'z' ? [f.road, f.node] : [f.node, f.road];
      const along = (t) => f.axis === 'z' ? [ax, az + t] : [ax + t, az];
      if (Math.abs(surfaceAt(...along(0), FLY.deckH) - FLY.deckH) > 1e-9) bad('a car on a deck over the junction is not handed the deck');
      if (surfaceAt(...along(0), 0) !== 0) bad('a car at grade under a deck is being scooped up onto it');
      for (const t of [FLY.deckHalf, FLY.deckHalf + RAMP_RUN / 2, FLY.rampEnd - 8]) {
        const h = rampHeight(t);
        if (Math.abs(surfaceAt(...along(t), h) - h) > 1e-9) bad(`a ramp ${t} m out does not present ${h.toFixed(2)} m to a car on it`);
        if (Math.abs(surfaceAt(...along(t), 0)) > 1e-9) bad(`a ramp ${t} m out is catching traffic at grade`);
      }
      if (rampHeight(FLY.deckHalf) !== FLY.deckH) bad('a ramp does not meet its deck exactly at its own end');
      if (rampHeight(FLY.rampEnd) !== 0 || rampHeight(FLY.rampEnd + 0.5) !== 0) bad('a ramp does not reach the ground at its own end');
      const [sx, sz] = f.axis === 'z' ? [FLY.halfW + 1, 0] : [0, FLY.halfW + 1];
      if (Math.abs(surfaceAt(ax + sx, az + sz, FLY.deckH)) > 1e-9) bad('a deck extends past its own half width');
      if (!isFlyoverNode(ax, az)) bad(`the junction at ${ax},${az} is not the one the traffic lights know about`);
    }
    if (isFlyoverNode(0, 0)) bad('the central crossing is a flyover: the player starts there');
    // The spacing is random but bounded, and it is the same on both roads: 5, 6 or 7 blocks apart, never closer,
    // and never a fixed beat. (The two roads see the same sequence, so a driver meets them at the same rate
    // whichever way he turns at the start.)
    const seq = [];
    for (let k = 1; k <= 30; k++) { const f = nodeAt(0, k); if (f) seq.push(f.node); }
    const xseq = [];
    for (let k = 1; k <= 30; k++) { const f = nodeAt(k, 0); if (f) xseq.push(f.node); }
    if (seq.length < 5) bad(`only ${seq.length} flyovers in the first 30 junctions of the avenue`);
    if (seq.join() !== xseq.join()) bad('the two main roads do not carry the same flyover spacing');
    const gaps = seq.slice(1).map((v, i) => v - seq[i]);
    for (const g of gaps) if (g < FLY.minGap * CHUNK) bad(`two flyovers on the avenue are only ${g} m apart`);
    if (new Set(gaps).size < 2) bad(`the flyovers are on a fixed beat (every ${gaps[0]} m) — they are meant to be spaced at random`);
    console.log(`  flyovers on the avenue: ${seq.map(v => (v / 1000).toFixed(2)).join(' km, ')} km — gaps ${gaps.join(', ')} m (min ${FLY.minGap * CHUNK})`);
    // ---- nothing is planted, parked or dropped in the concrete, and the underpass stays clear ----
    for (const ch of chunks.values()) {
      for (const pr of ch.props) if (insideFootprint(pr.x, pr.z, pr.r)) bad(`a ${pr.kind} prop stands inside an interchange at ${pr.x.toFixed(1)},${pr.z.toFixed(1)}`);
      for (const tr of ch.trees) if (insideFootprint(tr.x, tr.z, 1)) bad(`a tree stands inside an interchange at ${tr.x.toFixed(1)},${tr.z.toFixed(1)}`);
      for (const pk of ch.pickups) if (insideFootprint(pk.x, pk.z, 0.5)) bad(`a ${pk.kind} pickup floats inside an interchange at ${pk.x.toFixed(1)},${pk.z.toFixed(1)}`);
      for (const s of ch.solids) if (s.kind === 'parkedcar' && insideFootprint(s.x, s.z, 1)) bad(`a parked car stands inside an interchange at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
      for (const rw of ch.roadworks) if (insideFootprint(rw.x, rw.z, 0)) bad(`roadworks are laid inside an interchange at ${rw.x.toFixed(1)},${rw.z.toFixed(1)}`);
      // ... nor on the at-grade lane beside it, which is carriageway: a prop, a tree pit or a bus shelter
      // standing there would be a thing to hit in the middle of a lane.
      for (const pr of ch.props) if (!isNosePost(ch, pr) && onAtGradeLane(pr.x, pr.z, 0.7)) bad(`a ${pr.kind} prop stands in the at-grade lane at ${pr.x.toFixed(1)},${pr.z.toFixed(1)}`);
      for (const tr of ch.trees) if (onAtGradeLane(tr.x, tr.z, 1.6)) bad(`a tree stands in the at-grade lane at ${tr.x.toFixed(1)},${tr.z.toFixed(1)}`);
      for (const bs of ch.busStops) if (onAtGradeLane(bs.x, bs.z, 1.2)) bad(`a bus shelter stands in the at-grade lane at ${bs.x.toFixed(1)},${bs.z.toFixed(1)}`);
      // the crossing street's own carriageway has to stay clear of anything at grade: that is the underpass
      for (const s of ch.solids) {
        if (s.kind === 'flyover' || s.maxY !== undefined || s.hx <= 0 || s.hz <= 0) continue;
        const f = flyoverNear(s.x, s.z);
        if (f && Math.abs(alongOf(f, s.x, s.z)) < 8) bad(`a ${s.kind} solid stands in the underpass at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
      }
    }
    console.log(`  interchanges: ${nodes.length} of them within a kilometre of the start (both main roads, ${FLY.minGap}-7 blocks apart), each ${(2 * W).toFixed(0)} m wide on a ${(2 * (W - FLY.parapet)).toFixed(1)} m drivable deck, no signals at their junctions`);

    // ---- the at-grade lane: a road that only went up would leave the frontages with no way of their own, so
    // the kerb steps back beside the structure and the strip it gives up is real carriageway again. The frontage
    // steps back with it, the lane runs the whole length of the block *and through the junction* (it is the way
    // under the deck), and nothing is planted or parked on it ----
    {
      const f = nodes.find(n => n.axis === 'z') || nodes[0];
      const bx = f.axis === 'z' ? f.road / CHUNK : f.node / CHUNK - 1;        // one of the blocks that fronts it
      const bz = f.axis === 'z' ? f.node / CHUNK - 1 : f.road / CHUNK;
      const sides = [0, 1, 2, 3].filter(si => atGradeSide(bx, bz, si));
      if (sides.length !== 1) bad(`the block at ${bx},${bz} beside a flyover has ${sides.length} at-grade sides (want exactly 1: the one on the road that flies)`);
      const sw = world.sidewalkPieces(bx, bz, 'slab'), side = sides[0];
      const x0 = bx * CHUNK, z0 = bz * CHUNK;
      const dist = k => side === 0 ? k.x - x0 : side === 1 ? x0 + CHUNK - k.x : side === 2 ? k.z - z0 : z0 + CHUNK - k.z;
      const alongSide = m => side < 2 ? m.d > m.w : m.w > m.d;               // the strips of this side only
      const setBack = sw.curb.filter(k => alongSide(k) && dist(k) < CHUNK / 2 && dist(k) > PAVE_IN + 0.1);
      const line = PAVE_OUT + FLY.frontage;                                  // where the buildings stand now
      if (FLY.atGrade < 3.4) bad(`the at-grade lane is only ${FLY.atGrade} m wide — that is a shoulder, not a lane`);
      if (line - (roadEdge() + 0.5) < 1.5 - 1e-9) bad(`the frontage only steps back ${FLY.frontage} m (to ${line}), which leaves the walkway behind the ${FLY.atGrade} m at-grade lane ${(line - (roadEdge() + 0.5)).toFixed(2)} m — the widening came out of the pavement`);
      if (setBack.length !== 1) bad(`${setBack.length} of the block's kerb stones are set back beside the flyover (want 1)`);
      else {
        const k = setBack[0];
        if (Math.abs(dist(k) - (roadEdge() + 0.25)) > 0.01) bad(`the kerb beside the flyover stands ${dist(k).toFixed(2)} m from the road centre line, not ${(roadEdge() + 0.25).toFixed(2)}`);
        const want = line - (roadEdge() + 0.5);
        const walk = sw.walk.find(m => alongSide(m) && dist(m) < CHUNK / 2 && Math.abs((side < 2 ? m.w : m.d) - want) < 0.01 && Math.abs(dist(m) - (roadEdge() + 0.5 + want / 2)) < 0.01);
        if (!walk) bad(`the walkway behind the at-grade lane is not the expected ${want.toFixed(2)} m wide`);
        else if (Math.abs(dist(walk) + (side < 2 ? walk.w : walk.d) / 2 - line) > 0.01)
          bad(`the walkway beside the at-grade lane ends ${(dist(walk) + (side < 2 ? walk.w : walk.d) / 2).toFixed(2)} m from the road, not on the frontage line (${line.toFixed(2)} m)`);
      }
      // The four blocks that front the junction, built for real (they are not in the resident lattice) — their
      // paving, their solids and every box they bake. A chunk built with defer=false has already merged, and the
      // Node merge stub keeps the pieces it merged, which is how a baked box can be looked at here at all.
      const ring = [];
      const ix = Math.round((f.axis === 'z' ? f.road : f.node) / CHUNK), iz = Math.round((f.axis === 'z' ? f.node : f.road) / CHUNK);
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const ch2 = generateChunk(ix + dx, iz + dz, false);
        ch2.pieces = [];
        for (const merged of ch2.geos) for (const g of merged.geos || []) if (g.origin && g.w !== undefined) ch2.pieces.push(g);
        ring.push(ch2);
      }
      // the lane itself: clear of the concrete, clear of the pavement, clear of anything standing on it, and wide
      // enough for a car — a car at grade has to be able to drive the whole way beside the structure *and under
      // the deck* at the junction, because that lane is the only way past an interchange at grade
      const v = FLY.halfW + FLY.atGrade / 2;                                  // the middle of the lane
      const onLane = (x, z) => ring.some(ch2 => {
        const sw2 = swCapture.get(ch2); if (!sw2) return false;
        return ['curb', 'walk', 'grass', 'border', 'kerb', 'bed', 'bedEdge'].some(key =>
          sw2[key].some(m => obbPoint(x, z, m)));
      });
      const laneBand = (x, z, hx, hz) => {                                    // does this footprint reach the lane?
        const w2 = f.axis === 'z' ? Math.abs(x - f.road) : Math.abs(z - f.road);
        const u2 = f.axis === 'z' ? Math.abs(z - f.node) : Math.abs(x - f.node);
        const hv = f.axis === 'z' ? hx : hz, hu = f.axis === 'z' ? hz : hx;
        return u2 - hu <= CHUNK && w2 - hv < roadEdge() && w2 + hv > FLY.halfW;   // the lane is halfW..roadEdge()
      };
      // A 45° corner piece is not its bounding box, so it gets its own lane test: the piece's own centre, projected
      // on the radial axis by exactly its half extent. The cut is *pinned* to the kerb line — that point is where
      // the diagonal starts — so a piece whose nearest approach is that line to within a millionth is what the
      // shape is meant to be; only a piece that crosses the line is in the lane.
      const rotBand = g => {
        const c = Math.abs(Math.cos(g.rot)), s2 = Math.abs(Math.sin(g.rot));
        const hx2 = (Math.abs(g.w) * c + Math.abs(g.d) * s2) / 2, hz2 = (Math.abs(g.w) * s2 + Math.abs(g.d) * c) / 2;
        const cx = g.origin[0], cz = g.origin[2], hv = f.axis === 'z' ? hx2 : hz2;
        if (Math.abs((f.axis === 'z' ? cz : cx) - f.node) - (f.axis === 'z' ? hz2 : hx2) > CHUNK) return false;
        const dRad = Math.abs((f.axis === 'z' ? cx : cz) - f.road);
        return dRad - hv < roadEdge() - 1e-6 && dRad + hv > FLY.halfW;
      };
      let blocked = null, paved = null, onIt = null, over = null;
      for (let t = -CHUNK; t <= CHUNK; t += 0.5) {
        const [lx, lz] = f.axis === 'z' ? [f.road + v, f.node + t] : [f.node + t, f.road - v];
        for (const sgn of [1, -1]) {
          const [px2, pz2] = sgn > 0 ? [lx, lz] : (f.axis === 'z' ? [f.road - v, f.node + t] : [f.node + t, f.road + v]);
          if (blocked === null && Math.abs(t) <= FLY.rampEnd && ring.some(ch2 => ch2.solids.some(s => s.kind === 'flyover' && s.maxY >= 0.35 && Math.abs(s.x - px2) <= s.hx + 0.95 && Math.abs(s.z - pz2) <= s.hz + 0.95))) blocked = t;
          if (paved === null && onLane(px2, pz2)) paved = t;
        }
      }
      for (const ch2 of ring) {
        for (const s of ch2.solids) {
          if (s.kind === 'flyover' || s.kind === 'tree') continue;          // the structure, and the roadside trees' own boxes
          if (onIt === null && laneBand(s.x, s.z, s.hx, s.hz)) onIt = `${s.kind} at ${s.x.toFixed(1)},${s.z.toFixed(1)}`;
        }
        // A ground-level piece (anything low and flat: a lot pad, a walkway strip, a grass path, a marking) lying
        // in the lane is just as bad — and this is what caught the pads that still stopped at the old building
        // line. Boxes up in the air are skipped: the deck and the ramps are supposed to be over the lane.
        for (const g of ch2.pieces) {
          // Only pieces that stand proud of the asphalt count: 2 cm of paint (a lane marking) is texture, not
          // something that blocks a carriageway, but a 4 cm slab of roadworks tarmac is.
          if (g.h <= 0.03 || g.h > 1 || g.origin[1] - g.h / 2 > 0.4) continue;
          const hx = (f.axis === 'z' ? g.w : g.d) / 2, hz = (f.axis === 'z' ? g.d : g.w) / 2;
          const hit = g.rot ? rotBand(g) : laneBand(g.origin[0], g.origin[2], hx, hz);
          if (over === null && hit) over = `a ${g.w.toFixed(2)}x${g.d.toFixed(2)}x${g.h.toFixed(2)} piece at ${g.origin[0].toFixed(1)},${g.origin[2].toFixed(1)}`;
        }
        for (const sg of (ch2.flyover && ch2.flyover.signs) || []) if (onAtGradeLane(sg.x, sg.z, 0.6)) bad(`the OVERPASS sign at ${sg.x.toFixed(1)},${sg.z.toFixed(1)} stands in the at-grade lane`);
      }
      if (blocked !== null) bad(`the at-grade lane beside a flyover is blocked by the structure at u=${blocked}`);
      if (paved !== null) bad(`the at-grade lane is cut off by a raised pavement at u=${paved}: a car at grade can only get under the deck by that lane, so the pavement at the junction has to stop at roadEdge()`);
      if (onIt) bad(`a solid (${onIt}) stands in the at-grade lane`);
      if (over) bad(`a ground-level piece (${over}) lies in the at-grade lane`);
      if (blocked === null && paved === null && !onIt && !over)
        console.log(`  at-grade lane: ${FLY.atGrade.toFixed(2)} m of carriageway outside the ${(2 * FLY.halfW).toFixed(0)} m structure (kerb at ${roadEdge().toFixed(2)} m, frontage stepped back to ${line.toFixed(2)} m), unbroken through the junction, clear of structure and pavement, and nothing stands on it`);
      // ... and every block around every interchange keeps its own works out of the lane, with its buildings
      // behind the stepped-back frontage line (that step-back is where the lane's extra width came from)
      for (const f2 of nodes) {
        const ix2 = Math.round((f2.axis === 'z' ? f2.road : f2.node) / CHUNK), iz2 = Math.round((f2.axis === 'z' ? f2.node : f2.road) / CHUNK);
        for (const dx of [-1, 0]) for (const dz of [-1, 0]) {
          const ch2 = generateChunk(ix2 + dx, iz2 + dz, false);
          const band = (x, z, hx, hz) => {
            const w2 = f2.axis === 'z' ? Math.abs(x - f2.road) : Math.abs(z - f2.road);
            const u2 = f2.axis === 'z' ? Math.abs(z - f2.node) : Math.abs(x - f2.node);
            return u2 - (f2.axis === 'z' ? hz : hx) <= CHUNK && w2 - (f2.axis === 'z' ? hx : hz) < roadEdge() && w2 + (f2.axis === 'z' ? hx : hz) > FLY.halfW;
          };
          // ... and the cuts a flyover opens at the junctions beside it. Those junctions are one block either way
          // along the flying road from the node, and their pavement corners are cut on the diagonal by
          // `FLY.chamfer` measured from the corner where the two kerbs meet (see js/world.js `cutClear`). Nothing
          // a block around such a junction stands on its own ground — a tree, a tree pit's kerb, a light, a
          // hydrant, a bin, a post-box, a meter, a hedge — may still be inside one of those cuts.
          for (const along of [-1, 1]) {
            // the junction one block either way along the flying road, and the four blocks that meet at it
            const jc = (f2.axis === 'z' ? f2.node : f2.road) / CHUNK + along;
            const jx3 = f2.axis === 'z' ? 0 : jc * CHUNK, jz3 = f2.axis === 'z' ? jc * CHUNK : 0;
            for (const u of [-1, 0]) for (const v of [-1, 0]) {
              const cx3 = f2.axis === 'z' ? u : jc + v, cz3 = f2.axis === 'z' ? jc + v : u;
              const c3 = generateChunk(cx3, cz3, false);
              const sx3 = cx3 * CHUNK === jx3 ? 1 : -1, sz3 = cz3 * CHUNK === jz3 ? 1 : -1;
              const kx3 = PAVE_IN + (atGradeSide(cx3, cz3, sx3 > 0 ? 0 : 1) ? FLY.atGrade : 0);
              const kz3 = PAVE_IN + (atGradeSide(cx3, cz3, sz3 > 0 ? 2 : 3) ? FLY.atGrade : 0);
              const dc3 = kx3 + kz3 + FLY.chamfer;
              for (const p3 of [...c3.props, ...c3.trees]) {
                if (isNosePost(c3, p3)) continue;
                const ax = (p3.x - jx3) * sx3, az = (p3.z - jz3) * sz3;
                if (ax < 0 || az < 0 || ax > CHUNK || az > CHUNK) continue;      // another corner of this block
                if (ax + az < dc3) bad(`a ${p3.kind || 'tree'} at ${p3.x.toFixed(1)},${p3.z.toFixed(1)} stands inside the cut corner of the junction at ${jx3},${jz3} (${(ax + az).toFixed(1)} m out of the diagonal, which starts at ${dc3.toFixed(1)})`);
              }
            }
          }
          // ... and the block's own ground cover (lot, grass, concrete pad) has to stop at its own building line:
          // on the lane side that line is `FLY.frontage` further out, and a pad that ignored the step would lie
          // over the pavement behind the lane (which is exactly the strip the lane's widening may not eat)
          const x0 = (ix2 + dx) * CHUNK, z0 = (iz2 + dz) * CHUNK;
          for (const p of ch2.pads) {
            let worst = null;
            for (const si of [0, 1, 2, 3]) {
              const line = PAD_IN + (atGradeSide(ix2 + dx, iz2 + dz, si) ? FLY.frontage : 0);
              const near = si === 0 ? (p.x - p.w / 2) - x0 : si === 1 ? (x0 + CHUNK) - (p.x + p.w / 2)
                : si === 2 ? (p.z - p.d / 2) - z0 : (z0 + CHUNK) - (p.z + p.d / 2);
              if (near < line - 0.02 && (!worst || near - line < worst.gap)) worst = { near, line, si, gap: near - line };
            }
            if (worst) bad(`a block pad reaches ${worst.near.toFixed(2)} m from the edge of block ${ix2 + dx},${iz2 + dz} (side ${worst.si}) — the building line there is ${worst.line.toFixed(2)} m, so the pad is lying over the pavement beside the lane`);
          }
          for (const s of ch2.solids) {
            if (s.kind === 'flyover') continue;                            // the structure lives there on purpose
            if (band(s.x, s.z, s.hx, s.hz)) bad(`a ${s.kind} at ${s.x.toFixed(1)},${s.z.toFixed(1)} stands in the at-grade lane (${FLY.halfW}..${roadEdge().toFixed(2)} m off the flying road)`);
            const d = f2.axis === 'z' ? Math.abs(s.x - f2.road) - s.hx : Math.abs(s.z - f2.road) - s.hz;
            if ((s.kind === 'building' || s.kind === 'container') && Math.abs(f2.axis === 'z' ? s.z - f2.node : s.x - f2.node) - (f2.axis === 'z' ? s.hz : s.hx) <= CHUNK && d < PAD_IN + FLY.frontage - 0.02)
              bad(`a ${s.kind} at ${s.x.toFixed(1)},${s.z.toFixed(1)} in block ${ix2 + dx},${iz2 + dz} stands ${d.toFixed(2)} m from the flying road — inside the building line beside the lane (${(PAD_IN + FLY.frontage).toFixed(2)} m, the city's usual line is ${PAD_IN.toFixed(2)} m)`);
          }
        }
        // ... and the junction that closes the lane off at its far end: its signal poles stand OFF out from the
        // junction centre, which is the pavement behind the kerb at a plain junction — but here the kerb is
        // `roadEdge()` out and everything inside it is lane, so a pole left at the usual offset would stand in
        // the carriageway right where the ramp comes down. The chunk records where its poles went; this reads
        // them back, and fails if the junction built none at all (that would make the check pass for free).
        const n = Math.round(f2.node / CHUNK);
        const endChunks = f2.axis === 'z' ? [[0, n - 1], [0, n + 1]] : [[n - 1, 0], [n + 1, 0]];
        for (const [jx, jz] of endChunks) {
          const jch = generateChunk(jx, jz, false);
          const poles = jch.signalPoles || [];
          if (poles.length !== 4) bad(`the junction at ${jx * CHUNK},${jz * CHUNK} beside an interchange built ${poles.length} signal poles (want 4)`);
          for (const pl of poles) if (onAtGradeLane(pl.x, pl.z, 0.5))
            bad(`a signal pole at ${pl.x.toFixed(1)},${pl.z.toFixed(1)} stands in the at-grade lane at the junction ${jx * CHUNK},${jz * CHUNK} beside the interchange — the kerb there is ${roadEdge().toFixed(2)} m out and the pole is inside it`);
        }
      }
    }
  }

  // ---- 2d-4) shops: a shopping street of ten storefronts, all different, none of them in the road ----
  {
    const shopChunks = [...chunks.values()].filter(ch => (ch.shops || []).length);
    const pinned = chunks.get(ck(1, -1));
    if (!pinned || !(pinned.shops || []).length) bad('the shopping street pinned at (1,-1) was not generated');
    if (!shopChunks.length) bad('no shops anywhere in the city');
    const kinds = new Set(), names = new Set();
    const shopKindSet = new Set(SHOP_TYPES.map(o => o.kind));
    const loc = (v, o) => { const l = v - o; return Math.min(l, CHUNK - l); };   // distance from the nearest block edge
    let storefronts = 0, parades = 0;
    for (const ch of shopChunks) {
      storefronts += ch.shops.length;
      for (const sp of ch.shops) {
        if (!sp.name) bad(`chunk ${ch.cx},${ch.cz}: a shopfront has no name`);
        if (!shopKindSet.has(sp.kind)) bad(`chunk ${ch.cx},${ch.cz}: '${sp.name}' has no shop type`);
        if (!sp.mesh) bad(`chunk ${ch.cx},${ch.cz}: '${sp.name}' has no shop window to smash`);
        if (!(sp.solid && sp.solid.hx > 0)) bad(`chunk ${ch.cx},${ch.cz}: '${sp.name}' is not a real collision volume`);
        kinds.add(sp.kind); names.add(sp.name);
      }
      const byBlock = new Set(ch.shops.map(o => o.name));
      if (byBlock.size !== ch.shops.length && (ch.parades || []).length) bad(`chunk ${ch.cx},${ch.cz}: the shopping street repeats a shop name`);
      for (const pr of ch.parades || []) {
        parades++;
        if (!pr.title) bad(`chunk ${ch.cx},${ch.cz}: a parade has no name over its towers`);
        if (pr.shops.length !== 5) bad(`chunk ${ch.cx},${ch.cz}: a parade carries ${pr.shops.length} shops (want 5)`);
        if (new Set(pr.shops).size !== pr.shops.length) bad(`chunk ${ch.cx},${ch.cz}: a parade repeats a shop`);
      }
      // nothing about a shop may stand in the street: every window, and the body behind it, has to be at
      // least PAVE_OUT in from the block edge (that is where the paving ends and the block begins)
      const bx0 = ch.cx * CHUNK, bz0 = ch.cz * CHUNK;
      for (const sp of ch.shops) {
        const rx = loc(sp.x, bx0), rz = loc(sp.z, bz0);
        if (Math.min(rx, rz) < PAVE_OUT - 0.1) bad(`chunk ${ch.cx},${ch.cz}: '${sp.name}' stands in the pavement (${Math.min(rx, rz).toFixed(2)} m from a block edge)`);
        // A downtown shopfront hangs on the wall of the building it belongs to, so it is *supposed* to be
        // inside that footprint — but it has to poke out of the wall, otherwise a car would only ever hit
        // the wall and the window could never break.
        for (const s2 of ch.solids) {
          if (s2.kind !== 'building') continue;
          const inside = Math.abs(s2.x - sp.x) < s2.hx && Math.abs(s2.z - sp.z) < s2.hz;
          if (!inside) continue;
          const pokes = Math.abs(sp.x - s2.x) + 0.3 >= s2.hx || Math.abs(sp.z - s2.z) + 0.3 >= s2.hz;
          if (!pokes) bad(`chunk ${ch.cx},${ch.cz}: '${sp.name}' is buried inside its building, not on its wall`);
        }
      }
      // the market square, the bays and the sheds must not sit on top of each other
      for (const b of [...(ch.lotStanding || []).map(o => o.slot), ...ch.parking]) {
        const rx = loc(b.x, bx0), rz = loc(b.z, bz0);
        if (Math.min(rx, rz) < PAVE_OUT - 0.1) bad(`chunk ${ch.cx},${ch.cz}: a shopping-street bay stands on the pavement`);
        for (const s2 of ch.solids) {
          if (s2.kind !== 'building' && s2.kind !== 'shopfront') continue;
          if (Math.abs(s2.x - b.x) < s2.hx + b.hx - 0.05 && Math.abs(s2.z - b.z) < s2.hz + b.hz - 0.05) bad(`chunk ${ch.cx},${ch.cz}: a bay overlaps a ${s2.kind}`);
        }
      }
    }

    // ---- 2d-4a) a parade kit belongs to its own shop ----
    // buildShopParadeMesh hands every shop's glass back as a kit that the block then places at that shop's
    // world position. A kit that also carries the shop's offset along the parade moves its window twice:
    // every pane lands 9 m off its shopfront and the two end windows of each parade stand 18 m past the
    // parade ends, out in the street, as 7.6 x 2.35 m pale sheets — which is exactly what happened beside
    // the shopping centre. So a kit must always come back centred on its own shop.
    {
      let seed = 7;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const probe = buildShopParadeMesh(SHOP_TYPES.slice(0, 5), rnd, { title: 'PROBE' });
      if (probe.glasses.length !== 5) bad(`a probe parade returned ${probe.glasses.length} window kits for 5 shops`);
      for (const g of probe.glasses) {
        const off = Math.abs(g.group.position.x);
        if (off > 0.05) bad(`a parade window kit carries ${off.toFixed(1)} m of the shop's own parade offset: placed at the shop too, that window ends up in the street`);
        for (const piece of g.group.children) {
          const p = piece.pos || piece.position;
          if (!p || Math.hypot(p[0], p[2] || 0) > 1) bad(`a parade window pane sits ${Math.hypot(p[0], p[2] || 0).toFixed(1)} m off its shop's own centre, outside the kit`);
        }
      }
    }
    if (kinds.size < 8) bad(`only ${kinds.size} kinds of shop in the whole city (want at least 8)`);
    if (parades < 2) bad('the pinned shopping street has no parades');
    console.log(`shops: ${storefronts} storefronts across ${shopChunks.length} blocks, ${parades} parades, ${kinds.size} different businesses (${[...names].slice(0, 8).join(', ')}...)`);
  }
  // ---- 2d-4b) a parade's roof plant stands on the parade's own roof ----
  // The three plant boxes are spread along the parade at -len/4, 0 and +len/4. A stride of len/2 put the third
  // one at +3len/4 — 7.75 m past the end of the building — so a 1.9 x 0.95 x 1.7 m grey box hung in mid-air
  // over the street beside every parade, 5.4 m up and touching nothing: the "box attached to nothing" report.
  // Every plant box has to lie inside the shell's own footprint (the shell is len+7 long, depth deep).
  {
    let seed = 11;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const probe = buildShopParadeMesh(SHOP_TYPES.slice(0, 5), rnd, { title: 'PLANT' });
    const halfLen = (probe.len + 7) / 2, halfPitch = probe.len / 4;
    let plants = 0;
    probe.group.traverse(o => {
      if (!o.isMesh || !o.material || o.material.c !== 0x8b8f95) return;
      plants++;
      const [px, py, pz] = o.pos || [o.position.x, o.position.y, o.position.z];
      if (Math.abs(px) + 1.2 > halfLen) bad(`a parade roof plant sits ${Math.abs(px).toFixed(2)} m off the parade centre, past the end of the ${(halfLen * 2).toFixed(1)} m shell: the box hangs in mid-air over the street`);
      if (Math.abs(Math.abs(px) - halfPitch) > 0.6 && Math.abs(px) > 0.6) bad(`a parade roof plant is ${Math.abs(px).toFixed(2)} m off centre (want 0 or ${halfPitch.toFixed(2)} m)`);
      if (pz > 0.5 || pz < -probe.depth - 0.5) bad(`a parade roof plant sits ${pz.toFixed(2)} m off the parade's own depth (shell spans ${(-probe.depth).toFixed(1)}..0)`);
      if (py < probe.h + 0.4 || py > probe.h + 1.2) bad(`a parade roof plant floats at y ${py.toFixed(2)} over a ${probe.h} m roof`);
    });
    if (plants !== 3) bad(`a parade carries ${plants} roof plant boxes (want 3)`);
  }
  // ---- 2d-5) performance: the generator and the streamer must stay off the frame budget ----
  {
    const perf = world.__merge, checked = world.__checked;
    // (a) sign lettering is merged once per string and shared: it used to cost ~150 geometries per shop name
    const a = textBlocks('PERFORMANCE', world.ASSET && world.ASSET.roofMat ? world.ASSET.roofMat : {}, 0.5, 0.1, 0.3);
    const b = textBlocks('PERFORMANCE', {}, 0.5, 0.1, 0.3);
    let am = 0, bm = 0;
    a.traverse(o => { if (o.isMesh) am++; });
    b.traverse(o => { if (o.isMesh) bm++; });
    if (am !== 1 || bm !== 1) bad(`sign lettering still builds ${am}/${bm} meshes per string (want 1, shared)`);
    else if (a.children[0].geometry !== b.children[0].geometry) bad('two identical signs do not share one merged geometry');
    else console.log('sign lettering: merged once per string and shared (one draw, one geometry)');
    // (b) no block may cost the builder more than it has to: the shopping street was over 4000 geometries
    perf.geos = 0; perf.calls = 0;
    const heavy = generateChunk(1, -1);
    const shopBlockGeos = perf.geos;
    if (shopBlockGeos > 2600) bad(`the shopping street block merges ${shopBlockGeos} geometries (budget 2600)`);
    else console.log(`geometry budget: the heaviest block (shopping street) merges ${shopBlockGeos} geometries in ${perf.calls} merge calls`);
    for (const ch of chunks.values()) {
      if (!ch.group || !ch.group.visible === undefined) bad('a chunk has no group to hide');
    }
    void heavy;
    // (c) streaming is time-budgeted: one call builds at most the allowed number of view blocks, and the
    // blocks it prefetches beyond the view come in hidden
    const keysBefore = new Set(chunks.keys());
    updateChunks(0, 0, 2);
    const fresh = [...chunks.values()].filter(c => !keysBefore.has(ck(c.cx, c.cz)));
    const freshView = fresh.filter(c => Math.max(Math.abs(c.cx), Math.abs(c.cz)) <= 2);
    if (freshView.length > 2) bad(`one streaming call built ${freshView.length} view blocks (the budget allows 2)`);
    else console.log(`streaming budget: ${freshView.length} view block(s) built this call, ${fresh.length - freshView.length} prefetched ahead, ${chunks.size} held`);
    // (d) the ring beyond the view is prefetched and hidden, so arriving there costs nothing
    for (let i = 0; i < 40; i++) updateChunks(0, 0, 2);
    const held = [...chunks.values()];
    const shown = held.filter(c => c.group.visible);
    const hidden = held.filter(c => !c.group.visible);
    if (!hidden.length) bad('no block is prefetched beyond the view (the buffer ring is missing)');
    else if (!shown.length) bad('the view ring is not on screen');
    else {
      const far = shown.filter(c => Math.max(Math.abs(c.cx - 0), Math.abs(c.cz - 0)) > 2);
      if (far.length) bad(`${far.length} blocks outside the view ring are still being drawn`);
      else console.log(`streaming buffer: ${shown.length} blocks drawn around the player, ${hidden.length} built ahead and hidden`);
    }
    if (checked.nan) bad(`${checked.nan} geometry transforms went non-finite while generating`);
  }
  // ---- 2d-6) police air unit: the searchlight pool is held on the car, sways around it and leans to the
  //           police beacon colours (blue and red) instead of being a plain white spot ----
  {
    const L = await import(new URL('../../js/heliLight.js', import.meta.url).href);
    const p = {};
    // (a) on the car at any speed: the pool centre must stay in a small box around the car, and it must not
    // chase a lead position — the beam used to be aimed 0.7 s ahead, which is 28 m past the car at 40 m/s
    let worst = 0, mean = 0, n = 0;
    for (let h = 0; h < Math.PI * 2; h += Math.PI / 12) for (let v = 0; v <= 48; v += 8) for (let t = 0; t < 30; t += 0.05) {
      const x = Math.sin(h) * v * t, z = Math.cos(h) * v * t;        // straight run at that speed and heading
      L.poolPoint(t, x, z, h, p);
      const d = Math.hypot(p.x - x, p.z - z);
      worst = Math.max(worst, d); mean += d; n++;
    }
    mean /= n;
    if (worst > 3.2) bad(`the searchlight pool wanders ${worst.toFixed(2)} m off the car (limit 3.2 m)`);
    else if (mean < 0.5) bad(`the pool sits on the car to within ${mean.toFixed(2)} m — it does not sway at all`);
    else console.log(`air unit: pool centre within ${worst.toFixed(2)} m of the car (mean ${mean.toFixed(2)} m) at any speed — no lead, no drift off the car`);
    // (b) the sway is a real movement around the car: across it (left/right) and along it (up/down the road),
    // plus the slow rise and fall of the aim height
    let latMin = 9, latMax = -9, foreMin = 9, foreMax = -9, yMin = 9, yMax = -9;
    for (let t = 0; t < 40; t += 0.01) {
      L.poolPoint(t, 0, 0, 0, p);                                    // car at the origin, heading +z
      latMin = Math.min(latMin, p.x); latMax = Math.max(latMax, p.x);
      foreMin = Math.min(foreMin, p.z); foreMax = Math.max(foreMax, p.z);
      yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
    }
    if (latMax - latMin < 2) bad(`the pool sways only ${(latMax - latMin).toFixed(2)} m left/right (want > 2)`);
    if (foreMax - foreMin < 2) bad(`the pool sways only ${(foreMax - foreMin).toFixed(2)} m up/down the road (want > 2)`);
    if (yMax - yMin < 0.1) bad('the aim height never moves, so the pool cannot rise and fall');
    else console.log(`air unit sway: ${(latMax - latMin).toFixed(2)} m left/right, ${(foreMax - foreMin).toFixed(2)} m up/down the road, aim height ${yMin.toFixed(2)}..${yMax.toFixed(2)} m`);
    // (c) the beam is aimed short of the pool point by exactly the drop of the cone's axis, so the middle of
    // the lit circle lands on the car instead of a metre past its nose
    let worstAim = 0;
    for (let d = 8; d <= 70; d += 3) for (let ly = 26; ly <= 40; ly += 1) for (let t = 0; t < 6; t += 0.37) for (const h of [0, 1.1, 3.0]) {
      L.poolPoint(t, 0, 0, h, p);
      const lx = Math.sin(h) * d, lz = Math.cos(h) * d;              // aircraft out along the car's heading
      const a = L.aimPoint(lx, ly, lz, p.x, p.y, p.z);
      const u = ly / (ly - a.y);                                     // where the axis reaches the road
      worstAim = Math.max(worstAim, Math.hypot(lx + (a.x - lx) * u - p.x, lz + (a.z - lz) * u - p.z));
    }
    if (worstAim > 0.05) bad(`the beam axis crosses the road ${worstAim.toFixed(2)} m away from the pool centre`);
    else console.log(`air unit aim: the beam axis lands within ${worstAim.toFixed(3)} m of the pool centre at every height and range`);
    // (d) a hard turn sweeps the pool over the car and it is back on it once the turn is done
    const cur = { x: 0, z: 0, y: 1, ok: true };
    let turnPeak = 0, endOff = 0, x = 0, z = 0, h = 0;
    for (let i = 0; i < 150; i++) {
      const t = i / 60;
      h = t < 0.6 ? 0 : Math.min(Math.PI / 2, (t - 0.6) * (Math.PI / 2) / 0.6);   // 90° at 40 m/s
      L.poolPoint(t, x, z, h, p); L.followAim(cur, p, 1 / 60, Math.sin(h) * 40, Math.cos(h) * 40);
      const off = Math.hypot(cur.x - x, cur.z - z);
      turnPeak = Math.max(turnPeak, off); endOff = off;
      x += Math.sin(h) * 40 / 60; z += Math.cos(h) * 40 / 60;
    }
    if (turnPeak > 6) bad(`the pool centre swings ${turnPeak.toFixed(2)} m off the car through a hard turn (limit 6)`);
    else if (endOff > 3.2) bad(`the pool centre is still ${endOff.toFixed(2)} m off the car after the turn`);
    else console.log(`air unit steering: the pool trails at most ${turnPeak.toFixed(2)} m through a 90° turn at 40 m/s and is back within ${endOff.toFixed(2)} m afterwards`);
    // (e) the light leans to the police colours — blue at one end of the beacon cycle, red at the other, never
    // plain white — which is what makes it read as a police air unit rather than a white searchlight
    const chans = hex => [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
    const blue = chans(L.beaconTint(0, true)), red = chans(L.beaconTint(1, true)), mid = chans(L.beaconTint(0.5, true));
    if (blue[2] - blue[0] < 60) bad(`the beacon's blue end is not blue (${blue.join('/')})`);
    else if (red[0] - red[2] < 60) bad(`the beacon's red end is not red (${red.join('/')})`);
    else if (mid[2] - mid[1] > 60 || mid[1] - mid[0] > 60) bad(`the beacon tint collapses to one colour mid-cycle (${mid.join('/')})`);
    else if (L.beaconPulse(0) >= L.beaconPulse(1)) bad('the beacon brightness does not ride the cycle');
    else console.log(`air unit beacon: blue rgb(${blue.join('/')}) -> red rgb(${red.join('/')}), brightness pulse ${L.beaconPulse(0).toFixed(2)}..${L.beaconPulse(1).toFixed(2)}`);
    // (f) the same thing end to end: the real updateHelicopter() driven frame by frame against stub THREE
    // objects, so the spotlight the renderer actually gets is the one being checked
    const heli = await import(heliModulePath);
    heli.ensureHelicopter();
    const hp = { x: 0, z: 0, h: 0 };
    let wiredWorst = 0, locked = 0, blueF = 0, redF = 0, nonFinite = 0;
    for (let i = 0; i < 2400; i++) {
      const t = i / 60;
      hp.h = Math.sin(t * 0.55) * 0.8;                                // weaving at 22 m/s
      const vx = Math.sin(hp.h) * 22, vz = Math.cos(hp.h) * 22;
      hp.x += vx / 60; hp.z += vz / 60;
      Object.assign(heli.player, { x: hp.x, z: hp.z, h: hp.h, vx, vz, speed: 22 });
      Object.assign(heli.sight, { x: hp.x, z: hp.z, vx, vz, t });     // the radio: the cops keep reporting the car
      heli.game.t = t;
      heli.updateHelicopter(1 / 60, true);
      const H = heli.helicopter, tp = H.target.position;
      if (![tp.x, tp.y, tp.z, H.light.intensity, H.beam.scale.y].every(Number.isFinite)) nonFinite++;
      if (H.light.color.hex !== H.beam.material.color.hex) nonFinite++;      // lamp and cone share the tint
      if (!heli.sight.heliOn) continue;
      locked++;
      wiredWorst = Math.max(wiredWorst, Math.hypot(tp.x - hp.x, tp.z - hp.z));
      const c = H.light.color;
      if (c.b > c.r + 60) blueF++; else if (c.r > c.b + 60) redF++;
    }
    if (nonFinite || heli.probe.nan) bad(`${nonFinite + heli.probe.nan} non-finite value(s) came out of the air unit update`);
    else if (locked < 600) bad(`the air unit only locked on for ${locked} of 2400 frames`);
    else if (wiredWorst > 4) bad(`the wired-up spotlight aims ${wiredWorst.toFixed(2)} m off the car`);
    else if (!blueF || !redF) bad(`the lamp never shows both beacon colours (blue ${blueF} frames, red ${redF})`);
    else console.log(`air unit wired up: locked for ${(100 * locked / 2400).toFixed(0)}% of a 40 s weave, the spotlight aims within ${wiredWorst.toFixed(2)} m of the car, ${blueF} blue / ${redF} red frames, no NaN`);
  }
  // ---- 2d-7) roadworks: a closed lane has to read as fresh tarmac with cones, not as a sheet on the street ----
  {
    const sites = [];
    for (const ch of chunks.values()) for (const s of ch.roadworks || []) sites.push({ ch, ...s });
    if (!sites.length) bad('no road resurfacing site was generated in the sample district');
    const lum = c => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
    let slabs = 0, longest = 0, lightest = 0;
    const styles = new Set();
    for (const site of sites) {
      const ex = site.ch.cx * CHUNK, ez = site.ch.cz * CHUNK;
      if (site.slabs.length < 2) bad(`a resurfaced lane is laid as ${site.slabs.length} slab(s) — one clean rectangle reads as a sheet again`);
      for (const sl of site.slabs) {
        slabs++;
        longest = Math.max(longest, Math.max(sl.w, sl.d)); lightest = Math.max(lightest, lum(sl.col));
        // a repair is dark tarmac, thin and flush: the old slab was a warm grey / brown, 5 cm thick and 9 cm
        // proud of the street, which is exactly what made it look like a beige plate lying on the road
        if (lum(sl.col) > 80) bad(`a resurfaced slab is #${sl.col.toString(16)} — too light for tarmac (the street itself is #3b3f4a)`);
        if (sl.h > 0.06) bad(`a resurfaced slab is ${sl.h} m thick`);
        if (sl.y > 0.03) bad(`a resurfaced slab floats ${sl.y} m over the asphalt: a visible plate edge`);
        if (Math.max(sl.w, sl.d) > 9.5) bad(`a resurfaced slab is ${Math.max(sl.w, sl.d).toFixed(1)} m long — the lane is one rectangle again`);
        if (Math.min(sl.w, sl.d) > 3.6) bad(`a resurfaced slab is ${Math.min(sl.w, sl.d).toFixed(1)} m wide — wider than a lane`);
        // distance from the nearest road centre line (the block boundary): a lane slab sits 0.6..8 m out
        const near = Math.min(Math.abs(sl.x - ex), Math.abs(sl.x - (ex + CHUNK)), Math.abs(sl.z - ez), Math.abs(sl.z - (ez + CHUNK)));
        if (near < 0.6 || near > PAVE_IN) bad(`a resurfaced slab sits ${near.toFixed(2)} m from the road centre line, so it is not in a lane`);
      }
      // and the closed lane has to be announced, or a bare rectangle is all a driver sees
      const span = site.len + 12;
      const cones = site.ch.props.filter(pr => pr.kind === 'cone' && Math.hypot(pr.x - site.x, pr.z - site.z) < span).length;
      const sign = site.ch.props.some(pr => pr.kind === 'sign' && Math.hypot(pr.x - site.x, pr.z - site.z) < span);
      if (!sign) bad('a resurfacing site was laid without its warning sign');
      if (cones < 2) bad(`a resurfacing site carries only ${cones} cone(s) along it`);
      styles.add(site.style);
    }
    console.log(`roadworks: ${sites.length} closed lanes in styles ${[...styles].sort().join('/')}, ${slabs} tarmac slabs (longest ${longest.toFixed(1)} m, lightest ${lightest.toFixed(0)}/255 luminance), every one signed and cone-marked`);
  }
  // ---- 2e) fire station: three to five appliances, at least one large engine and one small squad ----
  {
    const stations = [...chunks.values()].filter(ch => ch.fireSlots);
    const pinnedFire = chunks.get(ck(0, -1));
    if (!pinnedFire || !pinnedFire.fireSlots) bad('the fire station pinned on the spawn block (0,-1) was not generated');
    for (const ch of stations) {
      const kinds = ch.fireSlots.map(sl => sl.kind);
      const large = kinds.filter(k => k === 'firetruck').length, small = kinds.filter(k => k === 'firesmall').length;
      if (ch.fireSlots.length < 3 || ch.fireSlots.length > 5) bad(`chunk ${ch.cx},${ch.cz}: ${ch.fireSlots.length} appliance bays (want 3-5)`);
      if (large < 1) bad(`chunk ${ch.cx},${ch.cz}: no large engine on station`);
      if (small < 1) bad(`chunk ${ch.cx},${ch.cz}: no small squad vehicle on station`);
      if (large + small !== ch.fireSlots.length) bad(`chunk ${ch.cx},${ch.cz}: the bays hold ${large + small} of ${ch.fireSlots.length} appliances`);
      const standing = ch.fireSlots.filter(sl => sl.car);
      if (standing.length !== ch.fireSlots.length) bad(`chunk ${ch.cx},${ch.cz}: only ${standing.length} of ${ch.fireSlots.length} appliances on station`);
      // every appliance must stand in front of its own bay door, not inside a wall
      const walls = ch.solids.filter(o => o.kind === 'building');
      for (const sl of ch.fireSlots) {
        if (walls.some(w => Math.abs(sl.x - w.x) < w.hx && Math.abs(sl.z - w.z) < w.hz)) bad(`chunk ${ch.cx},${ch.cz}: an appliance is parked inside a building`);
        const door = (ch.fireDoors || []).find(d => Math.abs(d.x + ch.cx * CHUNK + CHUNK / 2 - sl.x) < 0.01);
        if (!door) bad(`chunk ${ch.cx},${ch.cz}: an appliance bay is not in front of a garage door`);
        else if (sl.z - sl.hz <= door.z + ch.cz * CHUNK + CHUNK / 2) bad(`chunk ${ch.cx},${ch.cz}: an appliance overlaps its garage door`);
      }
      for (let i = 0; i < ch.fireSlots.length; i++) for (let j = i + 1; j < ch.fireSlots.length; j++) {
        const a = ch.fireSlots[i], b = ch.fireSlots[j];
        if (Math.abs(a.x - b.x) < a.hx + b.hx && Math.abs(a.z - b.z) < a.hz + b.hz) bad(`chunk ${ch.cx},${ch.cz}: two appliances overlap`);
      }
    }
    // the fleet must hold its shape for every station the generator can roll, not just this lattice's
    let seed = 987654321;
    const rndMs = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const seen = new Set();
    let sweepOk = true;
    for (let i = 0; i < 400 && sweepOk; i++) {
      const F = world.buildFireStationMesh(0, 0, rndMs);
      const kinds = F.bays.map(b => b.kind);
      if (F.bays.length < 3 || F.bays.length > 5) { bad(`a rolled station fields ${F.bays.length} appliances, want 3-5`); sweepOk = false; break; }
      if (!kinds.includes('firetruck')) { bad('a rolled station has no large engine at all'); sweepOk = false; break; }
      if (!kinds.includes('firesmall')) { bad('a rolled station has no small squad vehicle'); sweepOk = false; break; }
      seen.add(F.bays.length);
      const hall = F.volumes[0];
      for (const b of F.bays) {
        if (!F.doors.some(d => Math.abs(d.x - b.door) < 1e-9)) { bad('an appliance bay was rolled without a garage door of its own'); sweepOk = false; }
        if (Math.abs(b.x) + 3 > hall.hx) { bad(`an appliance door line (${Math.abs(b.x).toFixed(1)} m) overhangs its hall (${hall.hx} m)`); sweepOk = false; }
      }
      const tower = F.volumes[1];                              // the hall must not grow into the hose tower
      if (Math.abs(tower.x - hall.x) < tower.hx + hall.hx && Math.abs(tower.z - hall.z) < tower.hz + hall.hz) { bad('a five-bay hall overlaps the hose tower'); sweepOk = false; }
      for (let a = 0; a < F.bays.length && sweepOk; a++) for (let c = a + 1; c < F.bays.length; c++) {
        if (Math.abs(F.bays[a].x - F.bays[c].x) < F.bays[a].hx + F.bays[c].hx) { bad('two appliance bays overlap in a rolled station'); sweepOk = false; }
      }
    }
    if (sweepOk) {
      if (seen.size < 3) bad(`stations only ever field ${[...seen].sort().join('/')} appliances; the whole 3-5 range must occur`);
      else console.log(`fleet sweep: 400 rolled stations field ${[...seen].sort().join('/')} appliances, each with a large engine, a small squad and a door per bay`);
    }
    // the models themselves: the large engine must be bigger than the small squad
    const dims = world.CAR_DIMS || null;
    const H = world.buildFireStationMesh(0, 0, Math.random);
    const parts = g => { let n = 0; const walk = o => { n++; for (const c of o.children || []) walk(c); }; walk(g); return n; };
    if (parts(H.group) < 30) bad(`the fire station model is too thin (${parts(H.group)} parts)`);
    if (!stations.length) bad('no fire station with appliance bays was generated');
    else {
      const sizes = stations.map(ch => ch.fireSlots.length).sort().join('/');
      console.log(`fire stations: ${stations.length} block(s), bay counts ${sizes} (want 3-5, always a large engine and a small squad); pinned (0,-1) has ${pinnedFire.fireSlots.length} (${pinnedFire.fireSlots.map(sl => sl.kind).join(', ')}) all standing, ${parts(H.group)} part station model`);
    }
    void dims;
  }
  const pinnedHeli = pinned && pinned.heli;
  if (pinnedHeli) console.log(`hospital rooftop: air ambulance at (${pinnedHeli.x.toFixed(0)}, ${pinnedHeli.y.toFixed(1)}, ${pinnedHeli.z.toFixed(0)}), pad radius ${pinnedHeli.padR} m vs rotor ${pinnedHeli.rotorR} m, nearest tall volume ${pinnedHeliClear(pinned).toFixed(2)} m away, deck margin ${pinned.heliMargin.toFixed(2)} m on the ${pinned.heliRoof}`);
function pinnedHeliClear(ch) {
  const h = ch.heli, bladeY = h.y + 3.2;
  let worst = Infinity;
  for (const v of h.volumes || []) {
    if (v.top < bladeY - 0.5) continue;
    worst = Math.min(worst, Math.hypot(Math.max(Math.abs(v.x - h.x) - v.hx, 0), Math.max(Math.abs(v.z - h.z) - v.hz, 0)));
  }
  return worst;
}
}

// ---- 3) styles: all four must appear, each keeping its own invariants ----
const styles = new Map();
for (const ch of chunks.values()) {
  const sw = swCapture.get(ch), st = sw.st;
  styles.set(sw.style, (styles.get(sw.style) || 0) + 1);
  const cx = ch.cx, cz = ch.cz;
  const bands = sw.walk.map(m => [Math.abs(m.x - HALF - cx * CHUNK) - m.w / 2, Math.abs(m.x - HALF - cx * CHUNK) + m.w / 2])
    .concat(sw.walk.map(m => [Math.abs(m.z - HALF - cz * CHUNK) - m.d / 2, Math.abs(m.z - HALF - cz * CHUNK) + m.d / 2]));
  const band = bands.find(b => b[1] - b[0] > 1);
  if (st.verge) {
    if (!sw.grass.length) bad(`chunk ${cx},${cz}: verge style without a grass strip`);
    if (sw.bed.length) bad(`chunk ${cx},${cz}: verge style must not cut soil beds`);
    if (sw.border.length || sw.kerb.length) bad(`chunk ${cx},${cz}: verge style must not carry a border course / inner kerb`);
    const g = sw.grass[0];
    const gz = g.d > g.w;                                // strip runs along z -> radial extent is on x
    const gr = gz
      ? [Math.abs(g.x - HALF - cx * CHUNK) - g.w / 2, Math.abs(g.x - HALF - cx * CHUNK) + g.w / 2]
      : [Math.abs(g.z - HALF - cz * CHUNK) - g.d / 2, Math.abs(g.z - HALF - cz * CHUNK) + g.d / 2];
    if (Math.abs(gr[1] - gr[0] - 1.7) > 1e-6) bad(`verge grass strip is ${(gr[1] - gr[0]).toFixed(2)} m wide, expected 1.70`);
    // the walkway sits on the building side, the grass strip between it and the kerb
    if (Math.abs(band[1] - gr[0]) > 1e-6) bad(`walkway (outer edge ${band[1].toFixed(2)}) does not meet the grass strip (inner edge ${gr[0].toFixed(2)})`);
    const grRoad = [HALF - gr[1], HALF - gr[0]];                 // same band, measured from the road centre line
    for (const t of ch.trees) {
      const roads = radialsOf(t.x, t.z, cx, cz).map(r => HALF - r);   // distance from the road centre line
      if (!roads.length) continue;
      if (!roads.some(d => d >= grRoad[0] - 0.01 && d <= grRoad[1] + 0.01)) bad(`street tree at ${t.x.toFixed(1)},${t.z.toFixed(1)} is not planted in the grass strip (${roads.map(d => d.toFixed(2)).join('/')} vs ${grRoad[0].toFixed(2)}..${grRoad[1].toFixed(2)})`);
    }
  } else {
    if (sw.grass.length) bad(`chunk ${cx},${cz}: paved style with a grass strip`);
    if (!sw.border.length || !sw.kerb.length) bad(`chunk ${cx},${cz}: paved style is missing its border course or inner kerb`);
    if (sw.bed.length) {
      for (const t of ch.trees) {
        const roads = radialsOf(t.x, t.z, cx, cz).map(r => HALF - r);
        if (!roads.length) continue;
        if (!roads.some(d => Math.abs(d - 9.9) < 1.2)) bad(`street tree at ${t.x.toFixed(1)},${t.z.toFixed(1)} is not over a soil bed (${roads.map(d => d.toFixed(2)).join('/')}, bed at 9.90)`);
      }
    } else if (ch.trees.some(t => radialOf(t.x, t.z, cx, cz) >= 0)) bad(`chunk ${cx},${cz}: street trees on paving without a soil bed`);
  }
  if (!sw.curb.length) bad(`chunk ${cx},${cz}: no kerb stone baked`);
}
console.log(`sidewalk styles in the sample: ${[...styles].map(([k, v]) => `${k}=${v}`).join('  ')}`);
for (const name of ['slab', 'panel', 'brick', 'verge']) if (!styles.has(name)) bad(`style '${name}' never appeared in 25 blocks`);

// ---- 4) street furniture from the reference photos ----
const propKinds = new Set();
for (const ch of chunks.values()) for (const pr of ch.props) propKinds.add(pr.kind);
console.log(`street props present: ${[...propKinds].sort().join(', ')}`);
for (const k of ['mailbox', 'meter', 'sandwich', 'hedge']) if (!propKinds.has(k)) bad(`new prop '${k}' was never placed`);

// ---- 5) ring geometry of a plain block: band edges must line up with the constants ----
const p = world.sidewalkPieces(0, 0, 'slab');
const zs = p.walk.filter(m => m.d > m.w), xs = p.walk.filter(m => m.w > m.d);
const rad = Math.abs(zs[0].x - HALF), half = zs[0].w / 2;
console.log(`paving band: ${(rad - half).toFixed(2)} .. ${(rad + half).toFixed(2)} from block centre  (expected ${BAND_LO.toFixed(2)} .. ${BAND_HI.toFixed(2)})`);
if (Math.abs(rad - half - BAND_LO) > 0.01 || Math.abs(rad + half - BAND_HI) > 0.01) bad('paving band does not match PAVE_IN..PAVE_OUT');
if (p.walk.some(m => Math.abs(m.y - (WALK_Y - 0.1)) > 0.003)) bad('paving field is not at the expected height');
if (p.curb.some(m => m.h !== 0.16)) bad('kerb stone is not 0.16 m tall');
if (zs[0].y === xs[0].y) bad('sidewalk strips are coplanar at the block corners -> z-fighting');
console.log(`corner de-conflict: z-strips y=${zs[0].y}, x-strips y=${xs[0].y} (delta ${(zs[0].y - xs[0].y).toFixed(4)} m)`);

// ---- 6) intersections: no sidewalk band may reach into the crossing street's asphalt ----
// Every chunk has a road centre line on each of its two low edges, so a road occupies the first PAVE_IN
// metres of the chunk (and PAVE_IN of the neighbouring chunk). Any band closer to an edge than that is
// sitting in the intersection.
let closest = Infinity, closestKind = '';
for (const ch of chunks.values()) {
  const sw = swCapture.get(ch);
  const ex = ch.cx * CHUNK, ez = ch.cz * CHUNK;
  for (const [name, list] of [['paving', sw.walk], ['kerb stone', sw.curb], ['border', sw.border], ['inner kerb', sw.kerb], ['grass', sw.grass], ['tree bed', sw.bed], ['bed edging', sw.bedEdge]]) {
    for (const m of list) {
      const lo = m.x - m.w / 2 - ex, hi = m.x + m.w / 2 - ex;            // distance from the west road line
      const lo2 = m.z - m.d / 2 - ez, hi2 = m.z + m.d / 2 - ez;          // distance from the south road line
      // a strip running along z sweeps x (band on x, length on z) and vice versa
      const along = Math.min(m.w, m.d) === m.w ? [lo, hi] : [lo2, hi2];
      const near = Math.min(...along.map(v => Math.min(v, CHUNK - v)));
      if (near < closest) { closest = near; closestKind = name; }
      if (near < PAVE_IN - 1e-6) bad(`chunk ${ch.cx},${ch.cz}: ${name} reaches ${near.toFixed(2)} m from a road centre line (limit ${PAVE_IN}) -> it sits in the intersection`);
    }
  }
}
console.log(`closest sidewalk edge to a road centre line: ${closest.toFixed(2)} m (${closestKind}) — must be >= ${PAVE_IN.toFixed(2)}`);

// ---- 7) street width: the asphalt must span the full 16 m between the two kerbs ----
const roadW = 2 * PAVE_IN;
console.log(`street width: ${roadW.toFixed(2)} m between kerb faces (kerb stone occupies ${PAVE_IN.toFixed(2)}..${(PAVE_IN + 0.5).toFixed(2)} from the centre line)`);
if (Math.abs(roadW - 16) > 1e-9) bad(`street is ${roadW.toFixed(2)} m wide, expected 16.00`);
const walkW = PAVE_OUT - (PAVE_IN + 0.5);

// ---- 2g) chunk ownership: a block that streams out must hand its own geometry back ----
// Every merged stand-alone piece a block builds (street props, bus shelters, scaffolding, shop windows, fuel
// dispensers) owns its geometry, and disposeChunk() has to release it. Missing that was a real leak: driving a
// few kilometres left thousands of vertex buffers in the GPU that could never be reclaimed — the game kept
// getting heavier the longer a run went on. This builds a fresh shopping street and checks that every piece it
// owns is released when the block is taken down; the shared caches (sign text, the cylinder cache, tree
// geometry) are deliberately kept.
{
  const probe = generateChunk(1, -1, false);
  const own = probe.owned ? probe.owned.slice() : [];
  const pieces = 2 * 5 + probe.props.length;      // ten shop windows, plus one merged prop group per prop
  if (own.length < pieces) bad(`a fresh shopping street owns ${own.length} stand-alone pieces (want at least ${pieces}: ten shop windows and every street prop) — the rest would pin GPU memory until the page is reloaded`);
  disposeChunk(probe);
  const kept = own.filter(g => !g.__disposed).length;
  if (kept) bad(`${kept} of the block's ${own.length} stand-alone pieces survived disposeChunk(): their geometry would pin GPU memory for the rest of the session`);
  console.log(`block ownership: a fresh shopping street owns ${own.length} stand-alone pieces (${probe.props.length} props, ${probe.busStops.length} shelters, 10 shop windows, ${probe.pumps.length} dispensers); disposeChunk() released ${own.length - kept}`);
  // the school block hands its own pieces back too (its props, and the lot's painted slabs are shared boxes)
  const sc = generateChunk(0, 1, false);
  const scOwn = sc.owned ? sc.owned.slice() : [];
  if (scOwn.length < sc.props.length) bad(`a fresh school block owns ${scOwn.length} stand-alone pieces but builds ${sc.props.length} props — they would pin GPU memory`);
  disposeChunk(sc);
  const scKept = scOwn.filter(g => !g.__disposed).length;
  if (scKept) bad(`${scKept} of the school block's ${scOwn.length} stand-alone pieces survived disposeChunk()`);
  console.log(`block ownership: a fresh school block owns ${scOwn.length} stand-alone pieces (${sc.props.length} props and ${(sc.fencePanels || []).length} fence panels); disposeChunk() released ${scOwn.length - scKept}`);
}

console.log(`walkway: ${walkW.toFixed(2)} m paved in front of the buildings`);
if (walkW < 3.5) bad(`walkway shrank to ${walkW.toFixed(2)} m`);

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
