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
export const fx = { sparks: 0, smoke: 0, debris: 0, explosion: 0, crash: 0, hurtPlayer: 0, hurtCar: 0, impactFx: 0 };
const burst = k => () => { fx[k]++; };
const sparks = burst('sparks'), smoke = burst('smoke'), debris = burst('debris'), explosion = burst('explosion'), impactFx = burst('impactFx');
const emit = () => {};
const sfx = new Proxy({}, { get: () => () => { fx.crash++; } });
const hurtPlayer = () => { fx.hurtPlayer++; };
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
const toast = () => {};
const __world = await import(${JSON.stringify(modulePath)});
const nearChunks = __world.nearChunks, addParkedCarToChunk = __world.addParkedCarToChunk;
const lotCars = __world.lotCars, ambulanceTarget = __world.ambulanceTarget, RELIEF_DELAY = __world.RELIEF_DELAY;
const isHeavyParked = __world.isHeavyParked, parkedShove = __world.parkedShove, parkedDamage = __world.parkedDamage;
const CAR_DIMS = __world.CAR_DIMS;
const env = { phase: 0.8, day: 0, night: 1, dusk: 0 };
${carBoxSrc}
export { updateParking, collideSolids, carCar, tickHulks, wreckTick, tickPumpFuses, syncCarMesh, driveCar, sat, updateFlying, flyingFloor, hit, env, game, player, scene, flying, fires, cars };
`;
const file = path.join(os.tmpdir(), 'salam-heavyhit.test.mjs');
fs.writeFileSync(file, stubs + '\n' + read('js/flying.js') + '\n' + read('js/wrecks.js') + '\n' + read('js/traffic.js') + '\n' + read('js/collisions.js') + '\n' + createSrc + '\n' + driveSrc + '\n' + syncSrc);
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
const hospital = [...world.chunks.values()].find(ch => ch.parkingFixed && ch.ambulanceSlots);
const station = [...world.chunks.values()].find(ch => ch.fireSlots);
const mall = [...world.chunks.values()].find(ch => ch.parkingTotal && !ch.parkingFixed && !ch.fireSlots);
if (!hospital || !station || !mall) { console.log('missing test blocks'); process.exit(1); }
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

// ==== 2c) keep ramming: it burns where it stands, becomes a wreck, and is never replaced ====
let hulkRef = null;
{
  const game0 = { cash: M.game.cash };
  const fresh = [...hospital.ambulanceSlots, ...station.fireSlots].filter(sl => sl.car && !sl.out && !sl.car.wrecked);
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
  const ownedBefore = [...hospital.ambulanceSlots, ...station.fireSlots].filter(sl => sl.car).length;
  step(90, 0.8);                                                 // a minute and a half more of frames
  const ownedAfter = [...hospital.ambulanceSlots, ...station.fireSlots].filter(sl => sl.car).length;
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

console.log(fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
