/* Collisions: SAT oriented boxes, solids, props, trees, ramps, car-vs-car */
import * as THREE from 'three';
import { clamp, rnd } from './utils.js';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';
import { TREE_VARIANTS, setTreeMatrix, _Y } from './trees.js';
import { TREE_BREAK_V } from './config.js';
import { DIFF, HULK_PARAMS } from './config.js';
import { game, cars, flying, fallingTrees, geysers, fires, plazaBreaking } from './state.js';
import { nearChunks, isHeavyParked, parkedShove, parkedDamage } from './world.js';
import { insideFootprint, parapetPush } from './flyover.js';
import { flyingFloor } from './flying.js';
import { carBox, createCar } from './vehicle.js';
import { emit, debris, sparks, smoke, explosion } from './particles.js';
import { sfx } from './audio.js';
import { hurtPlayer, hurtCar, hurtPlayerEnv, hurtCarEnv, impactFx } from './damage.js';
import { toast } from './ui.js';
import { civPanic } from './civilians.js';
const PARK_BREAK_V = 8;     // speed (divided by sqrt(mass)) needed to total a parked car
const BUSSTOP_BREAK_V = 7;  // bus shelters are flimsy — break easily
const SCAFFOLD_BREAK_V = 8; // scaffolding — a bit sturdier, still breaks on a real hit
const PUMP_BREAK_V = 6;     // a fuel dispenser is light: a solid nudge shears it off its island
const SHOPFRONT_BREAK_V = 5; // shop glass: it gives way to any real impact and sprays across the pavement
const FENCE_BREAK_V = 4;    // a chain-link schoolyard fence: about 13 km/h in the player's car takes a panel down
const FENCE_CHAIN_R = 5;    // the panels this close to the hit come down with it, so the hole is a car wide
// A dispenser going up is a real blast, sized so it clears the forecourt: it takes the paint off everything
// within PUMP_BLAST_R m (falling off with distance) and rips apart whatever is actually on top of it. At the
// centre that is a pursuit sedan or a SWAT roadblock killed outright — the armoured bearcats only die to the
// point-blank bonus (PUMP_POINT_BONUS) and survive a near miss. The shock wave also shoves cars off the pumps.
const PUMP_BLAST_R = 9.5, PUMP_BLAST_DMG = 420;
const PUMP_POINT_R = 2, PUMP_POINT_BONUS = 700;
const PUMP_CHAIN_R = 7.5;   // the two dispensers on one island stand 6.8 m apart: hit one, both go up
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
  // Nothing spawns inside the interchange: a car placed in the embankment would sit in the concrete, and the
  // deck above is no place to drop traffic into mid-air either.
  if (insideFootprint(b.x, b.z, 2 + b.e1)) return true;
  const list = nearChunks(b.x, b.z);
  for (const ch of list) for (const s of ch.solids) { if (Math.abs(s.x - b.x) > s.hx + 4 || Math.abs(s.z - b.z) > s.hz + 4) continue; if (sat(b, s.box)) return true; }
  for (const c of cars) if (c !== self && Math.hypot(c.x - b.x, c.z - b.z) < 7 + b.e1 + c.box.e1) return true;
  return false;
}
export function collideSolids(c) {
  const list = nearChunks(c.x, c.z); const b = carBox(c);
  for (const ch of list) for (const s of ch.solids) {
    if (s.maxY !== undefined && c.y > s.maxY) continue;          // a wall under a deck: only for what is under it
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
    if (s.shop && !s.shop.broken) {
      const vnG = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards the shop window
      if (vnG > SHOPFRONT_BREAK_V / Math.sqrt(c.mass)) { breakShopFront(s.shop, c, vnG, hit.nx, hit.nz); continue; }
    }
    if (s.pump && !s.pump.broken) {
      const vnU = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards the fuel pump
      if (vnU > PUMP_BREAK_V / Math.sqrt(c.mass)) { breakPump(s.pump, c, vnU, hit.nx, hit.nz); continue; }
    }
    if (s.scaffold && !s.scaffold.broken) {
      const vnS = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards scaffolding
      if (vnS > SCAFFOLD_BREAK_V / Math.sqrt(c.mass)) { breakScaffold(s.scaffold, c, vnS); continue; }
    }
    if (s.fencePiece && !s.fencePiece.broken) {
      const vnF = c.vx * hit.nx + c.vz * hit.nz;                 // speed towards the schoolyard fence
      if (vnF > FENCE_BREAK_V / Math.sqrt(c.mass)) { breakFence(s.fencePiece, c, vnF, hit.nx, hit.nz); continue; }
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
      if (c.isPlayer) hurtPlayerEnv(Math.max(0, vn - 8) * 0.6); else hurtCarEnv(c, Math.max(0, vn - 8) * 0.8);
    }
    c.lastWall = game.time;
  }
}
// The flyover's parapets, for the cars that are actually up on the structure. A car on the deck is held inside
// them like a wall (with a scrape, and a small hit if it arrives hard); a car at grade is never touched, so the
// crossing street keeps passing under the deck and a car under the bridge is not stopped by a parapet up on
// above its roof.
const _pp = { hit: false };
export function collideFlyover(c) {
  const b = carBox(c);                                        // the box has to be this frame's heading, not the last
  const p = parapetPush(c.x, c.z, c.y, b, _pp);
  if (!p.hit) return;
  const sz = p.axis === 'z', push = p.depth + 0.01;                    // sz: the road that flies runs along z
  if (sz) c.x -= p.sv * push; else c.z -= p.sv * push;
  c.box.x = c.x; c.box.z = c.z;
  const vout = sz ? c.vx * p.sv : c.vz * p.sv;                         // closing on the parapet
  if (vout > 0) {
    const vn = vout, keep = 0.25;
    if (sz) c.vx -= vn * (1 + keep) * p.sv; else c.vz -= vn * (1 + keep) * p.sv;
    if (game.time - (c.lastFlyWall || -99) > 0.4) {
      c.lastFlyWall = game.time;
      impactFx(c.x + (sz ? p.sv * 0.9 : 0), c.z + (sz ? 0 : p.sv * 0.9), vn, sz ? p.sv : 0, sz ? 0 : p.sv, c.isPlayer);
      if (vn > 6) { if (c.isPlayer) { hurtPlayerEnv(Math.max(0, vn - 8) * 0.5); game.shake = Math.max(game.shake, 0.12); } else hurtCarEnv(c, Math.max(0, vn - 8) * 0.5); }
    }
  }
  c.lastWall = game.time;
}
function breakTree(t, c, vn) {
  t.broken = true; t.solid.hx = t.solid.hz = -999;           // no longer solid (all loops ignore it)
  setTreeMatrix(t, 0.0001); t.im.instanceMatrix.needsUpdate = true;
  const sp = Math.hypot(c.vx, c.vz) || 1, dx = c.vx / sp, dz = c.vz / sp;
  const m = new THREE.Mesh(TREE_VARIANTS[t.v], ASSET.treeMat); m.castShadow = true; m.position.set(t.x, t.y, t.z); scene.add(m);
  fallingTrees.push({ mesh: m, axis: new THREE.Vector3(dz, 0, -dx), yaw: new THREE.Quaternion().setFromAxisAngle(_Y, t.rot), ang: 0, w: 1 + vn * 0.15, life: 3 });
  debris(t.x, 4, t.z, t.v >= 4 ? 0x2f7d46 : 0x4caf50, 10); debris(t.x, 3, t.z, 0x66bb6a, 5); debris(t.x, 1, t.z, 0x7a5230, 5);
  const f = 1 - 0.26 / c.mass; c.vx *= f; c.vz *= f;           // heavier = less slowdown
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.3); sfx.crash(vn * 0.8); hurtPlayerEnv(Math.max(0, vn - 14) * 0.2); }
  else hurtCarEnv(c, Math.max(0, vn - 14) * 0.3);
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
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.22); sfx.crash(vn * 0.7); hurtPlayerEnv(Math.max(0, vn - 7) * 0.35); }
  else hurtCarEnv(c, Math.max(0, vn - 7) * 0.6);
}
function breakScaffold(sc, c, vn) {
  sc.broken = true; sc.solid.hx = sc.solid.hz = -999;
  const m = sc.mesh; scene.add(m);
  const nx = hit.nx, nz = hit.nz;
  flying.push({ mesh: m, vx: c.vx * 0.4 + nx * rnd(3, 6), vy: rnd(5, 10), vz: c.vz * 0.4 + nz * rnd(3, 6), sx: rnd(-7, 7), sz: rnd(-7, 7), life: 2.4 });
  debris(sc.x, 2, sc.z, 0x8a8f96, 12); sparks(sc.x, 1.5, sc.z, 8, nx, nz, 8);
  const f = 1 - 0.26 / c.mass; c.vx *= f; c.vz *= f;
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.28); sfx.crash(vn * 0.8); hurtPlayerEnv(Math.max(0, vn - 8) * 0.4); }
  else hurtCarEnv(c, Math.max(0, vn - 8) * 0.7);
}
// A shop window taking a hit: the pane comes out of its frame in one piece and tumbles off down the street,
// the shop itself carries on trading behind it. Bumping a window at a crawl just rattles it.
function breakShopFront(sp, c, vn, nx, nz) {
  sp.broken = true; sp.solid.hx = sp.solid.hz = -999;
  const m = sp.mesh; scene.add(m);
  flying.push({ mesh: m, vx: c.vx * 0.55 + nx * rnd(2, 5), vy: rnd(3.5, 7), vz: c.vz * 0.55 + nz * rnd(2, 5), sx: rnd(-7, 7), sz: rnd(-7, 7), life: 1.9, probe: { hx: sp.w / 2, up: 2.7, down: 0.6, hz: 0.5 } });
  debris(sp.x, 1.5, sp.z, 0xcfe8f0, 16);                       // the pane, in pieces
  sparks(sp.x, 1.6, sp.z, 6, nx, nz, 5);
  const f = 1 - 0.04 / c.mass; c.vx *= f; c.vz *= f;
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.3); sfx.crash(Math.min(22, vn + 6)); toast('SHOP WINDOW!'); }
  else hurtCarEnv(c, Math.max(0, vn - 4) * 0.4);
}
// ---- Fuel: a dispenser going up ----
const pumpFuses = [];                                        // dispensers that caught the fire and are about to go
// Chained dispensers explode on a short fuse, so hitting one pump still reads as a chain reaction. The fuse
// only counts down for a dispenser that is still standing in the world: disposeChunk() marks the pumps of a
// dismantled block (or of a run that was reset) as gone, and a forecourt that no longer exists must not blow.
export function tickPumpFuses(dt) {
  for (let i = pumpFuses.length - 1; i >= 0; i--) {
    const f = pumpFuses[i]; f.t -= dt;
    if (f.t > 0) continue;
    pumpFuses.splice(i, 1);
    if (f.pu.broken || f.pu.gone) continue;
    breakPump(f.pu, null, 0, 0, 0);
  }
}
// The fireball, the area damage and the shove. Everything inside the radius is hit, the player feels less
// than the traffic does (the same rule the fuel tanker blast follows in damage.js).
function pumpBlast(x, z) {
  explosion(x, z);
  explosion(x + rnd(-1.8, 1.8), z + rnd(-1.8, 1.8));          // a second fireball for weight
  game.shake = Math.max(game.shake, 1.8);
  sfx.crash(110);
  for (let i = 0; i < 36; i++) emit(x, 1.4, z, rnd(-17, 17), rnd(6, 24), rnd(-17, 17), i % 2 ? 0xff5a1a : 0xffce4a, rnd(0.8, 2.1), rnd(0.7, 1.5), 13);
  fires.push({ x, z, life: 12 });
  for (const o of cars) {
    if (o.dead) continue;
    const dx = o.x - x, dz = o.z - z, d = Math.hypot(dx, dz);
    if (d > PUMP_BLAST_R) continue;
    const f = 1 - d / PUMP_BLAST_R;
    const ux = d > 0.01 ? dx / d : 0, uz = d > 0.01 ? dz / d : 1;
    const push = 30 * f / Math.max(1, o.mass || 1);
    o.vx += ux * push; o.vz += uz * push;                      // the shock wave shoves the cars off the pump
    if (o.isPlayer) hurtPlayer(50 * f);
    else if (!o.wrecked) hurtCar(o, PUMP_BLAST_DMG * f + (d < PUMP_POINT_R ? PUMP_POINT_BONUS * (1 - d / PUMP_POINT_R) : 0));
  }
}
// A fuel dispenser sheared off its island: it tumbles away, and everything around it goes up with it.
function breakPump(pu, c, vn, nx, nz) {
  pu.broken = true; pu.solid.hx = pu.solid.hz = -999;
  const m = pu.mesh; scene.add(m);
  flying.push({ mesh: m, vx: (c ? c.vx * 0.5 : 0) + nx * rnd(3, 6), vy: rnd(5, 9), vz: (c ? c.vz * 0.5 : 0) + nz * rnd(3, 6), sx: rnd(-8, 8), sz: rnd(-8, 8), life: 2.2, probe: { hx: 0.6, up: 2.42, down: 0.12, hz: 0.52 } });
  debris(pu.x, 1, pu.z, 0xd42b2b, 12); sparks(pu.x, 1.1, pu.z, 10, nx, nz, 9);
  pumpBlast(pu.x, pu.z);
  for (const ch of nearChunks(pu.x, pu.z)) for (const other of ch.pumps || []) {
    if (other === pu || other.broken || other.fuse) continue;
    if (Math.hypot(other.x - pu.x, other.z - pu.z) > PUMP_CHAIN_R) continue;
    other.fuse = 0.4 + rnd(0, 0.4);                            // the neighbouring pump catches, then goes
    pumpFuses.push({ pu: other, t: other.fuse });
  }
  if (c) {
    const f = 1 - 0.12 / c.mass; c.vx *= f; c.vz *= f;
    if (c.isPlayer) { sfx.crash(Math.min(34, vn + 8)); toast('PUMP DOWN!'); hurtPlayer(Math.max(0, vn - 10) * 0.25); }
    else hurtCar(c, Math.max(0, vn - 6) * 0.8);
  }
}
// ---- Schoolyard fences: a panel tears off its plinth and tumbles ----
// The fence is the lightest thing on a block, so a real hit takes the panel down — rails, mesh and the posts
// standing on it — and that panel stops being a wall, which is what opens the yard up to drive into. The panels
// right beside the hit come down with it so the gap is always wide enough to drive through; the rest of the
// line carries on standing. The concrete plinth stays where it was poured.
function breakFence(pc, c, vn, nx, nz) {
  const x = pc.x, z = pc.z;
  for (const ch of nearChunks(x, z)) for (const other of ch.fencePanels || []) {
    if (other.broken || Math.hypot(other.x - x, other.z - z) > FENCE_CHAIN_R) continue;
    tearFencePanel(other, c, nx, nz);
  }
  debris(x, 1.2, z, 0x9aa79f, 14);
  sparks(x, 1.3, z, 8, nx, nz, 8);
  const f = 1 - 0.03 / c.mass; c.vx *= f; c.vz *= f;           // a wire fence barely slows a car down
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.22); sfx.crash(Math.min(20, vn + 5)); toast('FENCE DOWN!'); }
  else hurtCarEnv(c, Math.max(0, vn - 8) * 0.3);
}
function tearFencePanel(pc, c, nx, nz) {
  pc.broken = true;
  if (pc.solid) pc.solid.hx = pc.solid.hz = -999;              // the gap really is a gap now
  const m = pc.mesh; if (!m) return;
  scene.add(m);                                                // off the chunk group, so it can tumble on its own
  const probe = { hx: pc.hx, up: 2.35, down: 0.22, hz: pc.hz };
  m.position.y = flyingFloor(m.rotation, probe);               // seated on its own floor, so it does not pop upward
  flying.push({ mesh: m, vx: c.vx * 0.4 + nx * rnd(2, 5) + rnd(-1.5, 1.5), vy: rnd(4, 8),
    vz: c.vz * 0.4 + nz * rnd(2, 5) + rnd(-1.5, 1.5), sx: rnd(-7, 7), sz: rnd(-7, 7), life: rnd(1.6, 2.4), probe });
}
function smashPlaza(pr) {
  // Plaza features smash into small debris (stone, bronze, water, wood, leaf) rather than flying away whole.
  // Each piece gets its own colour and velocity, so the crash looks like the thing is actually breaking apart.
  const x = pr.x, z = pr.z;
  if (pr.kind === 'plazaFountain') {
    // Three stone basins + jet + spray: mostly stone-colour debris with a few water particles.
    const stone = 0xbfb7a8, water = 0x3aa8d8;
    for (let i = 0; i < 14; i++) emit(x, 0.6, z, rnd(-3, 3), rnd(3, 9), rnd(-3, 3), stone, rnd(0.15, 0.35), rnd(1.2, 2.0), 20);
    for (let i = 0; i < 10; i++) emit(x, 0.8, z, rnd(-2, 2), rnd(4, 7), rnd(-2, 2), water, rnd(0.08, 0.18), rnd(0.8, 1.4), 14);
  } else if (pr.kind === 'plazaStatue') {
    // Stone plinth + bronze body: a mix of heavy stone chunks and lighter bronze fragments.
    const stone = 0xbfb7a8, bronze = 0xb87333;
    for (let i = 0; i < 10; i++) emit(x, 0.8, z, rnd(-4, 4), rnd(5, 11), rnd(-4, 4), stone, rnd(0.15, 0.45), rnd(1.4, 2.2), 22);
    for (let i = 0; i < 8; i++) emit(x, 1.2, z, rnd(-5, 5), rnd(6, 12), rnd(-5, 5), bronze, rnd(0.08, 0.25), rnd(1.0, 1.8), 18);
  } else if (pr.kind === 'plazaTree') {
    // Three trunks + three leaf balls + stone bed: wood, leaf, and stone debris.
    const wood = 0x5a3a1e, leaf = 0x2a6a28, stone = 0xbfb7a8;
    for (let i = 0; i < 6; i++) emit(x, 0.6, z, rnd(-3, 3), rnd(4, 8), rnd(-3, 3), wood, rnd(0.08, 0.18), rnd(1.2, 2.0), 16);
    for (let i = 0; i < 10; i++) emit(x, 1.4, z, rnd(-4, 4), rnd(5, 10), rnd(-4, 4), leaf, rnd(0.15, 0.35), rnd(1.0, 1.6), 18);
    for (let i = 0; i < 5; i++) emit(x, 0.4, z, rnd(-2, 2), rnd(3, 6), rnd(-2, 2), stone, rnd(0.2, 0.4), rnd(1.4, 2.0), 20);
  }
}
function breakProp(pr, c) {
  pr.broken = true; const m = pr.mesh; scene.add(m);
  const sp = Math.max(8, c.speed);
  // Plaza features smash into pieces instead of flying away whole: they break where they stand and leave the
  // island empty, the way a real fountain or statue would when a car drives through it.
  if (pr.kind.startsWith('plaza')) {
    smashPlaza(pr);
    sparks(pr.x, 1, pr.z, 6, 0, 0, 8);
    // Progressive destruction: the mesh tilts in the impact direction and shrinks over ~1.5 s,
    // emitting small debris as it crumbles. The island stays; the feature is gone.
    const impDir = Math.atan2(c.vx, c.vz);
    plazaBreaking.push({ mesh: m, x: pr.x, z: pr.z, kind: pr.kind, life: 1.5, maxLife: 1.5, tiltX: Math.cos(impDir), tiltZ: Math.sin(impDir) });
  } else {
    flying.push({ mesh: m, vx: c.vx * 0.9 + rnd(-3, 3), vy: rnd(6, 12), vz: c.vz * 0.9 + rnd(-3, 3), sx: rnd(-8, 8), sz: rnd(-8, 8), life: 1.6 });
    debris(pr.x, 1, pr.z, pr.color, 8); sparks(pr.x, 1, pr.z, 4, 0, 0, 6);
  }
  if (pr.kind === 'hydrant') { geysers.push({ x: pr.x, z: pr.z, life: 7 }); for (let i = 0; i < 20; i++) emit(pr.x, 0.6, pr.z, rnd(-4, 4), rnd(8, 16), rnd(-4, 4), 0x8fd3ff, rnd(0.2, 0.45), rnd(0.8, 1.4), 26); }
  // Damage: proportional to impact speed. A car that hits a plaza at 30 m/s takes more damage than one
  // that bumps it at 8 m/s. The player feels it; civilian cars and police do too.
  const dmg = sp * 0.8;
  if (c.isPlayer) { hurtPlayerEnv(dmg); }
  else if (!c.wrecked) { hurtCarEnv(c, dmg); }
  const f = pr.drag; c.vx *= f; c.vz *= f;
  if (c.isPlayer) { game.shake = Math.max(game.shake, 0.25); sfx.crash(sp * 0.5); }
}
// Progressive destruction: a plaza feature tilts, shrinks and emits debris over 1.5 s before disappearing.
// Each frame it shrinks by a bit, tilts further in the impact direction, and drops a few particles so the
// destruction looks like a real collapse, not an instant vanish.
export function updatePlazaBreaking(sdt) {
  for (let i = plazaBreaking.length - 1; i >= 0; i--) {
    const pb = plazaBreaking[i]; pb.life -= sdt;
    const t = 1 - pb.life / pb.maxLife;                          // 0 → 1 over the animation
    const m = pb.mesh;
    const s = Math.max(0.01, 1 - t * 0.9);                     // shrink to ~10% over the animation
    m.scale.set(s, s * Math.max(0.3, 1 - t * 0.7), s);
    m.rotation.x = pb.tiltZ * t * 0.6;                         // tilt in the impact direction
    m.rotation.z = -pb.tiltX * t * 0.6;
    m.position.y = Math.max(0, 0.34 - t * 0.3);
    // Emit a few particles each frame proportional to remaining life — heavier at the start.
    if (Math.random() < (1 - t) * 0.7) {
      const x = pb.x, z = pb.z;
      if (pb.kind === 'plazaFountain') {
        const stone = 0xbfb7a8, water = 0x3aa8d8;
        emit(x + rnd(-1, 1), 0.5 + t, z + rnd(-1, 1), rnd(-2, 2), rnd(2, 5), rnd(-2, 2), Math.random() < 0.6 ? stone : water, rnd(0.08, 0.2), rnd(0.3, 0.7), 14);
      } else if (pb.kind === 'plazaStatue') {
        const stone = 0xbfb7a8, bronze = 0xb87333;
        emit(x + rnd(-1, 1), 0.6 + t, z + rnd(-1, 1), rnd(-3, 3), rnd(3, 7), rnd(-3, 3), Math.random() < 0.5 ? stone : bronze, rnd(0.1, 0.25), rnd(0.3, 0.8), 18);
      } else {
        const wood = 0x5a3a1e, leaf = 0x2a6a28;
        emit(x + rnd(-1, 1), 0.4 + t * 0.8, z + rnd(-1, 1), rnd(-2, 2), rnd(2, 5), rnd(-2, 2), Math.random() < 0.5 ? wood : leaf, rnd(0.08, 0.2), rnd(0.3, 0.6), 12);
      }
    }
    if (pb.life <= 0) { scene.remove(m); plazaBreaking.splice(i, 1); }
  }
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