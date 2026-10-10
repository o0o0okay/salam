/* Traffic lights — spawned at every 4-way intersection (chunk corner) */
import * as THREE from 'three';
import { rnd } from './utils.js';
import { mat, box } from './assets.js';
import { isFlyoverNode, atGradeSide, roadEdge, FLY } from './flyover.js';

const GREEN = 7, YELLOW = 1.6;
const poleMat = mat(0x2d2f33);
const housingMat = mat(0x202228);
const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 4.6, 6);
const bulbGeo = new THREE.SphereGeometry(0.17, 8, 8);

const RED = 0xff2a2a, RED_OFF = 0x3a1414;
const YEL = 0xffc82a, YEL_OFF = 0x3a3014;
const GRN = 0x2dff6a, GRN_OFF = 0x123a1e;

const lights = new Map();
const key = (ix, iz) => ix + '_' + iz;

// Where a junction's four signal poles stand. They go OFF out from the junction centre on both axes, which puts
// them on the pavement behind the kerb — the arrangement every plain junction has. Beside a flyover that kerb is
// not where it used to be: the strip between the structure's own edge and the widened kerb (`roadEdge()`) is the
// at-grade lane, real carriageway, and a pole left at OFF stands in the middle of it, right where the ramp comes
// down. On a block side that carries that lane the pole steps out onto the pavement behind the widened kerb
// instead, so the signal reads the lane rather than standing in it.
const OFF = 13, POLE_CLEAR = 1.0;
function cornerPoles(ix, iz) {
  const out = [];
  const put = (sx, sz, axis) => {
    let x = ix + sx * OFF, z = iz + sz * OFF;
    // The block this pole stands in, and the side of it that faces each main road (the avenue runs along x = 0,
    // the cross street along z = 0): a block east of a road faces it with its west side, one west of it with its
    // east side, and a block that fronts neither road has no lane to worry about.
    const bx = Math.floor(x / FLY.span), bz = Math.floor(z / FLY.span);
    const fx = bx === 0 ? 0 : bx === -1 ? 1 : -1;
    const fz = bz === 0 ? 2 : bz === -1 ? 3 : -1;
    // Only a pole that is actually standing in that lane moves: the block's far corner is nowhere near its
    // own kerb, and a pole out there has nothing to step back from.
    if (fx >= 0 && atGradeSide(bx, bz, fx) && Math.abs(x) < roadEdge() + POLE_CLEAR) x = (x < 0 ? -1 : 1) * (roadEdge() + POLE_CLEAR);
    if (fz >= 0 && atGradeSide(bx, bz, fz) && Math.abs(z) < roadEdge() + POLE_CLEAR) z = (z < 0 ? -1 : 1) * (roadEdge() + POLE_CLEAR);
    out.push({ x, z, axis });
  };
  put(-1, -1, 'x'); put(1, -1, 'z'); put(-1, 1, 'z'); put(1, 1, 'x');
  return out;
}

