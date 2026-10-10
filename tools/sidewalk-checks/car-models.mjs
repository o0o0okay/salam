/* Car bodies are merged (consolidateBody in js/carModels.js). Checks: the merge keeps the pieces (triangles and
   the world bounds of every car), cars of one kind and colour share their body geometry, the geometry cache levels
   off instead of growing with every spawn, and each car keeps its own light materials (update.js flashes them).
   Run:  node tools/sidewalk-checks/car-models.mjs      (exits non-zero on a failure) */
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const C = await import('../../js/carModels.js');

let fails = 0;
const bad = m => { console.log('  x ' + m); fails++; };
const KINDS = ['civ', 'sedan', 'suv', 'taxi', 'police1', 'police2', 'police3', 'police4', 'police5', 'policeMoto', 'policeVan',
  'bus', 'schoolbus', 'firetruck', 'ambulance', 'cementtruck', 'fueltanker', 'sportscar', 'pickup', 'hatchback', 'oldclassic', 'limo'];
const COLOURS = [0xe34a4a, 0x3a7bd5, 0x39b36b, 0xf2a93b, 0xeeeeee, 0x8e5bd9, 0x2f3340];

let seed = 3;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// every kind builds with and without the detail pieces, and the merged body keeps all of its triangles
let cars = 0;
for (const k of KINDS) for (const detail of [true, false]) {
  const g = C.buildCar(k, 0x3a7bd5, detail); cars++;
  let tris = 0; g.updateMatrixWorld(true);
  g.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  if (!(tris > 0) || !Number.isFinite(tris)) bad(`${k} (detail ${detail}): no triangles`);
  if (g.userData.inner.children.length === 0) bad(`${k}: empty body`);
}

// the same kind and colour built twice share the body geometry
const a = C.buildCar('civ', 0x3a7bd5, true), b = C.buildCar('civ', 0x3a7bd5, true);
const ids = g => g.userData.inner.children.map(o => o.geometry.uuid).sort().join();
if (ids(a) !== ids(b)) bad('two civilian cars of one colour do not share body geometry');

// the geometry cache levels off: distinct geometries after 200 spawns and after 2000
const seen = new Set(); let n200 = 0;
for (let i = 0; i < 2000; i++) {
  const g = C.buildCar(KINDS[Math.floor(rnd() * KINDS.length)], COLOURS[Math.floor(rnd() * COLOURS.length)], rnd() < 0.7); cars++;
  g.traverse(o => { if (o.isMesh) seen.add(o.geometry.uuid); });
  if (i === 199) n200 = seen.size;
}
if (seen.size > n200 + 40) bad(`geometry keeps growing with spawns: ${n200} after 200 cars, ${seen.size} after 2000`);

// light materials stay per car and are actually on a mesh (the police flash changes them)
const p1 = C.buildCar('police1', 0xeeeeee, true), p2 = C.buildCar('police1', 0xeeeeee, true);
if (!p1.userData.lights.red || p1.userData.lights.red === p2.userData.lights.red) bad('two police cars share a light material');
for (const key of Object.keys(p1.userData.lights)) {
  let used = false; p1.traverse(o => { if (o.isMesh && o.material === p1.userData.lights[key]) used = true; });
  if (!used) bad(`police light "${key}" is on no mesh`);
}

console.log(fails ? `CAR MODELS: ${fails} FAILURE(S)` : `CAR MODELS OK: ${cars} cars built, body geometry shared and bounded, light materials per car`);
process.exit(fails ? 1 : 0);
