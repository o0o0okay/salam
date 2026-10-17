/* The garbage truck (js/carModels.js 'garbage', js/civilians.js, js/vehicle.js syncCarMesh):
   * the model, in each of its three liveries (green with a white cab, grey with orange trim, white with a yellow
     band): a rear-loading refuse truck inside its CAR_DIMS box, 3.6 to 4 m high; three axles (one under the cab, a
     tandem at the back) with a tyre each side; the cab in its colour at the front with its windscreen, the trim stripe
     along it, the exhaust stack behind it; the tailgate's face sloping out over the loading mouth, and the mouth open:
     seen from behind, its dark back wall stands well inside the face and the rubbish in it shows in four colours or
     more; the chevron bar under it red and white; the reflective strip down both flanks red and white; the white truck's
     yellow band down both flanks; the four amber beacons, two on the cab roof and two on the tailgate, in a light
     material each truck owns, their geometry shared; two trucks of one livery share their body geometry;
   * the beacons flash (syncCarMesh): about 1.6 flashes a second, lit for about 0.4 of each, each truck on its own
     phase; dark on a wreck; removeCar frees their material;
   * the traffic: about one civilian car in 26 is a garbage truck (CIV_KINDS).
   Run:  node tools/sidewalk-checks/garbage-truck.mjs      (exits non-zero on a failure) */
import assert from 'node:assert/strict';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const THREE = await import('three');
const C = await import('../../js/carModels.js');
const { CIV_KINDS } = await import('../../js/civilians.js');
const { createCar, syncCarMesh, removeCar } = await import('../../js/vehicle.js');

let checks = 0;
const RED = 0xd8302c, WHITE = 0xf4f4f2, BLACK = 0x141518, CHROME = 0xc9cdd2, WHEEL = 0x16171b, GLASS = 0x18222f;
const AMBER = 0xffa41f;
// the mesh of one colour, and its vertices in the truck's frame (a colour with a single piece is not merged: that mesh
// keeps its own position and turn)
const meshOf = (g, hex) => g.userData.inner.children.find(o => o.isMesh && o.material.color && o.material.color.getHex() === hex && o.material !== g.userData.beacon);
const vertsOf = m => {
  m.updateMatrix();
  const p = m.geometry.attributes.position, v = new THREE.Vector3(), out = [];
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrix); out.push([v.x, v.y, v.z]); }
  return out;
};
const count = (m, f) => vertsOf(m).filter(f).length;
const hexOf = h => '#' + h.toString(16).padStart(6, '0');
// what a ray from (x, y, z) along d hits first on the truck: its colour and where
const ray = new THREE.Raycaster();
const hit = (g, from, d) => {
  ray.set(new THREE.Vector3(...from), new THREE.Vector3(...d).normalize());
  const h = ray.intersectObjects(g.userData.inner.children, false)[0];
  return h ? { hex: h.object.material.color.getHex(), p: h.point } : null;
};
const changes = list => list.reduce((n, h, i) => n + (i > 0 && h !== list[i - 1] ? 1 : 0), 0);