function bulb(onColor, offColor, y, parent) {
  const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: offColor }));
  m.position.set(0, y, 0.2); parent.add(m);
  m.userData.on = onColor; m.userData.off = offColor; return m;
}
function buildHead() {
  const head = new THREE.Group();
  head.add(box(0.46, 1.3, 0.36, housingMat, 0, 0, 0, false));
  const r = bulb(RED, RED_OFF, 0.42, head);
  const y = bulb(YEL, YEL_OFF, 0, head);
  const g = bulb(GRN, GRN_OFF, -0.42, head);
  return { group: head, r, y, g };
}
function setBulb(b, on) { b.material.color.setHex(on ? b.userData.on : b.userData.off); }
function applyPhase(L) {
  const zGo = L.phase === 'z-green', zWarn = L.phase === 'z-yellow';
  const xGo = L.phase === 'x-green', xWarn = L.phase === 'x-yellow';
  for (const h of L.zHeads) { setBulb(h.g, zGo); setBulb(h.y, zWarn); setBulb(h.r, !zGo && !zWarn); }
  for (const h of L.xHeads) { setBulb(h.g, xGo); setBulb(h.y, xWarn); setBulb(h.r, !xGo && !xWarn); }
}
function addSignal(group, px, pz, ix, iz, axis) {
  const poleH = 4.6;
  const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(px, poleH / 2, pz); pole.castShadow = true; group.add(pole);
  const dx = ix - px, dz = iz - pz, ang = Math.atan2(dx, dz), armLen = 2.6;
  const armMesh = box(0.12, 0.12, armLen, poleMat, px + Math.sin(ang) * armLen / 2, poleH - 0.15, pz + Math.cos(ang) * armLen / 2, false);
  armMesh.rotation.y = ang; group.add(armMesh);
  const head = buildHead();
  head.group.position.set(px + Math.sin(ang) * armLen, poleH - 0.15, pz + Math.cos(ang) * armLen);
  head.group.rotation.y = ang; group.add(head.group);
  return head;
}
// Called once per chunk from world.js — builds the 4-way signal set at this chunk's corner (ix, iz)
export function buildIntersection(ix, iz, group, ch) {
  // A grade-separated junction has nothing to signal: the avenue is up on its bridge and the crossing street
  // runs underneath, so the two movements never conflict and both roads simply flow. The node is still
  // registered (no heads, and a phase that never advances) so lightGo() answers for it and nothing else in the
  // game has to know the junction is special.
  if (isFlyoverNode(ix, iz)) { lights.set(key(ix, iz), { free: true, phase: 'free', t: Infinity, zHeads: [], xHeads: [] }); return; }
  const zHeads = [], xHeads = [];
  for (const c of cornerPoles(ix, iz)) {
    const h = addSignal(group, c.x, c.z, ix, iz, c.axis);
    (c.axis === 'z' ? zHeads : xHeads).push(h);
    // Recorded for the suite: where this junction's poles actually stand, so a pole left standing in the
    // at-grade lane beside a flyover cannot pass unnoticed (see run.mjs).
    if (ch) (ch.signalPoles = ch.signalPoles || []).push({ x: c.x, z: c.z, ix, iz, axis: c.axis });
  }
  const L = { phase: Math.random() < 0.5 ? 'z-green' : 'x-green', t: rnd(1, GREEN), zHeads, xHeads };
  lights.set(key(ix, iz), L);
  applyPhase(L);
}
// Called from world.js disposeChunk — frees the per-bulb materials
export function removeIntersection(ix, iz) {
  const L = lights.get(key(ix, iz)); if (!L) return;
  for (const h of [...L.zHeads, ...L.xHeads]) { h.r.material.dispose(); h.y.material.dispose(); h.g.material.dispose(); }
  lights.delete(key(ix, iz));
}
// Called every frame from update.js
export function updateTrafficLights(dt) {
  for (const L of lights.values()) {
    L.t -= dt;
    if (L.t <= 0) {
      if (L.phase === 'z-green') { L.phase = 'z-yellow'; L.t = YELLOW; }
      else if (L.phase === 'z-yellow') { L.phase = 'x-green'; L.t = GREEN; }
      else if (L.phase === 'x-green') { L.phase = 'x-yellow'; L.t = YELLOW; }
      else { L.phase = 'z-green'; L.t = GREEN; }
      applyPhase(L);
    }
  }
}
// Queried by civilians.js: can a car travelling along `axis` ('z' or 'x') go through (ix, iz)?
export function lightGo(ix, iz, axis) {
  const L = lights.get(key(ix, iz));
  if (!L) return true;         // no light built here (shouldn't normally happen) = free to go
  if (L.free) return true;     // the interchange: both roads have right of way, at different levels
  return axis === 'z' ? (L.phase === 'z-green' || L.phase === 'z-yellow') : (L.phase === 'x-green' || L.phase === 'x-yellow');
}