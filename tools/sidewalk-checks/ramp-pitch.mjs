/* Long vehicles on a flyover's ramps (js/vehicle.js: driveCar's ground follow and syncCarMesh's lean; js/flyover.js:
   surfaceAt). Every kind in CAR_DIMS is driven over real interchanges - on the avenue and on the cross street, a
   one-junction bridge and a two-junction one, both ways, slowly and quickly - with the real driveCar and
   syncCarMesh, and the body as it is drawn is held against the road under it:
   * nothing sinks into the concrete: along the whole length of the body the wheel line stays within MAX_SINK of the
     ramp, the deck or the street under it, going up (where the nose would go in) and coming down (the tail);
   * the body leans with the road: halfway up a ramp it is nose up at the ramp's own grade, halfway down nose down.
   This is the check for "a truck going up the bridge gets its nose stuck in it, and coming down its back": the probes
   at the nose and the tail were judged at the height of the truck's centre, and on a 1 in 6.3 ramp a probe more than
   FLY.on / RAMP_SLOPE = 5 m uphill of the centre is more than FLY.on above it - so for the tanker and the semis the
   uphill probe read the street under the ramp, and the lean came out backwards.
   Run:  node tools/sidewalk-checks/ramp-pitch.mjs      (exits non-zero on a failure) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as F from '../../js/flyover.js';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.join(here, '../..');
// Metres of the body's wheel line allowed below the road. The lean is smoothed on purpose (syncCarMesh), so at 18 m/s a
// nose meets a ramp's foot about 0.15 m (a car) to 0.2 m (a 9 m truck) before the body has tipped up to it.
const MAX_SINK = 0.25;
const MAX_LEAN_ERR = 0.03;     // radians off the ramp's own grade, halfway up or down it
const { FLY, RAMP_RUN, RAMP_SLOPE } = F;

// CAR_DIMS straight from js/carModels.js: it is plain data (the module itself needs three.js and a DOM)
const modelsSrc = fs.readFileSync(path.join(repo, 'js/carModels.js'), 'utf8');
const dimsText = modelsSrc.slice(modelsSrc.indexOf('export const CAR_DIMS = {') + 'export const CAR_DIMS = '.length);
const DIMS = Function('return ' + dimsText.slice(0, dimsText.indexOf('\n};') + 3).replace(/\/\/.*$/gm, ''))();

// driveCar and syncCarMesh straight from js/vehicle.js, on the real surfaceAt (the rest of vehicle.js needs three.js)
const vehicleSrc = fs.readFileSync(path.join(repo, 'js/vehicle.js'), 'utf8');
const cut = (a, b) => vehicleSrc.slice(vehicleSrc.indexOf(a), b ? vehicleSrc.indexOf(b) : undefined).replace(/^export /gm, '');
const url = f => JSON.stringify(pathToFileURL(path.join(repo, f)).href);
const file = path.join(os.tmpdir(), 'salam-ramp-pitch.test.mjs');
fs.writeFileSync(file, `import { clamp, lerp } from ${url('js/utils.js')};
import { surfaceAt } from ${url('js/flyover.js')};
const weatherSystem = { slickness: 0 };
${cut('export function driveCar', 'export function syncCarMesh')}
${cut('export function syncCarMesh')}
export { driveCar, syncCarMesh };
`);
const V = await import(pathToFileURL(file).href);

const DT = 1 / 60;
const makeCar = (kind, x, z, h) => ({
  kind, x, z, h, y: 0, vx: 0, vz: 0, vy: 0, steer: 0, yaw: 0, vf: 0, vl: 0, speed: 0, acc: 0, roll: 0, pitch: 0, gpitch: 0,
  air: false, boost: 0, flatT: 0, flatSide: 0,
  params: { maxSpeed: 40, accel: 12, brake: 24, maxReverse: 9, turn: 1.6, turnFalloff: 40, grip: 7 },
  box: { x, z, ux: Math.sin(h), uz: Math.cos(h), vx: -Math.cos(h), vz: Math.sin(h), e1: DIMS[kind].e1, e2: DIMS[kind].e2 },
  inner: { rotation: { x: 0, z: 0 } },
  mesh: { position: { set(px, py, pz) { this.x = px; this.y = py; this.z = pz; } }, rotation: { y: h }, userData: {} },
});
// The road under a point of the lane: the structure where it has one (a hint high enough to be on it), else the street.
const road = (x, z) => F.surfaceAt(x, z, 1e9);

// One drive over flyover f: from 30 m short of one ramp's foot to 30 m past the other's, `dir` +1 along the road's
// own axis or -1 against it, at a held speed v, `lat` metres off the road's centre line.
function drive(f, kind, dir, v, lat) {
  const along = f.axis === 'z';
  const a0 = f.lo - FLY.deckHalf - RAMP_RUN, a1 = f.lo - FLY.deckHalf;       // the ramp below the deck's low end
  const b0 = f.hi + FLY.deckHalf, b1 = f.hi + FLY.deckHalf + RAMP_RUN;       // and the one past its high end
  const start = dir > 0 ? a0 - 30 : b1 + 30, end = dir > 0 ? b1 + 30 : a0 - 30;
  const h = along ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  const c = makeCar(kind, along ? lat : f.node + start, along ? f.node + start : lat, h);
  const e1 = c.box.e1, settle = 3 + v * 0.5;
  const out = { sink: 0, sinkAt: null, lean: 0, leanAt: null, leanSamples: 0 };
  for (let t = 0; t < 60 * 120; t++) {
    c.vx = v * Math.sin(c.h); c.vz = v * Math.cos(c.h);              // hold the speed: this is about height, not the engine
    V.driveCar(c, { throttle: 0 }, DT);
    V.syncCarMesh(c, DT);
    const u = F.alongOf(f, c.x, c.z);
    if ((end - u) * dir < 0) break;
    // the body as drawn: the mesh at (x, y, z) turned by h, its inner group pitched by rotation.x about its origin
    const th = c.inner.rotation.x, sh = Math.sin(c.h), ch = Math.cos(c.h);
    for (let zl = -e1; zl <= e1 + 1e-9; zl += 0.5) {
      const px = c.x + sh * zl * Math.cos(th), pz = c.z + ch * zl * Math.cos(th), py = c.y - zl * Math.sin(th);
      const sink = road(px, pz) - py;
      if (sink > out.sink) {
        const climbing = (u > a0 && u < a1) ? dir > 0 : (u > b0 && u < b1) ? dir < 0 : null;
        out.sink = sink;
        out.sinkAt = `${zl > 0 ? 'nose' : 'tail'} ${Math.abs(zl).toFixed(1)} m out, centre at u=${u.toFixed(1)}` +
          (climbing === null ? '' : climbing ? ' (going up)' : ' (coming down)');
      }
    }
    // the lean, halfway along a ramp: the whole body on the slope and the smoothing long settled
    for (const [r0, r1, rising] of [[a0, a1, true], [b0, b1, false]]) {
      if (u < r0 + e1 + settle || u > r1 - e1 - settle) continue;
      const climbing = rising === dir > 0;
      const want = (climbing ? -1 : 1) * Math.atan(RAMP_SLOPE);       // rotation.x < 0 lifts the nose (three.js)
      const err = Math.abs(th - want);
      out.leanSamples++;
      if (err > out.lean) { out.lean = err; out.leanAt = `${climbing ? 'going up' : 'coming down'}: leans ${(-th * 180 / Math.PI).toFixed(1)} deg nose-up, the ramp is ${(-want * 180 / Math.PI).toFixed(1)}`; }
    }
  }
  return out;
}

// The interchanges: one-junction and two-junction bridges, on both main roads and on both sides of the centre.
const pick = (axis, sign, ext) => {
  for (let b = 1; b <= 30; b++) {
    const f = axis === 'z' ? F.nodeAt(0, sign * b) : F.nodeAt(sign * b, 0);
    if (f && f.ext === ext) return f;
  }
  return null;
};
const flyovers = [pick('z', 1, 0), pick('z', 1, 1), pick('x', -1, 0), pick('x', -1, 1)].filter(Boolean);
let failures = 0;
const bad = m => { failures++; console.log('  X ' + m); };
if (flyovers.length < 4) bad(`only ${flyovers.length} of the 4 test interchanges exist`);
console.log(`ramps: ${RAMP_RUN} m at 1 in ${(1 / RAMP_SLOPE).toFixed(2)}; a probe ${(FLY.on / RAMP_SLOPE).toFixed(1)} m uphill of a car is FLY.on (${FLY.on} m) above it`);
console.log(`interchanges: ${flyovers.map(f => `${f.axis}@${f.node} (${f.ext + 1} junction${f.ext ? 's' : ''})`).join(', ')}`);

const kinds = Object.keys(DIMS).sort((a, b) => DIMS[b].e1 - DIMS[a].e1);
for (const kind of kinds) {
  let worst = { sink: 0, sinkAt: null }, lean = { lean: 0, leanAt: null }, samples = 0;
  for (const f of flyovers) for (const dir of [1, -1]) for (const v of [8, 18]) {
    const r = drive(f, kind, dir, v, dir > 0 ? 2.5 : -2.5);
    if (r.sink > worst.sink) worst = { sink: r.sink, sinkAt: `${f.axis}@${f.node}, ${v} m/s: ${r.sinkAt}` };
    if (r.lean > lean.lean) lean = { lean: r.lean, leanAt: `${f.axis}@${f.node}, ${v} m/s, ${r.leanAt}` };
    samples += r.leanSamples;
  }
  const line = `${kind.padEnd(14)} ${(2 * DIMS[kind].e1).toFixed(1).padStart(4)} m long: deepest ${worst.sink.toFixed(2)} m into the road` +
    `, lean within ${(lean.lean * 180 / Math.PI).toFixed(1)} deg of the ramp`;
  if (!samples) bad(`${kind}: never measured halfway along a ramp`);
  if (worst.sink > MAX_SINK) bad(`${line}\n      deepest at ${worst.sinkAt}`);
  else if (lean.lean > MAX_LEAN_ERR) bad(`${line}\n      ${lean.leanAt}`);
  else console.log('  . ' + line + (process.env.RAMP_VERBOSE ? `\n      deepest at ${worst.sinkAt}` : ''));
}
// ... and the street stays the street. Judging the nose and the tail with their reach must never lift a car at grade
// onto the structure above it: every kind drives the crossing street under each deck (through the junction box, where
// the deck is 7.2 m overhead), and the at-grade lane beside each structure from one end of it to the other.
function atGrade(kind, x0, z0, h, dist, v = 12) {
  const c = makeCar(kind, x0, z0, h);
  let top = 0, lean = 0;
  for (let t = 0; t * DT * v < dist; t++) {
    c.vx = v * Math.sin(c.h); c.vz = v * Math.cos(c.h);
    V.driveCar(c, { throttle: 0 }, DT);
    V.syncCarMesh(c, DT);
    top = Math.max(top, c.y); lean = Math.max(lean, Math.abs(c.surfPitch));
  }
  return { top, lean };
}
let streetRuns = 0;
for (const kind of kinds) {
  for (const f of flyovers) {
    const along = f.axis === 'z', worldOf = (u, lat) => along ? [lat, f.node + u] : [f.node + u, lat];
    const runs = [];
    for (let j = f.lo; j <= f.hi; j += FLY.span) for (const side of [-1, 1]) {   // under the deck, each crossing street
      const [x, z] = worldOf(j + side * 2.5, -side * 40);                       // 40 m out, in its own lane
      runs.push([`under the deck at ${f.axis}@${f.node} (junction u=${j})`, x, z, along ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI), 80]);
    }
    for (const side of [-1, 1]) {                                               // the at-grade lane beside the structure
      const lat = side * (FLY.halfW + FLY.atGrade / 2), u0 = f.lo - FLY.deckHalf - RAMP_RUN - 20;
      const [x, z] = worldOf(u0, lat);
      runs.push([`in the at-grade lane beside ${f.axis}@${f.node}`, x, z, along ? 0 : Math.PI / 2, f.hi - f.lo + 2 * (FLY.deckHalf + RAMP_RUN + 20)]);
    }
    for (const [where, x, z, h, dist] of runs) {
      const r = atGrade(kind, x, z, h, dist);
      streetRuns++;
      if (r.top > 0.01 || r.lean > 0.01) bad(`${kind} ${where}: lifted to ${r.top.toFixed(2)} m, leaning ${r.lean.toFixed(3)} rad - the street became the structure`);
    }
  }
}
console.log(`  . ${streetRuns} drives at grade (under every deck, and beside every structure): nothing is lifted onto the concrete`);
console.log(failures ? `${failures} CHECK(S) FAILED` : 'RAMP PITCH CHECKS PASSED');
process.exit(failures ? 1 : 0);
