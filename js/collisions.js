/* Collisions: SAT oriented boxes, solids, props, trees, ramps, car-vs-car */
import * as THREE from 'three';
import { clamp, rnd } from './utils.js';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';
import { TREE_VARIANTS, setTreeMatrix, _Y } from './trees.js';
import { TREE_BREAK_V } from './config.js';
import { DIFF } from './config.js';
import { game, cars, flying, fallingTrees, geysers } from './state.js';
import { nearChunks } from './world.js';
import { carBox } from './vehicle.js';
import { emit, debris, sparks, smoke, explosion } from './particles.js';
import { sfx } from './audio.js';
import { hurtPlayer, hurtCar, impactFx } from './damage.js';
import { civPanic } from './civilians.js';
const PARK_BREAK_V = 8;     // speed (divided by sqrt(mass)) needed to total a parked car
const BUSSTOP_BREAK_V = 7;  // bus shelters are flimsy — break easily
const SCAFFOLD_BREAK_V = 8; // scaffolding — a bit sturdier, still breaks on a real hit
export const hit = { nx: 0, nz: 0, depth: 0 };
export function sat(A, B) {
  const dx = B.x - A.x, dz = B.z - A.z; let minO = Infinity, nx = 0, nz = 0;
  for (let i = 0; i < 4; i++) {
    let ax, az;
    if (i === 0) { ax = A.ux; az = A.uz; } else if (i === 1) { ax = A.vx; az = A.vz; } else if (i === 2) { ax = B.ux; az = B.uz; } else { ax = B.vx; az = B.vz; }
    const ra = A.e1 * Math.abs(A.ux * ax + A.uz * az) + A.e2 * Math.abs(A.vx * ax + A.vz * az);
    const rb = B.e1 * Math.abs(B.ux * ax + B.uz * az) + B.e2 * Math.abs(B.vx * ax + B.vz * az);
    const dist = dx * ax + dz * az, o = ra + rb - Math.abs(dist);
    if (o <= 0) return false;
    if (o < minO) { minO = o; const sg = dist < 0 ? -1 : 1; nx = ax * sg; nz = az * sg; }
  }
  hit.nx = nx; hit.nz = nz; hit.depth = minO; return true;
}
export function overlapsAnything(b, self) {
  const list = nearChunks(b.x, b.z);
  for (const ch of list) for (const s of ch.solids) { if (Math.abs(s.x - b.x) > s.hx + 4 || Math.abs(s.z - b.z) > s.hz + 4) continue; if (sat(b, s.box)) return true; }
  for (const c of cars) if (c !== self && Math.hypot(c.x - b.x, c.z - b.z) < 7 + b.e1 + c.box.e1) return true;
  return false;
}
export function collideSolids(c) {
  const list = nearChunks(c.x, c.z); const b = carBox(c);
  for (const ch of list) for (const s of ch.solids) {
    if (Math.abs(s.x - c.x) > s.hx + c.box.e1 + c.box.e2 || Math.abs(s.z - c.z) > s.hz + c.box.e1 + c.box.e2) continue;
    if (!sat(b, s.box)) continue;
    if (s.tree && !s.tree.broken) {
      const vnT = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards tree
      if (vnT > TREE_BREAK_V / Math.sqrt(c.mass)) { breakTree(s.tree, c, vnT); continue; }
    }
    if (s.parked && !s.parked.broken) {
      const vnP = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards parked car
      if (vnP > PARK_BREAK_V / Math.sqrt(c.mass)) { breakParkedCar(s.parked, c, vnP); continue; }
    }
    if (s.busstop && !s.busstop.broken) {
      const vnB = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards bus stop shelter
      if (vnB > BUSSTOP_BREAK_V / Math.sqrt(c.mass)) { breakBusStop(s.busstop, c, vnB); continue; }
    }
    if (s.scaffold && !s.scaffold.broken) {
      const vnS = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards scaffolding
      if (vnS > SCAFFOLD_BREAK_V / Math.sqrt(c.mass)) { breakScaffold(s.scaffold, c, vnS); continue; }
    }
    const nx = hit.nx, nz = hit.nz, d = hit.depth;
    c.x -= nx * d; c.z -= nz * d; b.x = c.x; b.z = c.z;
    const vn = c.vx * nx + c.vz * nz;
    if (vn > 0) {
      c.vx -= 1.28 * vn * nx; c.vz -= 1.28 * vn * nz; c.vx *= 0.99; c.vz *= 0.99;
      impactFx(c.x + nx * 1.5, c.z + nz * 1.5, vn, nx, nz, c.isPlayer);
      if (c.isPlayer) hurtPlayer(Math.max(0, vn - 8) * 0.6); else hurtCar(c, Math.max(0, vn - 8) * 0.8);
    }
    c.lastWall = game.time;
  }
}
function breakTree(t, c, vn) {
  t.broken = true; t.solid.hx = t.solid.hz = -999;           // no longer solid (all loops ignore it)
  setTreeMatrix(t, 0.0001); t.im.instanceMatrix.needsUpdate = true;
  const sp = Math.hypot(c.vx, c.vz) || 1, dx = c.vx / sp, dz = c.vz / sp;
  const m = new THREE.Mesh(TREE_VARIANTS[t.v], ASSET.treeMat); m.castShadow = true; m.position.set(t.x, t.y, t.z); scene.add(m);
  fallingTrees.push({ mesh: m, axis: new THREE.Vector3(dz, 0, -dx), yaw: new THREE.Quaternion().setFromAxisAngle(_Y, t.rot), ang: 0, w: 1 + vn * 0.15, life: 3 });
  debris(t.x, 4, t.z, t.v >= 4 ? 0x2f7d46 : 0x4caf50, 10); debris(t.x, 3, t.z, 0x66bb6a, 5); debris(t.x, 1, t.z, 0x7a5230, 5);
  const f = 1 - 0.26 / c.mass; c.vx *= f; c.vz *= f;           // heavier = less slowdown
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.3); sfx.crash(vn * 0.8); hurtPlayer(Math.max(0, vn - 14) * 0.2); }
  else hurtCar(c, Math.max(0, vn - 14) * 0.3);
}
function breakParkedCar(pc, c, vn) {
  pc.broken = true; pc.solid.hx = pc.solid.hz = -999;          // no longer solid
  const m = pc.mesh; scene.add(m);                              // detach from chunk group so it survives chunk unload while flying
  const nx = hit.nx, nz = hit.nz;
  flying.push({ mesh: m, vx: c.vx * 0.55 + nx * rnd(5, 9), vy: rnd(5, 10), vz: c.vz * 0.55 + nz * rnd(5, 9), sx: rnd(-6, 6), sz: rnd(-6, 6), life: 2.4 });
  explosion(pc.x, pc.z);
  debris(pc.x, 1, pc.z, pc.color, 10); sparks(pc.x, 1.1, pc.z, 6, nx, nz, 8);
  const f = 1 - 0.3 / c.mass; c.vx *= f; c.vz *= f;             // heavier cars plow through with less slowdown
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.35); sfx.crash(vn); hurtPlayer(Math.max(0, vn - 6) * 0.5); }
  else hurtCar(c, Math.max(0, vn - 6) * 0.9);
}
function breakBusStop(bs, c, vn) {
  bs.broken = true; bs.solid.hx = bs.solid.hz = -999;
  const m = bs.mesh; scene.add(m);
  const nx = hit.nx, nz = hit.nz;
  flying.push({ mesh: m, vx: c.vx * 0.5 + nx * rnd(4, 7), vy: rnd(4, 8), vz: c.vz * 0.5 + nz * rnd(4, 7), sx: rnd(-6, 6), sz: rnd(-6, 6), life: 2.2 });
  debris(bs.x, 1.2, bs.z, 0x8a6a3a, 10); sparks(bs.x, 1.2, bs.z, 6, nx, nz, 7);
  const f = 1 - 0.22 / c.mass; c.vx *= f; c.vz *= f;
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.22); sfx.crash(vn * 0.7); hurtPlayer(Math.max(0, vn - 7) * 0.35); }
  else hurtCar(c, Math.max(0, vn - 7) * 0.6);
}
function breakScaffold(sc, c, vn) {
  sc.broken = true; sc.solid.hx = sc.solid.hz = -999;
  const m = sc.mesh; scene.add(m);
  const nx = hit.nx, nz = hit.nz;
  flying.push({ mesh: m, vx: c.vx * 0.4 + nx * rnd(3, 6), vy: rnd(5, 10), vz: c.vz * 0.4 + nz * rnd(3, 6), sx: rnd(-7, 7), sz: rnd(-7, 7), life: 2.4 });
  debris(sc.x, 2, sc.z, 0x8a8f96, 12); sparks(sc.x, 1.5, sc.z, 8, nx, nz, 8);
  const f = 1 - 0.26 / c.mass; c.vx *= f; c.vz *= f;
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.28); sfx.crash(vn * 0.8); hurtPlayer(Math.max(0, vn - 8) * 0.4); }
  else hurtCar(c, Math.max(0, vn - 8) * 0.7);
}
function breakProp(pr, c) {
  pr.broken = true; const m = pr.mesh; scene.add(m);
  const sp = Math.max(8, c.speed);
  flying.push({ mesh: m, vx: c.vx * 0.9 + rnd(-3, 3), vy: rnd(6, 12), vz: c.vz * 0.9 + rnd(-3, 3), sx: rnd(-8, 8), sz: rnd(-8, 8), life: 1.6 });
  debris(pr.x, 1, pr.z, pr.color, 8); sparks(pr.x, 1, pr.z, 4, 0, 0, 6);
  if (pr.kind === 'hydrant') { geysers.push({ x: pr.x, z: pr.z, life: 7 }); for (let i = 0; i < 20; i++) emit(pr.x, 0.6, pr.z, rnd(-4, 4), rnd(8, 16), rnd(-4, 4), 0x8fd3ff, rnd(0.2, 0.45), rnd(0.8, 1.4), 26); }
  const f = pr.drag; c.vx *= f; c.vz *= f;
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.25); sfx.crash(sp * 0.5); }
}
export function collideProps(c) {
  const list = nearChunks(c.x, c.z); const s = Math.sin(c.h), co = Math.cos(c.h);
  for (const ch of list) for (const pr of ch.props) {
    if (pr.broken) continue; const dx = pr.x - c.x, dz = pr.z - c.z;
    if (dx * dx + dz * dz > 25) continue;
    const lf = dx * s + dz * co, ll = dx * co - dz * s;
    const cf = clamp(lf, -c.box.e1, c.box.e1), cl = clamp(ll, -c.box.e2, c.box.e2);
    if ((lf - cf) ** 2 + (ll - cl) ** 2 < pr.r * pr.r) breakProp(pr, c);
  }
}
export function triggerRamps(c) {
  if (c.y > .08 || c.speed < 12) return;
  for (const ch of nearChunks(c.x, c.z)) for (const ramp of ch.ramps) {
    const dx = c.x - ramp.x, dz = c.z - ramp.z;
    if (dx * dx + dz * dz > ramp.r * ramp.r || game.t - ramp.last < .85) continue;
    ramp.last = game.t; c.vy = c.isPolice ? 6 : c.kind === 'bus' ? 4.5 : 8.5;
    smoke(c.x, .35, c.z, 4, false, 1.2); game.shake = c.isPlayer ? Math.max(game.shake, .16) : game.shake;
    return;
  }
}
export function carCar(A, B) {
  const a = carBox(A), b = carBox(B);
  if (!sat(a, b)) return;
  const nx = hit.nx, nz = hit.nz, d = hit.depth, mA = A.mass, mB = B.mass, rA = mB / (mA + mB), rB = mA / (mA + mB);
  A.x -= nx * d * rA; A.z -= nz * d * rA; B.x += nx * d * rB; B.z += nz * d * rB;
  const rel = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
  if (rel > 0) {
    const j = 1.4 * rel / (1 / mA + 1 / mB);
    A.vx -= j / mA * nx; A.vz -= j / mA * nz; B.vx += j / mB * nx; B.vz += j / mB * nz;
    const px = (A.x + B.x) / 2, pz = (A.z + B.z) / 2, involved = A.isPlayer || B.isPlayer;
    impactFx(px, pz, rel, nx, nz, involved);
    if (rel > 3) {
      A.h += (Math.sin(A.h) * nz - Math.cos(A.h) * nx) * rel * 0.008; B.h += (Math.sin(B.h) * -nz - Math.cos(B.h) * -nx) * rel * 0.008;
    }
    if (involved) {
      const O = A.isPlayer ? B : A;
      if (!O.wrecked) { hurtPlayer(Math.max(0, rel - 5) * (O.kind === 'bus' ? 1.0 : O.isPolice ? O.impact : 0.7)); hurtCar(O, Math.max(0, rel - 5) * (O.isPolice && O.tier >= 4 ? 0.65 : 1.1)); }
      else hurtPlayer(Math.max(0, rel - 8) * 0.4);
      O.lastPlayerHit = game.time;
      if (O.isPolice && rel > 9 && O.role !== 'pinner') O.recoilT = 0.7 / DIFF.aggr;
      if (O.isCiv && rel > 4) civPanic(O, true);
    } else {
      hurtCar(A, Math.max(0, rel - 5) * 0.45); hurtCar(B, Math.max(0, rel - 5) * 0.45);
      if (rel > 4) { if (A.isCiv) civPanic(A, true); if (B.isCiv) civPanic(B, true); }
    }
  }
  if (A.isPlayer) B.lastTouchPlayer = game.time;
  if (B.isPlayer) A.lastTouchPlayer = game.time;
}