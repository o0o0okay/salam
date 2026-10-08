/* Behavioural test: how the police chase behaves around a flyover.
 *
 * The reported bug: a player parked beside a flyover's embankment could make the police circle the block for
 * a long time, because the pursuit only ever reasoned about the flying road's own lanes - so a pursuer coming
 * down the avenue aimed at the carriageway under the deck, and one starting at grade beside the wall kept
 * nosing into it. js/police.js now hands the car on the ground an aim built from the whole interchange (the
 * junction under the deck or the ramp foot to cross at, then the at-grade lane beside the structure).
 *
 * This drives the real policeAI with the real car physics, surface glue and collisions (js/flying.js,
 * js/collisions.js, js/vehicle.js stitched onto the Node world), and requires every pursuer to actually get
 * to a parked player - in the at-grade lane, under the deck, on the deck - within the time limit, at the
 * player's own height, instead of idling around the structure.
 *
 * Run:  node tools/sidewalk-checks/police-chase.mjs      (exits non-zero when a behaviour is wrong)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import url from 'url';
import { modulePath } from './harness.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const world = await import(modulePath);
const read = f => fs.readFileSync(path.join(repo, f), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const vehicleSrc = fs.readFileSync(path.join(repo, 'js/vehicle.js'), 'utf8');
const between = (a, b) => { const i = vehicleSrc.indexOf(a); return vehicleSrc.slice(i, b ? vehicleSrc.indexOf(b) : vehicleSrc.length); };
const strip = t => t.replace(/^export /gm, '');
const createSrc = strip(between('export function createCar', 'export function removeCar'));
const carBoxSrc = between('export function carBox', 'export function driveCar');
const driveSrc = strip(between('export function driveCar', 'export function syncCarMesh'));
const syncSrc = strip(between('export function syncCarMesh'));
const cfgSrc = fs.readFileSync(path.join(repo, 'js/config.js'), 'utf8');
const PLAYER_PARAMS = eval('(' + cfgSrc.match(/export const PLAYER_PARAMS = (\{[^}]*\});/)[1] + ')');
const DIFF = eval('(' + cfgSrc.match(/export const DIFFICULTIES = (\{[\s\S]*?\n\});/)[1] + ').normal');
const HEAR_R = +cfgSrc.match(/export const HEAR_R = (\d+)/)[1];
const POLICE_TIERS = eval('(' + cfgSrc.match(/export const POLICE_TIERS = (\[[\s\S]*?\n\]);/)[1] + ')');

const stubs = `
const PI = Math.PI, CHUNK = 80;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const rnd = (a, b) => a + Math.random() * (b - a);
const weatherSystem = { slickness: 0 };
const HULK_PARAMS = { maxSpeed: 46, maxReverse: 8, accel: 0, brake: 34, turn: 1.5, turnFalloff: 40, grip: 9.4 };
const isPoliceKind = kind => typeof kind === 'string' && kind.startsWith('police');
const buildCar = () => { const g = new Obj(); g.userData = { inner: new Obj(), lights: {} }; return g; };
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
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
const THREE = { Group: Obj, Mesh, BoxGeometry: Geo, CylinderGeometry: Geo, SphereGeometry: Geo, PlaneGeometry: Geo, Color: class { setRGB() { return this; } setHex() { return this; } }, Vector3: V3, Quaternion: Quat, MeshBasicMaterial: class { constructor(o) { Object.assign(this, o || {}); } } };
const scene = { list: [], add(o) { o.parent = this; this.list.push(o); return o; }, remove(o) { const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1); if (o) o.parent = null; } };
const ASSET = new Proxy({ burnt: {} }, { get: (t, k) => (k in t ? t[k] : {}) });
const TREE_VARIANTS = [{}, {}, {}, {}, {}, {}];
const setTreeMatrix = () => {}; const _Y = new V3(0, 1, 0);
const TREE_BREAK_V = 11; const DIFF = ${JSON.stringify(DIFF)};
const game = { state: 'playing', time: 0, t: 0, cash: 0, shake: 0, hp: 100, takedowns: 0, wanted: 1, clock: 0, dist: 0, slow: 1, combo: 0, comboT: 0 };
const player = {};
const police = [], civs = [], cars = [], flying = [], fallingTrees = [], geysers = [], fires = [];
const sight = { x: 0, z: 0, vx: 0, vz: 0, t: -99, heliLock: 0, heliOn: false, lostFlag: false };
const reportSighting = () => { sight.x = player.x; sight.z = player.z; sight.vx = player.vx; sight.vz = player.vz; sight.t = game.t; };
const env = { phase: 0.8, day: 0, night: 1, dusk: 0, sx: 0.5, sy: 1 };
const HEAR_R = ${HEAR_R};
const PLAYER_PARAMS = ${JSON.stringify(PLAYER_PARAMS)};
const POLICE_TIERS = ${JSON.stringify(POLICE_TIERS)};
const fx = { hurtCar: 0, hurtPlayer: 0, impactFx: 0, sparks: 0, smoke: 0, debris: 0, explosion: 0, crash: 0 };
const burst = k => () => { fx[k]++; };
const sparks = burst('sparks'), smoke = burst('smoke'), debris = burst('debris'), explosion = burst('explosion'), impactFx = burst('impactFx');
const emit = () => {};
const sfx = new Proxy({}, { get: () => () => {} });
const hurtPlayer = () => { fx.hurtPlayer++; };
const ARMOR = [1, .82, .62, .42, .28];
const hurtCar = (c, amt) => { fx.hurtCar++; if (c.wrecked || !(amt > 0)) return; const armor = c.isPolice ? ARMOR[Math.min(4, Math.max(0, (c.tier || 1) - 1))] : 1; c.hp -= amt * armor; if (c.hp <= 0) { c.wrecked = true; c.wreckT = 0; } };
const civPanic = () => {};
const toast = () => {};
const wreckTick = (c, dt) => { c.wreckT += dt; };
const tickHulks = () => {};
const __world = await import(${JSON.stringify(modulePath)});
const nearChunks = __world.nearChunks, CAR_DIMS = __world.CAR_DIMS, solidAt = __world.solidAt;
const isHeavyParked = __world.isHeavyParked, parkedShove = __world.parkedShove, parkedDamage = __world.parkedDamage;
const insideFootprint = __world.insideFootprint, parapetPush = __world.parapetPush;
const surfaceAt = __world.surfaceAt, flyoverNear = __world.flyoverNear, alongOf = __world.alongOf, latOf = __world.latOf;
const rampHeight = __world.rampHeight;
const laneOffsetOn = __world.laneOffsetOn, rampApproach = __world.rampApproach;
const rampExit = __world.rampExit, laneAim = __world.laneAim, laneOffset = __world.laneOffset, FLY = __world.FLY;
const roadEdge = __world.roadEdge;
${carBoxSrc}
export { sat, updateFlying, collideSolids, collideFlyover, carCar, syncCarMesh, driveCar, createCar, makePoliceUnit, policeAI, game, player, police, cars, sight, env, CAR_DIMS, PLAYER_PARAMS, fx, solidAt, surfaceAt, flyoverNear, alongOf, latOf, laneOffsetOn, rampApproach, rampExit, laneAim, laneOffset, nearChunks, __world };
`;
const file = path.join(os.tmpdir(), 'salam-psim.test.mjs');
fs.writeFileSync(file, stubs + '\n' + read('js/flying.js') + '\n' + read('js/collisions.js') + '\n' + createSrc + '\n' + driveSrc + '\n' + syncSrc + '\n' + read('js/police.js'));
const M = await import(file + '?v=' + Date.now());

const W = M.__world;
const DT = 1 / 60;
let seed = 987654321;
Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const reseed = (s = 987654321) => { seed = s; };

function spawnPlayer(x, z, h, y = 0) {
  Object.assign(M.player, M.createCar('player', x, z, h, M.PLAYER_PARAMS, 0));
  M.player.y = y;
  M.cars.push(M.player);
}

function spawnCop(x, z, h, { tier = 2, role = 'chaser', y = null } = {}) {
  const p = M.makePoliceUnit(tier, x, z, h, 'police' + tier);
  p.role = role; p.flank = 1;
  if (y !== null) p.y = y;
  M.police.push(p); M.cars.push(p);
  return p;
}

/* Runs one chase: the player sits still with the hand brake on (the reported case - hiding, not fleeing) and
   every pursuer is driven by the real policeAI. Returns the per-unit trace. */
