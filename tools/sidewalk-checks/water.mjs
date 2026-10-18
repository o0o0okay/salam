/* The water: no car gets into the river or the sea, and a car that is in it all the same goes under (js/water.js; the
   river's walls are built by closedStreets in js/world.js, the seawall by seaWall).
   * the edges: the keep-outs waterGuard holds are the walls the blocks build. Every river block's bank wall has its land
     face KEEP_HALF out from the river's line and its water face RIVER_HALF out. It runs from the bridge parapet at one
     end to the one at the other, or on the east coast (no bridge at the river's mouth) to the seawall. Every parapet
     stands on its deck's edge, as thick as the bank walls. Round every keep-out the walls leave no gap a car fits
     through. No flyover reaches into a keep-out, so the edges, which hold at any height, never stop a car up on one.
   * the guard, on the game's own update loop at 60 fps and at 30: the player's car slid sideways into the bank walls
     (both banks), a bridge's parapets (both sides) and the seawall (all four coasts) at up to 80 m/s; the player
     standing against each of them rammed by a Juggernaut or an Enforcer at up to 65 m/s; a car of the traffic rammed
     into the bank; random pile-ups at each edge, the player and up to three heavy units coming at him. After every
     frame every car's box is clear of the keep-outs and its centre over no water, and the player is on the side he
     started on. At the river's mouth on the east coast the player drives into the new wall and stops.
     waterGuard itself: a car clear of the edges is never touched. One that got through a wall in a frame is put back
     on the side it came from, right against the wall, and stopped like a car that hits one: off the bank onto the bank,
     off a deck onto the deck, at a corner onto the land. That holds however far in it got, out past the coast
     included. A car with no place on the land (just put there) over open water is left to go under.
   * going under: the player put down over the river, over the sea, or dropped over the river from the air (only once
     he is down), ends the run SUNK. The end screen reads like WASTED's, with its own line. The car sinks out of sight
     under the surface in SINK_T and stays down there. A car of the traffic in the river is wrecked, goes under, and is
     taken away. A police car the player hit just before it went into the sea counts as his takedown. The next run
     starts with the player's car dry.
   Run:  node tools/sidewalk-checks/water.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installDom } from './dom.mjs';
import { register } from 'node:module';
// The edges are read off the world generator on its own, block by block (the harness), and the harness wants no DOM: that
// part runs in a process of its own (`node water.mjs edges`), the rest on the game's modules with the stub DOM.
const EDGES_ONLY = process.argv[2] === 'edges';
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------------------------
// 1) the edges are the walls
// ---------------------------------------------------------------------------------------------------------------
if (EDGES_ONLY) {
  const { CHUNK } = await import('../../js/utils.js');
  const { ISLAND_R, ISLAND_MAX, SEAWALL_T } = await import('../../js/island.js');
  const { RIVER_ROW } = await import('../../js/flyover.js');
  const { modulePath } = await import('./harness.mjs');
  const HW = await import(modulePath);
  const K = JSON.parse(process.argv[3]);                        // water.js's numbers, from the parent (water.js wants the game's modules)
  const RZ = K.RIVER_Z, KEEP = K.KEEP_HALF, SEA = K.SEA_IN;
  ok(near(RZ, RIVER_ROW * CHUNK) && SEA === ISLAND_MAX - SEAWALL_T, 'the river is on its row and the sea starts at the seawall');
  const riverKeep = j => ({ x0: j * CHUNK + K.DECK, x1: j === ISLAND_R - 1 ? ISLAND_MAX : (j + 1) * CHUNK - K.DECK, z0: RZ - KEEP, z1: RZ + KEEP });
  ok(JSON.stringify(riverKeep(3)) === JSON.stringify(K.keep3) && JSON.stringify(riverKeep(ISLAND_R - 1)) === JSON.stringify(K.keepEast) && JSON.stringify(riverKeep(-ISLAND_R)) === JSON.stringify(K.keepWest), 'the keep-outs read here are water.js\'s own');
  const walls = [];                                             // every wall round the river, both banks, the whole island
  for (let cx = -ISLAND_R; cx < ISLAND_R; cx++) for (const [cz, sg] of [[RIVER_ROW, 1], [RIVER_ROW - 1, -1]]) {
    const ch = HW.generateChunk(cx, cz, true), x0 = cx * CHUNK, at = `block ${cx},${cz}`;
    const bank = ch.solids.filter(s => s.kind === 'building' && s.hz === 0.25 && near(s.z, RZ + sg * 8.25));
    ok(bank.length === 1, `${at}: ${bank.length} bank walls on the river`);
    const b = bank[0];
    ok(near(Math.abs(b.z - RZ) + b.hz, KEEP) && near(Math.abs(b.z - RZ) - b.hz, K.RIVER_HALF), `${at}: the bank wall's faces are ${KEEP} and ${K.RIVER_HALF} m out`);
    ok(near(b.x - b.hx, x0 + 8.3), `${at}: the bank wall starts at the parapet (${(b.x - b.hx - x0).toFixed(2)} m into the block)`);
    const end = cx === ISLAND_R - 1 ? SEA : x0 + 71.7;
    ok(near(b.x + b.hx, end), `${at}: the bank wall ends at ${(b.x + b.hx).toFixed(2)} (want ${end.toFixed(2)}${cx === ISLAND_R - 1 ? ', the seawall' : ', the next parapet'})`);
    const para = ch.solids.filter(s => s.kind === 'flyover' && s.hx === 0.25 && s.hz === 4);
    ok(para.length === (cx === -ISLAND_R ? 1 : 2), `${at}: ${para.length} parapets at its west junction`);
    for (const p of para) {
      ok(near(Math.abs(p.x - x0) - p.hx, K.DECK) && near(Math.abs(p.x - x0) + p.hx, K.DECK + K.RIVER_WALL), `${at}: a parapet stands on the deck's edge`);
      ok(near(p.z - p.hz, sg > 0 ? RZ : RZ - 8) && near(p.z + p.hz, sg > 0 ? RZ + 8 : RZ), `${at}: a parapet spans its half of the river`);
    }
    walls.push(b, ...para, ...ch.solids.filter(s => s.kind === 'building' && (s.hx === SEAWALL_T / 2 || s.hz === SEAWALL_T / 2) && (s.hx === CHUNK / 2 || s.hz === CHUNK / 2)));
    HW.disposeChunk(ch);
  }
  // round every keep-out, along the middle of its wall band (the bank walls, the parapets, the seawall at the east mouth):
  // the longest stretch no wall covers. (The corner where a parapet meets a bank wall leaves 0.5 m: no car is that narrow.)
  const covered = (x, z) => walls.some(s => Math.abs(x - s.x) <= s.hx + 1e-9 && Math.abs(z - s.z) <= s.hz + 1e-9);
  let worstGap = 0, worstAt = '';
  for (let j = -ISLAND_R; j < ISLAND_R; j++) {
    const r = riverKeep(j), m = K.RIVER_WALL / 2;
    const edges = [[r.x0, r.z1 - m, r.x1, r.z1 - m, 'north'], [r.x0, r.z0 + m, r.x1, r.z0 + m, 'south'], [r.x0 + m, r.z0, r.x0 + m, r.z1, 'west'], [r.x1 - m, r.z0, r.x1 - m, r.z1, 'east']];
    for (const [ax, az, bx, bz, side] of edges) {
      const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 0.05);
      let run = 0;
      for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
        if (covered(x, z)) run = 0; else { run += len / n; if (run > worstGap) { worstGap = run; worstAt = `the ${side} edge of the river's keep-out ${j} at ${x.toFixed(2)},${z.toFixed(2)}`; } }
      }
    }
  }
  ok(worstGap < 0.6, `the walls round the river leave a ${worstGap.toFixed(2)} m opening, ${worstAt}`);
  let flyIn = 0;
  for (let j = -ISLAND_R; j < ISLAND_R; j++) {
    const r = riverKeep(j);
    for (let x = r.x0 + 0.01; x < r.x1; x += 1) for (let z = r.z0 + 0.01; z < r.z1; z += 1) if (HW.flyoverNear(x, z, 0)) flyIn++;
  }
  ok(flyIn === 0, `${flyIn} points of the river's keep-outs are under a flyover`);
  console.log(`the edges: 100 river blocks, their bank walls and parapets where the keep-outs have them, the longest opening round the river ${worstGap.toFixed(2)} m, no flyover over it (${checks} checks)`);
  process.exit(0);
}

installDom();
// the stub DOM makes a new element for every lookup: the end screen's lines are kept per id, so they can be read back
{ const get = document.getElementById, keep = {}; document.getElementById = id => (id in keep ? keep[id] : (keep[id] = get(id))); }
register('./hooks.mjs', import.meta.url);
// a fixed clock and a fixed random sequence: every run the same
performance.now = () => 0;
let seed = 7;
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const THREE = await import('three');
const R = await import('../../js/renderer.js');
const S = await import('../../js/state.js');
const F = await import('../../js/flow.js');
const U = await import('../../js/update.js');
const PO = await import('../../js/police.js');
const V = await import('../../js/vehicle.js');
const W = await import('../../js/world.js');
const WA = await import('../../js/water.js');
const { CHUNK, $ } = await import('../../js/utils.js');
const { ISLAND_R, ISLAND_MAX } = await import('../../js/island.js');
const { CAR_DIMS } = await import('../../js/carModels.js');
R.scene.background = new THREE.Color(0x9ad5ff); R.scene.fog = new THREE.Fog(0x9ad5ff, 95, 215);   // the stub scene has neither
const P = S.player, game = S.game, RZ = WA.RIVER_Z, KEEP = WA.KEEP_HALF, SEA = WA.SEA_IN;
{
  const K = { RIVER_Z: RZ, KEEP_HALF: KEEP, SEA_IN: SEA, DECK: WA.DECK, RIVER_HALF: WA.RIVER_HALF, RIVER_WALL: WA.RIVER_WALL, keep3: WA.riverKeep(3), keepEast: WA.riverKeep(ISLAND_R - 1), keepWest: WA.riverKeep(-ISLAND_R) };
  const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'edges', JSON.stringify(K)], { encoding: 'utf8', maxBuffer: 1 << 24 });
  console.log(out.trim().split('\n').pop());
  checks++;
}

// ---------------------------------------------------------------------------------------------------------------
// 2) the guard
// ---------------------------------------------------------------------------------------------------------------
// The test's own reading of the keep-outs, for any car after any frame: its box clear of all of them, its centre over no water.
function boxRect(c, r) {
  const s = Math.sin(c.h), co = Math.cos(c.h), e1 = c.box.e1, e2 = c.box.e2, hx = (r.x1 - r.x0) / 2, hz = (r.z1 - r.z0) / 2;
  const dx = (r.x0 + r.x1) / 2 - c.x, dz = (r.z0 + r.z1) / 2 - c.z;
  const over = (d, ra, rb) => ra + rb - Math.abs(d) > 1e-6;
  return over(dx, e1 * Math.abs(s) + e2 * Math.abs(co), hx) && over(dz, e1 * Math.abs(co) + e2 * Math.abs(s), hz)
    && over(dx * s + dz * co, e1, hx * Math.abs(s) + hz * Math.abs(co)) && over(dz * s - dx * co, e2, hx * Math.abs(co) + hz * Math.abs(s));
}
function wet(c) {
  const s = Math.sin(c.h), co = Math.cos(c.h), ex = c.box.e1 * Math.abs(s) + c.box.e2 * Math.abs(co), ez = c.box.e1 * Math.abs(co) + c.box.e2 * Math.abs(s);
  if (Math.abs(c.x) + ex > SEA + 1e-6 || Math.abs(c.z) + ez > SEA + 1e-6) return `in the seawall (${c.x.toFixed(2)},${c.z.toFixed(2)})`;
  for (let j = -ISLAND_R; j < ISLAND_R; j++) if (boxRect(c, WA.riverKeep(j))) return `in the river's keep-out ${j} (${c.x.toFixed(2)},${c.z.toFixed(2)})`;
  if (WA.waterAt(c.x, c.z)) return `over the water (${c.x.toFixed(2)},${c.z.toFixed(2)})`;
  return null;
}
// A new run once; after that each trial clears the street and puts the player down where it wants him, the world loaded
// round him. The run never ends on the way (no damage adds up, no BUSTED bar fills): only the water may end it.
game.state = 'menu'; F.startGame();
let loadedAt = '';
function put(x, z, h, vx = 0, vz = 0) {
  for (const c of S.police.slice()) V.removeCar(c);
  for (const c of S.civs.slice()) V.removeCar(c);
  Object.assign(P, { x, z, h, vx, vz, vf: 0, vl: 0, speed: Math.hypot(vx, vz), steer: 0, y: 0, vy: 0, air: false, landX: x, landZ: z, dead: false, sink: null, hp: P.maxHp, boost: 0, flatT: 0 });
  game.state = 'playing'; game.hp = 1e9; game.pin = 0; game.time = Math.max(game.time, 5);
  const key = Math.round(x / CHUNK) + ',' + Math.round(z / CHUNK);
  if (key !== loadedAt) { W.updateChunks(x, z, 999); loadedAt = key; }
  globalThis.__input = undefined;
}
function unit(tier, kind, x, z, h, v) {
  const u = PO.makePoliceUnit(tier, x, z, h, kind);
  u.role = 'chaser'; u.vx = Math.sin(h) * v; u.vz = Math.cos(h) * v; u.vf = v; u.speed = v; u.landX = x; u.landZ = z;
  S.police.push(u); S.cars.push(u); return u;
}
// frames of the game's own loop; after each one every car is checked: clear of the water, and no further from where it was
// a frame ago than it could have got (a car put back on the wrong side of the river would have jumped it). `side(c)`
// says the player is still on his side of the wall.
let frames = 0, trials = 0;
const JUMP = 8;
function run(secs, DT, what, side) {
  const was = new Map(S.cars.map(c => [c, [c.x, c.z]]));
  for (let f = 0; f < Math.round(secs / DT); f++) {
    game.spawnT = 99; game.civT = 99; game.spikeT = 99; game.roadblockT = 99; game.hp = 1e9; game.pin = 0;
    U.update(DT); frames++;
    const at = `${(f * DT).toFixed(2)} s`;
    ok(game.state === 'playing', `${what}: the run ended (${game.reason}) at ${at}`);
    for (const c of S.cars) {
      if (c.sink) continue;
      const who = c.isPlayer ? 'the player' : c.kind, bad = wet(c);
      ok(!bad, `${what}: ${who} is ${bad} at ${at}`);
      const w = was.get(c);
      if (w) ok(Math.hypot(c.x - w[0], c.z - w[1]) <= JUMP, `${what}: ${who} jumped ${Math.hypot(c.x - w[0], c.z - w[1]).toFixed(1)} m in a frame at ${at}`);
      was.set(c, [c.x, c.z]);
    }
    if (side) ok(side(P), `${what}: the player is off his side of the wall (${P.x.toFixed(2)},${P.z.toFixed(2)}) at ${at}`);
  }
  trials++;
}
const J = -23 * CHUNK;                                         // the bridge the deck trials use: x = -1840
// Each edge: where the player stands with his side against it (0.6 m off for a slide, 0.02 m for a ram), the way into it
// (unit vector), his heading along it, and his side of it.
const E2 = CAR_DIMS.player.e2;
// (off the river's span, past a bank or over a deck, a car is on the land whichever side of a wall's line it is)
const overDeck = x => Math.abs(x - Math.round(x / CHUNK) * CHUNK) <= WA.DECK, offRiver = c => Math.abs(c.z - RZ) >= KEEP;
const EDGES = [
  { name: 'the north bank', at: g => [-1880, RZ + KEEP + E2 + g], n: [0, -1], h: Math.PI / 2, side: c => c.z > RZ + KEEP || overDeck(c.x) },
  { name: 'the south bank', at: g => [-1880, RZ - KEEP - E2 - g], n: [0, 1], h: Math.PI / 2, side: c => c.z < RZ - KEEP || overDeck(c.x) },
  { name: 'a bridge, east parapet', at: g => [J + WA.DECK - E2 - g, RZ + 3], n: [1, 0], h: 0, side: c => c.x < J + WA.DECK || offRiver(c) },
  { name: 'a bridge, west parapet', at: g => [J - WA.DECK + E2 + g, RZ - 3], n: [-1, 0], h: Math.PI, side: c => c.x > J - WA.DECK || offRiver(c) },
  { name: 'the west seawall', at: g => [-SEA + E2 + g, 320], n: [-1, 0], h: 0, side: c => c.x > -SEA },
  { name: 'the east seawall', at: g => [SEA - E2 - g, -400], n: [1, 0], h: 0, side: c => c.x < SEA },
  { name: 'the north seawall', at: g => [240, SEA - E2 - g], n: [0, 1], h: Math.PI / 2, side: c => c.z < SEA },
  { name: 'the south seawall', at: g => [-640, -SEA + E2 + g], n: [0, -1], h: Math.PI / 2, side: c => c.z > -SEA },
];
// (the seawall trials stand on the coast's junction squares, grass with nothing on it)
// a) slides: sideways into the wall, a little speed along it
for (const e of EDGES) for (const DT of [1 / 60, 1 / 30]) for (const v of [15, 30, 45, 60, 80]) {
  const [x, z] = e.at(0.6);
  put(x, z, e.h, e.n[0] * v + Math.sin(e.h) * 10, e.n[1] * v + Math.cos(e.h) * 10);
  run(1.0, DT, `${e.name}: a slide at ${v} m/s, ${Math.round(1 / DT)} fps`, e.side);
}
// b) rams: the player against the wall, a Juggernaut or an Enforcer coming straight at him from the land
for (const e of EDGES) for (const DT of [1 / 60, 1 / 30]) for (const [tier, kind] of [[5, 'police5'], [4, 'police4']]) for (const v of [25, 45, 65]) {
  const [x, z] = e.at(0.02);
  put(x, z, e.h);
  const back = E2 + CAR_DIMS[kind].e1 + 1.5;
  unit(tier, kind, x - e.n[0] * back, z - e.n[1] * back, Math.atan2(e.n[0], e.n[1]), v);
  run(1.0, DT, `${e.name}: a ${kind} rams him at ${v} m/s, ${Math.round(1 / DT)} fps`, e.side);
}
// c) a car of the traffic, rammed into the north bank by a Juggernaut
{
  const [x, z] = EDGES[0].at(5);
  put(x, z, Math.PI / 2);                                       // the player out of the way, on the bank
  P.x -= 40; P.landX = P.x;
  const civ = V.createCar('sedan', -1880, RZ + KEEP + E2 + 0.02, Math.PI / 2, { maxSpeed: 14, maxReverse: 6, accel: 8, brake: 20, turn: 2, turnFalloff: 40, grip: 7 }, 0x3366cc);
  S.civs.push(civ); S.cars.push(civ);
  unit(5, 'police5', -1880, RZ + KEEP + E2 + 0.02 + E2 + 3.7 + 1.5, Math.PI, 55);
  run(1.0, 1 / 30, 'a sedan rammed into the north bank at 55 m/s, 30 fps', null);
  ok(civ.z > RZ + KEEP && !civ.sink, `the sedan is on the bank (${civ.z.toFixed(2)})`);
}
// d) pile-ups: the player near an edge, heading anywhere, sliding anyhow, and up to three heavy units coming at him
const KINDS = [[5, 'police5'], [4, 'police4'], [3, 'police3'], [2, 'police2'], [1, 'police1']];
for (const e of EDGES) for (let t = 0; t < 24; t++) {
  const DT = Math.random() < 0.5 ? 1 / 60 : 1 / 30, g = 0.05 + Math.random() * 2.5;
  const [x, z] = e.at(g), along = [Math.sin(e.h), Math.cos(e.h)];
  const v = 10 + Math.random() * 60, a = (Math.random() - 0.5) * 2.2;     // into the wall, up to 63 degrees off square
  const dx = e.n[0] * Math.cos(a) + along[0] * Math.sin(a), dz = e.n[1] * Math.cos(a) + along[1] * Math.sin(a);
  put(x, z, Math.random() * Math.PI * 2, dx * v, dz * v);
  const units = Math.floor(Math.random() * 4);
  for (let k = 0; k < units; k++) {
    const [tier, kind] = KINDS[Math.floor(Math.random() * KINDS.length)];
    const back = E2 + CAR_DIMS[kind].e1 + 1 + Math.random() * 8, off = (Math.random() - 0.5) * 6;
    const ux = x - e.n[0] * back + along[0] * off, uz = z - e.n[1] * back + along[1] * off;
    const u = unit(tier, kind, ux, uz, Math.atan2(x - ux, z - uz), 15 + Math.random() * 50);
    if (wet(u)) V.removeCar(u);                                 // past a bridge's other parapet: not a place to start from
  }
  run(0.7, DT, `${e.name}: pile-up ${t} (${units} units, ${v.toFixed(0)} m/s at ${(a * 57.3).toFixed(0)} degrees, ${Math.round(1 / DT)} fps)`, e.side);
}
// e) a ram that kills him against the seawall: his wreck is left clear of it, where it is drawn
{
  const e = EDGES[4], [x, z] = e.at(0.02);
  put(x, z, e.h); game.hp = 1;
  unit(5, 'police5', x - e.n[0] * (E2 + 3.7 + 1.5), z, Math.atan2(e.n[0], e.n[1]), 50);
  for (let f = 0; f < 30 && game.state === 'playing'; f++) { game.spawnT = 99; game.civT = 99; U.update(1 / 30); }
  ok(game.state === 'over' && game.reason === 'WASTED', `a ram at 50 m/s with 1 hp left: ${game.state} ${game.reason}`);
  ok(!wet(P) && P.mesh.position.x === P.x && P.mesh.position.z === P.z, `his wreck is clear of the seawall (${P.x.toFixed(2)}), and drawn there`);
  game.state = 'playing';
}
// f) the river's mouth on the east coast: driven into from the coast's park, on both banks
for (const [z0, h, sg] of [[RZ + 16, Math.PI, 1], [RZ - 13, 0, -1]]) for (const x of [1992.5, 1994.5, 1996]) {
  put(x, z0, h);
  globalThis.__input = { throttle: 1, steer: 0 };
  run(2.0, 1 / 60, `the east mouth from ${x},${z0}`, c => sg * (c.z - RZ) > KEEP);
  ok(sg * (P.z - RZ) - KEEP - CAR_DIMS.player.e1 < 0.3, `the east mouth from ${x},${z0}: he drove up to the wall (${P.z.toFixed(2)})`);
}
console.log(`the guard: ${trials} runs, ${frames} frames of the game's loop, every car clear of the water after every one`);

// waterGuard itself, on cars put by hand
function bare(x, z, h, lx, lz, kind = 'player') {
  const c = { kind, isPlayer: false, x, z, h, y: 0, vx: 0, vz: 0, box: { e1: CAR_DIMS[kind].e1, e2: CAR_DIMS[kind].e2 }, landX: lx, landZ: lz, lastWall: -99, mass: 1, hp: 50, sink: null, isPolice: false };
  return c;
}
// a car clear of every edge, however close, is never touched
let untouched = 0;
for (let i = 0; i < 4000; i++) {
  const e = EDGES[i % EDGES.length], [x, z] = e.at(Math.random() * 3), h = Math.random() * Math.PI * 2;
  const c = bare(x + (Math.random() - 0.5) * 40 * Math.abs(e.n[1]), z + (Math.random() - 0.5) * 40 * Math.abs(e.n[0]), h);
  c.landX = c.x; c.landZ = c.z;
  if (wet(c)) continue;
  const before = [c.x, c.z, c.vx, c.vz, c.lastWall];
  WA.waterGuard(c);
  ok(c.x === before[0] && c.z === before[1] && c.vx === before[2] && c.vz === before[3] && c.lastWall === before[4] && !c.sink, `a car clear of the water at ${before[0].toFixed(2)},${before[1].toFixed(2)} was moved`);
  untouched++;
}
ok(untouched > 1500, `${untouched} cars clear of the water tried`);
// one that got through in a frame goes back the way it came, right against the wall, and is stopped: [what, the car, where
// it must end up, its speed (into the wall), the way(s) out]
const ex = (c) => c.box.e1 * Math.abs(Math.sin(c.h)) + c.box.e2 * Math.abs(Math.cos(c.h)), ez = (c) => c.box.e1 * Math.abs(Math.cos(c.h)) + c.box.e2 * Math.abs(Math.sin(c.h));
const CASES = [
  ['off the north bank, 1 m into the water', bare(-1880, RZ + 7, Math.PI / 2, -1880, RZ + 10.5), c => near(c.z, RZ + KEEP + ez(c)), [0, -30], [[0, 1]]],
  ['off the north bank, past the river\'s middle', bare(-1880, RZ - 0.5, Math.PI / 2, -1880, RZ + 9.5), c => near(c.z, RZ + KEEP + ez(c)), [0, -30], [[0, 1]]],
  ['off the south bank, 3 m in', bare(-1870, RZ - 5.5, 0.4, -1870, RZ - 10), c => near(c.z, RZ - KEEP - ez(c)), [0, 30], [[0, -1]]],
  ['off a deck, through its parapet', bare(J + 10, RZ + 2, 0, J + 6, RZ + 2), c => near(c.x, J + WA.DECK - ex(c)), [30, 0], [[-1, 0]]],
  ['off a deck, through the parapet on its other side', bare(J - 12, RZ - 4, Math.PI, J - 6.5, RZ - 4), c => near(c.x, J - WA.DECK + ex(c)), [-30, 0], [[1, 0]]],
  ['at a corner, off the deck onto it', bare(J + 9, RZ + 9, 0.7, J + 6, RZ + 7), c => c.x < J + WA.DECK, [20, 20], [[-1, 0]]],
  ['at a corner, off the bank onto it', bare(J + 9.5, RZ + 8.2, 0.3, J + 11, RZ + 11), c => c.z > RZ + KEEP, [0, -30], [[0, 1]]],
  ['into the west seawall', bare(-SEA - 1, 200, 0, -SEA + 1.5, 200), c => near(c.x, -SEA + ex(c)), [-30, 0], [[1, 0]]],
  ['out past the west coast', bare(-ISLAND_MAX - 2, 200, 0, -SEA + 1.2, 200), c => near(c.x, -SEA + ex(c)), [-30, 0], [[1, 0]]],
  ['into the north seawall at the island\'s corner', bare(SEA - 0.3, SEA + 0.6, 0.8, SEA - 2.5, SEA - 2.5), c => near(c.x, SEA - ex(c)) && near(c.z, SEA - ez(c)), [20, 20], [[-1, 0], [0, -1]]],
  ['into the river\'s mouth on the east coast', bare(1995, RZ + 6, Math.PI / 2, 1995, RZ + 11), c => near(c.z, RZ + KEEP + ez(c)), [0, -30], [[0, 1]]],
];
for (const [what, c, where, [vx, vz], outs] of CASES) {
  c.vx = vx; c.vz = vz;
  WA.waterGuard(c);
  ok(!wet(c) && where(c) && !c.sink, `${what}: put back at ${c.x.toFixed(2)},${c.z.toFixed(2)}`);
  ok(c.lastWall > -99, `${what}: stopped as by a wall`);
  for (const [mx, mz] of outs) ok(c.vx * mx + c.vz * mz >= 0, `${what}: still going into the water (${c.vx.toFixed(1)},${c.vz.toFixed(1)})`);
}
// a car with no place on the land, put down over open water, is left to go under
{
  const c = bare(-1880, RZ + 1, 0, undefined, undefined); c.mesh = { position: { set() {} } };
  c.isPlayer = false; c.wrecked = false; c.lastPlayerHit = -99;
  WA.waterGuard(c);
  ok(c.sink && c.dead && c.wrecked, 'a car put down over the river goes under');
}
console.log(`waterGuard by hand: ${untouched} cars clear of the water left alone, ${CASES.length} put back the way they came`);

// ---------------------------------------------------------------------------------------------------------------
// 3) going under
// ---------------------------------------------------------------------------------------------------------------
function drown(x, z, y, what) {
  put(x, z, 0);
  P.y = y; P.landX = undefined; P.landZ = undefined;              // put down there: no place on the land to go back to
  let t = 0;
  while (game.state === 'playing' && t < 3) { game.spawnT = 99; game.civT = 99; game.hp = 100; U.update(1 / 60); t += 1 / 60; }
  ok(game.state === 'over' && game.reason === 'SUNK' && P.dead && P.sink, `${what}: the run ends SUNK (${game.state} ${game.reason})`);
  return t;
}
for (const [x, z, what] of [[-1880, RZ + 2, 'the player over the river'], [-ISLAND_MAX - 6, 300, 'the player over the sea'], [-1000, RZ - 3, 'the player over the river, further east']]) {
  drown(x, z, 0, what);
  for (let k = 0; k < 75; k++) U.update(1 / 60);                // 1.25 s
  ok(P.y < -1.5 && P.mesh.position.y === P.y, `${what}: going under (${P.y.toFixed(2)} m after 1.25 s)`);
  for (let k = 0; k < 90; k++) U.update(1 / 60);
  ok(P.y === WA.SINK_TO && P.mesh.position.y === P.y && near(P.inner.rotation.x, 0.45), `${what}: out of sight, nose down (${P.y.toFixed(2)} m)`);
  ok(S.cars.includes(P), `${what}: his car stays down there until the next run`);
  F.showOver();
  ok($('overTitle').textContent === 'SUNK' && $('overTitle').className === 'title wasted', `${what}: the end screen says SUNK, as WASTED does (${$('overTitle').textContent}, ${$('overTitle').className})`);
  ok($('overSub').textContent === 'You went into the water. Your ride sank.', `${what}: and why (${$('overSub').textContent})`);
}
{
  const t = drown(-1880, RZ + 2, 6, 'the player dropped over the river from 6 m');
  ok(t > 0.3, `dropped from 6 m, he goes under only once he is down (after ${t.toFixed(2)} s)`);
}
{
  put(-1880, RZ + 30, Math.PI / 2);
  const civ = V.createCar('sedan', -1880, RZ - 2, Math.PI / 2, { maxSpeed: 14, maxReverse: 6, accel: 8, brake: 20, turn: 2, turnFalloff: 40, grip: 7 }, 0x3366cc);
  civ.landX = undefined; S.civs.push(civ); S.cars.push(civ);
  const cop = unit(3, 'police3', -ISLAND_MAX - 5, RZ + 30, 0, 0); cop.landX = undefined; cop.lastPlayerHit = game.time;   // (within 210 m of him: a cop further off is replaced)
  const td = game.takedowns, cash = game.cash;
  run(1 / 60, 1 / 60, 'a sedan in the river and a cop in the sea', null);
  ok(civ.sink && civ.wrecked && civ.dead && cop.sink && cop.wrecked, 'the sedan and the cop go under, wrecked');
  ok(game.takedowns === td + 1 && game.cash === cash + 75 + 3 * 50, `the cop he hit counts as his takedown (+${game.cash - cash})`);
  for (let k = 0; k < Math.ceil((WA.SINK_T + 0.5) * 60); k++) { game.spawnT = 99; game.civT = 99; game.hp = 100; U.update(1 / 60); }
  ok(!S.cars.includes(civ) && !S.civs.includes(civ) && !S.cars.includes(cop) && !S.police.includes(cop), 'and once they are gone they are taken away');
  ok(game.state === 'playing', 'the run goes on');
}
{
  game.state = 'over'; F.startGame();
  ok(!P.sink && !P.dead && P.landX === P.x && P.landZ === P.z, 'the next run starts with his car dry, on the land');
  U.update(1 / 60);
  ok(!P.sink && game.state === 'playing', 'and it drives');
}
console.log(`going under: SUNK over the river, over the sea and dropped in from the air; the traffic and the police go under and are taken away`);
console.log(`WATER CHECKS PASSED (${checks} checks)`);
process.exit(0);
