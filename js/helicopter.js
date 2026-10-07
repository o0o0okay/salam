/* Tier 5 air unit — procedural helicopter and visible tracking beam */
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';
import { scene } from './renderer.js';
import { mat, box, cyl } from './assets.js';
import { game, player, sight, reportSighting } from './state.js';
import { DIFF, HELI_V } from './config.js';
import { env } from './environment.js';
import { toast } from './ui.js';

export let helicopter = null;   // live binding: other modules always see the current value
const _est = { x: 0, z: 0 };

export function ensureHelicopter() {
  if (helicopter) return helicopter;
  const group = new THREE.Group(), black = mat(0x17232e), white = mat(0xe8eef5), glass = mat(0x203447);
  group.add(box(2.7, 1.25, 4.6, black, 0, 0, 0));
  group.add(box(2.25, 0.9, 2.35, glass, 0, 0.45, 0.8));
  group.add(box(0.55, 0.48, 5.2, black, 0, 0.18, -4.25));
  group.add(box(1.05, 1.1, 0.2, white, 0, 0.4, -6.5));
  group.add(box(3.4, 0.12, 0.15, black, 0, 1.15, -6.45));
  group.add(cyl(0.16, 0.16, 0.42, 8, black, 0, 1.15, 0));
  const rotor = new THREE.Group(); rotor.position.y = 1.4; rotor.add(box(10, 0.08, 0.32, black)); rotor.add(box(0.32, 0.08, 10, black)); group.add(rotor);
  group.add(box(3.2, 0.12, 0.12, white, 0, -0.88, 0.6)); group.add(box(3.2, 0.12, 0.12, white, 0, -0.88, -1.9));
  const light = new THREE.SpotLight(0xbfe9ff, 0, 115, 0.38, 0.5, 1.4), target = new THREE.Object3D();
  light.castShadow = false; scene.add(light, target);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  beam.renderOrder = 1; scene.add(group, beam);
  helicopter = { group, rotor, light, target, beam, x: 0, y: 38, z: 0, visible: false, entry: 0 };
  return helicopter;
}

export function setHelicopterVisible(on) {
  if (!helicopter) return;
  helicopter.visible = on; helicopter.group.visible = on; helicopter.beam.visible = on;
  if (!on) helicopter.light.intensity = 0;
}

export function updateHelicopter(dt, active) {
  if (!active) { sight.heliLock = 0; sight.heliOn = false; setHelicopterVisible(false); return; }
  const h = ensureHelicopter();
  if (!h.visible) { // enter from behind player
    h.x = player.x - Math.sin(player.h) * 140; h.z = player.z - Math.cos(player.h) * 140; h.entry = 4; sight.heliLock = 0;
  }
  setHelicopterVisible(true);
  // --- lock logic (hysteresis): locks when close, breaks when pulled away ---
  const gd = Math.hypot(h.x - player.x, h.z - player.z), was = sight.heliOn;
  if (gd < (sight.heliLock > 0.5 ? 55 * DIFF.aggr : 24)) sight.heliLock = Math.min(1, sight.heliLock + dt / 0.8);
  else sight.heliLock = Math.max(0, sight.heliLock - dt / 1.5);
  sight.heliOn = sight.heliLock > 0.5;
  if (sight.heliOn !== was) toast(sight.heliOn ? '🚁 AIR UNIT LOCKED ON' : '🚁 AIR UNIT LOST YOU!');
  if (sight.heliOn) reportSighting();   // locked = all cops get exact position (even behind buildings)
  // --- target: locked = real player; lost = guess from last report ---
  const tracking = sight.heliOn, age = clamp(game.t - sight.t, 0, 5);
  _est.x = sight.x + sight.vx * age * 0.7; _est.z = sight.z + sight.vz * age * 0.7;
  const px = player.x + player.vx * .7, pz = player.z + player.vz * .7;
  const cx = tracking ? px : _est.x, cz = tracking ? pz : _est.z;
  const a = game.t * 0.37, off = tracking ? 8 : 0, rad = (tracking ? 18 : 26) * (1 - clamp(player.speed / 48, 0, 1) * 0.7);
  const tx = cx + Math.sin(a) * rad - Math.sin(player.h) * off, tz = cz + Math.cos(a) * rad - Math.cos(player.h) * off;
  const ty = 34 + Math.sin(game.t * 1.7) * 2;
  // movement with speed cap (this is what nitro can outrun)
  const dd = Math.hypot(tx - h.x, tz - h.z), spd = Math.min(HELI_V * (h.entry > 0 ? 2.2 : 1), dd * 2.2);
  if (dd > 0.01) { h.x += (tx - h.x) / dd * spd * dt; h.z += (tz - h.z) / dd * spd * dt; }
  h.entry = Math.max(0, h.entry - dt);
  h.y = lerp(h.y, ty, 1 - Math.exp(-dt * 2.2));
  // light: locked = cool blue-white on player; lost = warm light sweeping guessed area
  const ax = tracking ? px : _est.x + Math.sin(game.t * 1.3) * 12, az = tracking ? pz : _est.z + Math.cos(game.t * 1.1) * 12;
  h.light.intensity = 30 + 190 * env.night; h.beam.material.opacity = 0.1 + 0.12 * env.night;
  h.light.color.setHex(tracking ? 0xbfe9ff : 0xffe0a8); h.beam.material.color.setHex(tracking ? 0xbfe9ff : 0xffd98a);
  h.group.position.set(h.x, h.y, h.z); h.group.rotation.y = Math.atan2(tx - h.x, tz - h.z); h.rotor.rotation.y += dt * 24;
  h.target.position.set(ax, 0.3, az); h.light.position.set(h.x, h.y - .4, h.z); h.light.target = h.target;
  const ddx = h.x - ax, ddy = h.y - .25, ddz = h.z - az, len = Math.hypot(ddx, ddy, ddz), radius = Math.tan(h.light.angle) * len;
  h.beam.position.set((h.x + ax) * .5, (h.y + .25) * .5, (h.z + az) * .5); h.beam.scale.set(radius, len, radius);
  h.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ddx / len, ddy / len, ddz / len));
}