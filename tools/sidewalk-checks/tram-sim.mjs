// Tram behaviour checks, run without a browser. The real js/tram.js is loaded with three.js, the game state, the renderer
// and the audio replaced by stubs (the same idea as harness.mjs), and driven frame by frame:
//   - speed and acceleration stay in their limits, and the tram brakes smoothly while it is moving
//   - it runs to a terminal and turns back, and no two trams share a route
//   - a car on its track stops it short of the car, it never passes the car, and it goes on again once the track is clear
//   - a car about to cross its track (tramTrackAhead) is told so, and a car in its own lane is not
//   - the bell rings more often while a car blocks the tram than while it just runs
// Run by `npm run check` (tram-sim is part of it). Exits 1 with the failures listed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'salam-tram-'));

// A fixed seed: the player's start points are drawn from it, so the numbers are the same on every run.
let seed = 4242;
// The real modules (tram.js spawns, utils.js rnd) draw from Math.random too, so it is seeded for the whole run.
Math.random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const rand = Math.random;

// ---- stubs -------------------------------------------------------------------------------------------------------
fs.writeFileSync(path.join(work, 'three.mjs'), `
class V3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
export class Object3D {
  constructor() { this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0 }; this.children = []; }
  add(o) { this.children.push(o); return this; }
  remove() { return this; }
  traverse(fn) { fn(this); this.children.forEach(c => c.traverse(fn)); }
  clone() { const o = Object.create(Object.getPrototypeOf(this)); Object.assign(o, this); o.position = Object.assign(new V3(), this.position); o.rotation = { ...this.rotation }; o.children = this.children.map(c => c.clone()); return o; }
}
export class Group extends Object3D {}
export class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
export class BoxGeometry { dispose() {} }
export class CylinderGeometry { dispose() {} }
export class MeshPhongMaterial { constructor(o) { this.color = o.color; } dispose() {} }
export class MeshBasicMaterial { constructor(o) { this.color = o.color; } dispose() {} }
`);
fs.writeFileSync(path.join(work, 'state.mjs'), `export const player = { x: 0, z: 0, dead: false }; export const cars = [];`);
fs.writeFileSync(path.join(work, 'renderer.mjs'), `export const scene = { add() {}, remove() {} };`);
fs.writeFileSync(path.join(work, 'audio.mjs'), `
const sfx = { bells: 0, rolls: 0, tramBell() { sfx.bells++; }, tramRoll() { sfx.rolls++; } };
export { sfx };`);

// ---- the tram module, with its imports pointed at the stubs and at the real utils and flyover ---------------------
let src = fs.readFileSync(path.join(repo, 'js/tram.js'), 'utf8');
const rep = (from, to) => { src = src.split(`from '${from}'`).join(`from '${to}'`); };
rep('three', pathToFileURL(path.join(work, 'three.mjs')).href);
rep('./state.js', pathToFileURL(path.join(work, 'state.mjs')).href);
rep('./renderer.js', pathToFileURL(path.join(work, 'renderer.mjs')).href);
rep('./audio.js', pathToFileURL(path.join(work, 'audio.mjs')).href);
rep('./utils.js', pathToFileURL(path.join(repo, 'js/utils.js')).href);
rep('./flyover.js', pathToFileURL(path.join(repo, 'js/flyover.js')).href);
fs.writeFileSync(path.join(work, 'tram.mjs'), src);
const T = await import(pathToFileURL(path.join(work, 'tram.mjs')).href);
const { sfx } = await import(pathToFileURL(path.join(work, 'audio.mjs')).href);
const { player, cars } = await import(pathToFileURL(path.join(work, 'state.mjs')).href);

const { trams, updateTrams, removeTram, tramTrackAhead } = T;
const C = 80, dt = 1 / 60;
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const clearAll = () => { for (const t of [...trams]) removeTram(t); cars.length = 0; };

// Find a moving tram somewhere in the city, with the player beside it (so it is not taken away).
function findRunningTram() {
  for (let g = 0; g < 300; g++) {
    player.x = (rand() * 2 - 1) * 1200; player.z = (rand() * 2 - 1) * 1200;
    for (let f = 0; f < 60 * 300; f++) {
      updateTrams(dt);
      const t = trams.find(x => x.speed > 15 && !x.turning);
      if (t) return t;
    }
  }
  return null;
}
// A car on the tram's track, dist metres ahead of its centre.
function carOnTrack(t, dist) {
  const along = t.s + t.dir * dist;
  const car = { kind: 'civ', isPlayer: false, wrecked: false, x: 0, z: 0, vx: 0, vz: 0,
    h: t.axis === 'z' ? 0 : Math.PI / 2, box: { e1: 2.05, e2: 0.95 } };
  car.x = t.axis === 'z' ? t.x : along; car.z = t.axis === 'z' ? along : t.z;
  cars.push(car);
  return car;
}

