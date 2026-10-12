/* Trams: a rail route down the middle of some streets, and a tram that runs it end to end.
 *
 * THE ROUTES
 *   A tram line is a whole column (x = k*CHUNK) or row (z = k*CHUNK) of the street grid, chosen by hash. The main roads
 *   (k = 0, which carry the flyovers) never carry rails. A street segment is tram-eligible only where it is a street: not
 *   a closed or filled one, not inside a neighbourhood, not at a plaza, and not under a flyover.
 *   A ROUTE is a maximal run of eligible segments on one line. It has two terminals, at its ends. A run longer than
 *   ROUTE_MAX blocks is not a route and carries no rails. The rails, the overhead wire and the masts are laid by the chunk
 *   that owns each segment (tramRails, called from generateChunk). Every chunk finds the same run from any of its segments,
 *   so the ends agree.
 *   The rails run down the centre line: the civilian lanes are at 2.5 m and 5 m, so the tram does not sit in a lane.
 *
 * THE TRAM
 *   Kinematic, on its route. It runs to one terminal, waits there, runs back to the other, and so on. It stops for a few
 *   seconds at a station (a third of the blocks have one). It stops for any car that is on the track ahead, and rings its bell
 *   while that car is there. It is solid for every car (collisions.js: collideTrams): a car that is hit takes damage, and the
 *   tram is not moved. At most one tram runs on a route, and at most MAX_TRAMS run at once. A tram spawns near the player
 *   and is taken away when it is far from him. */
import * as THREE from 'three';
import { CHUNK, rnd, hash2, clamp } from './utils.js';
import { player, cars } from './state.js';
import { scene } from './renderer.js';
import { sfx } from './audio.js';
import { segClosed, segFilled, nbhdJunction, plazaAt, flyoverNear } from './flyover.js';

export const trams = [];
const MAX_TRAMS = 3, SPAWN_EVERY = 15, SPAWN_CHANCE = 0.6;
const CRUISE = 22, ACCEL = 2.4, BRAKE = 4, STOP_DECEL = 2.2;      // 22 m/s is about 80 km/h
const STOP_WAIT = 6, TERMINUS_WAIT = 25, STOP_BLOCK_SHARE = 3;
const HALF_LEN = 15, HALF_W = 1.35, GAUGE = 0.72, REMOVE_R = 260;
const CLEAR = 130;                                                 // how far ahead the tram looks for a car on its track
const ROUTE_MAX = 12;                                              // the longest run of blocks that is a route
const WIRE_H = 5.8, MAST_X = 9;                                    // overhead wire height, and the masts' distance from the centre line
let spawnT = 6, nextId = 1;

// Which lines carry rails: a column or row index k. The main roads (0) never do.
export function isTramLine(axis, k) {
  return k !== 0 && hash2(k, axis === 'z' ? 77 : 91) % 6 === 0;
}
// Whether the street segment from junction (jx, jz) to its next one along the axis may carry rails.
export function tramSegment(axis, jx, jz) {
  if (!isTramLine(axis, axis === 'z' ? jx : jz)) return false;
  if (segClosed(axis, jx, jz) || segFilled(axis, jx, jz)) return false;
  const ex = axis === 'x' ? jx + 1 : jx, ez = axis === 'x' ? jz : jz + 1;
  if (nbhdJunction(jx, jz) || nbhdJunction(ex, ez) || plazaAt(jx, jz) || plazaAt(ex, ez)) return false;
  if (flyoverNear(jx * CHUNK, jz * CHUNK, 25) || flyoverNear(ex * CHUNK, ez * CHUNK, 25)) return false;
  return true;
}
// A station is halfway along a block, and only some blocks have one.
const isStopBlock = (axis, k, j) => hash2(k * 3 + (axis === 'z' ? 1 : 0), j) % STOP_BLOCK_SHARE === 0;

