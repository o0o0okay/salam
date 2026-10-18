/* Spilled logs. A log truck that takes a hard hit loses its load: the six logs come off the trailer and go rolling
   across the street. A loose log is a heavy, hard thing. A car it runs into is damaged (wrecked, if the car is light
   and the log is fast), and so is a car that drives into one; it knocks down what a car would knock down (street
   props, trees, bus stops, shop windows, pumps, fences, parked cars) and stops at a wall the way a car does. It rolls
   easily across its length and hardly slides along it, so it ends up lying across the road.
   It is no wall, though: every blow wears it down (LOG_HP, LOG_WEAR), a hard one at once, and then it breaks up into
   three pieces and a few splinters that fly on with the car that broke it and are gone in a couple of seconds; the car
   goes on through, losing only the speed it took to break it. So a log stops one car, not every car after it. One that
   nothing breaks crumbles away after LOG_LIFE (each log a little sooner or later than the next).
   A log is a small body of its own: a box the size of the log (its half length and its radius) turned to its yaw, with
   its speed, spin and height. Against the world it goes through the very tests a car goes through (collideSolids,
   collideTrams, collideFlyover, collideProps) as a wrecked car, so nothing it hits can hurt it back. Against the cars
   it has a contact of its own (logCar), and against the other logs another, as two cylinders, so a log can also come
   to lie on top of another. All the loose logs, and the pieces of the broken ones, are drawn with two instanced meshes:
   the bark and the cut ends. */
import * as THREE from 'three';
import { clamp, rnd } from './utils.js';
import { scene } from './renderer.js';
import { game, player, cars, logs } from './state.js';
import { LOG_SPILL_V, LOG_MASS, LOG_HIT_MIN, LOG_DMG_CAR, LOG_DMG_PLAYER, LOG_ROLL_DECEL, LOG_SLIDE_DECEL, LOG_HP, LOG_WEAR, LOG_KNOCK_MIN,
  LOG_LIFE, LOG_MAX } from './config.js';
import { LOG_LOAD, logParts } from './carModels.js';
import { carBox } from './vehicle.js';
import { collideSolids, collideTrams, collideFlyover, collideProps, sat, hit } from './collisions.js';
import { hurtPlayer, hurtCar, impactFx } from './damage.js';
import { surfaceAt } from './flyover.js';
import { debris, smoke, emit } from './particles.js';
import { sfx } from './audio.js';
import { toast } from './ui.js';
import { civPanic } from './civilians.js';

const R = LOG_LOAD.r, HALF = LOG_LOAD.len / 2;
const GRAV = 20;                                    // m/s²
const INERTIA = LOG_MASS * LOG_LOAD.len * LOG_LOAD.len / 12;   // a rod about its middle: how hard it is to turn
const SPIN_MAX = 4;                                 // rad/s
const FAR = 240;                                    // m from the player: further off, the street it lies in is unloaded
const SHRINK = 0.8;                                 // s: a log being cleared away shrinks out over this
const WOOD = 0x7a4a24;                              // bark chips
const HIT_COOL = 0.3;                               // s: one blow from a car wears a log once, not every frame of it
const PIECE_MAX = 48, PIECE_FADE = 0.45;            // pieces of broken logs out at once; s they take to shrink out
const pieces = [];                                  // the pieces of the logs that broke, flying and lying
// the log trailer's bed, in the truck's frame (js/carModels.js): its half width inside the stakes, the height the
// bottom logs lie on, and its ends (the 7.6 m trailer about the load's middle); and how fast a log coming off it slides
// out sideways at the least (m/s, against the truck)
const BED_HALF = 1.0, BED_Y = LOG_LOAD.at[0][1] - R, BED_Z0 = LOG_LOAD.z - 3.8, BED_Z1 = LOG_LOAD.z + 3.8, SLIDE_OFF = 1.5;
const TIP_V = 1.5;                                  // m/s: a log lying across another off its middle slides off it this fast
// The order a load's six logs go in when nothing breaks them, from 0.85 LOG_LIFE to 1.15 in steps of 0.06 (1.2 s at
// 20 s): one at a time, never two together, and not from one end of the stack to the other.
const LIFE_ORDER = [2, 4, 0, 5, 1, 3];

const toward0 = (v, d) => (v > d ? v - d : v < -d ? v + d : 0);