// ---- the model ----
const dims = C.CAR_DIMS.garbage;
assert(dims && dims.e1 > 4.0 && dims.e1 < 4.8 && dims.e2 > 1.2 && dims.e2 < 1.4 && dims.mass >= 4, 'the garbage truck has no truck-sized CAR_DIMS box');
assert.equal(C.GARBAGE_LIVERIES.length, 3, 'the garbage truck has not got its three liveries');
checks += 2;
for (const L of C.GARBAGE_LIVERIES) {
  const g = C.buildCar('garbage', L.body, true);
  g.updateMatrixWorld(true);
  const name = `the ${hexOf(L.body)} truck`;
  // inside its box, and as high as a refuse truck
  const b = new THREE.Box3().setFromObject(g);
  assert(b.min.z >= -dims.e1 - 0.02 && b.max.z <= dims.e1 + 0.02, `${name} is longer than its box: z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)}`);
  assert(b.min.x >= -dims.e2 - 0.02 && b.max.x <= dims.e2 + 0.02, `${name} is wider than its box: x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}`);
  assert(b.max.y > 3.6 && b.max.y < 4.0, `${name} is ${b.max.y.toFixed(2)} m high, not 3.6 to 4 m`);
  // three axles, a tyre each side: the lowest points of the tyres, one per wheel
  const feet = vertsOf(meshOf(g, WHEEL)).filter(([, y]) => y < 0.03);
  const axles = [];
  for (const [x, , z] of feet) {
    let a = axles.find(a => Math.abs(a.z - z) < 0.3);
    if (!a) axles.push(a = { z, l: false, r: false });
    if (x > 0.7) a.l = true; else if (x < -0.7) a.r = true;
  }
  axles.sort((p, q) => q.z - p.z);
  assert.equal(axles.length, 3, `${name} stands on ${axles.length} axles, not 3`);
  assert(axles.every(a => a.l && a.r), `${name} has an axle without a tyre each side`);
  assert(axles[0].z > 2.4 && axles[1].z < -1 && axles[2].z < -1 && axles[1].z - axles[2].z > 1.0 && axles[1].z - axles[2].z < 1.4,
    `${name}'s axles are not one under the cab and a tandem at the back: z ${axles.map(a => a.z.toFixed(2)).join(', ')}`);
  // the cab at the front, in its colour, with its windscreen; the trim stripe along it; the exhaust stack behind it
  const cab = meshOf(g, L.cab);
  assert(cab && count(cab, ([, y, z]) => z > 4.0 && y > 2.9) > 0 && count(cab, ([, , z]) => z < 2.2) === 0, `${name}'s cab is not at the front in ${hexOf(L.cab)}`);
  assert(count(meshOf(g, GLASS), ([, y, z]) => z > 4.1 && y > 2.0 && y < 2.9) >= 4, `${name} has no windscreen`);
  const trim = meshOf(g, L.trim);
  assert(trim && count(trim, ([x, , z]) => x > 1.18 && z > 2.3) > 0 && count(trim, ([x, , z]) => x < -1.18 && z > 2.3) > 0, `${name} has no trim stripe along its cab`);
  assert(count(meshOf(g, CHROME), ([, y, z]) => z > 2.15 && z < 2.4 && y > 3.3) > 0, `${name} has no exhaust stack behind its cab`);
  // the tailgate's face slopes out over the mouth: the ray from behind meets it further forward the higher it goes
  const face = [2.0, 2.5, 3.0, 3.4].map(y => hit(g, [0, y, -8], [0, 0, 1]));
  assert(face.every(h => h && h.hex === L.body), `${name}'s tailgate face is not in its colour`);
  assert(face.every((h, i) => i === 0 || h.p.z > face[i - 1].p.z) && face[3].p.z - face[0].p.z > 0.35,
    `${name}'s tailgate face does not slope out over the mouth: z ${face.map(h => h.p.z.toFixed(2)).join(', ')}`);
  // the loading mouth is open: every ray into it from behind goes past the face, and meets rubbish or the dark back wall
  const mouth = [];
  for (const y of [1.2, 1.35, 1.5, 1.62]) for (let x = -0.8; x <= 0.81; x += 0.2) mouth.push(hit(g, [x, y, -8], [0, 0, 1]));
  assert(mouth.every(h => h && h.p.z > -4.18), `${name}'s loading mouth is closed: a ray stops at z ${Math.min(...mouth.map(h => h ? h.p.z : -99)).toFixed(2)}`);
  const back = mouth.filter(h => h.hex === BLACK);
  assert(back.length > 0 && back.every(h => h.p.z > -3.7), `${name}'s mouth has no dark back wall well inside it`);
  const junk = new Set(mouth.filter(h => h.hex !== BLACK).map(h => h.hex));
  assert(junk.size >= 4, `${name}'s mouth shows ${junk.size} colours of rubbish, not 4 or more`);
  // under it the chevron bar, red and white
  const bar = [];
  for (let x = -1.0; x <= 1.01; x += 0.1) { const h = hit(g, [x, 0.6, -8], [0, 0, 1]); if (h && h.p.z < -4.2) bar.push(h.hex); }
  assert(bar.length >= 18 && bar.every(h => h === RED || h === WHITE) && changes(bar) >= 6, `${name}'s chevron bar is not red and white: ${bar.map(hexOf).join(' ')}`);
  // the reflective strip down both flanks, red and white (a rib in the way is passed over)
  for (const sx of [1, -1]) {
    const strip = [];
    for (let z = -2.45; z <= 2.0; z += 0.115) { const h = hit(g, [sx * 3, 1.3, z], [-sx, 0, 0]); if (h && (h.hex === RED || h.hex === WHITE)) strip.push(h.hex); }
    assert(changes(strip) >= 6, `${name}'s reflective strip on its ${sx > 0 ? 'left' : 'right'} flank is not red and white`);
  }
  // the white truck's yellow band down both flanks
  if (L.band !== null) {
    const band = vertsOf(meshOf(g, L.band));
    for (const sx of [1, -1]) {
      const zs = band.filter(([x, y]) => sx * x > 1.2 && y > 1.4 && y < 1.9).map(([, , z]) => z);
      assert(zs.length && Math.max(...zs) - Math.min(...zs) > 4.5, `${name}'s band does not run down its ${sx > 0 ? 'left' : 'right'} flank`);
    }
    checks++;
  }
  // the four beacons: two on the cab roof, two on the tailgate, in a light material the truck owns
  const bm = g.userData.inner.children.find(o => o.isMesh && o.material === g.userData.beacon);
  assert(bm && g.userData.beacon === g.userData.lights.amber && g.userData.beacon.isMeshBasicMaterial && g.userData.beacon.color.getHex() === AMBER, `${name}'s beacons are not in an amber light of its own`);
  const bv = vertsOf(bm);
  for (const [where, f] of [['the cab roof', ([, y, z]) => y > 3.1 && z > 2.4], ['the tailgate', ([, y, z]) => y > 3.55 && z < -2.4]]) {
    const on = bv.filter(f);
    assert(on.some(([x]) => x > 0.5) && on.some(([x]) => x < -0.5), `${name} has not got a beacon each side on ${where}`);
  }
  checks += 15;
}
{
  // two trucks of one livery share their body and their beacons' geometry; each has its own beacon light
  const a = C.buildCar('garbage', C.GARBAGE_LIVERIES[0].body, true), b = C.buildCar('garbage', C.GARBAGE_LIVERIES[0].body, true);
  const ids = v => v.userData.inner.children.map(o => o.geometry.uuid).sort().join();
  assert.equal(ids(a), ids(b), 'two garbage trucks of one livery do not share their geometry');
  assert.notEqual(a.userData.beacon, b.userData.beacon, 'two garbage trucks share one beacon light: they would flash together');
  checks += 2;
}