// ---------- routes ----------
const routeCache = new Map();
// The route that segment j of line k (on the given axis) belongs to, or null. A route is the maximal run of eligible
// segments around it, and it is null when that run is longer than ROUTE_MAX. The scan is the same from any segment of
// the run, so every chunk that lays the rails of a route agrees on its two terminals.
export function routeOf(axis, k, j) {
  const key = axis + k + ':' + j;
  if (routeCache.has(key)) return routeCache.get(key);
  const on = q => tramSegment(axis, axis === 'z' ? k : q, axis === 'z' ? q : k);
  let r = null;
  if (on(j)) {
    let lo = j, hi = j;
    while (hi - lo <= ROUTE_MAX && on(hi + 1)) hi++;
    while (hi - lo <= ROUTE_MAX && on(lo - 1)) lo--;
    if (hi - lo < ROUTE_MAX) r = { axis, k, lo, hi, id: axis + k + ':' + lo };
  }
  routeCache.set(key, r);
  return r;
}
// Whether the street segment from junction (jx, jz) carries rails: it is on a route.
export function tramLaid(axis, jx, jz) {
  const k = axis === 'z' ? jx : jz, j = axis === 'z' ? jz : jx;
  return routeOf(axis, k, j) !== null;
}

// The rails, the overhead wire and the masts of the two street segments this chunk owns: the column at its west edge
// (x0) and the row at its south edge (z0). `add`, `box` and `mat` are the chunk builder's own, so everything is baked into the chunk.
export function tramRails({ add, box, mat, x0, z0, cx, cz }) {
  const rail = mat(0xa9afb5), sleeper = mat(0x5e4b38), mast = mat(0x8a8f96), wire = mat(0x2b2b2b);
  const mid = CHUNK / 2, MH = WIRE_H + 0.3;
  if (tramLaid('z', cx, cz)) {
    add(box(0.12, 0.14, CHUNK, rail, x0 - GAUGE, 0.09, z0 + mid, false));
    add(box(0.12, 0.14, CHUNK, rail, x0 + GAUGE, 0.09, z0 + mid, false));
    for (let t = 1.1; t < CHUNK; t += 2.2) add(box(2.6, 0.12, 0.26, sleeper, x0, 0.06, z0 + t, false));
    add(box(0.06, 0.06, CHUNK, wire, x0, WIRE_H, z0 + mid, false));                       // contact wire along the track
    add(box(2 * MAST_X, 0.05, 0.05, wire, x0, WIRE_H, z0 + mid, false));                  // span wire across it
    add(box(0.3, MH, 0.3, mast, x0 - MAST_X, MH / 2, z0 + mid, false));
    add(box(0.3, MH, 0.3, mast, x0 + MAST_X, MH / 2, z0 + mid, false));
  }
  if (tramLaid('x', cx, cz)) {
    add(box(CHUNK, 0.14, 0.12, rail, x0 + mid, 0.09, z0 - GAUGE, false));
    add(box(CHUNK, 0.14, 0.12, rail, x0 + mid, 0.09, z0 + GAUGE, false));
    for (let t = 1.1; t < CHUNK; t += 2.2) add(box(0.26, 0.12, 2.6, sleeper, x0 + t, 0.06, z0, false));
    add(box(CHUNK, 0.06, 0.06, wire, x0 + mid, WIRE_H, z0, false));
    add(box(0.05, 0.05, 2 * MAST_X, wire, x0 + mid, WIRE_H, z0, false));
    add(box(0.3, MH, 0.3, mast, x0 + mid, MH / 2, z0 - MAST_X, false));
    add(box(0.3, MH, 0.3, mast, x0 + mid, MH / 2, z0 + MAST_X, false));
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
  B(0.08, 3.1, 0.08, black, 0, 4.25, 0);               // pantograph mast, up to the wire
  B(1.6, 0.05, 0.3, black, 0, WIRE_H + 0.02, 0);       // pantograph head on the wire
  return g;
}

// ---------- the tram on its route ----------
function place(t) {
  if (t.axis === 'z') { t.x = t.k * CHUNK; t.z = t.s; t.h = t.dir > 0 ? 0 : Math.PI; }
  else { t.x = t.s; t.z = t.k * CHUNK; t.h = t.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  t.box.x = t.x; t.box.z = t.z; t.box.ux = Math.sin(t.h); t.box.uz = Math.cos(t.h);
  t.box.vx = Math.cos(t.h); t.box.vz = -Math.sin(t.h);
  t.group.position.set(t.x, 0, t.z); t.group.rotation.y = t.h;
}
function makeTram(route, dir, s) {
  const t = {
    id: nextId++, route, axis: route.axis, k: route.k, dir, s, speed: CRUISE, wait: 0, turning: false, blocked: false,
    lastStop: null, dead: false, rollT: 0, bellT: 0, group: buildMesh(),
    box: { x: 0, z: 0, ux: 0, uz: 0, vx: 0, vz: 0, e1: HALF_LEN, e2: HALF_W },
  };
  place(t); scene.add(t.group);
  return t;
}
export function removeTram(t) {
  t.dead = true; scene.remove(t.group);
  t.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  const i = trams.indexOf(t); if (i >= 0) trams.splice(i, 1);
}
export function clearTrams() { for (const t of [...trams]) removeTram(t); }

// The next station ahead of the tram, inside its route: its block index and position, or null.
function nextStop(t) {
  const r = t.route, j0 = Math.floor(t.s / CHUNK);
  for (let q = 0; q < 3; q++) {
    const j = j0 + (t.dir > 0 ? q : -q), mid = (j + 0.5) * CHUNK;
    if (j < r.lo || j > r.hi) continue;
    if ((mid - t.s) * t.dir < -0.5) continue;               // passed
    if (j === t.lastStop) continue;                          // already waited here
    if (isStopBlock(t.axis, t.k, j)) return { j, mid };
  }
  return null;
}

// The distance from the tram's nose to the nearest car on its track, out to CLEAR metres (0 if a car is at the nose;
// CLEAR or more if the track ahead is clear). A car is on the track when it overlaps the tram's width and lies ahead of it.
// A car beside the tram in the next lane (2.5 m off the centre line) is not on the track.
function gapAhead(t) {
  const tu = [t.box.ux, t.box.uz], tv = [t.box.vx, t.box.vz];
  let best = CLEAR;
  for (const c of cars) {
    const dx = c.x - t.x, dz = c.z - t.z;
    const a = dx * tu[0] + dz * tu[1], l = dx * tv[0] + dz * tv[1];          // the car's centre, along and across the tram
    const cu = [Math.sin(c.h), Math.cos(c.h)], cv = [-Math.cos(c.h), Math.sin(c.h)];
    const e1 = c.box.e1, e2 = c.box.e2;
    const ex = e1 * Math.abs(cu[0] * tu[0] + cu[1] * tu[1]) + e2 * Math.abs(cv[0] * tu[0] + cv[1] * tu[1]);   // the car's half extent along the tram
    const ey = e1 * Math.abs(cu[0] * tv[0] + cu[1] * tv[1]) + e2 * Math.abs(cv[0] * tv[0] + cv[1] * tv[1]);   // ... and across it
    if (Math.abs(l) > ey + HALF_W + 0.1) continue;                            // not on the track
    const fa = a - ex, fb = a + ex;                                           // the car's near and far edges, forward of the tram's centre (tu points the way it runs)
    if (fb <= HALF_LEN) continue;                                             // behind the nose
    if (fa >= HALF_LEN + CLEAR) continue;                                     // beyond the look-ahead
    best = Math.min(best, Math.max(0, fa - HALF_LEN));
  }
  return best;
}

function driveTram(t, dt) {
  const r = t.route;
  // The tram's body must stay on the route, so its centre stops HALF_LEN + 1 short of each terminal.
  const lo = r.lo * CHUNK + HALF_LEN + 1, hi = (r.hi + 1) * CHUNK - HALF_LEN - 1;
  let target = CRUISE;

  // 1. a car on the track ahead: brake short of it, and wait until it has gone
  const gap = gapAhead(t);
  t.blocked = gap < CLEAR;
  if (t.blocked) {
    target = Math.min(target, Math.sqrt(2 * STOP_DECEL * Math.max(0, gap - 3)));
    if (gap <= 3) t.speed = 0;
  }

  // 2. the terminal: brake to a halt at the end of the route, wait there, and run back the other way
  if (!t.turning) {
    const toEnd = t.dir > 0 ? hi - t.s : t.s - lo;
    if (toEnd < 150) target = Math.min(target, Math.sqrt(2 * STOP_DECEL * Math.max(0, toEnd)));
    if (toEnd <= Math.max(0.03, t.speed * dt)) { t.turning = true; t.wait = TERMINUS_WAIT; t.speed = 0; target = 0; }
  }

  // 3. waiting (at a station or a terminal), or the next station ahead
  if (t.wait > 0) {
    t.wait -= dt; target = 0;
    if (t.wait <= 0) { t.wait = 0; if (t.turning) { t.turning = false; t.dir = -t.dir; t.lastStop = null; } }
  } else if (!t.turning) {
    const st = nextStop(t);
    if (st) {
      const dS = (st.mid - t.s) * t.dir;                    // distance still to run to the station
      if (dS < 150) target = Math.min(target, Math.sqrt(2 * STOP_DECEL * Math.max(0, dS)));   // brake so as to arrive at rest
      if (dS <= Math.max(0.03, t.speed * dt)) {
        // at a walking pace it halts here; too fast to stop in time (only just after a spawn), it runs past the station
        if (t.speed <= 2) { t.wait = STOP_WAIT; t.speed = 0; target = 0; }
        t.lastStop = st.j;
      }
    }
  }

  t.speed += clamp(target - t.speed, -BRAKE * dt, ACCEL * dt);
  t.speed = Math.max(0, t.speed);
  t.s = clamp(t.s + t.dir * t.speed * dt, lo, hi);
}

// A tram on a route near the player, somewhere within reach of him and not on a route that already has one.
function spawnTram() {
  for (let tries = 0; tries < 16; tries++) {
    const axis = Math.random() < 0.5 ? 'z' : 'x';
    const near = axis === 'z' ? player.x : player.z, along = axis === 'z' ? player.z : player.x;
    const k = Math.round(near / CHUNK) + Math.floor(rnd(-2, 3));
    if (!isTramLine(axis, k)) continue;
    const r = routeOf(axis, k, Math.floor(along / CHUNK) + Math.floor(rnd(-2, 3)));
    if (!r || trams.some(t => t.route.id === r.id)) continue;
    const lo = r.lo * CHUNK + HALF_LEN + 1, hi = (r.hi + 1) * CHUNK - HALF_LEN - 1;
    const s = clamp(along + (Math.random() < 0.5 ? -1 : 1) * rnd(70, 170), lo, hi);
    if (Math.abs(s - along) < 50) continue;
    const t = makeTram(r, Math.random() < 0.5 ? 1 : -1, s);
    t.speed = 0;                                             // it starts from rest, so it can always stop where it is
    trams.push(t);
    return true;
  }
  return false;
}

// The tram's sounds: wheels on the rails while it runs, and the bell while a car is on the track ahead.
function tramSound(t, dt) {
  const d = Math.hypot(t.x - player.x, t.z - player.z), vol = clamp(1 - d / 170, 0, 1);
  if (vol <= 0) return;
  t.rollT -= dt; t.bellT -= dt;
  if (t.speed > 1 && t.rollT <= 0) { t.rollT = 0.42 - Math.min(0.2, t.speed * 0.004); sfx.tramRoll(vol * 0.8); }
  if (t.blocked && t.bellT <= 0) { t.bellT = 1.3; sfx.tramBell(vol); }
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
    tramSound(t, dt);
    if (Math.hypot(t.x - player.x, t.z - player.z) > REMOVE_R) removeTram(t);
  }
}
