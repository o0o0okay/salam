/* Cars digest: hashes the body `buildCar()` builds for every vehicle kind and colour, so a refactor of
 * js/carModels.js can be proven to change nothing.
 *
 *   node tools/sidewalk-checks/car-digest.mjs            # check against car-digest.baseline.json
 *   node tools/sidewalk-checks/car-digest.mjs --write     # re-record the baseline (only for intended changes)
 *   node tools/sidewalk-checks/car-digest.mjs --verbose   # print every case, pass or fail
 *
 * `buildCar` never calls Math.random, so the same kind and colour always build the same tree. The digest walks
 * that tree and records, per node: its type, transform, shadow flags, userData keys, geometry (including which
 * shared geometry instance it uses) and material (colour, opacity, which shared material instance). Two things
 * make it a refactor guard rather than a screenshot:
 *
 *  * geometries and materials are identified by first-appearance order, so a wheel that stops sharing
 *    ASSET.wheelGeo and starts using a clone is caught even though it looks identical;
 *  * it covers all 26 kinds from CAR_DIMS plus unknown kinds (which must fall back to the civilian sedan) and
 *    both `detail` settings, so a branch that stops being reachable is caught too.
 *
 * The suite's other tools build cars through the same module, so this is the cheap half of the guard the
 * project review asked for before splitting the file up (see PROJECT-REVIEW.md §6).
 */
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const BASELINE = path.join(here, 'car-digest.baseline.json');
const argv = process.argv.slice(2);
const MODE = argv.includes('--write') ? 'write' : 'check';
const VERBOSE = argv.includes('--verbose');

const cm = await import('../../js/carModels.js');

const COLORS = [0xffc21a, 0xe34a4a, 0xffffff, 0x111216];   // the player's yellow, a civilian red, white, black
const r6 = v => Math.round(v * 1e6) / 1e6;

// Geometry and material instances are numbered in first-appearance order: deterministic, and it is what makes
// "still sharing the same geometry" observable.
const ids = { geo: new Map(), mat: new Map() };
const idOf = (map, o) => { if (!map.has(o)) map.set(o, map.size); return map.get(o); };

function geoKey(geo) {
  if (!geo) return 'none';
  if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
  const pos = geo.attributes && geo.attributes.position;
  return {
    id: idOf(ids.geo, geo), type: geo.type,
    params: geo.parameters ? JSON.stringify(geo.parameters) : null,
    verts: pos ? pos.count : 0,
    idx: geo.index ? geo.index.count : 0,
    bb: geo.boundingBox ? [...geo.boundingBox.min.toArray(), ...geo.boundingBox.max.toArray()].map(r6) : null,
  };
}
function matKey(m) {
  if (!m) return 'none';
  if (Array.isArray(m)) return m.map(matKey);
  return {
    id: idOf(ids.mat, m), type: m.type,
    color: m.color ? m.color.getHex() : null,
    emissive: m.emissive ? m.emissive.getHex() : null,
    opacity: m.opacity === undefined ? 1 : m.opacity,
    transparent: !!m.transparent, flat: !!m.flatShading, side: m.side,
    vertexColors: !!m.vertexColors,
  };
}
function nodeSig(o) {
  const n = {
    type: o.type, name: o.name || '', visible: o.visible,
    cast: !!o.castShadow, recv: !!o.receiveShadow, ro: o.renderOrder,
    p: [o.position.x, o.position.y, o.position.z].map(r6),
    s: [o.scale.x, o.scale.y, o.scale.z].map(r6),
    q: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].map(r6),
    ud: Object.keys(o.userData || {}).sort(), kids: o.children.length,
  };
  if (o.isMesh) { n.geo = geoKey(o.geometry); n.mat = matKey(o.material); }
  if (o.isLight) n.light = { color: o.color ? o.color.getHex() : null, intensity: r6(o.intensity || 0) };
  if (o.children.length) n.children = o.children.map(nodeSig);
  return n;
}
function caseDigest(kind, color, detail) {
  ids.geo.clear(); ids.mat.clear();
  const g = cm.buildCar(kind, color, detail);
  const lights = Object.entries((g.userData && g.userData.lights) || {})
    .map(([k, m]) => [k, m && m.color ? m.color.getHex() : null]);
  const sig = {
    kind: String(kind), color: String(color), detail,
    lights,
    hasInner: !!(g.userData && g.userData.inner),
    tree: nodeSig(g),
  };
  const json = JSON.stringify(sig);
  let meshes = 0, verts = 0;
  g.traverse(o => { if (o.isMesh) { meshes++; const p = o.geometry.attributes && o.geometry.attributes.position; verts += p ? p.count : 0; } });
  return { digest: crypto.createHash('sha256').update(json).digest('hex').slice(0, 16), meshes, verts, bytes: json.length };
}

// Every kind the game knows, plus the fall-backs an unknown one has to take.
const KINDS = Object.keys(cm.CAR_DIMS);
const EXTRA_KINDS = ['spaceship', '', null, undefined, 12345];
const cases = [];
const out = {};
let totalMeshes = 0, totalVerts = 0;
for (const kind of [...KINDS, ...EXTRA_KINDS]) {
  for (const color of COLORS) {
    for (const detail of [true, false]) {
      const key = `${String(kind)}|${color}|${detail ? 'full' : 'lod'}`;
      const r = caseDigest(kind, color, detail);
      out[key] = r.digest;
      totalMeshes += r.meshes; totalVerts += r.verts;
      cases.push({ key, ...r });
    }
  }
}
const total = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 16);
const result = { note: 'sha256 (16 hex) of the car tree; see tools/sidewalk-checks/car-digest.mjs', total, meshes: totalMeshes, verts: totalVerts, cases: out };

if (VERBOSE) for (const c of cases) console.log(`  . ${c.key.padEnd(28)} ${c.digest}  ${String(c.meshes).padStart(3)} meshes  ${String(c.verts).padStart(6)} verts`);
console.log(`car digest: ${KINDS.length} kinds + ${EXTRA_KINDS.length} unknown, ${COLORS.length} colours, detail on/off -> ${cases.length} cases`);
console.log(`  total ${total}   ${totalMeshes} meshes   ${totalVerts} vertices`);

if (MODE === 'write') {
  fs.writeFileSync(BASELINE, JSON.stringify(result, null, 1) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), BASELINE)}`);
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) {
  console.log(`no baseline at ${path.relative(process.cwd(), BASELINE)} — run with --write to record one`);
  process.exit(1);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
let bad = 0;
for (const c of cases) {
  if (base.cases[c.key] === c.digest) continue;
  bad++;
  console.log(`  x ${c.key}: ${base.cases[c.key] || '(absent)'} -> ${c.digest}  (${c.meshes} meshes / ${c.verts} verts)`);
}
for (const key of Object.keys(base.cases)) if (!(key in out)) { bad++; console.log(`  x ${key}: case no longer built`); }
if (bad) { console.log(`${bad} CASE(S) CHANGED — if that was not intended, the refactor is not a no-op`); process.exit(1); }
console.log(`PASS: all ${cases.length} cases match the baseline (total ${total}, meshes ${totalMeshes}, verts ${totalVerts})`);
