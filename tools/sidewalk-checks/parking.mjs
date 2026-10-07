/* Behavioural test for the live parking system (js/traffic.js), run in Node against the generated world.
 *
 * The invariant suite in run.mjs checks the rules and the generated bookkeeping; this file actually drives
 * the system frame by frame and watches what it does. Two rules live here: a wrecked permanent vehicle is
 * never replaced (its burnt hulk stays in its bay for the rest of the run), and an ordinary car park bay
 * that was emptied by a crash is refilled by a fresh arrival after the delay.
 *
 * Run:  node tools/sidewalk-checks/parking.mjs      (exits non-zero when a behaviour is wrong)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const world = await import(modulePath);

// ---- build a runnable copy of js/traffic.js on top of the harness world ----
let src = fs.readFileSync(path.join(repo, 'js/traffic.js'), 'utf8');
src = src.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const stubs = `
const env = { phase: 0.75, day: 0, night: 1, dusk: 0 };
const game = { state: 'playing', t: 0 };
const player = { x: 0, z: 0 };
const scene = { add() {}, remove() {} };
const smoke = () => {};   // the tow-away puff when a burnt husk leaves its bay
const __world = await import(${JSON.stringify(modulePath)});
const nearChunks = __world.nearChunks, addParkedCarToChunk = __world.addParkedCarToChunk;
const lotCars = __world.lotCars, ambulanceTarget = __world.ambulanceTarget, RELIEF_DELAY = __world.RELIEF_DELAY;
export { updateParking, updateRooftops, env, game, player, scene, RELIEF_DELAY };
`;
const file = path.join(os.tmpdir(), 'salam-traffic.test.mjs');
fs.writeFileSync(file, stubs + '\n' + src);
const traffic = await import(file + '?v=' + Date.now());

let fails = 0;
const bad = m => { console.log('  x ' + m); fails++; };
const ok = m => console.log('  . ' + m);
const { env, game, player } = traffic;
const step = (seconds, phase) => {
  if (phase !== undefined) env.phase = phase;
  for (let t = 0; t < seconds * 60; t++) { game.t += 1 / 60; traffic.updateParking(1 / 60); }
};
const countCars = standing => standing.filter(r => !r.car.broken && !r.car.gone).length;
const standingCar = ch => countCars(ch.lotStanding || []);
const liveAmbulances = ch => (ch.ambulanceSlots || []).filter(sl => sl.car && !sl.out).length;

// ---- generate the spawn district and park the player in the middle of it ----
world.updateChunks(0, 0, 999);
const fire = world.chunks.get(world.ck(0, -1));
const mall = [...world.chunks.values()].find(ch => ch.parkingTotal && !ch.parkingFixed && !ch.fireSlots);
const hospital = [...world.chunks.values()].find(ch => ch.parkingFixed);
if (!fire || !mall || !hospital) { console.log('missing test blocks'); process.exit(1); }
const centreOf = ch => (world.PI, [ch.cx * 80 + 40, ch.cz * 80 + 40]);

// ==== 0) every roster bay must name a vehicle, and the station fleet must hold its shape ====
{
  for (const ch of [fire, hospital, mall]) {
    for (const sl of [...(ch.ambulanceSlots || []), ...(ch.fireSlots || [])]) {
      if (!sl.kind) bad(`chunk ${ch.cx},${ch.cz}: a roster bay has no vehicle type (the fill path would call buildCar(undefined))`);
    }
  }
  const kinds = fire.fireSlots.map(sl => sl.kind);
  const large = kinds.filter(k => k === 'firetruck').length, small = kinds.filter(k => k === 'firesmall').length;
  if (fire.fireSlots.length < 3 || fire.fireSlots.length > 5) bad(`the fire station fields ${fire.fireSlots.length} appliances (want 3-5)`);
  if (!large) bad('the fire station fields no large engine');
  if (!small) bad('the fire station fields no small squad vehicle');
  if (large && small && fire.fireSlots.length >= 3) ok(`roster bays name their vehicles: fire=[${kinds.join(', ')}] (${large} large, ${small} small) ambulances=[${hospital.ambulanceSlots.map(sl => sl.kind).join(', ')}]`);
}

// ==== 1) a wrecked appliance is never replaced: the burnt hulk stays in its bay ====
{
  const [px, pz] = centreOf(fire); player.x = px; player.z = pz;
  const slot = fire.fireSlots[0];
  const rec = slot.car, before = fire.fireSlots.filter(sl => sl.car).length;
  rec.broken = true; rec.wrecked = true; rec.hulk = true;       // the state wreckParkedHeavy leaves behind:
  if (rec.solid) { rec.solid.hx = rec.solid.hz = -999; }         // a burnt hull that rolls instead of a wall
  step(1.5);
  const soon = fire.fireSlots.filter(sl => sl.car).length;
  if (soon !== before - 1) bad(`the wrecked appliance was replaced within 1.5 s (${soon} of ${before} standing)`);
  else ok(`wrecked engine: bay out of service after 1.5 s (${soon} of ${before} on station)`);
  step(60);                                                     // a whole minute: nothing may come back
  const later = fire.fireSlots.filter(sl => sl.car).length;
  if (later !== before - 1) bad(`a replacement appliance turned up ${'' + 60}s after the wreck (${later} of ${before}) - nothing is supposed to respawn`);
  else if (slot.wreck !== rec) bad('the burnt hulk was not kept against its bay');
  else if (!rec.mesh.visible) bad('the burnt hulk was hidden');
  else ok(`nothing respawns: the same burnt hulk is still in its bay 60 s later (${later} of ${before} on station)`);
}

// ==== 1b) wreck the whole station: every bay keeps its own burnt hulk and nothing ever comes back ====
{
  const [px, pz] = centreOf(fire); player.x = px; player.z = pz;
  for (const sl of fire.fireSlots) {                            // the rest of the fleet, floor by floor
    if (sl.car) { sl.car.broken = true; sl.car.wrecked = true; }
  }
  step(2);
  if (fire.fireSlots.some(sl => sl.car)) bad('a wrecked appliance was still on the books after 2 s');
  step(120);                                                    // two whole minutes of frames
  if (fire.fireSlots.some(sl => sl.car)) bad('the station was rebuilt by itself: an appliance came back');
  else if (fire.fireSlots.some(sl => !sl.wreck)) bad('a wrecked bay lost its burnt hulk');
  else if (fire.fireSlots.some(sl => !sl.wreck.mesh.visible)) bad('a burnt hulk was hidden');
  else ok(`a fully wrecked station is never rebuilt: ${fire.fireSlots.length} burnt hulks stay in their bays, still obstacles`);
}

// ==== 2) ordinary cars follow the clock, and the lot never exceeds its 20% ceiling ====
{
  const [px, pz] = centreOf(mall); player.x = px; player.z = pz;
  const bays = mall.parkingTotal, cap = Math.floor(bays * 0.2);
  for (const [name, phase, want] of [['midnight', 0.75, world.lotCars(bays, 0, 0.75, mall.parkingFloor || 2)],
                                     ['midday', 0.25, world.lotCars(bays, 0, 0.25, mall.parkingFloor || 2)],
                                     ['evening', 0.5, world.lotCars(bays, 0, 0.5, mall.parkingFloor || 2)]]) {
    step(12, phase);                                              // let the lot settle at that hour
    const n = standingCar(mall);
    if (n !== want) bad(`${name}: ${n} cars standing, expected ${want} (bays ${bays})`);
    if (n > cap) bad(`${name}: ${n} cars standing exceeds the 20% ceiling of ${cap}`);
    else ok(`${name}: ${n} cars standing of ${bays} bays (ceiling ${cap})`);
  }
  // a rammed parked car: the bay stays empty for the refill delay and then a fresh arrival takes it. Public
  // car parks keep turning over like that — it is the burnt-out permanent vehicles that never come back.
  const rec = mall.lotStanding[0];
  if (rec) {
    const want = world.lotCars(bays, 0, 0.5, mall.parkingFloor || 2);
    rec.car.broken = true; rec.car.mesh.visible = false;
    step(2);
    if (standingCar(mall) === want) bad('a rammed parked car was replaced within 2 s');
    else ok('rammed parked car: bay stays empty for the refill delay');
    step(world.RELIEF_DELAY + 2);
    if (standingCar(mall) !== want) bad(`the car park never refilled (${standingCar(mall)} of ${want} cars)`);
    else ok('a fresh car takes the empty bay once the delay is up');
  }
}

// ==== 3) hospital ambulances hold the 2-3 range ====
{
  const [px, pz] = centreOf(hospital); player.x = px; player.z = pz;
  for (const [name, phase, want] of [['overnight', 0.75, 3], ['midday', 0.25, 2]]) {
    step(24, phase);                                              // plenty of time: relief units have to drive in
    const n = liveAmbulances(hospital);
    if (n !== want) bad(`${name}: ${n} ambulances in the lot, expected ${want}`);
    else ok(`${name}: ${n} ambulances in the lot`);
  }
  // wreck one at midday: that unit is gone for good, so the campus is a vehicle short from now on
  const kept = ch => (ch.ambulanceSlots || []).filter(sl => sl.car).length;
  const owned = kept(hospital);
  const slot = hospital.ambulanceSlots.find(sl => sl.car && !sl.out);   // a unit that is actually standing
  const rec = slot.car;
  rec.broken = true; rec.wrecked = true; rec.hulk = true;
  if (rec.solid) { rec.solid.hx = rec.solid.hz = -999; }
  step(2);
  if (kept(hospital) !== owned - 1) bad(`a wrecked ambulance was replaced within 2 s (${kept(hospital)} of ${owned} still owned)`);
  else ok(`wrecked ambulance: the campus is down to ${kept(hospital)} units`);
  step(60);
  if (kept(hospital) !== owned - 1) bad(`the ambulance roster was refilled after the wreck (${kept(hospital)} of ${owned}) - nothing is supposed to respawn`);
  else if (slot.wreck !== rec) bad('the wrecked ambulance was not kept against its bay');
  else if (!rec.mesh.visible) bad('the burnt ambulance was hidden');
  else ok('the wrecked ambulance is never replaced: its burnt hulk stays in the bay');
}

console.log(fails ? `\n${fails} BEHAVIOUR CHECK(S) FAILED` : '\nPARKING BEHAVIOUR OK');
process.exit(fails ? 1 : 0);
