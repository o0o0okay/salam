/* Collisions: SAT oriented boxes, solids, props, trees, ramps, car-vs-car */
import * as THREE from 'three';
import { clamp, rnd } from './utils.js';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';
import { TREE_VARIANTS, setTreeMatrix, _Y } from './trees.js';
import { TREE_BREAK_V } from './config.js';
import { DIFF, HULK_PARAMS } from './config.js';
import { game, cars, flying, fallingTrees, geysers, fires } from './state.js';
import { nearChunks, isHeavyParked, parkedShove, parkedDamage } from './world.js';
import { carBox, createCar } from './vehicle.js';
import { emit, debris, sparks, smoke, explosion } from './particles.js';
import { sfx } from './audio.js';
import { hurtPlayer, hurtCar, impactFx } from './damage.js';
import { toast } from './ui.js';
import { civPanic } from './civilians.js';
const PARK_BREAK_V = 8;     // speed (divided by sqrt(mass)) needed to total a parked car
const BUSSTOP_BREAK_V = 7;  // bus shelters are flimsy — break easily
const SCAFFOLD_BREAK_V = 8; // scaffolding — a bit sturdier, still breaks on a real hit
export const hit = { nx: 0, nz: 0, depth: 0 };
// One damage tick per quarter second per vehicle pair: without this a single crash inside the SAT overlap
// would apply the damage on every frame the boxes still touch.
function pcHitCool(pc, c, vn) {
  if (vn < 1.5) return false;
  if (pc.lastHitBy === c && game.time - (pc.lastHit || -99) < 0.25) return false;
  pc.lastHitBy = c;
  return true;
}
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
      if (isHeavyParked(s.parked.mass)) {
        // Heavy: absorb the impact with a cooldown so one crash cannot tick damage every frame, then fall
        // through so the car still stops against it like the wall it is (this is what "weight" feels like).
        if (pcHitCool(s.parked, c, vnP)) hitParkedHeavy(s.parked, c, vnP);
      } else if (vnP > PARK_BREAK_V / Math.sqrt(c.mass)) { breakParkedCar(s.parked, c, vnP); continue; }
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
      const heavyWall = s.parked && isHeavyParked(s.parked.mass);          // very little bounce off something heavy
      const rebound = heavyWall ? 1.02 : 1.28;
      c.vx -= rebound * vn * nx; c.vz -= rebound * vn * nz;
      const keep = heavyWall ? 0.86 : 0.99;                                // and a real chunk of speed gone
      c.vx *= keep; c.vz *= keep;
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
// A heavy parked vehicle takes the hit instead of flying: it shifts, dents, smokes, and once its hit points
// are gone it burns where it stands. Nothing here launches the mesh, so nothing can sink into the road.
export function hitParkedHeavy(pc, c, vn) {
  if (pc.wrecked || vn < 1.5) return false;
  const nx = hit.nx, nz = hit.nz;
  if (c.isPlayer) pc.lastPlayerHit = game.time;
  pc.mesh.rotation.y += rnd(-0.05, 0.05) * Math.min(1.4, vn / 8);         // rocks a little on its springs
  const push = parkedShove(pc.mass, vn);
  if (push > 0.01 && canShift(pc, nx * push, nz * push)) {
    pc.mesh.position.x += nx * push; pc.mesh.position.z += nz * push;
    pc.x += nx * push; pc.z += nz * push;
    if (pc.solid) { pc.solid.x = pc.x; pc.solid.z = pc.z; pc.solid.box.x = pc.x; pc.solid.box.z = pc.z; }
  }
  const dmg = parkedDamage(pc.mass, vn);
  pc.hp -= dmg; pc.lastHit = game.time;
  const px = pc.x + nx * 1.4, pz = pc.z + nz * 1.4;
  sparks(px, 0.9, pz, Math.min(12, 3 + Math.floor(vn * 0.4)), nx, nz, Math.min(12, vn * 0.4));
  if (vn > 8) smoke(px, 1, pz, 1, true, 1.1);
  if (c.isPlayer) { game.shake = Math.max(game.shake, Math.min(1.0, vn * 0.035)); sfx.crash(Math.min(30, vn)); }
  if (pc.hp <= 0) { wreckParkedHeavy(pc); return true; }
  return false;
}
// Refuses to shove a parked vehicle into a wall or into another vehicle: if the ground it would slide onto is
// already taken, it stays exactly where it stands — still absorbing the hit, still catching fire there.
function canShift(pc, dx, dz) {
  const x = pc.x + dx, z = pc.z + dz, r = Math.max(pc.len || 2, pc.wid || 1) * 0.8;
  for (const ch of nearChunks(x, z)) for (const s of ch.solids) {
    if (s === pc.solid || s.parked === pc) continue;
    if (Math.abs(s.x - x) < s.hx + r && Math.abs(s.z - z) < s.hz + r) return false;
  }
  return true;
}
// Burns out where it stands and turns into a real wreck — the player can then shove it out of the way.
function wreckParkedHeavy(pc) {
  pc.wrecked = true; pc.broken = true;
  pc.mesh.traverse(o => { if (o.isMesh && !o.userData.beam) o.material = ASSET.burnt; });
  explosion(pc.x, pc.z);
  smoke(pc.x, 1.4, pc.z, 4, true, 1.8);
  debris(pc.x, 1, pc.z, pc.color, 8);
  if (game.time - (pc.lastPlayerHit || -99) < 4 && game.state === 'playing') {   // the player did this: pay them
    game.cash += 70; toast('CHAOS! +$70'); sfx.blip(740);
  }
  sfx.crash(45);
  makeHulk(pc);
}
// The burnt-out hull stops being a static prop: it becomes a wrecked car entity, exactly like a police car
// that blew up mid-chase — the game pushes it around, it keeps smoking and burning, and it is never cleaned
// up or replaced. It is still the same parked record, with the same mesh, sitting on its own bay.
function makeHulk(pc) {
  for (const ch of nearChunks(pc.x, pc.z)) {                    // it is not one of the lot's parked cars any more
    const i = ch.spill.indexOf(pc); if (i >= 0) ch.spill.splice(i, 1);
  }
  if (pc.solid) pc.solid.hx = pc.solid.hz = -999;                // so it is no longer a wall, just a heavy wreck
  scene.add(pc.mesh);                                            // out of the chunk group: a rebuild cannot hide it
  // A complete wrecked-vehicle entity, so every system that expects a car finds what it needs (flat tires,
  // nav and boost fields, a headlight beam slot…), and then the burnt parked mesh takes the place of the
  // fresh body: the hull that slides away is exactly the one the player set on fire.
  const shell = createCar(pc.kind, pc.x, pc.z, pc.mesh.rotation.y, HULK_PARAMS, pc.color);
  scene.remove(shell.mesh);
  Object.assign(pc, shell, {
    mesh: pc.mesh, inner: pc.mesh.userData.inner, lights: pc.mesh.userData.lights || {}, beam: null,
    x: pc.x, z: pc.z, mass: pc.mass, lastPlayerHit: pc.lastPlayerHit,
  });
  pc.isCiv = false; pc.isPolice = false; pc.isPlayer = false; pc.isTanker = false; pc.tier = 0;
  pc.h = pc.mesh.rotation.y; pc.hulkY = pc.mesh.position.y; pc.y = pc.hulkY; pc.vy = 0;   // stays on its lot
  pc.dead = false; pc.wrecked = true; pc.wreckT = 0; pc.hulk = true; pc.hp = 0;
  pc.fire = { x: pc.x, z: pc.z, life: 12 };                      // a burning hulk, like a tanker wreck
  fires.push(pc.fire);                                           // (js/wrecks.js keeps it under the wreck)
  cars.push(pc);
}
function breakParkedCar(pc, c, vn) {
  pc.broken = true; pc.solid.hx = pc.solid.hz = -999;          // no longer solid
  const m = pc.mesh;
  scene.add(m);                                                 // detach from chunk group so it survives chunk unload while flying
  if (pc.faded) {                                               // cars parked at run time (mall lots) carry transparency
    m.traverse(o => { if (o.userData.faded) o.material = o.userData.lotMat || o.material; });
  }
  const nx = hit.nx, nz = hit.nz;
  // Tumble about the car's own centre, not about its wheels: a mesh that rotates around a ground-level
  // origin swings half of its body through the road, which is what buried the launched cars. The pivot
  // carries the car's heading and spins about the car's own axes (Euler order YXZ), and it reports its
  // body extents so js/flying.js can hold the lowest corner above the asphalt on every frame.
  const lift = 0.9, pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  pivot.rotation.y = m.rotation.y; m.rotation.y = 0;
  pivot.position.set(m.position.x, Math.min(m.position.y, 0.2) + lift, m.position.z);
  scene.add(pivot); pivot.add(m); m.position.set(0, -lift, 0);
  const probe = { hx: (pc.wid || 0.95) + 0.1, up: 1.2, down: lift, hz: (pc.len || 2.05) + 0.15 };
  flying.push({ mesh: pivot, vx: c.vx * 0.55 + nx * rnd(5, 9), vy: rnd(5, 10), vz: c.vz * 0.55 + nz * rnd(5, 9), sx: rnd(-6, 6), sz: rnd(-6, 6), life: 2.4, probe });
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