/* Trams: a rail line down the middle of some streets, and an articulated tram that runs along it now and then.
 *
 * THE LINES
 *   A tram line is a whole column (x = k*CHUNK) or row (z = k*CHUNK) of the street grid, chosen by hash. The main roads
 *   (k = 0, which carry the flyovers) never carry rails. A street segment carries rails only where it is a street:
 *   not a closed or filled one, not inside a neighbourhood, not at a plaza, and not under a flyover. Rails are laid by
 *   the chunk that owns the segment (tramRails, called from generateChunk), so they stream with the city.
 *   The rails run down the centre line: the civilian lanes are at 2.5 m and 5 m, so the tram does not sit in a lane.
 *
 * THE TRAM
 *   Kinematic, on its line: it moves along the rails at up to 11 m/s, stops for a few seconds at a stop (a third of the
 *   blocks are stops, halfway along the block), and yields at a junction while a moving car is in the box.
 *   Its box is a solid for every car (collisions.js: tramHit): cars are pushed out and hurt, the tram is not moved.
 *   It spawns ahead of the player on a line near him and runs toward him, and is removed once it is far away or the line
 *   ends. At most MAX_TRAMS run at once. */
import * as THREE from 'three';
import { CHUNK, rnd, hash2 } from './utils.js';
import { player, cars } from './state.js';
import { scene } from './renderer.js';
import { segClosed, segFilled, nbhdJunction, plazaAt, flyoverNear } from './flyover.js';

export const trams = [];
const MAX_TRAMS = 2, SPAWN_EVERY = 20, SPAWN_CHANCE = 0.5;
const CRUISE = 11, ACCEL = 1.1, BRAKE = 2.6, STOP_DECEL = 1.6, STOP_WAIT = 6, STOP_BLOCK_SHARE = 3;
const HALF_LEN = 15, HALF_W = 1.35, GAUGE = 0.72, REMOVE_R = 260;   // spawns sit within ~230 m, so none is removed on its first frame
let spawnT = 6, nextId = 1;

// Which lines carry rails: a column or row index k. The main roads (0) never do.
export function isTramLine(axis, k) {
  return k !== 0 && hash2(k, axis === 'z' ? 77 : 91) % 6 === 0;
}
// Whether the street segment from junction (jx, jz) to its next one along the axis carries rails.
export function tramSegment(axis, jx, jz) {
  if (!isTramLine(axis, axis === 'z' ? jx : jz)) return false;
  if (segClosed(axis, jx, jz) || segFilled(axis, jx, jz)) return false;
  const ex = axis === 'x' ? jx + 1 : jx, ez = axis === 'x' ? jz : jz + 1;
  if (nbhdJunction(jx, jz) || nbhdJunction(ex, ez) || plazaAt(jx, jz) || plazaAt(ex, ez)) return false;
  if (flyoverNear(jx * CHUNK, jz * CHUNK, 25) || flyoverNear(ex * CHUNK, ez * CHUNK, 25)) return false;
  return true;
}
// A stop is halfway along a block, and only some blocks have one.
const isStopBlock = (axis, k, j) => hash2(k * 3 + (axis === 'z' ? 1 : 0), j) % STOP_BLOCK_SHARE === 0;

// The rails of the two street segments this chunk owns: the column at its west edge (x0) and the row at its south edge (z0).
// `add`, `box` and `mat` are the chunk builder's own (generateChunk), so the rails are baked into the chunk.
export function tramRails({ add, box, mat, x0, z0, cx, cz }) {
  const rail = mat(0xa9afb5), sleeper = mat(0x5e4b38);
  if (tramSegment('z', cx, cz)) {
    add(box(0.12, 0.14, CHUNK, rail, x0 - GAUGE, 0.09, z0 + CHUNK / 2, false));
    add(box(0.12, 0.14, CHUNK, rail, x0 + GAUGE, 0.09, z0 + CHUNK / 2, false));
    for (let t = 1.1; t < CHUNK; t += 2.2) add(box(2.6, 0.12, 0.26, sleeper, x0, 0.06, z0 + t, false));
  }
  if (tramSegment('x', cx, cz)) {
    add(box(CHUNK, 0.14, 0.12, rail, x0 + CHUNK / 2, 0.09, z0 - GAUGE, false));
    add(box(CHUNK, 0.14, 0.12, rail, x0 + CHUNK / 2, 0.09, z0 + GAUGE, false));
    for (let t = 1.1; t < CHUNK; t += 2.2) add(box(0.26, 0.12, 2.6, sleeper, x0 + t, 0.06, z0, false));
  }
}

