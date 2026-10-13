/* Bakes the city map's data: for every block of the island, what the map shows of it (the buildings' footprints, the trees,
 * the water and the landmarks), written as tiles of 10 x 10 blocks into map-data/. The map (js/map.js) fetches only the
 * tiles of the part it shows, so the whole island can be on the map without generating it in the browser.
 *
 * The blocks are made by the game's own generator (js/world.js, through the test harness in tools/sidewalk-checks).
 * The generator keeps what it makes, so it runs in slices, each in its own process (one process cannot hold the island).
 * The output is generated and git-ignored. Run it again after the city generation changes:  npm run bake:map
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { execFileSync } from 'child_process';

const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const R = 25;            // the island is the blocks -25 .. 24 on each axis (js/island.js)
const TILE = 10;         // blocks per tile side
const SLICE = 5;         // block columns per process
const out = path.join(repo, 'map-data');
const parts = path.join(out, '.parts');
const r1 = v => Math.round(v * 10) / 10;

// ---- one slice: the blocks of columns cx0 .. cx0 + SLICE - 1, written to a part file ----
if (process.argv[2] === '--slice') {
  const cx0 = Number(process.argv[3]);
  const { build } = await import('../sidewalk-checks/harness.mjs');
  const G = await import(url.pathToFileURL(build()).href);
  const recs = {};
  for (let cx = cx0; cx < cx0 + SLICE; cx++) for (let cz = -R; cz < R; cz++) {
    const ch = G.generateChunk(cx, cz, true);
    if (ch.mapType === undefined) continue;            // not built: nothing to show
    recs[`${cx},${cz}`] = {
      type: ch.mapType,
      water: (ch.radarWater || []).map(w => w.map(v => (typeof v === 'number' ? r1(v) : v))),
      // a building: its corner, its size, and its roof (the same roof the map gives it from its centre)
      blds: ch.solids.filter(s => s.kind === 'building' && Math.min(s.hx, s.hz) >= 2)
        .map(s => [r1(s.x - s.hx), r1(s.z - s.hz), r1(2 * s.hx), r1(2 * s.hz), Math.abs(Math.round(s.x * 3 + s.z * 7)) % 7]),
      trees: (ch.trees || []).map(t => [r1(t.x), r1(t.z)]),
      lm: (ch.landmarks || []).map(l => [r1(l.x), r1(l.z), l.name]),
    };
  }
  fs.mkdirSync(parts, { recursive: true });
  fs.writeFileSync(path.join(parts, `slice-${cx0}.json`), JSON.stringify(recs));
  process.exit(0);
}

// ---- the parent: run every slice, then write the tiles ----
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(parts, { recursive: true });
for (let cx0 = -R; cx0 < R; cx0 += SLICE) {
  execFileSync(process.execPath, [url.fileURLToPath(import.meta.url), '--slice', String(cx0)], { stdio: 'inherit', maxBuffer: 1 << 28 });
}
const tiles = new Map();
let blocks = 0;
for (let cx0 = -R; cx0 < R; cx0 += SLICE) {
  const recs = JSON.parse(fs.readFileSync(path.join(parts, `slice-${cx0}.json`), 'utf8'));
  for (const [key, rec] of Object.entries(recs)) {
    const [cx, cz] = key.split(',').map(Number);
    const tx = Math.floor((cx + R) / TILE), tz = Math.floor((cz + R) / TILE);
    const tkey = `${tx}_${tz}`;
    if (!tiles.has(tkey)) tiles.set(tkey, {});
    tiles.get(tkey)[key] = rec;
    blocks++;
  }
}
let bytes = 0;
for (const [key, obj] of tiles) {
  const text = JSON.stringify(obj);
  bytes += text.length;
  fs.writeFileSync(path.join(out, `${key}.json`), text);
}
fs.rmSync(parts, { recursive: true, force: true });
console.log(`map-data/: ${blocks} built blocks in ${tiles.size} tiles, ${(bytes / 1048576).toFixed(2)} MB`);
