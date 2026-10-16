/* Car entity creation + arcade vehicle physics */
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';
import { scene } from './renderer.js';
import { ASSET } from './assets.js';
import { weatherSystem } from './weather.js';
import { CAR_DIMS, buildCar, isPoliceKind } from './carModels.js';
import { cars, police, civs } from './state.js';
import { surfaceAt } from './flyover.js';



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
    boost: 0, flatT: 0, flatSide: 1, air: false, nmIn: false, nmEnter: 0, nmMin: 99,
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
  const p = c.params, boost = c.boost || 0, fl = c.flatT > 0 ? 1 : 0, slick = weatherSystem.slickness;
  const maxS = p.maxSpeed * (1 + 0.35 * boost) * (1 - 0.34 * fl) * (1 - 0.035 * slick);
  const accel = p.accel * (1 + 1.0 * boost) * (1 - 0.2 * fl) * (1 - 0.08 * slick);
  const brakeForce = p.brake * (1 - 0.3 * slick);
  let s = Math.sin(c.h), co = Math.cos(c.h);
  let vf = c.vx * s + c.vz * co, vl = c.vx * co - c.vz * s; const oldVf = vf;
  if (inp.throttle > 0) {
    if (vf < -0.5) vf += brakeForce * dt;
    else vf += accel * inp.throttle * Math.max(0, 1 - Math.pow(Math.max(0, vf) / maxS, 3)) * dt;
  } else if (inp.throttle < 0) {
    if (vf > 0.8) vf -= brakeForce * dt; else vf -= p.accel * 0.55 * (1 - 0.08 * slick) * dt;
  } else vf *= Math.exp(-0.3 * dt);
  if (vf > maxS) vf *= Math.exp(-1.2 * dt);
  if (vf < -p.maxReverse) vf = -p.maxReverse;
  if (inp.hand) vf *= Math.exp(-0.7 * dt);
  c.vx = vf * s + vl * co; c.vz = vf * co - vl * s;
  const sp = Math.abs(vf);
  const sf = Math.min(1, sp / 6) / (1 + sp / p.turnFalloff);
  let yaw = c.steer * p.turn * sf * (vf >= 0 ? 1 : -1) * (inp.hand ? 1.35 : 1) * (1 - 0.18 * boost) * (1 - 0.14 * slick);
  yaw += fl * c.flatSide * 0.5 * Math.min(1, sp / 10); // flat tires pull the car sideways
  c.h += yaw * dt; c.yaw = yaw;
  s = Math.sin(c.h); co = Math.cos(c.h);
  vf = c.vx * s + c.vz * co; vl = c.vx * co - c.vz * s;
  const grip = p.grip * (1 - 0.58 * slick) * (inp.hand ? 0.16 : 1) * (1 - 0.5 * fl) * (1 - 0.35 * Math.min(1, sp / maxS));
  const k = Math.exp(-grip * dt), lost = vl * (1 - k); vl *= k; vf += Math.sign(vf || 1) * Math.abs(lost) * 0.3;
  c.vx = vf * s + vl * co; c.vz = vf * co - vl * s;
  c.x += c.vx * dt; c.z += c.vz * dt;
  // Height. What the car is standing on is the road, or a flyover's deck and ramps when it is up on one (a car
  // at grade UNDER a deck is handed the ground by surfaceAt, so the crossing street is never scooped up onto the
  // bridge). The rule the car obeys is the one a real one does: while the surface is under it, it is glued to it
  // and it carries the surface's own vertical speed; when the road falls away from under it faster than gravity
  // can pull it down, it stays on its own trajectory for a moment and comes back down. That is what gives a
  // bridge its little hop at speed — the geometry does it, there is no scripted jump anywhere.
  // The hop is meant to be slight, and it happens in one place only: the crest, where the road stops climbing and
  // starts to fall. The body carries just a fraction of the climb up the ramp — that, and nothing else, is the
  // launch it gets — and it follows a descent in full, so it lands the hop and stays landed instead of skipping
  // down the slope. Both halves matter: without the first the crest is a trampoline, without the second the car
  // floats the whole way down a ramp. While the wheels are only just off the surface they also drag it back down.
  const G = 29, HOP = 0.18, PULL = 3.0;
  // Ground follow. The car is one rigid body on its surface, so its height comes from the surface under its nose,
  // its tail and its centre together: it rests on the higher of the centre and the mean of the two ends, and its
  // pitch is the slope between the ends. Sampling the centre alone let a nose two metres ahead sit up to 0.37 m
  // inside a ramp's slope (the ramp's grade times that distance). Flat ground and the flat deck give zero pitch.
  // The ends are F metres away, so they are judged with that reach: up a ramp the road there is higher than the car
  // itself, and a 12 m semi's uphill end used to read the street under the ramp instead (see surfaceAt).
  const F = c.box ? c.box.e1 : 2.05;
  const gyF = surfaceAt(c.x + s * F, c.z + co * F, c.y, F), gyR = surfaceAt(c.x - s * F, c.z - co * F, c.y, F);
  const gy = Math.max(surfaceAt(c.x, c.z, c.y), (gyF + gyR) / 2), wasY = c.y;
  c.surfPitch = Math.atan2(gyF - gyR, 2 * F);                   // nose up is positive
  c.vy -= G * (c.air && c.y - gy < 1.0 ? PULL : 1) * dt;
  const ny = c.y + c.vy * dt;
  if (ny <= gy + 0.02) {
    const rate = clamp((gy - wasY) / Math.max(dt, 1e-4), -30, 30);  // how fast the road itself is moving here
    c.y = gy; c.vy = rate >= 0 ? rate * HOP : rate; c.air = false;
  } else { c.y = ny; c.air = true; }
  c.vf = vf; c.vl = vl; c.speed = Math.hypot(c.vx, c.vz); c.acc = (vf - oldVf) / Math.max(dt, 1e-4);
}



export function syncCarMesh(c, dt) {
  c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.y = c.h;
  const tr = clamp(c.steer * c.speed * 0.0007 + c.vl * 0.004, -0.09, 0.09), tp = clamp(-c.acc * 0.0016, -0.05, 0.05);
  const a = 1 - Math.exp(-dt * 9); c.roll = lerp(c.roll, tr, a); c.pitch = lerp(c.pitch, tp, a);
  // A car on a slope leans with it. The pitch is the one driveCar measured from the surface under the nose and
  // the tail, so the body and the height the car drives on are the same numbers.
  // ... and while it is off the ground (the hop off a bridge) the nose follows the flight instead of the road.
  const target = c.air && c.speed > 3 ? clamp(-Math.atan2(c.vy, Math.max(6, c.speed)) * 0.7, -0.25, 0.25)
    : clamp(-(c.surfPitch || 0), -0.3, 0.3);
  c.gpitch = lerp(c.gpitch || 0, target, 1 - Math.exp(-dt * (c.air ? 4.5 : 8)));
  c.inner.rotation.z = c.roll; c.inner.rotation.x = c.pitch + c.gpitch;
  if (c.mesh.userData.mixer) c.mesh.userData.mixer.rotation.z += dt * (0.6 + Math.min(2, c.speed * 0.08));
}