// ---------- the tram's body ----------
function buildMesh() {
  const g = new THREE.Group();
  const M = c => new THREE.MeshPhongMaterial({ color: c, shininess: 40 });
  const yellow = M(0xf2b233), grey = M(0x9ea4aa), white = M(0xf1f1ee), dark = M(0x1d2630), black = M(0x222222);
  const amber = new THREE.MeshBasicMaterial({ color: 0xffc247 }), lamp = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
  const B = (w, h, d, m, x, y, z) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); g.add(mesh); };
  for (const z of [-10, 0, 10]) {                        // three sections of 10 m, the front at +z
    B(2.5, 1.9, 9.4, yellow, 0, 1.2, z);                 // body
    B(2.56, 0.8, 9.4, grey, 0, 0.55, z);                 // grey skirt
    B(2.3, 0.45, 9.2, white, 0, 2.5, z);                 // white roof
    B(2.52, 0.9, 7.8, dark, 0, 1.6, z);                  // window band
  }
  B(2.4, 2.1, 1.4, white, 0, 1.25, 15.3);              // cab nose
  B(2.1, 1.1, 0.06, dark, 0, 1.6, 16.05);              // windscreen
  B(1.4, 0.25, 0.05, amber, 0, 2.35, 16.0);            // destination sign
  B(0.3, 0.2, 0.05, lamp, -0.8, 0.9, 16.02);
  B(0.3, 0.2, 0.05, lamp, 0.8, 0.9, 16.02);
  B(0.08, 0.9, 0.08, black, 0, 3.1, 0);                // pantograph mast
  return g;
}

