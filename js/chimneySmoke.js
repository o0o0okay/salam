/* Smoke from factory chimneys: a dedicated pool of dark grey puffs, kept apart from the shared particle pool so a
   steady plume can never crowd out a crash, a fire or an explosion. Each plant's stacks are listed on its chunk
   (`ch.stacks`, filled by buildFactoryMesh in js/campus.js). Every stack in the streamed chunks puffs out at a steady
   rate; the puffs rise, drift with the wind, spread, and fade out. Plain geometry only: low-poly puffs with flat
   shading, like the rest of the scene. */
import * as THREE from 'three';
import { scene } from './renderer.js';
import { nearChunks } from './world.js';
import { rnd } from './utils.js';

const MAXP = 340;                       // puffs alive at once (a plume lives about 11 s, so this holds about eight stacks)
const EMIT_EVERY = 0.42;                // seconds between puffs from one stack
const RANGE = 220;                      // stacks further than this are not fed
const WIND_X = 2.0, WIND_Z = 0.7;       // a steady breeze, metres per second
const geo = new THREE.IcosahedronGeometry(1, 0);
const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false });
export const smokeMesh = new THREE.InstancedMesh(geo, mat, MAXP);
smokeMesh.frustumCulled = false;
smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(smokeMesh);

const puffs = [], dummy = new THREE.Object3D(), col = new THREE.Color();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAXP; i++) {
  puffs.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, vis: false });
  smokeMesh.setColorAt(i, col.setHex(0x888888)); smokeMesh.setMatrixAt(i, zero);
}
let next = 0;

// Takes the next pool slot (oldest first, so a full pool recycles the oldest puff) and starts a puff at the stack top.
function spawn(st) {
  const i = next; next = (i + 1) % MAXP;
  const p = puffs[i];
  p.x = st.x + rnd(-0.7, 0.7); p.y = st.top + rnd(0, 0.8); p.z = st.z + rnd(-0.7, 0.7);
  p.vx = rnd(-0.3, 0.3); p.vy = rnd(1.4, 2.2); p.vz = rnd(-0.3, 0.3);
  p.life = p.max = rnd(9, 12);
  p.s0 = rnd(2.4, 3.4) * (st.r / 1.9 + 0.4);
  const g = rnd(0.2, 0.52);                             // dark grey to mid grey, as in the reference plumes
  smokeMesh.setColorAt(i, col.setRGB(g, g, g * 1.02));
  p.vis = true;
}

// Called once a frame with the player's position. Stacks in the streamed chunks emit; every live puff moves.
export function updateChunkSmoke(dt, px, pz) {
  for (const ch of nearChunks(px, pz)) {
    if (!ch.stacks) continue;
    for (const st of ch.stacks) {
      const dx = st.x - px, dz = st.z - pz;
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      st.smokeT = (st.smokeT === undefined ? rnd(0, EMIT_EVERY) : st.smokeT) - dt;
      while (st.smokeT <= 0) { st.smokeT += EMIT_EVERY * rnd(0.8, 1.2); spawn(st); }
    }
  }
  for (let i = 0; i < MAXP; i++) {
    const p = puffs[i];
    if (p.life <= 0) { if (p.vis) { smokeMesh.setMatrixAt(i, zero); p.vis = false; } continue; }
    p.life -= dt;
    const t = 1 - Math.max(0, p.life) / p.max;           // 0 at birth, 1 when gone
    const damp = Math.exp(-0.25 * dt);
    p.vy *= damp; p.vx *= damp; p.vz *= damp;
    p.x += (p.vx + WIND_X) * dt; p.y += p.vy * dt; p.z += (p.vz + WIND_Z) * dt;
    const s = p.s0 * (0.6 + 2.4 * t) * Math.min(1, (1 - t) * 3.5);   // spreads as it rises, then shrinks away
    dummy.position.set(p.x, p.y, p.z); dummy.scale.setScalar(Math.max(0.01, s));
    dummy.rotation.set(t * 1.5, t * 1.1, 0); dummy.updateMatrix();
    smokeMesh.setMatrixAt(i, dummy.matrix);
  }
  smokeMesh.instanceMatrix.needsUpdate = true;
  if (smokeMesh.instanceColor) smokeMesh.instanceColor.needsUpdate = true;
}
