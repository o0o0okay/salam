/* Car entity creation + arcade vehicle physics */
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';
import { weather } from './environment.js';
import { CAR_DIMS, buildCar, isPoliceKind } from './carModels.js';
import { cars, police, civs } from './state.js';



export function createCar(kind, x, z, h, params, color) {
  const dims = CAR_DIMS[kind] || CAR_DIMS.sedan;
  const mesh = buildCar(kind, color);
  mesh.position.set(x, 0, z); mesh.rotation.y = h; scene.add(mesh);
  // ground headlight beam (visible at night)
  const beam = new THREE.Mesh(ASSET.beamGeo, ASSET.beamMat); beam.position.set(0, 0.22, kind === 'bus' ? 2.4 : 0); beam.userData.beam = true; beam.renderOrder = 2; mesh.add(beam);
  const isPolice = isPoliceKind(kind), isCiv = kind !== 'player' && !isPolice;
  return {
    kind, isPlayer: kind === 'player', isPolice, isCiv, isTanker: kind === 'fueltanker', x, z, h, vx: 0, vz: 0, steer: 0, yaw: 0, vf: 0, vl: 0, speed: 0, acc: 0, roll: 0, pitch: 0, y: 0, vy: 0,
    params, mesh, beam, inner: mesh.userData.inner, lights: mesh.userData.lights, box: { x, z, ux: 0, uz: 1, vx: -1, vz: 0, e1: dims.e1, e2: dims.e2 },
    mass: dims.mass, hp: dims.hp, maxHp: dims.hp, wrecked: false, wreckT: 0, dead: false,
    stuckT: 0, reverseT: 0, role: 'chaser', lastPlayerHit: -99, lastTouchPlayer: -99, lastWall: -99, smokeT: 0, navT: 0, navX: 0, navZ: 0, navOn: false, avoidDir: 0, flashPh: Math.random() * 6,
    boost: 0, flatT: 0, flatSide: 1, nmIn: false, nmEnter: 0, nmMin: 99,
    // civilian traffic fields
    axis: 'z', dir: 1, road: 0, off: 2.5, cruise: 11, lastNode: null, panicT: 0, panicCool: 0, panicMode: 0, swerve: 1, tier: 0, flank: Math.random() < .5 ? -1 : 1,
    // bus-stop behavior (buses only, harmless on other kinds)
    busWaitT: 0, busStopDoneAt: null
  };
}



export function removeCar(c) {
  scene.remove(c.mesh);
  if (c.lights) { if (c.lights.red) c.lights.red.dispose(); if (c.lights.blue) c.lights.blue.dispose(); }
  const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1);
  const j = police.indexOf(c); if (j >= 0) police.splice(j, 1);
  const k = civs.indexOf(c); if (k >= 0) civs.splice(k, 1);
}



export function carBox(c) {
  const s = Math.sin(c.h), co = Math.cos(c.h), b = c.box; b.x = c.x; b.z = c.z; b.ux = s; b.uz = co; b.vx = -co; b.vz = s; return b;
}



export function driveCar(c, inp, dt) {
  const p = c.params, boost = c.boost || 0, fl = c.flatT > 0 ? 1 : 0;
  const wet = clamp(weather.wet, 0, 1);
  const maxS = p.maxSpeed * (1 + 0.35 * boost) * (1 - 0.34 * fl);
  const accel = p.accel * (1 + 1.0 * boost) * (1 - 0.12 * wet) * (1 - 0.2 * fl);
  const brakeForce = p.brake * (1 - 0.32 * wet);
  let s = Math.sin(c.h), co = Math.cos(c.h);
  let vf = c.vx * s + c.vz * co, vl = c.vx * co - c.vz * s; const oldVf = vf;
  if (inp.throttle > 0) {
    if (vf < -0.5) vf += brakeForce * dt;
    else vf += accel * inp.throttle * Math.max(0, 1 - Math.pow(Math.max(0, vf) / maxS, 3)) * dt;
  } else if (inp.throttle < 0) {
    if (vf > 0.8) vf -= brakeForce * dt; else vf -= p.accel * 0.55 * (1 - 0.12 * wet) * dt;
  } else vf *= Math.exp(-0.3 * dt);
  if (vf > maxS) vf *= Math.exp(-1.2 * dt);
  if (vf < -p.maxReverse) vf = -p.maxReverse;
  if (inp.hand) vf *= Math.exp(-0.7 * dt);
  c.vx = vf * s + vl * co; c.vz = vf * co - vl * s;
  const sp = Math.abs(vf);
  const sf = Math.min(1, sp / 6) / (1 + sp / p.turnFalloff);
  let yaw = c.steer * p.turn * sf * (vf >= 0 ? 1 : -1) * (inp.hand ? 1.35 : 1) * (1 - 0.18 * boost) * (1 - 0.1 * wet);
  yaw += fl * c.flatSide * 0.5 * Math.min(1, sp / 10); // flat tires pull the car sideways
  c.h += yaw * dt; c.yaw = yaw;
  s = Math.sin(c.h); co = Math.cos(c.h);
  vf = c.vx * s + c.vz * co; vl = c.vx * co - c.vz * s;
  const grip = p.grip * (1 - 0.52 * wet) * (inp.hand ? 0.16 : 1) * (1 - 0.5 * fl) * (1 - 0.35 * Math.min(1, sp / maxS));
  const k = Math.exp(-grip * dt), lost = vl * (1 - k); vl *= k; vf += Math.sign(vf || 1) * Math.abs(lost) * 0.3;
  c.vx = vf * s + vl * co; c.vz = vf * co - vl * s;
  c.x += c.vx * dt; c.z += c.vz * dt;
  if (c.y > 0 || c.vy > 0) { c.vy -= 29 * dt; c.y += c.vy * dt; if (c.y < 0) { c.y = 0; c.vy = 0; } }
  c.vf = vf; c.vl = vl; c.speed = Math.hypot(c.vx, c.vz); c.acc = (vf - oldVf) / Math.max(dt, 1e-4);
}



export function syncCarMesh(c, dt) {
  c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.y = c.h;
  const tr = clamp(c.steer * c.speed * 0.0007 + c.vl * 0.004, -0.09, 0.09), tp = clamp(-c.acc * 0.0016, -0.05, 0.05);
  const a = 1 - Math.exp(-dt * 9); c.roll = lerp(c.roll, tr, a); c.pitch = lerp(c.pitch, tp, a);
  c.inner.rotation.z = c.roll; c.inner.rotation.x = c.pitch;
  if (c.mesh.userData.mixer) c.mesh.userData.mixer.rotation.z += dt * (0.6 + Math.min(2, c.speed * 0.08));
}