// ---- the load comes off ----
// A hard hit on a log truck (js/collisions.js carCar, or a loose log here) or its wreck (js/damage.js wreckCar)
// spills its load, once. (nx, nz): the way the hit shoved the truck, power: how hard (m/s; 0 for no direction);
// byPlayer: the player caused it, so what the logs wreck counts as the player's. Every log starts where it lay on the
// trailer, with the truck's own speed, falling off the side it lay on (the two in the middle, the way the hit shoved
// the trailer), the higher ones further, and the hit carrying all of them on across the way it pushed.
export function spillLogs(truck, nx = 0, nz = 0, power = 0, byPlayer = false) {
  if (truck.kind !== 'logtruck' || truck.spilled) return false;
  truck.spilled = true;
  const cargo = truck.mesh && truck.mesh.userData.cargo;
  if (cargo) cargo.visible = false;
  const s = Math.sin(truck.h), co = Math.cos(truck.h);
  const lx = co, lz = -s;                                       // the truck's own x axis, in the world
  const across = nx * lx + nz * lz, along = nx * s + nz * co;   // the shove: across the trailer and along it
  const push = clamp(power, 0, 30), y0 = truck.y || 0;
  for (let i = 0; i < LOG_LOAD.at.length; i++) {
    const [ax, ay] = LOG_LOAD.at[i];
    const side = ax > 0.01 ? 1 : ax < -0.01 ? -1 : Math.abs(across) > 0.2 ? Math.sign(across) : Math.random() < 0.5 ? -1 : 1;
    const va = side * rnd(1.0, 2.0) * (1 + 0.6 * (ay - 1.15)) + across * push * rnd(0.1, 0.2);
    const vf = along * push * rnd(0.03, 0.08) + rnd(-0.5, 0.5);
    addLog(truck.x + ax * lx + LOG_LOAD.z * s, y0 + ay, truck.z + ax * lz + LOG_LOAD.z * co, truck.h + rnd(-0.06, 0.06),
      truck.vx + va * lx + vf * s, rnd(0.5, 2.5), truck.vz + va * lz + vf * co, rnd(-0.5, 0.5), i % 2, byPlayer, truck,
      LOG_LIFE * (0.85 + 0.06 * LIFE_ORDER[i]));
  }
  const cx = truck.x + LOG_LOAD.z * s, cz = truck.z + LOG_LOAD.z * co;
  debris(cx, y0 + 1.6, cz, WOOD, 12);
  smoke(cx, y0 + 1.2, cz, 2, false, 1.3);
  thudAt(cx, cz, 10);
  if (byPlayer && game.state === 'playing') toast('TIMBER!');
  return true;
}
function addLog(x, y, z, h, vx, vy, vz, spin, shade, byPlayer, src, life) {
  meshes();
  while (logs.length >= LOG_MAX) {                              // the oldest go first
    let o = 0;
    for (let i = 1; i < logs.length; i++) if (logs[i].age > logs[o].age) o = i;
    removeLog(o);
  }
  logs.push({ x, y, z, h, vx, vy, vz, spin, roll: 0, rollV: 0, shade, byPlayer, src, age: 0, out: 0, rest: 0,
    sleep: false, ground: false, propped: false, held: false, tip: 0,
    hp: LOG_HP, hitAt: -99, life,                               // what it can take, and how long it lies if nothing breaks it
    // what the world's collision tests read of a car: a wrecked one, so nothing it hits can hurt it
    kind: 'log', isLog: true, isPlayer: false, wrecked: true, mass: LOG_MASS, speed: 0, lastWall: -99,
    box: { x, z, ux: 0, uz: 1, vx: -1, vz: 0, e1: HALF, e2: R } });
}
function removeLog(i) {
  const last = logs.pop();
  if (i < logs.length) logs[i] = last;
}
export function clearLogs() {
  logs.length = 0; pieces.length = 0;
  if (barkIM) { barkIM.count = endIM.count = 0; barkIM.visible = endIM.visible = false; }
}

// ---- every frame (js/update.js, after the cars' collisions) ----
export function updateLogs(dt) {
  if (!logs.length && !pieces.length) { if (barkIM && barkIM.visible) clearLogs(); return; }
  for (let i = logs.length - 1; i >= 0; i--) {
    const L = logs[i];
    L.age += dt;
    if (Math.hypot(L.x - player.x, L.z - player.z) > FAR) { removeLog(i); continue; }
    if (L.age > L.life) {                                       // nothing broke it: it crumbles away where it lies
      if (!L.out) crumble(L);
      if ((L.out += dt) >= SHRINK) removeLog(i);
    }
  }
  for (const L of logs) if (!L.sleep && !L.out) moveLog(L, dt);
  for (const L of logs) for (const c of cars) if (!c.dead) logCar(L, c);
  // last, so a log a car has shoved into another is parted from it before the frame is drawn
  for (let i = 0; i < logs.length; i++) for (let j = i + 1; j < logs.length; j++) logLog(logs[i], logs[j]);
  for (let i = logs.length - 1; i >= 0; i--) if (logs[i].hp <= 0) removeLog(i);   // the ones broken up this frame
  movePieces(dt);
  draw();
}