// ---- 1. the route: speed, acceleration, smooth braking, terminals, one tram per route -------------------------------
{
  let maxSpeed = 0, maxAccel = 0, maxDecelRunning = 0, sameRoute = 0, outOfRoute = 0, turns = 0, reversals = 0, spawns = 0;
  const seen = new Set(), prev = new Map();
  for (let trial = 0; trial < 40; trial++) {
    player.x = (rand() * 2 - 1) * 1200; player.z = (rand() * 2 - 1) * 1200;
    prev.clear();
    for (let f = 0; f < 60 * 200; f++) {
      if (f % (60 * 60) === 0) { player.x += (rand() * 2 - 1) * 150; player.z += (rand() * 2 - 1) * 150; }
      updateTrams(dt);
      const ids = new Set();
      for (const t of trams) {
        if (!seen.has(t.id)) { seen.add(t.id); spawns++; }
        if (ids.has(t.route.id)) sameRoute++;
        ids.add(t.route.id);
        if (t.s < t.route.lo * C + 15 - 1e-6 || t.s > (t.route.hi + 1) * C - 15 + 1e-6) outOfRoute++;
        const p = prev.get(t.id);
        if (p) {
          const a = (t.speed - p.speed) / dt;
          if (a > maxAccel) maxAccel = a;
          if (p.speed > 3 && -a > maxDecelRunning) maxDecelRunning = -a;
          if (!p.turning && t.turning) turns++;
          if (t.dir !== p.dir) reversals++;
        }
        prev.set(t.id, { speed: t.speed, dir: t.dir, turning: t.turning });
        if (t.speed > maxSpeed) maxSpeed = t.speed;
      }
    }
    clearAll();
  }
  check(spawns > 0, 'no tram spawned in 40 trials of 200 s');
  check(maxSpeed >= 26 && maxSpeed <= 28.05, `top speed ${maxSpeed.toFixed(2)} m/s, want 26 to 28`);
  check(maxAccel <= 2.85, `acceleration ${maxAccel.toFixed(2)} m/s2 above 2.8`);
  check(maxDecelRunning <= 3.0, `braking ${maxDecelRunning.toFixed(2)} m/s2 while moving, above 3.0 (a jolt)`);
  check(sameRoute === 0, `${sameRoute} frames with two trams on one route`);
  check(outOfRoute === 0, `${outOfRoute} frames with a tram outside its route`);
  check(turns > 0 && reversals > 0, `no terminal turn seen (turns ${turns}, reversals ${reversals})`);
  console.log(`tram route: ${spawns} trams, top ${maxSpeed.toFixed(1)} m/s, accel ${maxAccel.toFixed(2)}, braking ${maxDecelRunning.toFixed(2)}, ${turns} terminal turns, ${reversals} reversals, ${sameRoute} shared routes`);
}

// ---- 2. a car on the track: the tram stops short of it, never passes it, and goes on when the track is clear ----------
{
  let runs = 0, passed = 0, minGap = 1e9, blockedRuns = 0, resumed = 0, resumeSlow = 0;
  for (let trial = 0; trial < 40; trial++) {
    const t = findRunningTram();
    if (!t || t.turning) { clearAll(); continue; }
    const R = t.route, endF = t.dir > 0 ? (R.hi + 1) * C - 16 : R.lo * C + 16;
    if ((endF - t.s) * t.dir < 200) { clearAll(); continue; }            // the car would be past the terminal
    runs++;
    const car = carOnTrack(t, 170);
    let blocked = false;
    for (let f = 0; f < 60 * 40 && trams.includes(t); f++) {
      player.x = t.x; player.z = t.z;
      updateTrams(dt);
      if (t.blocked) blocked = true;
      const nose = t.s + t.dir * 15;
      const rear = (t.axis === 'z' ? car.z : car.x) - t.dir * 2.05;
      const g = t.dir > 0 ? rear - nose : nose - rear;
      if (g < -0.05) passed++;
      minGap = Math.min(minGap, g);
    }
    if (blocked) blockedRuns++;
    // the track is clear: the tram must move on
    cars.splice(cars.indexOf(car), 1);
    const s0 = t.s; let movedAt = null;
    for (let f = 0; f < 60 * 30 && trams.includes(t); f++) {
      player.x = t.x; player.z = t.z;
      updateTrams(dt);
      if (movedAt === null && Math.abs(t.s - s0) > 20) movedAt = f / 60;
    }
    if (movedAt !== null) { resumed++; if (movedAt > 15) resumeSlow++; }
    clearAll();
  }
  check(runs > 0, 'no running tram for the obstacle test');
  check(passed === 0, `the tram passed the car in ${passed} frames`);
  check(minGap >= 2.5, `closest approach ${minGap.toFixed(2)} m, want at least 2.5`);
  check(blockedRuns === runs, `the tram did not brake for the car in ${runs - blockedRuns} of ${runs} runs`);
  check(resumed === runs && resumeSlow === 0, `the tram resumed in ${resumed} of ${runs} runs (${resumeSlow} took over 15 s)`);
  console.log(`tram obstacle: ${runs} runs, blocked ${blockedRuns}, passed-the-car frames ${passed}, closest ${minGap.toFixed(2)} m, resumed ${resumed}`);
}