function chase(player, cops, seconds = 26) {
  M.cars.length = 0; M.police.length = 0; M.sight.t = -99; M.game.time = 0; M.game.t = 0; reseed();
  spawnPlayer(player.x, player.z, player.h, player.y || 0);
  const units = cops.map(c => spawnCop(c.x, c.z, c.h, c));
  W.updateChunks(player.x, player.z, 999);
  const trace = units.map(() => []);
  let budgetT = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    M.game.time += DT; M.game.t = M.game.time;
    M.driveCar(M.player, { throttle: 0, hand: true }, DT);
    for (const p of M.police) { const inp = M.policeAI(p, DT); M.driveCar(p, inp, DT); }
    for (const c of M.cars) { M.collideSolids(c); M.collideFlyover(c); }
    for (let a = 0; a < M.cars.length; a++) for (let b = a + 1; b < M.cars.length; b++) {
      const A = M.cars[a], B = M.cars[b];
      if (Math.abs(A.y - B.y) > 2 || A.dead || B.dead) continue;
      const dx = A.x - B.x, dz = A.z - B.z, rr = A.box.e1 + B.box.e1 + 1;
      if (dx * dx + dz * dz <= rr * rr) M.carCar(A, B);
    }
    for (const c of M.cars) { M.collideFlyover(c); M.syncCarMesh(c, DT); }
    budgetT += DT;
    if (budgetT > 1) { budgetT = 0; W.updateChunks(player.x, player.z, 999); }
    units.forEach((p, k) => trace[k].push({ t: M.game.time, x: p.x, z: p.z, y: p.y, speed: p.speed, d: Math.hypot(p.x - player.x, p.z - player.z), dy: Math.abs(p.y - (player.y || 0)), hp: p.hp }));
  }
  return trace;
}