// ---------- the line the tram is on ----------
function place(t) {
  if (t.axis === 'z') { t.x = t.k * CHUNK; t.z = t.s; t.h = t.dir > 0 ? 0 : Math.PI; }
  else { t.x = t.s; t.z = t.k * CHUNK; t.h = t.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  t.box.x = t.x; t.box.z = t.z; t.box.ux = Math.sin(t.h); t.box.uz = Math.cos(t.h);
  t.box.vx = Math.cos(t.h); t.box.vz = -Math.sin(t.h);
  t.group.position.set(t.x, 0, t.z); t.group.rotation.y = t.h;
}
function makeTram(axis, k, dir, s) {
  const t = { id: nextId++, axis, k, dir, s, speed: CRUISE, wait: 0, lastStop: null, dead: false, group: buildMesh(), box: { x: 0, z: 0, ux: 0, uz: 0, vx: 0, vz: 0, e1: HALF_LEN, e2: HALF_W } };
  place(t); scene.add(t.group);
  return t;
}
export function removeTram(t) {
  t.dead = true; scene.remove(t.group);
  t.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  const i = trams.indexOf(t); if (i >= 0) trams.splice(i, 1);
}
export function clearTrams() { for (const t of [...trams]) removeTram(t); }

// The next stop ahead of the tram: its block index and the position of the stop, or null.
function nextStop(t) {
  const j0 = Math.floor(t.s / CHUNK);
  for (let q = 0; q < 3; q++) {
    const j = j0 + (t.dir > 0 ? q : -q), mid = (j + 0.5) * CHUNK;
    if ((mid - t.s) * t.dir < -0.5) continue;               // passed
    if (j === t.lastStop) continue;                          // already waited here
    if (isStopBlock(t.axis, t.k, j)) return { j, mid };
  }
  return null;
}
// A moving car in the box of the junction at (jx, jz): the tram waits for it to clear.
function junctionBusy(jx, jz) {
  for (const c of cars) {
    if (c.wrecked || Math.hypot(c.vx, c.vz) < 0.5) continue;
    if (Math.abs(c.x - jx) < 6 && Math.abs(c.z - jz) < 6) return true;
  }
  return false;
}

function driveTram(t, dt) {
  let target = CRUISE;
  // the junction ahead: slow down on the approach, and wait while it is occupied
  const jN = t.dir > 0 ? Math.floor(t.s / CHUNK) + 1 : Math.ceil(t.s / CHUNK) - 1;
  const dJ = (jN * CHUNK - t.s) * t.dir;
  if (dJ < 40) {
    target = Math.min(target, 8);
    const jx = t.axis === 'z' ? t.k * CHUNK : jN * CHUNK, jz = t.axis === 'z' ? jN * CHUNK : t.k * CHUNK;
    if (dJ < 30 && junctionBusy(jx, jz)) target = 0;
  }
  // the line ends at the junction ahead (the next block is not rails): brake to a halt at the end of the rails, then go
  const jA = t.dir > 0 ? jN : jN - 1;
  if (dJ < 40 && !tramSegment(t.axis, t.axis === 'z' ? t.k : jA, t.axis === 'z' ? jA : t.k)) {
    target = Math.min(target, Math.sqrt(2 * STOP_DECEL * Math.max(0, dJ - 1)));
    if (dJ < 1.5 && t.speed < 0.5) { removeTram(t); return; }
  }
  // a stop
  if (t.wait > 0) { t.wait -= dt; target = 0; if (t.wait <= 0) t.wait = 0; }
  else {
    const st = nextStop(t);
    if (st) {
      const dS = (st.mid - t.s) * t.dir;                    // distance still to run to the stop
      if (dS < 60) target = Math.min(target, Math.sqrt(2 * STOP_DECEL * Math.max(0, dS)));   // brake so as to arrive at rest
      if (dS <= Math.max(0.03, t.speed * dt)) { t.wait = STOP_WAIT; t.lastStop = st.j; t.speed = 0; target = 0; }
    }
  }
  t.speed += Math.max(-BRAKE * dt, Math.min(ACCEL * dt, target - t.speed));
  t.speed = Math.max(0, t.speed);
  t.s += t.dir * t.speed * dt;
}

// A tram on a tram line near the player, ahead of the way it runs, so it comes toward him. Lines are sparse (about one
// street in six), so a few candidates are tried before giving up.
function spawnTram() {
  for (let tries = 0; tries < 12; tries++) {
    const axis = Math.random() < 0.5 ? 'z' : 'x';
    const near = axis === 'z' ? player.x : player.z, along = axis === 'z' ? player.z : player.x;
    const k = Math.round(near / CHUNK) + Math.floor(rnd(-2, 3));   // within two blocks of him, so it can be seen
    if (!isTramLine(axis, k)) continue;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const s = along - dir * rnd(110, 160);
    const j = Math.floor(s / CHUNK);
    if (!tramSegment(axis, axis === 'z' ? k : j, axis === 'z' ? j : k)) continue;
    const t = makeTram(axis, k, dir, (j + 0.5) * CHUNK);
    trams.push(t);
    return true;
  }
  return false;
}

// Once a frame, before the cars are tested against the trams.
export function updateTrams(dt) {
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = SPAWN_EVERY;
    if (trams.length < MAX_TRAMS && Math.random() < SPAWN_CHANCE) spawnTram();
  }
  for (const t of [...trams]) {
    driveTram(t, dt);
    if (t.dead) continue;
    place(t);
    if (Math.hypot(t.x - player.x, t.z - player.z) > REMOVE_R) removeTram(t);
  }
}
