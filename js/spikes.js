/* Spike strips deployed by police ahead of the player (wanted ≥ 2) */
import * as THREE from 'three';
import { PI, CHUNK, rnd } from './utils.js';
import { scene } from './renderer.js';
import { mat, box, ASSET } from './assets.js';
import { game, player, spikes, cars } from './state.js';
import { solidAt } from './world.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';
import { sparks, smoke } from './particles.js';
import { hurtPlayer, hurtCar } from './damage.js';
import { civPanic } from './civilians.js';

function makeSpikeMesh(axisZ) {
  const g = new THREE.Group(), dark = mat(0x2a2d33);
  g.add(box(11, 0.12, 1.5, dark, 0, 0.08, 0, false));
  for (let i = 0; i < 11; i++) { const sp = new THREE.Mesh(ASSET.spikeGeo, ASSET.spikeMat); sp.position.set(-5 + i, 0.42, 0); g.add(sp); }
  for (const sx of [-1, 1]) { g.add(box(0.25, 2.4, 0.25, dark, sx * 6.1, 1.2, 0, false)); g.add(box(0.55, 0.55, 0.55, ASSET.spikeLit, sx * 6.1, 2.6, 0, false)); }
  g.rotation.y = axisZ ? 0 : PI / 2;
  return g;
}

export function deploySpike() {
  if (spikes.length >= 3) return false;
  const s = Math.sin(player.h), co = Math.cos(player.h);
  const axisZ = Math.abs(co) >= Math.abs(s);
  const ahead = axisZ ? Math.sign(co || 1) : Math.sign(s || 1);
  const pAlong = axisZ ? player.z : player.x, pLat = axisZ ? player.x : player.z;
  const rc = Math.round(pLat / CHUNK) * CHUNK;
  if (Math.abs(pLat - rc) > 12) return false; // player is not on a road
  for (let a = 0; a < 5; a++) {
    let along = pAlong + ahead * rnd(95, 125);
    const node = Math.round(along / CHUNK) * CHUNK;
    if (Math.abs(along - node) < 20) along = node + (along >= node ? 22 : -22); // never inside an intersection
    const lat = rc + (Math.random() < 0.5 ? -2.5 : 2.5); // leaves a gap on one side of the road
    const x = axisZ ? lat : along, z = axisZ ? along : lat;
    if (Math.hypot(x - player.x, z - player.z) < 70 || solidAt(x, z, 7)) continue;
    if (spikes.some(o => Math.hypot(o.x - x, o.z - z) < 30)) continue;
    const mesh = makeSpikeMesh(axisZ); mesh.position.set(x, 0.02, z); scene.add(mesh);
    spikes.push({ x, z, axisZ, mesh, life: 50 });
    toast('⚠ SPIKE STRIP AHEAD!'); sfx.blip(300);
    return true;
  }
  return false;
}

function popTires(c) {
  c.flatT = c.isPlayer ? 6.5 : c.isPolice ? [6, 5.5, 4.5, 3.2, 2.2][c.tier - 1] : 6;
  c.flatSide = Math.random() < 0.5 ? -1 : 1;
  const s = Math.sin(c.h), co = Math.cos(c.h);
  sparks(c.x, 0.3, c.z, 12, 0, 0, 8); smoke(c.x - s * c.box.e1 * 0.6, 0.4, c.z - co * c.box.e1 * 0.6, 4);
  if (c.isPlayer) { hurtPlayer(5); game.shake = Math.max(game.shake, 0.5); toast('TIRES BLOWN!'); sfx.crash(22); }
  else {
    if (Math.hypot(c.x - player.x, c.z - player.z) < 60) sfx.crash(12);
    if (c.isPolice) {
      hurtCar(c, 8);
      if (game.state === 'playing') { game.spiked++; game.cash += 30; toast('COP SPIKED! +$30'); sfx.blip(760); }
    } else civPanic(c, true);
  }
}

export function updateSpikes(dt) {
  ASSET.spikeLit.color.setHex(Math.floor(game.t * 5) % 2 ? 0xff2020 : 0x501010);
  for (let i = spikes.length - 1; i >= 0; i--) {
    const sp = spikes[i]; sp.life -= dt;
    if (sp.life <= 0 || Math.hypot(sp.x - player.x, sp.z - player.z) > 260) { scene.remove(sp.mesh); spikes.splice(i, 1); continue; }
    for (const c of cars) {
      if (c.dead || c.wrecked || c.y > 0.5 || c.flatT > 0.3) continue;
      const dx = c.x - sp.x, dz = c.z - sp.z, lx = sp.axisZ ? dx : dz, lz = sp.axisZ ? dz : dx;
      if (Math.abs(lx) < 6.2 && Math.abs(lz) < 0.8 + c.box.e1 * 0.55) popTires(c);
    }
  }
}