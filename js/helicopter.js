/* Tier 5 air unit — procedural helicopter and visible tracking beam */
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';
import { scene } from './renderer.js';
import { mat, box, cyl } from './assets.js';
import { game, player, sight, reportSighting } from './state.js';
import { DIFF, HELI_V } from './config.js';
import { env } from './environment.js';
import { toast } from './ui.js';
import { AIM_Y, poolPoint, aimPoint, followAim, beaconStrobe, beaconTint, beaconPulse } from './heliLight.js';

export let helicopter = null;   // live binding: other modules always see the current value
const _est = { x: 0, z: 0 };
const _pool = { x: 0, z: 0, y: AIM_Y }, _aim = { x: 0, z: 0, y: AIM_Y, ok: false }, _aimPt = { x: 0, z: 0, y: AIM_Y };
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
const LIGHT_DROP = 0.4;   // the searchlight hangs under the nose

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
  if (!on) { helicopter.light.intensity = 0; _aim.ok = false; }   // next call re-aims the beam outright
  // note: light.visible is never toggled — a change in the visible light count makes three.js recompile every
  // material's shader, which is exactly the hitch this file is careful to avoid (intensity 0 is enough)
}

export function updateHelicopter(dt, active) {
  if (!active) { sight.heliLock = 0; sight.heliOn = false; setHelicopterVisible(false); return; }
  const h = ensureHelicopter();
  if (!h.visible) { // enter from behind player
    h.x = player.x - Math.sin(player.h) * 140; h.z = player.z - Math.cos(player.h) * 140; h.entry = 4; sight.heliLock = 0;
    _aim.ok = false;   // fresh arrival: put the beam straight on the car, do not fly it in from the old spot
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
  // light: locked = the pool of light is held on the player's car; lost = the beam sweeps the guessed area
  const strobe = beaconStrobe(game.t);
  let gx, gz, ay;
  if (tracking) {
    // The pool follows the car itself — no velocity lead — with a small hand-flown sway around it and a light
    // trailing filter, so a hard turn sweeps the circle over the car instead of teleporting it.
    poolPoint(game.t, player.x, player.z, player.h, _pool);   // the car itself, never a lead position
    followAim(_aim, _pool, dt, player.vx, player.vz);
    gx = _aim.x; gz = _aim.z; ay = _aim.y;
  } else {
    _aim.ok = false;   // the next lock-on takes the beam outright
    gx = _est.x + Math.sin(game.t * 1.3) * 12; gz = _est.z + Math.cos(game.t * 1.1) * 12; ay = AIM_Y * 0.4;
  }
  // Aim short of that ground point by the projection the cone makes on its way down, so the middle of the lit
  // circle lands on the car rather than a metre past its nose.
  aimPoint(h.x, h.y - LIGHT_DROP, h.z, gx, ay, gz, _aimPt);
  const pulse = beaconPulse(strobe), tint = beaconTint(strobe, tracking, tracking ? 1 : 0.55);
  h.light.intensity = (30 + 190 * env.night) * pulse;
  h.beam.material.opacity = (0.1 + 0.12 * env.night) * pulse;
  h.light.color.setHex(tint); h.beam.material.color.setHex(tint);   // leans blue / red like the light bars
  h.group.position.set(h.x, h.y, h.z); h.group.rotation.y = Math.atan2(tx - h.x, tz - h.z); h.rotor.rotation.y += dt * 24;
  h.target.position.set(_aimPt.x, _aimPt.y, _aimPt.z); h.light.position.set(h.x, h.y - LIGHT_DROP, h.z); h.light.target = h.target;
  // the visible cone runs from the searchlight down to the middle of the pool on the road
  const bdx = h.x - gx, bdy = h.y - LIGHT_DROP - 0.12, bdz = h.z - gz, len = Math.hypot(bdx, bdy, bdz), radius = Math.tan(h.light.angle) * len;
  h.beam.position.set((h.x + gx) * .5, (h.y - LIGHT_DROP + 0.12) * .5, (h.z + gz) * .5); h.beam.scale.set(radius, len, radius);
  h.beam.quaternion.setFromUnitVectors(_up, _dir.set(bdx / len, bdy / len, bdz / len));
}