// Gravity, the road (or the flyover deck) under it, the friction of the road (rolling across its length, scraping
// along it), its spin dying away, and then the world as a car meets it.
function moveLog(L, dt) {
  if (L.tip) {                                                  // tipping off the log it lies across (logLog)
    const k = clamp(L.tip, -1, 1) * TIP_V * dt;
    L.x += Math.sin(L.h) * k; L.z += Math.cos(L.h) * k; L.tip = 0;
  }
  L.vy -= GRAV * dt;
  L.x += L.vx * dt; L.z += L.vz * dt; L.y += L.vy * dt; L.h += L.spin * dt;
  let floor = surfaceAt(L.x, L.z, L.y) + R;
  if (L.src && L.age > 3) L.src = null;                         // off its trailer long since (or the truck has gone)
  const T = L.src;
  if (T) {
    // Still coming off its own trailer: it slides out over the side it is on, at SLIDE_OFF at the least, and until it
    // is past the edge of the bed the bed holds it up (it never drops through the trailer onto the road under it).
    const s = Math.sin(T.h), co = Math.cos(T.h), dx = L.x - T.x, dz = L.z - T.z;
    const lx = dx * co - dz * s, lz = dx * s + dz * co, side = lx >= 0 ? 1 : -1;
    const out = side * ((L.vx - T.vx) * co - (L.vz - T.vz) * s);
    if (out < SLIDE_OFF) { L.vx += side * (SLIDE_OFF - out) * co; L.vz -= side * (SLIDE_OFF - out) * s; }
    if (Math.abs(lx) < BED_HALF && lz > BED_Z0 && lz < BED_Z1) floor = Math.max(floor, (T.y || 0) + BED_Y + R);
  }
  L.ground = L.y <= floor;
  if (L.ground) {
    L.y = floor;
    if (L.vy < -3) {                                            // a drop: it knocks on the road, loses some way, and hops
      const keep = 1 - Math.min(0.3, -0.03 * L.vy);
      L.vx *= keep; L.vz *= keep; landed(L, -L.vy); L.vy = -L.vy * 0.2;
    } else L.vy = 0;
  }
  L.held = L.propped;                                           // lying on another log, last frame
  L.propped = false;
  if ((L.ground && !T) || L.held) {
    const ax = Math.sin(L.h), az = Math.cos(L.h);
    const va = toward0(L.vx * ax + L.vz * az, LOG_SLIDE_DECEL * dt);                 // along the log: it scrapes
    const vc0 = L.vx * az - L.vz * ax, vc = toward0(vc0, (LOG_ROLL_DECEL + 0.3 * Math.abs(vc0)) * dt);   // across: it rolls
    L.vx = va * ax + vc * az; L.vz = va * az - vc * ax;
    L.spin = toward0(L.spin, (2.5 + 1.5 * Math.abs(L.spin)) * dt);
    L.rollV = -vc / R;                                          // turning about its own axis as it rolls
    if (Math.abs(va) + Math.abs(vc) < 0.12 && Math.abs(L.spin) < 0.05 && Math.abs(L.vy) < 0.5) L.rest += dt; else L.rest = 0;
    if (L.ground && L.rest > 0.3) { L.vx = L.vz = L.vy = L.spin = L.rollV = 0; L.sleep = true; }
  }
  L.roll += L.rollV * dt;
  L.speed = Math.hypot(L.vx, L.vz);
  const vx0 = L.vx, vz0 = L.vz;
  collideSolids(L); collideTrams(L); collideFlyover(L); collideProps(L);
  // A knock off the world (a wall, a tree it does not break, a parapet, a tram): the speed it lost in it. Smashing
  // through a prop costs a log little speed, and so little of it.
  const knock = Math.hypot(L.vx - vx0, L.vz - vz0);
  if (knock > LOG_KNOCK_MIN && wear(L, (knock - LOG_KNOCK_MIN) * LOG_MASS * LOG_WEAR, L.x, L.z)) breakLog(L, knock);
}
function landed(L, v) {
  if (v > 4) { smoke(L.x, L.y - R + 0.1, L.z, 1, false, 1.0); debris(L.x, L.y, L.z, WOOD, 3); }
  thudAt(L.x, L.z, v);
}
// a wooden knock, as loud as the blow and quieter with the distance from the player
function thudAt(x, z, v) {
  const d = Math.hypot(x - player.x, z - player.z);
  sfx.thud(clamp(v / 12, 0, 1) * clamp(1 - (d - 12) / 80, 0, 1));
}