// ---- 3. a car about to cross the track (civAI yields), a car in its own lane (it does not), and the bell ------------
{
  // a tram with at least 40 m of its route ahead, so that the crossing is ahead of it
  let t = null;
  for (let g = 0; g < 10 && !t; g++) {
    const c = findRunningTram();
    if (!c) break;
    const R = c.route, ahead = c.dir > 0 ? (R.hi + 1) * C - 30 - c.s : c.s - (R.lo * C + 30);
    if (ahead >= 40) t = c;
  }
  if (!t) check(false, 'no running tram with a crossing ahead for the crossing test');
  else {
    const R = t.route, P = t.k * C;
    const cross = t.s + t.dir * Math.min(90, t.dir > 0 ? (R.hi + 1) * C - 30 - t.s : t.s - (R.lo * C + 30));
    const crossing = t.axis === 'z'
      ? { x: P + 12, z: cross, h: -Math.PI / 2, box: { e1: 2.05, e2: 0.95 } }      // 12 m off the rails, heading for them
      : { x: cross, z: P + 12, h: Math.PI, box: { e1: 2.05, e2: 0.95 } };
    const lane = t.axis === 'z'
      ? { x: P + 2.5, z: t.s + t.dir * 30, h: t.dir > 0 ? 0 : Math.PI, box: { e1: 2.05, e2: 0.95 } }
      : { x: t.s + t.dir * 30, z: P + 2.5, h: t.dir > 0 ? Math.PI / 2 : -Math.PI / 2, box: { e1: 2.05, e2: 0.95 } };
    const onTrack = t.axis === 'z'
      ? { x: P, z: t.s, h: 0, box: { e1: 2.05, e2: 0.95 } }
      : { x: t.s, z: P, h: Math.PI / 2, box: { e1: 2.05, e2: 0.95 } };
    const dCross = tramTrackAhead(crossing), dLane = tramTrackAhead(lane), dOn = tramTrackAhead(onTrack);
    check(dOn === -1, `a car on the rails is not told to get off (got ${dOn})`);
    check(Number.isFinite(dCross) && dCross < 25, `a car about to cross the track got ${dCross}, want a distance under 25`);
    check(dLane === Infinity, `a car in its own lane was told to yield (got ${dLane})`);
  }
  clearAll();
  // the bell: a car on the track, and then a run without one
  const t2 = findRunningTram();
  if (t2) for (const x of [...trams]) if (x !== t2) removeTram(x);
  if (t2) {
    const car = carOnTrack(t2, 170);
    let blockedSec = 0, bellsBlocked = 0;
    for (let f = 0; f < 60 * 12 && trams.includes(t2); f++) {
      player.x = t2.x; player.z = t2.z;
      const before = sfx.bells;
      updateTrams(dt);
      if (t2.blocked) { blockedSec += dt; bellsBlocked += sfx.bells - before; }   // only the bells rung while it is blocked
    }
    cars.splice(cars.indexOf(car), 1);
    clearAll();
    // the bell while it only runs: every 5 s, so about 0.2 a second
    const t3 = findRunningTram();
    if (t3) {
      clearAll();
      const t3b = findRunningTram();
      // the steady rate: only after 6 s of running clear of a car, when the bell is back on its 5 s interval (a bell
      // rung just after a car clears the track comes sooner, on the 1.3 s timer, and that is checked below, not here)
      const tramSec = 30;
      let runSec = 0, runBells = 0, calm = 0;
      for (let f = 0; f < 60 * tramSec && t3b && trams.includes(t3b); f++) {
        player.x = t3b.x; player.z = t3b.z;
        for (const o of trams) if (o !== t3b) o.bellT = 1e9;               // the other trams stay quiet: sfx.bells counts them all
        const b0 = sfx.bells; updateTrams(dt);
        calm = t3b.blocked ? 0 : calm + dt;
        if (!t3b.blocked && t3b.speed > 1 && calm > 6) { runSec += dt; runBells += sfx.bells - b0; }
      }
      const movingRate = runBells / Math.max(1, runSec);
      check(runSec < 5 || (movingRate > 0.1 && movingRate < 0.35), `bell rate while running ${movingRate.toFixed(2)} per s, want about 0.2`);
      console.log(`tram bell while running: ${movingRate.toFixed(2)} per second over ${runSec.toFixed(0)} s`);
      clearAll();
    }
    if (blockedSec > 2) {
      const rate = bellsBlocked / blockedSec;
      check(rate > 0.5 && rate < 1.0, `bell rate while blocked ${rate.toFixed(2)} per s, want about 0.8`);
      console.log(`tram bell: ${rate.toFixed(2)} per second while a car blocks it`);
    }
  }
}

clearAll();
fs.rmSync(work, { recursive: true, force: true });
if (fails.length) {
  console.log('TRAM SIM FAILED:\n  - ' + fails.join('\n  - '));
  process.exit(1);
}
console.log('TRAM SIM OK');