// ---- the beacons flash ----
const lit = c => c.lights.amber.color.getHex() === AMBER;
const run = (c, secs, dt = 1 / 60) => { const out = []; for (let t = 0; t < secs; t += dt) { syncCarMesh(c, dt); out.push(lit(c)); } return out; };
const truck = (ph) => { const c = createCar('garbage', 0, 0, 0, {}, C.GARBAGE_LIVERIES[1].body); c.flashPh = ph; return c; };
{
  const c = truck(0), seq = run(c, 5);
  // the rate from the spacing of the flashes (the frames each one comes on), not from a count over a window
  const share = seq.filter(Boolean).length / seq.length, rises = seq.map((v, i) => (v && i > 0 && !seq[i - 1] ? i : -1)).filter(i => i >= 0);
  const flashes = rises.length > 1 ? (rises.length - 1) / ((rises[rises.length - 1] - rises[0]) / 60) : 0;
  assert(share > 0.3 && share < 0.5, `the beacons are lit ${(share * 100).toFixed(0)}% of the time, not about 40%`);
  assert(flashes > 1.3 && flashes < 1.9, `the beacons flash ${flashes.toFixed(2)} times a second, not about 1.6`);
  const d = truck(0.3), other = run(d, 5);
  assert(other.filter((v, i) => v !== seq[i]).length > seq.length * 0.2, 'two trucks on different phases flash together');
  c.wrecked = true;
  assert(run(c, 2).every(v => !v), 'a wrecked garbage truck\'s beacons still flash');
  let freed = false; const amber = c.lights.amber, dispose = amber.dispose.bind(amber);
  amber.dispose = () => { freed = true; dispose(); };
  removeCar(c); removeCar(d);
  assert(freed, 'removeCar does not free the beacons\' material');
  checks += 5;
  globalThis.__flashes = flashes;
}

// ---- the traffic ----
const share = CIV_KINDS.filter(k => k === 'garbage').length / CIV_KINDS.length;
assert(share > 1 / 40 && share < 1 / 15, `one civilian car in ${(1 / share).toFixed(0)} is a garbage truck (want about one in 26)`);
checks++;

console.log(`garbage truck: ${checks} checks PASSED (three liveries; the beacons ${globalThis.__flashes.toFixed(1)} flashes a second; one civilian car in ${(1 / share).toFixed(0)})`);
process.exit(0);