// ---- two logs ----
// Two cylinders: the closest points of their axes (each axis a radius short of the ends, so the ends are rounded),
// pushed apart along the line between them. A log on top of another is held up by it (the upper one takes all of the
// lift) and lies there with the road's friction; one lying still is not shoved by a log that only rests against it.
function logLog(A, B) {
  if (A.out || B.out || A.hp <= 0 || B.hp <= 0 || (A.sleep && B.sleep)) return;
  const dx = B.x - A.x, dz = B.z - A.z;
  if (Math.abs(B.y - A.y) >= 2 * R || dx * dx + dz * dz > 4 * HALF * HALF) return;
  const k = HALF - R;
  const ax = Math.sin(A.h) * k, az = Math.cos(A.h) * k, bx = Math.sin(B.h) * k, bz = Math.cos(B.h) * k;
  // P(s) = A + a s and Q(t) = B + b t, s and t in -1..1: the s, t that bring them closest
  const rx = -dx, rz = -dz;
  const aa = ax * ax + az * az, bb = bx * bx + bz * bz, ab = ax * bx + az * bz, ar = ax * rx + az * rz, br = bx * rx + bz * rz;
  const den = aa * bb - ab * ab;
  let s = den > 1e-6 ? clamp((ab * br - ar * bb) / den, -1, 1) : 0;
  let t = (ab * s + br) / bb;
  if (t < -1 || t > 1) { t = clamp(t, -1, 1); s = clamp((ab * t - ar) / aa, -1, 1); }
  // Where the two cross, seen from above, the closest points are one over the other: the push between them is
  // straight up, and the higher log is lifted onto the lower (two logs lying level across each other: the one on the
  // move rides up over the other). Side by side, or end on, it is sideways.
  let nx = B.x + bx * t - (A.x + ax * s), ny = B.y - A.y, nz = B.z + bz * t - (A.z + az * s);
  const d2 = nx * nx + ny * ny + nz * nz;
  if (d2 >= 4 * R * R) return;
  const d = Math.sqrt(d2);
  if (d < 1e-4) { nx = 0; nz = 0; ny = B.vx * B.vx + B.vz * B.vz >= A.vx * A.vx + A.vz * A.vz ? 1 : -1; }
  else { nx /= d; ny /= d; nz /= d; }
  const over = 2 * R - d, wA = A.sleep ? 0 : 1, wB = B.sleep ? 0 : 1, w = wA + wB;
  A.x -= nx * over * wA / w; A.z -= nz * over * wA / w; B.x += nx * over * wB / w; B.z += nz * over * wB / w;
  const up = ny >= 0 ? B : A;                                   // the upper one is lifted off the lower
  if (!up.sleep) { up.y += Math.abs(ny) * over; if (Math.abs(ny) > 0.5) up.propped = true; }
  // A log lying across another, held up at one point well off its own middle, tips off it: it slides away along its
  // length the way its weight overhangs (moveLog) until it drops to the road. Logs lying side by side are held along
  // their length, and a log across two logs near both its ends is pushed both ways at once: those stay.
  if (Math.abs(ny) > 0.7 && den > 0.12 * aa * bb) { const u = up === A ? s : t; if (Math.abs(u) > 0.35) up.tip -= Math.sign(u); }
  const rel = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny + (A.vz - B.vz) * nz;   // closing along A to B
  if (rel <= 0) return;
  // Resting on a log that lies on the road, or against one lying still: the road holds the other one, so the resting
  // log takes the whole of the correction and the other is left lying (and can go to sleep under it).
  const lower = up === B ? A : B;
  if (rel < 1 && (A.sleep || B.sleep || (Math.abs(ny) > 0.7 && (lower.ground || lower.held || lower.propped)))) {
    const m = A.sleep ? B : B.sleep ? A : up, sg = m === B ? 1 : -1;
    m.vx += sg * nx * rel; m.vy += sg * ny * rel; m.vz += sg * nz * rel;
    return;
  }
  A.sleep = B.sleep = false; A.rest = B.rest = 0;
  const jm = 0.6 * rel;                                         // equal masses, a dead knock (restitution 0.2)
  A.vx -= nx * jm; A.vy -= ny * jm; A.vz -= nz * jm; B.vx += nx * jm; B.vy += ny * jm; B.vz += nz * jm;
  if (rel > 1) {                                                // a blow off the middle turns them (a log on a log: gently)
    const J = 0.5 * jm * LOG_MASS, m = SPIN_MAX / 2;
    A.spin = clamp(A.spin - s * k * J * (Math.cos(A.h) * nx - Math.sin(A.h) * nz) / INERTIA, -m, m);
    B.spin = clamp(B.spin + t * k * J * (Math.cos(B.h) * nx - Math.sin(B.h) * nz) / INERTIA, -m, m);
    if (rel > 3) thudAt((A.x + B.x) / 2, (A.z + B.z) / 2, rel);
  }
}

