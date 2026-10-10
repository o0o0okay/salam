/* Behavioural test: what actually happens when a moving car rams a parked fire engine or ambulance.
 *
 * js/traffic.js, js/collisions.js and js/flying.js are stitched into one runnable module on top of the
 * Node world, and a real car is driven into a real bay. This is the test for the complaint that parked
 * appliances "fly off like cardboard and half of them land in the ground": nothing here may ever be
 * launched, the vehicle has to absorb the hit like the weight it is, burn where it stands, and still be
 * replaced by the station after the relief delay.
 *
 * Run:  node tools/sidewalk-checks/heavyhit.mjs      (exits non-zero when a behaviour is wrong)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const world = await import(modulePath);

// ---- stitch the three modules into one file that shares one stub environment ----
const read = f => fs.readFileSync(path.join(repo, f), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
// The rammer has to present the same oriented box the real game builds, and the shove has to be the real
// arcade physics, so driveCar / syncCarMesh / carBox are lifted verbatim from js/vehicle.js, and the player
// tuning comes straight out of js/config.js.
const vehicleSrc = fs.readFileSync(path.join(repo, 'js/vehicle.js'), 'utf8');
const between = (a, b) => { const i = vehicleSrc.indexOf(a); return vehicleSrc.slice(i, b ? vehicleSrc.indexOf(b) : vehicleSrc.length); };
const strip = t => t.replace(/^export /gm, '');
const createSrc = strip(between('export function createCar', 'export function removeCar'));
const carBoxSrc = between('export function carBox', 'export function driveCar');
const driveSrc = strip(between('export function driveCar', 'export function syncCarMesh'));
const syncSrc = strip(between('export function syncCarMesh'));
const cfgSrc = fs.readFileSync(path.join(repo, 'js/config.js'), 'utf8');
const PLAYER_PARAMS = eval('(' + cfgSrc.match(/export const PLAYER_PARAMS = (\{[^}]*\});/)[1] + ')');
const HULK_PARAMS = eval('(' + cfgSrc.match(/export const HULK_PARAMS = (\{[^}]*\});/)[1] + ')');
const stubs = `
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const weatherSystem = { slickness: 0 };
const HULK_PARAMS = ${JSON.stringify(HULK_PARAMS)};
// the world module's own strict buildCar stub lives inside that module, so the stitched one mirrors it
const isPoliceKind = kind => typeof kind === 'string' && kind.startsWith('police');
const buildCar = () => { const g = new Obj(); g.userData = { inner: new Obj(), lights: {} }; return g; };
const rnd = (a, b) => a + Math.random() * (b - a);
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } setFromAxisAngle() { return this; } multiply() { return this; } }
class Quat { setFromAxisAngle() { return this; } multiply() { return this; } }
class Obj {
  constructor() { this.children = []; this.userData = {}; this.visible = true; this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0, order: 'XYZ' }; this.scale = { set() {}, setScalar() {} }; this.parent = null; }
  add(...o) { for (const c of o) { c.parent = this; this.children.push(c); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); if (o) o.parent = null; return this; }
  traverse(f) { f(this); for (const c of this.children) c.traverse(f); }
  updateMatrixWorld() {}
}
class Mesh extends Obj { constructor(g, m) { super(); this.isMesh = true; this.geometry = g; this.material = m; } }
class Geo { constructor() {} clone() { return new Geo(); } dispose() {} }
const THREE = { Group: Obj, Mesh, BoxGeometry: Geo, CylinderGeometry: Geo, SphereGeometry: Geo, PlaneGeometry: Geo, Color: class { setRGB() { return this; } }, Vector3: V3, Quaternion: Quat, MeshBasicMaterial: class { constructor(o) { Object.assign(this, o || {}); } } };
const scene = { list: [], add(o) { o.parent = this; this.list.push(o); return o; }, remove(o) { const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1); if (o) o.parent = null; } };
const ASSET = new Proxy({ burnt: {} }, { get: (t, k) => (k in t ? t[k] : {}) });
const TREE_VARIANTS = [{}, {}, {}, {}, {}, {}];
const setTreeMatrix = () => {}; const _Y = new V3(0, 1, 0);
const TREE_BREAK_V = 10; const DIFF = {};
const game = { state: 'playing', time: 0, t: 0, cash: 0, shake: 0, hp: 100, takedowns: 0 };
const player = { x: 0, z: 0 };
const cars = [], flying = [], fallingTrees = [], geysers = [], fires = [];
export const fx = { sparks: 0, smoke: 0, debris: 0, explosion: 0, crash: 0, hurtPlayer: 0, hurtCar: 0, impactFx: 0, hurtAmt: 0 };
const burst = k => () => { fx[k]++; };
const sparks = burst('sparks'), smoke = burst('smoke'), debris = burst('debris'), explosion = burst('explosion'), impactFx = burst('impactFx');
const emit = () => {};
const sfx = new Proxy({}, { get: () => () => { fx.crash++; } });
const hurtPlayer = amt => { fx.hurtPlayer++; fx.hurtAmt += amt || 0; };   // hurtAmt: total HP the player lost
// hurtCar mirrors js/damage.js: police carry armor by tier, anything at 0 hp is a wreck. The pump-blast test
// needs the real numbers so "the blast kills a police car" is measured, not assumed.
const ARMOR = [1, .82, .62, .42, .28];
const hurtCar = (c, amt) => {
  fx.hurtCar++;
  if (c.wrecked || !(amt > 0)) return;
  const armor = c.isPolice ? ARMOR[Math.min(4, Math.max(0, (c.tier || 1) - 1))] : (c.isTanker ? 2.2 : 1);
  c.hp -= amt * armor;
  if (c.hp <= 0) { c.wrecked = true; c.wreckT = 0; c.lastPlayerHit = game.time; }
};
const civPanic = () => {};
// scenery hits: js/damage.js scales them by ENV_DMG (js/config.js) before they reach the normal hurt functions
const ENV_DMG = 0.3;
const hurtPlayerEnv = amt => hurtPlayer(amt * ENV_DMG);
const hurtCarEnv = (c, amt) => hurtCar(c, amt * ENV_DMG);
// the interchange's maths, shared with the world module (the stitched sources strip their imports)
const toast = () => {};
const __world = await import(${JSON.stringify(modulePath)});
const nearChunks = __world.nearChunks, solidsNear = __world.solidsNear, addParkedCarToChunk = __world.addParkedCarToChunk;
const CHUNK = __world.CHUNK;
const lotCars = __world.lotCars, ambulanceTarget = __world.ambulanceTarget, RELIEF_DELAY = __world.RELIEF_DELAY;
const isHeavyParked = __world.isHeavyParked, parkedShove = __world.parkedShove, parkedDamage = __world.parkedDamage;
const CAR_DIMS = __world.CAR_DIMS;
const env = { phase: 0.8, day: 0, night: 1, dusk: 0 };
${carBoxSrc}
export { updateParking, collideSolids, collideFlyover, collideProps, carCar, tickHulks, wreckTick, tickPumpFuses, syncCarMesh, driveCar, sat, updateFlying, flyingFloor, hit, env, game, player, scene, flying, fires, cars, FLY, RAMP_RUN, rampHeight, surfaceAt, insideFootprint, parapetPush, nodeAt, nearestNode, nodeBlock, isFlyoverNode, flyoverNear, alongOf, latOf, laneOffsetOn, rampApproach, roadEdge, onAtGradeLane };
`;
const file = path.join(os.tmpdir(), 'salam-heavyhit.test.mjs');
fs.writeFileSync(file, stubs + '\n' + read('js/flyover.js') + '\n' + read('js/flying.js') + '\n' + read('js/wrecks.js') + '\n' + read('js/traffic.js') + '\n' + read('js/collisions.js') + '\n' + createSrc + '\n' + driveSrc + '\n' + syncSrc);
const M = await import(file + '?v=' + Date.now());
const fx = M.fx;
const CAR_DIMS = world.CAR_DIMS;

let fails = 0;
const bad = m => { console.log('  x ' + m); fails++; };
const ok = m => console.log('  . ' + m);
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ==== 1) the ground rule is the exact lowest corner of the tumbling body ====
{
  const probe = { hx: 1.05, up: 1.2, down: 0.9, hz: 2.2 };
  const cases = [
    ['upright', { x: 0, z: 0 }, 0.2 + probe.down],
    ['on its nose (x = 90 deg)', { x: Math.PI / 2, z: 0 }, 0.2 + probe.hz],
    ['on its roof (x = 180 deg)', { x: Math.PI, z: 0 }, 0.2 + probe.up],
    ['on its side (z = 90 deg)', { x: 0, z: Math.PI / 2 }, 0.2 + probe.hx],
    ['half way over (x = 45 deg)', { x: Math.PI / 4, z: 0 }, 0.2 + probe.down * Math.SQRT1_2 + probe.hz * Math.SQRT1_2],
  ];
  let good = true;
  for (const [name, rot, want] of cases) {
    if (!near(M.flyingFloor(rot, probe), want)) { good = false; bad(`flyingFloor ${name}: got ${M.flyingFloor(rot, probe).toFixed(3)}, want ${want.toFixed(3)}`); }
  }
  if (!near(M.flyingFloor({ x: 1, z: 2 }, null), 0.2)) bad('a prop with no probe must keep the flat 0.2 floor');
  if (good) ok('the ground rule is the exact lowest corner of a tumbling body');
}

// ---- the world: hospital ambulance bays, fire station bays, and a shopping-centre lot ----
world.updateChunks(0, 0, 999);
const hospital = [...world.chunks.values()].find(ch => ch.ambulanceSlots);
const station = [...world.chunks.values()].find(ch => ch.fireSlots);
const mall = [...world.chunks.values()].find(ch => ch.parkingTotal && !ch.parkingFixed && !ch.fireSlots);
const school = [...world.chunks.values()].find(ch => (ch.busSlots || []).length);
if (!hospital || !station || !mall || !school) { console.log('missing test blocks'); process.exit(1); }
const step = (seconds, phase) => {
  if (phase !== undefined) M.env.phase = phase;
  for (let t = 0; t < seconds * 60; t++) { M.game.time += 1 / 60; M.game.t = M.game.time; M.updateParking(1 / 60); }
};
step(3, 0.8);                                        // night: the bays are at full strength

const findCar = (chunks, key, kind) => {
  for (const ch of chunks) for (const sl of (ch[key] || [])) if (sl.car && !sl.out && sl.car.kind === kind && !sl.car.wrecked) return sl;
  return null;
};

// drives a car straight into `rec` at `speed` and reports what the impact did to both of them
function ramInto(rec, speed = 34, mass = 1.3, from = 'front') {
  const yaw = rec.mesh.rotation.y || 0;
  const h = from === 'front' ? yaw + Math.PI : yaw;  // a parked appliance faces the lane, so the run-up is in front of its nose
  const dist = 13;                                   // start 13 m up the road, aimed at the bay
  const c = {
    x: rec.x - Math.sin(h) * dist, z: rec.z - Math.cos(h) * dist, h,   // 13 m up its own heading, then straight at the bay
    vx: Math.sin(h) * speed, vz: Math.cos(h) * speed,
    box: { x: 0, z: 0, ux: 1, uz: 0, vx: 0, vz: 1, e1: CAR_DIMS.player.e1, e2: CAR_DIMS.player.e2 },
    mass, kind: 'player', isPlayer: true, hp: 100, wrecked: false,
  };
  const hp0 = rec.hp;
  const x0 = rec.mesh.position.x, z0 = rec.mesh.position.z, y0 = rec.mesh.position.y;
  const dt = 1 / 60, speed0 = Math.hypot(c.vx, c.vz);
  let speedAfter = speed0, touched = false, sinceTouch = 0, flyingBefore = M.flying.length, yLow = y0, peak = y0;
  let impactSpeed = speed0;
  for (let i = 0; i < 120; i++) {
    const speedIn = Math.hypot(c.vx, c.vz);            // what it carried into this frame
    c.x += c.vx * dt; c.z += c.vz * dt;
    M.collideSolids(c);
    if (rec.hp < hp0) { if (!touched) impactSpeed = speedIn; touched = true; }
    if (touched && sinceTouch++ < 8) speedAfter = Math.min(speedAfter, Math.hypot(c.vx, c.vz));
    yLow = Math.min(yLow, rec.mesh.position.y);
    peak = Math.max(peak, rec.mesh.position.y);
  }
  return {
    touched, damages: hp0 - rec.hp, speed0, speedAfter, impactSpeed,
    shift: Math.hypot(rec.mesh.position.x - x0, rec.mesh.position.z - z0),
    yLow, peak, y0, launched: M.flying.length - flyingBefore,
  };
}

// ==== 2a) a parked ambulance absorbs a full-speed ram instead of flying ====
let amb = null;
{
  const slot = findCar([hospital], 'ambulanceSlots', 'ambulance');
  if (!slot) bad('no ambulance standing in the hospital bays to test');
  else {
    const rec = slot.car;
    const fullHp = CAR_DIMS.ambulance.hp;
    const r = ramInto(rec, 34, 1.3, 'front');
    r.rate = r.damages / Math.max(1, r.impactSpeed - 4);      // damage per m/s of ram
    amb = r;
    if (!r.touched) bad('a full-speed ram did no damage at all');
    if (r.launched !== 0) bad(`the rammed ambulance was launched into the air (${r.launched} flying prop(s)) - it must stay on its wheels`);
    else ok('a full-speed ram never launches the ambulance');
    if (r.speedAfter > r.speed0 * 0.35) bad(`the car kept ${(100 * r.speedAfter / r.speed0).toFixed(0)}% of its speed through the ambulance - that hit has no weight`);
    else ok(`the hit lands as weight: ${r.damages.toFixed(0)} damage of ${fullHp}, the car keeps only ${(100 * r.speedAfter / r.speed0).toFixed(0)}% of its speed`);
    if (fx.hurtPlayer === 0) bad('the player felt nothing: hitting a heavy parked vehicle must hurt');
    if (fx.sparks === 0) bad('no sparks on the impact');
    if (r.shift > 1.6) bad(`the ambulance slid ${r.shift.toFixed(2)} m on impact - that is a launch, not weight`);
    if (!near(rec.mesh.position.y, r.y0)) bad(`the ambulance changed height on impact (${r.y0} -> ${rec.mesh.position.y})`);
    if (r.yLow < r.y0 - 1e-9) bad('the ambulance dipped below its own footprint');
  }
}

// ==== 2b) a fire engine is heavier still: it shifts less and takes less damage per ram ====
{
  const slot = findCar([station], 'fireSlots', 'firetruck');
  if (!slot) bad('no fire engine standing at the station to test');
  else {
    const r = ramInto(slot.car, 34, 6.2, 'front');
    r.rate = r.damages / Math.max(1, r.impactSpeed - 4);
    if (!r.touched) bad('a full-speed ram did no damage to the fire engine');
    if (r.launched !== 0) bad('the rammed fire engine was launched');
    if (amb) {
      if (!(r.shift <= amb.shift + 1e-9)) bad(`the fire engine slid ${r.shift.toFixed(2)} m but the lighter ambulance only ${amb.shift.toFixed(2)} m - heavier must move less`);
      if (!(r.rate < amb.rate)) bad(`the fire engine takes ${r.rate.toFixed(2)} damage per m/s of ram and the ambulance ${amb.rate.toFixed(2)} - heavier must take less`);
      else ok(`weight scales: the fire engine shifted ${r.shift.toFixed(2)} m and took ${r.rate.toFixed(2)} damage per m/s of ram, the ambulance ${amb.shift.toFixed(2)} m / ${amb.rate.toFixed(2)}`);
    }
    if (r.launched === 0 && r.touched) ok('a full-speed ram leaves the fire engine standing where it was parked');
  }
}

// ==== 2b-2) the school bus is the heaviest thing in a lot: it barely moves and shrugs off a ram ====
let schoolBus = null;
{
  // The buses stand nose-to-tail in a line, so only the one at the end of the row has a clear run-up:
  // aim at it from the open end of the lot, or the rammer would just bump the neighbouring bus.
  const slot = (school.busSlots || []).filter(sl => sl.car && !sl.out && !sl.car.wrecked).sort((a, b) => b.x - a.x)[0];
  if (!slot) bad('no school bus standing in the stand to test');
  else {
    const r = ramInto(slot.car, 34, 6.2, 'front');
    r.rate = r.damages / Math.max(1, r.impactSpeed - 4);
    schoolBus = r;
    if (!r.touched) bad('a full-speed ram did no damage to the school bus');
    if (r.launched !== 0) bad('the rammed school bus was launched - a bus must stay on its wheels');
    if (r.shift > 1.6) bad(`the school bus slid ${r.shift.toFixed(2)} m on impact`);
    if (amb && r.rate >= amb.rate) bad(`the school bus takes ${r.rate.toFixed(2)} damage per m/s of ram, the ambulance ${amb.rate.toFixed(2)} - the bus is heavier`);
    else if (amb) ok(`the school bus is heavier than the ambulance: it shifted ${r.shift.toFixed(2)} m and took ${r.rate.toFixed(2)} damage per m/s of ram`);
  }
}

// ==== 2c) keep ramming: it burns where it stands, becomes a wreck, and is never replaced ====
let hulkRef = null;
{
  const game0 = { cash: M.game.cash };
  const fresh = [...hospital.ambulanceSlots, ...station.fireSlots, ...(school.busSlots || [])].filter(sl => sl.car && !sl.out && !sl.car.wrecked);
  const slot = fresh.find(sl => sl.car.hp === CAR_DIMS[sl.car.kind].hp) || fresh[0];
  const rec = hulkRef = slot.car;
  let rams = 0;
  while (rams < 8 && !rec.wrecked) {
    M.game.time += 0.3; const rr = ramInto(rec, 34, 1.3, 'front'); rams++;
    void rr;
  }
  if (!rec.wrecked) bad(`the ${rec.kind} survived ${rams} full-speed rams`);
  else ok(`the ${rec.kind} wrecked and caught fire after ${rams} full-speed rams`);
  if (rec.wrecked && M.fires.length !== 1) bad(`a burning parked vehicle left ${M.fires.length} fire(s) - it should leave exactly one`);
  else if (rec.wrecked) ok(`it burns where it stands (fire life ${M.fires[0].life}s)`);
  if (rec.wrecked && !rec.hulk) bad('the burnt hull never became a wreck the game can push around');
  if (rec.wrecked && M.cars.indexOf(rec) < 0) bad('the burnt hull is not part of the live vehicle list');
  if (rec.wrecked && rec.solid && rec.solid.hx > 0) bad('the burnt hull is still a static wall - it should be a heavy wreck now');
  if (rec.wrecked && game0.cash === M.game.cash) bad('wrecking a parked appliance paid the player nothing');
  if (rec.wrecked && Math.hypot(rec.mesh.position.x - slot.x, rec.mesh.position.z - slot.z) > 4.5) bad('the wreck slid right out of its bay');
  if (rec.wrecked && M.flying.length) bad('the wreck was launched');
  const burning = { x: rec.mesh.position.x, z: rec.mesh.position.z };
  step(6, 0.8);                                                  // let the books settle after the crash
  const ownedBefore = [...hospital.ambulanceSlots, ...station.fireSlots, ...(school.busSlots || [])].filter(sl => sl.car).length;
  step(90, 0.8);                                                 // a minute and a half more of frames
  const ownedAfter = [...hospital.ambulanceSlots, ...station.fireSlots, ...(school.busSlots || [])].filter(sl => sl.car).length;
  if (ownedAfter !== ownedBefore) bad(`a replacement turned up after the wreck (${ownedAfter} of ${ownedBefore} units owned) - nothing is supposed to respawn`);
  else if (slot.wreck !== rec) bad('the burnt hulk was not kept against its bay');
  else if (slot.car) bad('the wrecked bay was refilled');
  else if (!rec.mesh.parent || !rec.mesh.visible) bad('the burnt husk was hidden or removed from the bay');
  else ok(`nothing respawns: the same burnt hulk is still in its bay, and no unit moved (${ownedAfter} owned)`);
  if (rec.wrecked && M.fires.length > 1) bad(`a wrecked vehicle left ${M.fires.length} fires behind - it should leave one`);
  if (rec.wrecked && Math.hypot(rec.mesh.position.x - burning.x, rec.mesh.position.z - burning.z) > 1.6) bad('the burning wreck slid away instead of staying put');
}

// ==== 2d) the burning hull can be shoved aside: it is a wreck now, not a wall ====
{
  const hulk = hulkRef;
  if (!hulk) bad('no wrecked hull to shove');
  M.player.x = hulk.x; M.player.z = hulk.z;               // ticks (and their smoke) only run near the player
  const before = { x: hulk.x, z: hulk.z };
  const p = {
    kind: 'player', isPlayer: true, isPolice: false, isCiv: false, isTanker: false, tier: 0,
    x: hulk.x, z: hulk.z - 12, h: 0, vx: 0, vz: 26, steer: 0, yaw: 0, vf: 0, vl: 0, speed: 26, acc: 0, roll: 0, pitch: 0, y: 0, vy: 0,
    mass: CAR_DIMS.player.mass, hp: 100, maxHp: 100, wrecked: false, dead: false, boost: 0, flatT: 0, flatSide: 1,
    params: PLAYER_PARAMS, mesh: null, inner: null, beam: null, lights: null, lastPlayerHit: -99, lastTouchPlayer: -99,
    box: { x: hulk.x, z: hulk.z - 12, ux: 0, uz: 1, vx: -1, vz: 0, e1: CAR_DIMS.player.e1, e2: CAR_DIMS.player.e2 },
  };
  if (hulk) M.cars.push(p);
  const dt = 1 / 60;
  let closest = Infinity;
  for (let i = 0; i < 300; i++) {                          // five seconds with the throttle pinned
    M.game.time += dt;
    M.driveCar(p, { throttle: 1, hand: false }, dt);        // the real player physics, foot down
    M.carCar(p, hulk);                                      // the real mass-weighted collision
    M.tickHulks(dt);                                        // the wreck coasts, burns and stays alight
    M.syncCarMesh(hulk, dt);
    closest = Math.min(closest, Math.hypot(p.x - hulk.x, p.z - hulk.z));
  }
  const moved = Math.hypot(hulk.x - before.x, hulk.z - before.z);
  if (moved < 2) bad(`five seconds of ramming only moved the burning hull ${moved.toFixed(2)} m - it is still a static prop`);
  else if (closest < 1.2) bad(`the player drove right through the burning hull (closest approach ${closest.toFixed(2)} m)`);
  else ok(`the burning hull is shoved aside: ${moved.toFixed(2)} m off its bay under a full-throttle push, never driven through (closest approach ${closest.toFixed(1)} m)`);
  if (!M.cars.includes(hulk)) bad('the hull was cleaned up after being shoved');
  if (!hulk.mesh.visible) bad('the hull mesh vanished after being shoved');
  if (!hulk.wrecked) bad('the hull stopped being a wreck');
  if (!hulk.fire) bad('the burning hull lost its fire');
  else if (Math.hypot(hulk.fire.x - hulk.x, hulk.fire.z - hulk.z) > 0.5) bad('the flames were left behind when the hull slid away');
  else ok('the fire rode along with the hull as it slid');
  M.cars.splice(M.cars.indexOf(p), 1);
}

// ==== 3) a light parked car still tumbles - and stays out of the asphalt while it does ====
{
  let slot = (mall.lotStanding || []).find(sl => sl.car && !sl.car.wrecked);
  if (!slot) slot = { car: world.addParkedCarToChunk(mall, 'sedan', 0xe34a4a, { x: mall.cx * 80 + 20, z: mall.cz * 80 + 20, rotY: 0 }) };
  const rec = slot.car;
  if (!rec) bad('no light parked car to test the launch path');
  else {
    const r = ramInto(rec, 34, 0.9);
    if (r.launched !== 1) bad(`a light parked car should still be launched (flying props: ${r.launched}, parked ${rec.kind} broke: ${rec.broken})`);
    else {
      const f = M.flying[0];
      if (!f.probe) bad('the launched car carries no body probe, so its floor cannot be computed');
      else {
        ok(`a light car still tumbles (${rec.kind}); its pivot carries ${JSON.stringify(f.probe)}`);
        let below = 0, floats = 0, minGap = Infinity, touchedDown = false;
        for (let i = 0; i < 150; i++) {
          M.updateFlying(1 / 60);
          const floor = M.flyingFloor(f.mesh.rotation, f.probe);
          if (f.mesh.position.y < floor - 1e-9) below++;
          if (f.mesh.position.y > floor + 3) floats++;
          minGap = Math.min(minGap, f.mesh.position.y - floor);
          if (Math.abs(f.mesh.position.y - floor) < 0.05) touchedDown = true;
        }
        if (below) bad(`the tumbling car spent ${below} frame(s) under its own floor (sunk into the road)`);
        if (floats) bad(`the tumbling car spent ${floats} frame(s) floating more than 3 m above the road`);
        if (!touchedDown) bad('the launched car never came back down to the road');
        if (!below && touchedDown) ok(`it tumbles on the asphalt: never below its floor, wheels back down (gap ${minGap.toFixed(3)} m)`);
        if (M.flying.length !== 0) bad('the launched car was never cleaned up at the end of its flight');
        else ok('the debris is cleaned up when its flight ends');
      }
    }
  }
}

// ==== 4) a fuel dispenser: a solid hit shears it off its island and the spill burns ====
{
  const fuel = [...world.chunks.values()].find(ch => ch.pumps && ch.pumps.length);
  if (!fuel) bad('no filling station with dispensers in the lattice');
  else {
    // the two dispensers on an island stand 6.8 m apart, so every run-up is measured from the pump it is
    // aimed at and stays inside that gap
    const gentle = fuel.pumps.find(p => !p.broken);
    const c = {
      x: gentle.x, z: gentle.z + 3.2, h: 0, vx: 0, vz: -4,
      box: { x: 0, z: 0, ux: 1, uz: 0, vx: 0, vz: 1, e1: CAR_DIMS.sedan.e1, e2: CAR_DIMS.sedan.e2 },
      mass: 1.0, kind: 'sedan', isPlayer: false, hp: 40, wrecked: false,
    };
    for (let i = 0; i < 60 && !gentle.broken; i += 1) { c.x += c.vx / 60; c.z += c.vz / 60; M.collideSolids(c); }
    if (gentle.broken) bad('a 4 m/s nudge knocked a fuel dispenser over - it should shrug that off');
    else ok('a slow nudge leaves the dispenser standing, and the car stops against it');

    const pump = fuel.pumps.find(p => !p.broken) || fuel.pumps[1];
    const firesBefore = M.fires.length, flyingBefore = M.flying.length;
    const fast = {
      x: pump.x, z: pump.z + 4, h: 0, vx: 0, vz: -20,
      box: { x: 0, z: 0, ux: 1, uz: 0, vx: 0, vz: 1, e1: CAR_DIMS.sedan.e1, e2: CAR_DIMS.sedan.e2 },
      mass: 1.0, kind: 'sedan', isPlayer: false, hp: 40, wrecked: false,
    };
    for (let i = 0; i < 60 && !pump.broken; i += 1) { fast.x += fast.vx / 60; fast.z += fast.vz / 60; M.collideSolids(fast); }
    if (!pump.broken) bad('a 20 m/s hit did not shear the dispenser off its island');
    else ok('a 20 m/s hit shears the dispenser off its island');
    if (pump.broken && !(pump.solid.hx < 0)) bad('the broken dispenser is still a solid wall');
    if (pump.broken && M.fires.length !== firesBefore + 1) bad(`the fuel spill left ${M.fires.length - firesBefore} fire(s), want 1`);
    else if (pump.broken) ok('the spilled fuel burns where the pump stood');
    if (pump.broken && M.flying.length !== flyingBefore + 1) bad('the dispenser did not tumble off its island');
    else if (pump.broken) ok('the dispenser itself tumbles away with the wreckage');
    if (pump.broken && M.fx.explosion === 0) bad('no blast on the pump hit');
  }
}

// ==== 4b) the schoolyard fence: a slow roll-up stops, a normal bump takes the panel down ====
{
  const school = [...world.chunks.values()].find(ch => (ch.fencePanels || []).length);
  if (!school) bad('no school block with fence panels in the lattice');
  else {
    // a panel on the front line: hit it head-on from the lot, so the run-up is clear of the parked cars
    const front = school.fencePanels.filter(pc => pc.run < 3);
    const panel = (front.length ? front : school.fencePanels).slice().sort((a, b) => Math.max(b.hx, b.hz) - Math.max(a.hx, a.hz))[0];
    const alongX = panel.hx > panel.hz;                   // a wall running along x is hit head-on by driving along z
    const PMASS = CAR_DIMS.player.mass;                    // the player's own car: 1.3
    const car = (dist, speed, mass = PMASS) => {
      const c = {
        h: alongX ? 0 : -Math.PI / 2, mass, kind: 'player', isPlayer: true, hp: 100, wrecked: false,
        vx: alongX ? 0 : -speed, vz: alongX ? -speed : 0,
        box: { x: 0, z: 0, ux: 1, uz: 0, vx: 0, vz: 1, e1: CAR_DIMS.player.e1, e2: CAR_DIMS.player.e2 },
      };
      c.x = alongX ? panel.x : panel.x + dist;
      c.z = alongX ? panel.z + dist : panel.z;
      return c;
    };
    const standing = () => school.fencePanels.filter(pc => !pc.broken).length;
    const all = school.fencePanels.length;
    const roll = (c, frames = 90) => { for (let i = 0; i < frames && !panel.broken; i += 1) { c.x += c.vx / 60; c.z += c.vz / 60; M.collideSolids(c); } };
    // rolling up at walking pace (about 9 km/h) only stops the car: the fence holds
    const gentle = car(CAR_DIMS.player.e1 + 1.2, 2.6);
    roll(gentle);
    if (panel.broken) bad('a 9 km/h roll-up tore a fence panel down - it should just stop the car');
    else ok('rolling up at 9 km/h: the schoolyard fence stops the car');
    // the bump the player will actually make (about 15 km/h) takes the panel off its plinth
    const bump = car(CAR_DIMS.player.e1 + 1.2, 4.2);
    roll(bump);
    if (!panel.broken) bad('a 15 km/h bump in the player\'s car did not take the panel down - the fence has to give way');
    else ok(`a 15 km/h bump takes the ${(Math.max(panel.hx, panel.hz) * 2).toFixed(1)} m panel off its plinth`);
    if (panel.broken && !(panel.solid.hx < 0 && panel.solid.hz < 0)) bad('the broken panel is still a solid wall');
    else if (panel.broken) ok('the gap really is a gap: the torn panel stops being solid');
    const torn = all - standing();
    if (torn < 1) bad('nothing came down with the hit');
    else if (torn > 4) bad(`${torn} panels came down at once - a hit should take the panel it lands on`);
    else ok(`the hit takes ${torn} panel(s) down and leaves ${standing()} of ${all} standing`);
    if (!panel.broken || !M.flying.includes(M.flying[M.flying.length - 1])) bad('a torn panel did not tumble away');
    else ok('the torn panel tumbles off as its own piece');
    if (fx.debris === 0) bad('no debris on the fence hit');
    // the rest of the line carries on standing, and stays a wall
    const near = school.fencePanels.filter(pc => !pc.broken).sort((a, b) => Math.hypot(a.x - panel.x, a.z - panel.z) - Math.hypot(b.x - panel.x, b.z - panel.z))[0];
    if (!near) bad('one hit brought the whole fence line down');
    else if (!(near.solid.hx > 0 && near.solid.hz > 0)) bad('a panel away from the hit came down with it');
    else if (Math.hypot(near.x - panel.x, near.z - panel.z) < 4) bad('the hit took the neighbouring panels as well - it should take the panel it lands on');
    else ok(`the line carries on: the nearest standing panel is ${Math.hypot(near.x - panel.x, near.z - panel.z).toFixed(1)} m from the gap and is still solid`);
    // and a car can now drive in through the gap: the yard is open
    const through = car(CAR_DIMS.player.e1 + 2.5, 12);
    const startX = through.x, startZ = through.z;
    for (let i = 0; i < 90; i += 1) { through.x += through.vx / 60; through.z += through.vz / 60; M.collideSolids(through); }
    const travelled = Math.hypot(through.x - startX, through.z - startZ);
    if (!(travelled > 12)) bad(`the car only travelled ${travelled.toFixed(1)} m - the torn panel still blocks the yard`);
    else ok(`the car rolls through the gap into the schoolyard (${travelled.toFixed(1)} m travelled)`);
    // the panels settle on the asphalt without sinking into it, and are cleaned up
    let below = 0;
    for (let i = 0; i < 200; i += 1) {
      M.updateFlying(1 / 60);
      for (const f of M.flying) if (f.mesh.position.y < M.flyingFloor(f.mesh.rotation, f.probe) - 1e-9) below += 1;
    }
    if (below) bad(`a tumbling fence panel spent ${below} frame(s) under its own floor`);
    else ok('the fence panels tumble on the asphalt and never sink through it');
    if (M.flying.length) bad('the fence debris was never cleaned up');
    else ok('the fence debris is cleaned up when its flight ends');
  }
}

// ==== 5) a dispenser blast is strong enough to destroy a police car standing beside it ====
{
  const station = [...world.chunks.values()].find(ch => ch.pumps && ch.pumps.length === 4 && ch.pumps.every(p => !p.broken));
  if (!station) bad('no intact filling station left to blow up');
  else {
    const pumpA = station.pumps[0];                       // the island pair runs along z, so the run-up is along x
    const nearby = station.pumps[1];
    const police = [
      { name: 'a tier 1 cruiser 6.5 m away', d: 6.5, tier: 1, hp: 55, mass: 1.0, armor: 1, want: 'dead' },
      { name: 'a tier 3 SWAT roadblock 2 m away', d: 2.0, tier: 3, hp: 190, mass: 3.2, armor: .62, want: 'dead' },
      { name: 'an armoured bearcat sitting on the pump', d: 0.6, tier: 4, hp: 330, mass: 5.4, armor: .42, want: 'dead' },
      { name: 'an armoured bearcat 9 m away', d: 9.0, tier: 4, hp: 330, mass: 5.4, armor: .42, want: 'alive' },
    ].map(o => {
      const rec = Object.assign({ x: pumpA.x + o.d, z: pumpA.z, h: 0, vx: 0, vz: 0, isPolice: true, wrecked: false,
        box: { x: 0, z: 0, ux: 1, uz: 0, vx: 0, vz: 1, e1: CAR_DIMS.police2.e1, e2: CAR_DIMS.police2.e2 } }, o);
      M.cars.push(rec);
      return rec;
    });
    for (const o of police) { o.hp0 = o.hp; o.need = o.hp / o.armor; }   // raw damage each one needs, for the report
    const ram = {
      x: pumpA.x + 5, z: pumpA.z, h: 0, vx: -20, vz: 0,
      box: { x: 0, z: 0, ux: 0, uz: 1, vx: -1, vz: 0, e1: CAR_DIMS.sedan.e1, e2: CAR_DIMS.sedan.e2 },
      mass: 1.0, kind: 'sedan', isPlayer: true, hp: 100, wrecked: false,
    };
    const firesBefore = M.fires.length;
    for (let i = 0; i < 90 && !pumpA.broken; i += 1) { ram.x += ram.vx / 60; ram.z += ram.vz / 60; M.collideSolids(ram); }
    if (!pumpA.broken) bad('the ram never set the pump off');
    else ok('ramming a dispenser sets off the whole blast');
    for (const o of police) {
      const took = (o.hp0 - o.hp) / o.armor;
      if (o.want === 'dead' && !o.wrecked) bad(`${o.name} survived the blast: ${o.hp.toFixed(0)} hp left, it needed ${o.need.toFixed(0)} raw damage`);
      else if (o.want === 'dead') ok(`the blast destroyed ${o.name} — ${took.toFixed(0)} raw damage against the ${o.need.toFixed(0)} it needed`);
      else if (o.wrecked) bad(`${o.name} should have survived at that range`);
      else ok(`${o.name} survived with ${o.hp.toFixed(0)} of ${o.hp0} hp (took ${took.toFixed(0)} raw at the edge of the blast)`);
    }
    // the shock wave throws the traffic off the pumps, and the player is hurt but their car is never destroyed
    const close = police.find(o => o.d < 1);
    if (!(close.vx > 0)) bad('the blast did not shove the car on top of the pump away from it');
    else ok(`the shock wave shoves cars off the pumps (${close.vx.toFixed(1)} m/s)`);
    if (ram.hp !== 100) bad('the player car was damaged by the blast - the game never destroys the player car');
    else ok('the player feels the blast but their car is never destroyed');
    // and the fire runs to the pump beside it
    let chained = false;
    for (let i = 0; i < 90 && !chained; i += 1) { M.tickPumpFuses(1 / 60); chained = nearby.broken; }
    if (!chained) bad('the fire did not run to the dispenser beside it');
    else if (M.fires.length < firesBefore + 2) bad('the chained pump exploded without leaving its own fire');
    else ok('the fire runs along the island: the neighbouring dispenser goes up seconds later');
  }
}

// ==== 6) a shop window: a real impact takes the pane out, a crawl leaves it in its frame ====
{
  const mall = [...world.chunks.values()].find(ch => (ch.shops || []).length && ch.parades.length);
  if (!mall) bad('no shopping street to smash a window on');
  else {
    // the west parade of the shopping street: its windows face the court, so the run-up comes from the court
    const centre = mall.cx * world.CHUNK + 40;
    const west = mall.shops.filter(sp => sp.x < centre);
    if (west.length < 2) bad('the shopping street has no row of shops to test');
    const drive = (sp, speed) => {
      const c = {
        x: sp.x + 7, z: sp.z, h: 0, vx: -speed, vz: 0,
        box: { x: 0, z: 0, ux: 0, uz: 1, vx: -1, vz: 0, e1: CAR_DIMS.sedan.e1, e2: CAR_DIMS.sedan.e2 },
        mass: 1.0, kind: 'sedan', isPlayer: true, hp: 100, wrecked: false,
      };
      for (let i = 0; i < 90 && !sp.broken; i += 1) { c.x += c.vx / 60; c.z += c.vz / 60; M.collideSolids(c); }
      return c;
    };
    const target = west[0];
    drive(target, 3);
    if (target.broken) bad('a 3 m/s crawl shattered a shop window');
    else if (!(target.solid.hx > 0)) bad('the shop window vanished without being hit');
    else ok(`a 3 m/s crawl only rattles '${target.name}'`);
    const before = west[1];
    const firesBefore = M.fires.length, flyingBefore = M.flying.length, debrisBefore = fx.debris;
    drive(before, 16);
    if (!before.broken) bad('16 m/s into a shop window did not take the pane out');
    else ok(`16 m/s takes the pane out of '${before.name}'`);
    if (before.broken && before.solid.hx > 0) bad('the broken window is still a solid wall');
    else if (before.broken) ok('the empty frame is no longer a wall: the car rolls on into the shop mouth');
    if (before.broken && M.flying.length !== flyingBefore + 1) bad('the pane did not come away from the frame');
    else if (before.broken) ok('the pane tumbles off down the street with the wreckage');
    if (before.broken && fx.debris <= debrisBefore) bad('no glass on the ground');
    else if (before.broken) ok('the pavement gets a scatter of glass');
    if (before.broken && M.fires.length !== firesBefore) bad('smashing a window somehow started a fire');
    // and the shop itself is still standing: its neighbour on the same parade is untouched
    const neighbour = west.find(sp => sp !== before && sp !== target && !sp.broken);
    if (!neighbour || !neighbour.mesh) bad('smashing one shop window destroyed the parade');
    else ok('the shop behind the empty frame carries on trading, and its neighbours are untouched');
  }
}

// ==== 8) the interchange: a car drives up one ramp, across the deck and down the far side, while the street it
// crosses keeps running at grade underneath it ====
// Both of the city's main roads carry flyovers now (js/flyover.js spaces them out along each one), so this whole
// section is run twice — once on the avenue, once on the cross street — and everything below is written in the
// flyover's own frame: u along the road that flies, v across it. The real arcade physics and the real surface
// function do the rest, so what is checked is true in play and not just in the plan: one road goes over, the
// other goes under, and neither is scooped onto the other's level.
for (const f of [M.nearestNode(0, 1), M.nearestNode(1, 0)]) {
  const F = M.FLY, H = F.deckH, alongX = f.axis === 'x';
  const wx = (u, v) => alongX ? f.node + u : f.road + v;
  const wz = (u, v) => alongX ? f.road + v : f.node + u;
  const mu = c => (alongX ? c.x : c.z) - f.node, mv = c => (alongX ? c.z : c.x) - f.road;   // the car's own (u, v)
  const alongH = alongX ? Math.PI / 2 : 0;                 // facing +u
  const acrossH = alongX ? 0 : Math.PI / 2;                // facing +v
  const name = `${f.axis}@${f.node}`;
  // The blocks around this interchange have to be resident before anything here can be hit: the collision volumes
  // (the embankment's slices, its flanks, the abutment) live in the chunks that build them, and the player's own
  // world streams them in as he drives. This test drives a car there, so it streams them in first.
  world.updateChunks(wx(0, 0), wz(0, 0), 999);
  // A bare car object with the real dimensions and the real physics (the stitched module's createCar needs a
  // renderer, and none of what is driven here needs a mesh).
  const laneV = (f, dir, off) => M.laneOffsetOn(f.axis, dir, off);      // the across-the-road lane coordinate
  const mk = (u, v, h) => ({
    x: wx(u, v), z: wz(u, v), h, y: 0, vy: 0, vx: 0, vz: 0, steer: 0, speed: 0, vf: 0, vl: 0, acc: 0, yaw: 0, gpitch: 0,
    box: { x: wx(u, v), z: wz(u, v), ux: 1, uz: 0, vx: 0, vz: 1, e1: CAR_DIMS.sedan.e1, e2: CAR_DIMS.sedan.e2 },
    mass: CAR_DIMS.sedan.mass, params: PLAYER_PARAMS, kind: 'sedan', isPlayer: false, hp: 100, wrecked: false, dead: false,
    boost: 0, flatT: 0, flatSide: 1,   // flatSide matters: 0 * undefined would make the steering NaN
  });
  const roll = (c, seconds, throttle = 1) => {
    for (let t = 0; t < seconds * 60; t++) {
      M.driveCar(c, { throttle, hand: false }, 1 / 60);
      M.game.time += 1 / 60;
      M.collideSolids(c); M.collideFlyover(c);
    }
    return c;
  };
  // ---- splitter protection is not decorative: the drum stops a frontal approach, while the thin
  // flexible posts break away without forming an invisible wall across the junction.
  {
    const guardV = F.halfW - 0.70;
    const nose = mk(-F.rampEnd - 8, guardV, alongH);
    roll(nose, 3);
    if (mu(nose) + nose.box.e1 > -F.rampEnd - 1.4 - 0.65 + 0.03)
      bad(`${name}: car penetrated the nose-protection drum`);
    else ok(`${name}: nose-protection drum stops a frontal approach before the concrete`);
    const posts = [...world.chunks.values()].flatMap(ch => ch.props).filter(p => p.kind === 'delineator');
    const post = posts.find(p => Math.hypot(p.x - wx(-F.rampEnd - 5.6, guardV), p.z - wz(-F.rampEnd - 5.6, guardV)) < 0.01);
    if (!post) bad(`${name}: no approach delineator to test`);
    else {
      const c = mk(-F.rampEnd - 5.6, guardV, alongH); c.speed = 12;
      if (alongX) c.vx = 12; else c.vz = 12;
      M.collideProps(c);
      if (!post.broken || Math.hypot(c.vx, c.vz) < 11) bad(`${name}: delineator acts like a rigid wall`);
      else ok(`${name}: orange delineator breaks away and does not trap the car`);
    }
  }
  // ---- up and over: in the lane on one side of the centre line, all the way across ----
  const up = mk(-F.rampEnd - 12, -4, alongH);
  let peak = 0, onDeck = 0, drift = 0, backDown = null;
  for (let i = 0; i < 9 * 60; i++) {
    roll(up, 1 / 60);
    peak = Math.max(peak, up.y);
    if (Math.abs(mu(up)) < 1) onDeck = up.y;
    if (up.y > 3) drift = Math.max(drift, Math.abs(mv(up) + 4));
    if (backDown === null && mu(up) > F.rampEnd + 4) backDown = up.y;
  }
  if (M.surfaceAt(wx(-F.rampEnd - 12, -4), wz(-F.rampEnd - 12, -4), 0) !== 0) bad(`${name}: the road a block before the interchange is not at grade`);
  else ok(`${name}: the road runs at grade up to its approach`);
  // (the peak is the crest hop now, so it is allowed to sit a little above the deck: what has to be exactly
  // right is the surface it crosses the junction on)
  if (peak < H - 0.05 || peak > H + 0.5) bad(`${name}: a car driving up the approach reached y=${peak.toFixed(2)} m, not the ${H} m deck`);
  else ok(`${name}: a car climbs the approach and reaches the deck (peak y=${peak.toFixed(2)} m, the crest hop)`);
  if (Math.abs(onDeck - H) > 0.05) bad(`${name}: the car was at y=${onDeck.toFixed(2)} m crossing the junction, not on the ${H} m deck`);
  else ok(`${name}: it crosses the junction on the deck at y=${onDeck.toFixed(2)} m, ${(H - F.slab).toFixed(2)} m over the street below`);
  if (M.surfaceAt(wx(0, 0), wz(0, 0), H) !== H) bad(`${name}: the surface over the junction is not the deck for a car up there`);
  if (drift > 1.0) bad(`${name}: the car wandered ${drift.toFixed(2)} m sideways on the structure`);
  else ok(`${name}: the parapets hold it on the deck`);
  if (backDown === null || backDown > 0.35) bad(`${name}: the far approach does not bring the car back to grade (y=${backDown})`);
  else ok(`${name}: the far approach brings it back down to the road`);
  // ---- under: a car on the street below, crossing the junction at grade ----
  const under = mk(0, -40, acrossH);
  let lift = 0, through = false;
  for (let i = 0; i < 5 * 60; i++) {
    roll(under, 1 / 60);
    if (Math.abs(mv(under)) < F.halfW) { lift = Math.max(lift, Math.abs(under.y)); through = true; }
  }
  if (lift > 0.01) bad(`${name}: a car crossing on the street below was lifted to y=${lift.toFixed(2)} m`);
  else ok(`${name}: traffic on the street below passes under the deck without being lifted onto it`);
  if (!through || mv(under) <= 6) bad(`${name}: the car under the deck did not get through the underpass`);
  else ok(`${name}: a car drives the underpass at grade, coming out ${mv(under).toFixed(0)} m past the junction`);
  // ---- the underpass has real headroom: the deck's underside is clear of anything but traffic ----
  const clear = H - (F.slab + 0.08);                                  // underside of the slab over the carriageway
  if (clear < 4.2) bad(`${name}: only ${clear.toFixed(2)} m of headroom under the deck`);
  else ok(`${name}: the underpass leaves ${clear.toFixed(2)} m of headroom`);
  // ---- the embankment is a wall at grade: a car beside it cannot drive into the structure ----
  const wallCar = mk(-F.deckHalf - 6, -F.halfW - 1.4, alongH);
  roll(wallCar, 1.2, 1);
  const before = mu(wallCar);
  roll(wallCar, 2.5, 1);
  if (Math.abs(mv(wallCar) + F.halfW + 1.4) > 0.6) bad(`${name}: a car at grade is being pushed out of its own lane beside the embankment`);
  else ok(`${name}: the embankment's walls leave the traffic beside them alone`);
  if (mu(wallCar) - before < 2) bad(`${name}: a car at grade did not get past the embankment at all`);
  else ok(`${name}: traffic passes the interchange at grade on the far side of the embankment`);
  // ---- the flank is closed, but not to the traffic that belongs beside it: a car at grade that turns in
  // towards the embankment is stopped outside it ----
  const flank = mk(-30, -F.halfW - 0.6, acrossH);      // right up against the wall, pointing at the road
  for (let i = 0; i < 4 * 60; i++) roll(flank, 1 / 60);
  if (mv(flank) > -F.halfW) bad(`${name}: a car at grade drove into the flank of the embankment, reaching v=${mv(flank).toFixed(2)} m`);
  else ok(`${name}: the flank of the embankment turns traffic at grade away at v=${mv(flank).toFixed(2)} m`);
  // ---- the parapet holds the whole car, not just its centre line: a car that ends up square across the lane —
  // spun by a PIT, slewed by a ram, slithering on its side after a wreck — presents its *length* to the concrete,
  // and a car shoved clean past the wall's own line (two bodies separating out of a hard hit) has to be brought
  // back inside it. What the push measures is the reach of the car's own box across the road: using half the
  // width let a car at an angle put most of its body through the parapet while its centre stayed "inside".
  {
    const face = F.halfW - F.parapet;                                    // the lane's side of the parapet
    const e2 = CAR_DIMS.sedan.e2;
    const reach = c => alongX ? c.box.e1 * Math.abs(c.box.uz) + c.box.e2 * Math.abs(c.box.vz)
                              : c.box.e1 * Math.abs(c.box.ux) + c.box.e2 * Math.abs(c.box.vx);
    const slideV = (c, dv) => { if (alongX) c.z += dv; else c.x += dv; c.box.x = c.x; c.box.z = c.z; };
    // square across the deck, resting where a sideways slide used to be allowed to stop, then pushed on in
    const spun = mk(0, -(face - e2), acrossH);
    spun.y = H; M.carBox(spun);
    let through = 0;
    for (let i = 0; i < 60; i++) { slideV(spun, -0.05); M.collideFlyover(spun); through = Math.max(through, -mv(spun) + reach(spun) - face); }
    if (through > 0.03) bad(`${name}: a car spun square across the lane puts ${through.toFixed(2)} m of itself through the parapet (its reach is ${reach(spun).toFixed(2)} m)`);
    else ok(`${name}: a car spun square across the lane is held at the parapet (its length reaches ${reach(spun).toFixed(2)} m across, ${through.toFixed(2)} m through the concrete)`);
    // aligned with the lane, shoved right through the wall's line half way up the ramp
    const wallU = F.deckHalf + 20;
    const shoved = mk(wallU, face + 1.4, alongH);
    shoved.y = M.rampHeight(wallU); M.carBox(shoved);
    M.collideFlyover(shoved);
    if (mv(shoved) > face - e2 + 0.03) bad(`${name}: a car shoved ${(face + 1.4 - (face - e2)).toFixed(1)} m past the parapet's face is left ${(mv(shoved) - (face - e2)).toFixed(2)} m inside it`);
    else ok(`${name}: a car shoved across the parapet's line is brought back inside the lane (v=${mv(shoved).toFixed(2)} m)`);
    // Both walls, ramp halves (including the low approach), every heading, and small/long/heavy vehicles.
    let checks = 0, penetration = 0;
    for (const kind of ['player', 'police2', 'police5', 'schoolbus', 'fueltanker', 'policeMoto']) {
      for (const side of [-1, 1]) for (const u of [-53, -32, 0, 32, 53]) for (let deg = 0; deg < 360; deg += 30) {
        const c = mk(u, side * (face + 0.8), alongH + deg * Math.PI / 180);
        Object.assign(c.box, { e1: CAR_DIMS[kind].e1, e2: CAR_DIMS[kind].e2 });
        c.y = M.rampHeight(u); c.wrecked = deg === 90;
        M.collideFlyover(c); // must refresh even an initially stale box heading
        penetration = Math.max(penetration, Math.abs(mv(c)) + reach(c) - face);
        if (!Number.isFinite(c.x + c.z)) bad(`${name}: non-finite parapet correction for ${kind}`);
        checks++;
      }
    }
    if (penetration > 0.001) bad(`${name}: oriented vehicle sweep penetrates the parapet by ${penetration} m`);
    else ok(`${name}: ${checks} wall/heading/vehicle/height cases keep every corner inside the lane`);
    // Elevated is not the same as being on the bridge: neither jumping underneath nor clearing the coping
    // should teleport a vehicle sideways into the upper lane. Ordinary traffic beside it stays untouched too.
    for (const y of [0, 1.5, H + 2]) {
      const c = mk(0, F.halfW + 0.8, acrossH); c.y = y;
      const x = c.x, z = c.z;
      M.collideFlyover(c);
      if (c.x !== x || c.z !== z) bad(`${name}: parapet catches a car at the wrong level y=${y}`);
    }
    ok(`${name}: level filtering tested below the deck and above its coping`);
    // A police ram separates two overlapping cars after the first wall pass. The final wall pass must refresh
    // the box again (carCar also changes heading) and remove the penetration before the renderer sees it.
    const victim = mk(0, face - e2 - 0.02, alongH);
    const rammer = mk(0, face - e2 - 1.2, acrossH);
    victim.y = rammer.y = H;
    if (alongX) rammer.vz = 24; else rammer.vx = 24;
    M.collideFlyover(victim); M.collideFlyover(rammer);
    M.carCar(rammer, victim); M.carBox(victim);
    const afterPair = mv(victim) + reach(victim) - face;
    M.collideFlyover(victim); M.collideFlyover(rammer);
    if (afterPair <= 0) bad(`${name}: ram fixture failed to push a car into the wall`);
    else if (mv(victim) + reach(victim) > face + 0.001) bad(`${name}: ram leaves the car inside the parapet`);
    else ok(`${name}: ram penetration (${afterPair.toFixed(2)} m) is resolved before rendering`);

  }
  // ---- and the longest vehicle in the city climbs it too: the embankment's slices can never be tall enough to
  // catch a bus straddling them ----
  const bus = mk(-F.rampEnd - 20, -4, alongH);
  bus.kind = 'schoolbus'; bus.mass = CAR_DIMS.schoolbus.mass;
  bus.box.e1 = CAR_DIMS.schoolbus.e1; bus.box.e2 = CAR_DIMS.schoolbus.e2;
  let busPeak = 0;
  for (let i = 0; i < 12 * 60; i++) { roll(bus, 1 / 60); busPeak = Math.max(busPeak, bus.y); }
  if (busPeak < H - 0.05 || busPeak > H + 0.5) bad(`${name}: a school bus only reached y=${busPeak.toFixed(2)} m climbing the approach — a slice is catching a long vehicle`);
  else ok(`${name}: a school bus climbs the approach to the deck just as the car does`);
  // ---- a look-up made from up on the deck is not blocked by the embankment under it: this is what lets the AI
  // (and any car's own look-ahead) treat the ramp it is climbing as open road instead of a wall of concrete ----
  const midU = F.deckHalf + (F.rampEnd - F.deckHalf) / 2;
  const [px, pz] = [wx(0, 0) + (alongX ? 0 : 0), wz(0, 0)];
  const [hx, hz] = [alongX ? f.node + midU : f.road, alongX ? f.road : f.node + midU];
  if (!world.solidAt(hx, hz, 1.2, 0)) bad(`${name}: the embankment is not solid for a car at grade at u=${midU}`);
  else ok(`${name}: the embankment is a wall for a car at grade at u=${midU}`);
  // (the car up there rides the ramp's own surface, half way up the climb: F.deckH / 2)
  if (world.solidAt(hx, hz, 1.2, F.deckH / 2)) bad(`${name}: a car up on the structure still reads the embankment below it as a wall`);
  else ok(`${name}: the same spot is open road for a car up on the structure`);
  // ---- the hop off the crest: a car coming down at speed leaves the road for a moment, and comes back ----
  {
    const hop = mk(-F.rampEnd - 10, -4, alongH);
    let air = 0, rise = 0;                       // total air time, and the highest the body gets above the road under it
    for (let i = 0; i < 14 * 60; i++) {
      roll(hop, 1 / 60);
      const g = M.surfaceAt(hop.x, hop.z, hop.y);
      if (hop.y > g + 0.03) { air += 1 / 60; rise = Math.max(rise, hop.y - g); }
    }
    if (air < 0.06) bad(`${name}: a car taking the bridge at speed never leaves the road at the crest (a hop of ${rise.toFixed(2)} m)`);
    else if (air > 0.8 || rise > 0.6) bad(`${name}: the crest throws a car ${(rise * 100).toFixed(0)} cm up for ${air.toFixed(2)} s — that is not a slight hop, that is a jump`);
    else ok(`${name}: it takes the crest at speed with a slight natural hop (airborne ${air.toFixed(2)} s in all, ${(rise * 100).toFixed(0)} cm at its highest)`);
  }
  // ---- and a pursuer can follow it up there: a car at grade on the flying road, steering for the lane in front
  // of the ramp's foot (the point rampApproach() hands the police AI), climbs the bridge instead of stopping
  // under it. This is the bug the player reported: "police can't catch it, they go under the flyover" ----
  {
    const cop = mk(-(F.rampEnd + 26), laneV(f, 1, 2.5), alongH);
    const tgt = { x: 0, z: 0 };
    let peakY = 0, onDeckAt = null;
    for (let i = 0; i < 16 * 60; i++) {
      const p = M.rampApproach(f, cop.x, cop.z, 2.5, 9, tgt);
      const tx = p ? p.x : cop.x, tz = p ? p.z : cop.z;
      const want = Math.atan2(tx - cop.x, tz - cop.z), diff = ((want - cop.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      cop.steer = Math.max(-1, Math.min(1, diff * 2.35));
      roll(cop, 1 / 60, Math.abs(diff) > 1.1 && cop.speed > 22 ? -0.1 : 1);
      peakY = Math.max(peakY, cop.y);
      if (onDeckAt === null && Math.abs(mu(cop)) < F.deckHalf) onDeckAt = cop.y;
    }
    if (peakY < H - 0.05) bad(`${name}: a pursuer steering for the ramp foot never got up the bridge (peak y=${peakY.toFixed(2)} m)`);
    else ok(`${name}: a pursuer at grade lines up on the ramp foot and drives up onto the deck (y=${peakY.toFixed(2)} m, ${onDeckAt === null ? 'never crossed the junction' : `across it at ${onDeckAt.toFixed(2)} m`})`);
  }
}

// The test loop above mirrors the game: guard the ordering that used to leave a rammed car in the wall
// for a rendered frame even when an earlier collision pass was correct.
{
  const update = fs.readFileSync(path.join(repo, 'js/update.js'), 'utf8');
  const pair = update.indexOf('carCar(A, B)');
  const wall = update.indexOf('collideFlyover(c)', pair);
  const mesh = update.indexOf('syncCarMesh(c, sdt)', pair);
  if (pair < 0 || wall < pair || mesh < wall) bad('update must resolve parapets after car separation and before rendering');
  else ok('update resolves car-car shoves against the parapet before syncing meshes');
}

// ---- street cones: a bump at city speed is a knock, and a fast hit costs less than a tree's would ----
// (before: every cone cost at least 1.9 HP for the player, and 3.6 HP at 15 m/s; a tree costs nothing below 14 m/s)
{
  const px = 40, pz = 40;                                   // inside block (0, 0), which the checks above generated
  const near = world.nearChunks(px, pz);
  const saved = near.map(ch => ch.props);
  const hitAt = speed => {
    fx.hurtAmt = 0;
    near.forEach(ch => { ch.props = []; });                 // only the cone under test can break here
    const cone = { kind: 'cone', x: px, z: pz, r: 0.65, drag: 0.97, color: 0xff7a1a, broken: false, soft: true, mesh: {} };
    near[0].props.push(cone);
    const c = { x: px, z: pz, h: 0, y: 0, speed, vx: 0, vz: speed, mass: 1.3, isPlayer: true, wrecked: false, box: { e1: 2.05, e2: 0.95 } };
    M.collideProps(c);
    return { hp: fx.hurtAmt, broke: cone.broken };
  };
  const slow = hitAt(10), mid = hitAt(15), fast = hitAt(30);
  near.forEach((ch, i) => { ch.props = saved[i]; });
  if (!slow.broke || !mid.broke || !fast.broke) bad('a cone must still knock over when it is hit');
  else ok('a cone is knocked over at every speed');
  if (slow.hp > 0.01) bad(`a cone hit at 10 m/s costs ${slow.hp.toFixed(2)} HP: a bump at city speed should cost nothing`);
  else ok('a cone bumped at 10 m/s costs no HP');
  if (mid.hp > 0.3) bad(`a cone hit at 15 m/s costs ${mid.hp.toFixed(2)} HP (limit 0.3)`);
  else ok(`a cone hit at 15 m/s costs ${mid.hp.toFixed(2)} HP`);
  if (fast.hp > 1.0) bad(`a cone hit at 30 m/s costs ${fast.hp.toFixed(2)} HP (limit 1.0, about a tree's)`);
  else ok(`a cone hit at 30 m/s costs ${fast.hp.toFixed(2)} HP`);
}
console.log(fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