let fails = 0;
const ok = m => console.log('  . ' + m);
const bad = m => { fails++; console.log('  X ' + m); };

// The copy below is stitched in as plain text and its import lines are dropped, so a helper the AI calls without
// importing it still runs here and only blows up in the browser. Every flyover helper the AI names has to be one
// its import line pulls in - this is exactly how `roadEdge` slipped through once.
{
  const policeSrc = fs.readFileSync(path.join(repo, 'js/police.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const imported = /import \{([^}]*)\} from '\.\/flyover\.js';/.exec(policeSrc)[1].split(',').map(s => s.trim());
  const exports = [...fs.readFileSync(path.join(repo, 'js/flyover.js'), 'utf8').matchAll(/export (?:function|const) ([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  const missing = exports.filter(n => !imported.includes(n) && new RegExp(`(?<![.\\w$])${n}\\b`).test(policeSrc));
  if (missing.length) bad(`js/police.js uses ${missing.join(', ')} from js/flyover.js without importing it`);
  else ok('js/police.js imports every flyover helper its AI uses (a stitched copy hides a missing import)');
}

const NODE = W.nearestNode(0, -1).node;        // the first flyover on the avenue: x = 0, the flying road runs along z
const FLY = W.FLY, LANE = FLY.halfW + 7;       // middle of the at-grade lane beside the structure's flank
console.log(`police chase at the flyover on the avenue at z = ${NODE} (deck ±${FLY.deckHalf} m of it, ramp foot at ±${FLY.rampEnd} m, at-grade lane at ±${LANE} m)`);

/* Each case: where the player parks, where the pursuer starts, and the time limit. The player is always
   stationary - the complaint is that a *hiding* player could keep the police going round in circles. */
const cases = [
  ['player in the at-grade lane beside the abutment, pursuer behind on the avenue at grade',
    { x: LANE, z: NODE - 30, h: 0 }, [{ x: 2.5, z: NODE + 60, h: Math.PI }], 24],
  ['player in the at-grade lane beside the abutment, pursuer in that same lane 90 m away',
    { x: LANE, z: NODE - 30, h: 0 }, [{ x: LANE, z: NODE + 60, h: Math.PI }], 14],
  ['player in the at-grade lane beside the abutment, pursuer on the deck right above',
    { x: LANE, z: NODE, h: 0 }, [{ x: 2.5, z: NODE - 8, h: Math.PI, y: 7.2 }], 20],
  ['player in the at-grade lane beside the abutment, pursuer in the far lane on the other side',
    { x: LANE, z: NODE - 30, h: 0 }, [{ x: -LANE, z: NODE + 30, h: Math.PI }], 24],
  ['player under the deck in the junction box, pursuer crossing on the deck',
    { x: 2.5, z: NODE, h: 0 }, [{ x: 2.5, z: NODE, h: Math.PI, y: 7.2 }], 20],
  ['player in the at-grade lane beside the abutment, pursuer coming along the cross street at grade',
    { x: 30, z: NODE, h: -Math.PI / 2 }, [{ x: 70, z: NODE, h: -Math.PI / 2 }], 12],
];

for (const [name, player, cops, limit] of cases) {
  const tr = chase(player, cops.map(c => ({ ...c, tier: 2, role: 'chaser' })));
  const t = tr[0];
  const reach = t.find(s => s.d < 6 && s.dy < 2);
  const dmin = Math.min(...t.map(s => s.d));
  const onDeck = t.filter(s => s.y > 1.2).length * 100 / t.length;
  const line = `dmin ${dmin.toFixed(1)} m, on the structure ${onDeck.toFixed(0)}% of the run, hp ${Math.max(0, Math.round(t[t.length - 1].hp))}`;
  if (!reach) bad(`${name}: never got to the player (${line})`);
  else if (reach.t > limit) bad(`${name}: took ${reach.t.toFixed(1)} s to reach the player, over the ${limit} s limit (${line})`);
  else ok(`${name}: reached the player in ${reach.t.toFixed(1)} s (${line})`);
}

console.log(fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