// ---- a log and a car ----
// The two boxes are pushed apart by their masses and exchange a heavy, nearly dead blow; a blow off the log's middle
// turns it, and a hard one lifts it off the road. Above LOG_HIT_MIN the blow wears the log (by the closing speed and
// the two masses, once a blow) and hurts the car (the player's car by hurtPlayer), a civilian panics, and a log truck
// the log runs into loses its own load. The blow that takes the last of the log breaks it up instead: the car goes on
// through the pieces, losing only the speed of the blow that would just have broken it. A log the player spilled
// hands the player the credit for what it wrecks (js/damage.js wreckCar). A log coming off a trailer leaves its own
// truck alone until it is clear of it (the hit may have turned the truck under the falling load).
function logCar(L, c) {
  if (L.out || L.hp <= 0) return;
  const cy = c.y || 0, dx = c.x - L.x, dz = c.z - L.z, rr = HALF + c.box.e1 + 1;
  const touch = L.y - R <= cy + (c.mass >= 3 ? 3.2 : 1.6) && L.y + R >= cy      // not over its roof, nor under its deck
    && dx * dx + dz * dz <= rr * rr && sat(carBox(c), carBox(L));
  if (c === L.src) { if (!touch) L.src = null; return; }
  if (!touch) return;
  const nx = hit.nx, nz = hit.nz, d = hit.depth;               // n: from the car to the log
  const ic = 1 / c.mass, il = 1 / L.mass, w = ic + il, mu = 1 / w;   // mu: the reduced mass of the two
  const rel = (c.vx - L.vx) * nx + (c.vz - L.vz) * nz;
  const px = L.x - nx * R, pz = L.z - nz * R;                   // where they meet
  const dmg = rel > LOG_HIT_MIN && game.time - L.hitAt >= HIT_COOL ? (rel - LOG_HIT_MIN) * mu * LOG_WEAR : 0;
  if (dmg > 0 && dmg >= L.hp) {
    // it breaks: the car loses the blow it took to do it, and goes on through the pieces
    const j = 1.25 * (LOG_HIT_MIN + L.hp / (mu * LOG_WEAR)) * mu;
    c.vx -= nx * j * ic; c.vz -= nz * j * ic;
    L.hitAt = game.time; wear(L, dmg, px, pz);
    breakLog(L, rel, c);
  } else {
    c.x -= nx * d * ic / w; c.z -= nz * d * ic / w; L.x += nx * d * il / w; L.z += nz * d * il / w;
    if (d > 1e-4) L.sleep = false;                              // shoved, it is not lying still: the logs it meets part from it
    if (rel <= 0) return;
    const j = 1.25 * rel / w;
    c.vx -= nx * j * ic; c.vz -= nz * j * ic; L.vx += nx * j * il; L.vz += nz * j * il;
    L.sleep = false; L.rest = 0;
    const sh = Math.sin(L.h), ch = Math.cos(L.h), along = clamp(dx * sh + dz * ch, -HALF, HALF);
    L.spin = clamp(L.spin + along * j * (ch * nx - sh * nz) / INERTIA, -SPIN_MAX, SPIN_MAX);
    if (rel > 6) L.vy = Math.max(L.vy, Math.min(4, rel * 0.15));
    if (dmg > 0) { L.hitAt = game.time; wear(L, dmg, px, pz); }
  }
  if (rel <= LOG_HIT_MIN || game.time - (c.logHitAt ?? -9) < 0.3) return;
  c.logHitAt = game.time;
  impactFx(px, pz, rel, -nx, -nz, c.isPlayer, cy);
  debris(px, cy + 0.7, pz, WOOD, Math.min(8, 2 + Math.floor(rel / 3)));
  thudAt(px, pz, rel);
  if (c.isPlayer) { hurtPlayer((rel - LOG_HIT_MIN) * LOG_DMG_PLAYER); return; }
  if (L.byPlayer) c.lastPlayerHit = game.time;
  hurtCar(c, (rel - LOG_HIT_MIN) * LOG_DMG_CAR);
  if (c.isCiv && rel > 4) civPanic(c, true);
  if (rel > LOG_SPILL_V) spillLogs(c, -nx, -nz, rel, L.byPlayer);          // the log shoves the car along -n
}

