/* Invariant checks for the procedural sidewalk ring (kerbs, paving styles, verges, tree pits, furniture).
   Run:  node tools/sidewalk-checks/run.mjs      (exits non-zero when a check fails) */
import { modulePath } from './harness.mjs';

const world = await import(modulePath);
const { chunks, updateChunks, swCapture, CHUNK, PAVE_IN, PAVE_OUT, WALK_Y, BORDER_W, BED, SLAB, ck, lotCars, FONT3D, ambulanceTarget, RELIEF_DELAY, isHeavyParked, parkedShove, parkedDamage } = world;
// every vehicle kind the game can build (js/carModels.js); a bay asking for anything else is a bug
const KNOWN_KINDS = new Set(['player', 'police1', 'police2', 'police3', 'police4', 'police5', 'policeMoto', 'policeUnmarked', 'policeVan', 'civ', 'sedan', 'taxi', 'pickup', 'bus', 'hatchback', 'suv', 'van', 'sportscar', 'oldclassic', 'limo', 'cementtruck', 'fueltanker', 'ambulance', 'firetruck', 'firesmall']);

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
    // the 20% ceiling counts every vehicle standing in the lot, ambulances included
    // a hospital lot also carries its ambulances: two by day, three at night (see ambulanceTarget)
    const amb = fixed ? ph2 => ambulanceTarget(ph2) : () => 0;
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
  const hospitals = [...chunks.values()].filter(ch => ch.parkingFixed);
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
    if (parts(H.group) < 200) bad(`the hospital model is too thin (${parts(H.group)} parts)`);
    if (parts(H.heliMain) < 2 || parts(H.heliTail) < 2) bad('the air ambulance is missing a rotor');
    if (parts(H.heliBody || { children: [] }) < 0) void 0;
    if (!H.heliBeacons || H.heliBeacons.length < 2) bad('the air ambulance has no beacons');
    console.log(`hospital model: ${parts(H.group)} parts + air ambulance with ${parts(H.heliMain)}-part main rotor`);
  }
  const pinned = chunks.get(ck(-1, 0));
  if (!pinned) bad('the pinned hospital block next to the spawn was not generated');
  else if (!pinned.parkingFixed) bad('the pinned block next to the spawn is not a hospital');
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
      const fixedSlots = (ch.ambulanceSlots || []).length + (ch.fireSlots || []).length;
      const free = ch.parking.length;
      // every bay of the lot is accounted for exactly once: standing, free, or a permanent roster slot
      const accounted = standing.length + free + fixedSlots;
      if (accounted !== bays) bad(`chunk ${ch.cx},${ch.cz}: ${accounted} bays accounted for out of ${bays} (${standing.length} standing, ${free} free, ${fixedSlots} roster)`);
      // every permanent bay must say which vehicle lives in it: a bay with no type made the parking system
      // call buildCar(undefined) and froze the whole frame loop in the browser
      for (const sl of [...(ch.ambulanceSlots || []), ...(ch.fireSlots || [])]) {
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
        const n = lotCars(bays, ch.parkingFixed || 0, ph, ch.parkingFloor || 2) + ((ch.ambulanceSlots || []).length ? ambulanceTarget(ph) : 0);
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
    if (parts(H.group) < 150) bad(`the fire station model is too thin (${parts(H.group)} parts)`);
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
console.log(`walkway: ${walkW.toFixed(2)} m paved in front of the buildings`);
if (walkW < 3.5) bad(`walkway shrank to ${walkW.toFixed(2)} m`);

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