// ---- a log worn down, broken up, or crumbling away ----
// A blow that takes dmg off what is left of a log. One it survives cracks it: a few chips of the light wood inside fly
// from where it was struck (px, pz). True when that was the last of it (the caller breaks it up).
function wear(L, dmg, px, pz) {
  L.hp -= dmg;
  if (L.hp <= 0) return true;
  for (let k = 0; k < 4; k++) emit(px, L.y + rnd(-0.1, 0.25), pz, rnd(-3, 3), rnd(2, 5), rnd(-3, 3), LOG_LOAD.end, rnd(0.07, 0.14), rnd(0.5, 0.9), 22);
  return false;
}
// It breaks up: three pieces along its length (their broken ends splintered off) and five long splinters, thrown off
// tumbling, with a burst of chips (bark and the light wood inside), a puff of dust and a crack. power (m/s): how hard
// the blow was. A car (c) that drives on through it sends the piece in its way flying on ahead of it and off to the
// side, out of its way, and knocks the others aside; a log that hit a car that did not go on (or a wall) drops its
// pieces about where it broke, flying apart along it. Nothing of it flies into the car: every piece leaves the face of
// the car's box it is nearest at 1 m/s at least. The log itself is taken out of the street at the end of the frame.
function breakLog(L, power, c = null) {
  L.hp = 0;
  const sh = Math.sin(L.h), ch = Math.cos(L.h), p30 = Math.min(power, 30);
  const vx = c ? c.vx : L.vx, vz = c ? c.vz : L.vz, sp = Math.hypot(vx, vz);
  const fx = sp > 0.5 ? vx / sp : 0, fz = sp > 0.5 ? vz / sp : 0;      // the way the car (or the log) is going
  const through = c && sp > 1 && (L.x - c.x) * fx + (L.z - c.z) * fz > 0;
  const cs = c ? Math.sin(c.h) : 0, cc = c ? Math.cos(c.h) : 0;
  const piece = (u, len, thick, pvx, pvy, pvz, life, whirl) => {
    if (c) {                                                    // off the nearest face of the car, not into it
      const dx = L.x + sh * u - c.x, dz = L.z + ch * u - c.z, lf = dx * cs + dz * cc, ll = dx * cc - dz * cs;
      const ends = c.box.e1 - Math.abs(lf) < c.box.e2 - Math.abs(ll), sg = (ends ? lf : ll) >= 0 ? 1 : -1;
      const ax = ends ? cs * sg : cc * sg, az = ends ? cc * sg : -cs * sg, rel = (pvx - c.vx) * ax + (pvz - c.vz) * az;
      if (rel < 1) { pvx += ax * (1 - rel); pvz += az * (1 - rel); }
    }
    addPiece(L, u, len, thick, pvx, pvy, pvz, life, whirl);
  };
  const cuts = [0, rnd(0.28, 0.4), rnd(0.6, 0.72), 1];
  for (let k = 0; k < 3; k++) {
    const a = (cuts[k] - 0.5) * 2 * HALF, b = (cuts[k + 1] - 0.5) * 2 * HALF, u = (a + b) / 2;
    let pvx, pvz, pvy;
    if (through) {
      const lat = (L.x + sh * u - c.x) * fz - (L.z + ch * u - c.z) * fx;     // across the car's way
      const side = Math.abs(lat) > 0.15 ? Math.sign(lat) : Math.random() < 0.5 ? -1 : 1, inWay = Math.abs(lat) < c.box.e2 + 0.5;
      const on = inWay ? sp * rnd(1.1, 1.25) + rnd(1, 3) : sp * rnd(0.5, 0.8), out = side * (inWay ? rnd(4, 6) : rnd(2, 5));
      pvx = fx * on + fz * out; pvz = fz * on - fx * out; pvy = (inWay ? rnd(3, 5) : rnd(2, 4)) + 0.06 * p30;
    } else {
      const apart = (u / HALF) * rnd(1, 3);
      pvx = vx * rnd(0.3, 0.7) + sh * apart + rnd(-1.5, 1.5); pvz = vz * rnd(0.3, 0.7) + ch * apart + rnd(-1.5, 1.5); pvy = rnd(2, 4) + 0.1 * p30;
    }
    piece(u, b - a - rnd(0.15, 0.35), 1, pvx, pvy, pvz, rnd(1.8, 2.6), 1);
  }
  for (let k = 0; k < 5; k++) piece(rnd(-0.8, 0.8) * HALF, rnd(0.7, 1.6), rnd(0.15, 0.3), vx * rnd(0.3, 0.7) + rnd(-4, 4),
    rnd(3, 6) + 0.1 * p30, vz * rnd(0.3, 0.7) + rnd(-4, 4), rnd(1.0, 1.6), 1.8);
  for (let k = 0; k < 16; k++) {
    const u = rnd(-0.9, 0.9) * HALF;
    emit(L.x + sh * u, L.y + rnd(0, 0.3), L.z + ch * u, vx * rnd(0.2, 0.6) + rnd(-5, 5), rnd(3, 9), vz * rnd(0.2, 0.6) + rnd(-5, 5),
      k % 2 ? WOOD : LOG_LOAD.end, rnd(0.1, 0.28), rnd(0.8, 1.5), 22);
  }
  for (let k = -1; k <= 1; k++) smoke(L.x + sh * k * HALF * 0.5, L.y, L.z + ch * k * HALF * 0.5, 1, false, 1.1);
  const d = Math.hypot(L.x - player.x, L.z - player.z);
  sfx.splinter(clamp(0.35 + power / 20, 0, 1) * clamp(1 - (d - 12) / 90, 0, 1));
}
// A piece of log u m along it from its middle, len m long and thick times as thick, thrown off at (vx, vy, vz), for
// life seconds; whirl: how fast it tumbles.
function addPiece(L, u, len, thick, vx, vy, vz, life, whirl) {
  while (pieces.length >= PIECE_MAX) pieces.shift();          // the oldest go first
  const sh = Math.sin(L.h), ch = Math.cos(L.h);
  pieces.push({ x: L.x + sh * u, y: L.y, z: L.z + ch * u, vx, vy, vz, h: L.h + rnd(-0.3, 0.3), pitch: 0, roll: L.roll,
    wh: rnd(-3, 3) * whirl, wp: rnd(-7, 7) * whirl, wr: rnd(-6, 6) * whirl, half: len / 2, r: R * thick, shade: L.shade, age: 0, life,
    ground: false });
}
// how far a piece reaches down from its middle, tilted end over end by its pitch
const pieceLow = p => p.half * Math.abs(Math.sin(p.pitch)) + p.r * Math.abs(Math.cos(p.pitch));
// The pieces fly, tumbling, land on the road (or the deck) with a bounce, scrape to a stop lying down, and go. They
// touch nothing else: they are what is left of the log, not more logs.
function movePieces(dt) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if ((p.age += dt) >= p.life) { pieces.splice(i, 1); continue; }
    p.vy -= GRAV * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.h += p.wh * dt; p.pitch += p.wp * dt; p.roll += p.wr * dt;
    if (p.ground) {                                             // on the road: it scrapes to a stop, falling onto its side
      const v = Math.hypot(p.vx, p.vz), k = v > 0 ? Math.max(0, v - 10 * dt) / v : 0;
      p.vx *= k; p.vz *= k;
      p.pitch += (Math.round(p.pitch / Math.PI) * Math.PI - p.pitch) * Math.min(1, 8 * dt);
      p.wp *= Math.max(0, 1 - 8 * dt); p.wh *= Math.max(0, 1 - 6 * dt); p.wr *= Math.max(0, 1 - 3 * dt);
    }
    p.ground = false;
    const floor = surfaceAt(p.x, p.z, p.y) + pieceLow(p);
    if (p.y > floor) continue;
    p.y = floor;
    if (p.vy > 0) continue;                                     // still going up (it turned over the road): lifted
    if (p.vy < -2) { p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; p.wh *= 0.5; p.wp *= 0.5; p.wr *= 0.5; continue; }
    p.vy = 0; p.ground = true;
  }
}
// A log whose time is up crumbles away where it lies: a little dust and a few chips as it starts to shrink out.
function crumble(L) {
  const sh = Math.sin(L.h), ch = Math.cos(L.h);
  for (let k = -1; k <= 1; k++) smoke(L.x + sh * k * HALF * 0.6, L.y - R * 0.5, L.z + ch * k * HALF * 0.6, 1, false, 0.8);
  for (let k = 0; k < 6; k++) {
    const u = rnd(-1, 1) * HALF;
    emit(L.x + sh * u, L.y + R * 0.5, L.z + ch * u, rnd(-1.5, 1.5), rnd(1, 3), rnd(-1.5, 1.5), k % 2 ? WOOD : LOG_LOAD.end, rnd(0.08, 0.16), rnd(0.6, 1.0), 18);
  }
}

// ---- for the traffic (js/civilians.js civAI) ----
// How far ahead along the car's heading (s, co) a loose log lies in its path, up to reach (m), or Infinity. Five
// points along each log are tried, so a log lying across the road is seen from every lane it blocks.
export function logAhead(c, s, co, reach) {
  let best = Infinity;
  const cy = c.y || 0, half = c.box.e2 + R + 0.3, far = (reach + HALF) * (reach + HALF);
  for (const L of logs) {
    if (L.out || L.hp <= 0 || Math.abs(L.y - R - cy) > 1.5) continue;
    const dx = L.x - c.x, dz = L.z - c.z;
    if (dx * dx + dz * dz > far) continue;
    const ax = Math.sin(L.h) * HALF / 2, az = Math.cos(L.h) * HALF / 2;
    for (let k = -2; k <= 2; k++) {
      const px = dx + ax * k, pz = dz + az * k, f = px * s + pz * co;
      if (f > 0 && f < reach && f < best && Math.abs(px * co - pz * s) < half) best = f;
    }
  }
  return best;
}

// ---- drawing: two instanced meshes for every loose log and every piece, the bark (two shades) and the cut ends ----
let barkIM = null, endIM = null;
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _k = new THREE.Vector3();
const _m = new THREE.Matrix4(), _c = new THREE.Color();
function meshes() {
  if (barkIM) return;
  const { bark, ends } = logParts();
  barkIM = new THREE.InstancedMesh(bark, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), LOG_MAX + PIECE_MAX);
  endIM = new THREE.InstancedMesh(ends, new THREE.MeshLambertMaterial({ color: LOG_LOAD.end, flatShading: true }), LOG_MAX + PIECE_MAX);
  barkIM.setColorAt(0, _c.setHex(LOG_LOAD.bark[0]));            // the colour buffer exists before the first draw
  for (const im of [barkIM, endIM]) {
    im.count = 0; im.visible = false; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im);
  }
}
// The logs first (one shrinking out keeps its underside on the road), then the pieces: the log's own two meshes, as
// short as a piece and as thin as a splinter.
function draw() {
  for (let i = 0; i < logs.length; i++) {
    const L = logs[i], k = L.out > 0 ? Math.max(0.01, 1 - L.out / SHRINK) : 1;
    _m.compose(_p.set(L.x, L.y - R * (1 - k), L.z), _q.setFromEuler(_e.set(0, L.h, L.roll)), _k.set(k, k, k));
    barkIM.setMatrixAt(i, _m); endIM.setMatrixAt(i, _m);
    barkIM.setColorAt(i, _c.setHex(LOG_LOAD.bark[L.shade]));
  }
  let n = logs.length;
  for (const p of pieces) {
    const k = Math.min(1, (p.life - p.age) / PIECE_FADE), t = p.r / R * k;
    _m.compose(_p.set(p.x, p.y - pieceLow(p) * (1 - k), p.z), _q.setFromEuler(_e.set(p.pitch, p.h, p.roll)), _k.set(t, t, 2 * p.half / LOG_LOAD.len * k));
    barkIM.setMatrixAt(n, _m); endIM.setMatrixAt(n, _m);
    barkIM.setColorAt(n++, _c.setHex(LOG_LOAD.bark[p.shade]));
  }
  barkIM.count = endIM.count = n;
  barkIM.visible = endIM.visible = n > 0;
  barkIM.instanceMatrix.needsUpdate = endIM.instanceMatrix.needsUpdate = true;
  barkIM.instanceColor.needsUpdate = true;
}
// what the checks look at: the two instanced meshes (null before the first spill), and the pieces in the air
export const logMeshes = () => ({ bark: barkIM, ends: endIM });
export const logPieces = () => pieces;
