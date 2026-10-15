/* The map's data: what the car has seen of each block (`seen`), the blocks baked ahead of time (`baked`, from
   map-data/, written by tools/map-data/bake.mjs), and the tile loading. js/map.js only draws from these. */
import { ck } from './utils.js';
import { chunks } from './chunkState.js';

const seen = new Map();                    // chunk key -> { type, water, blds, trees, lm } for chunks the car has been near
const baked = new Map();                   // chunk key -> the same, for every block of the island (tiles of map-data/, see tools/map-data)

// the roof colour of a building, from where it stands (the same colour every time it is drawn)
const roofOf = (x, z) => Math.abs(Math.round(x * 3 + z * 7)) % 7;

// The island's blocks, baked ahead of time (tools/map-data/bake.mjs) in tiles of 10 x 10 blocks. The tile of a part on
// screen is fetched the first time it is shown, so scrolling the map loads it. A block the car has been near is used as
// the game made it (seen); any other block is the baked one.
export function known(key) { return seen.get(key) || baked.get(key); }
export function* allKnown() {
  for (const v of seen.values()) yield v;
  for (const [key, v] of baked) if (!seen.has(key)) yield v;
}
// The baked tiles (map-data/, written by tools/map-data/bake.mjs with an index.json that lists them). They are loaded once,
// in the background, when the game starts, so opening the map (M) does not wait for them and does not ask for a tile that
// is not there. Without the index (no map-data/ here), nothing is asked for beyond the index itself, and the map shows what
// the car has seen.
let preloadP = null;
let mapDataOk = false;   // true when the index lists at least one tile
function preloadMap() {
  if (preloadP) return preloadP;
  preloadP = fetch('map-data/index.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => {
    const names = j && Array.isArray(j.tiles) ? j.tiles : [];
    mapDataOk = names.length > 0;
    return Promise.all(names.map(name => fetch(`map-data/${name}.json`).then(r => (r.ok ? r.json() : null)).then(t => {
      if (!t) return;
      for (const [key, rec] of Object.entries(t)) {
        const [cx, cz] = key.split(',').map(Number);
        baked.set(ck(cx, cz), rec);
      }
    }).catch(() => {})));
  }).catch(() => {});
  return preloadP;
}
if (typeof window !== 'undefined') preloadMap();
// Resolves to true when the baked map data is there (npm run bake:map); the game asks this once it starts.
export function mapDataReady() { return preloadMap().then(() => mapDataOk); }

export function learn() {
  for (const [key, ch] of chunks) {
    if (ch.mapType !== undefined && !seen.has(key)) {
      // the real buildings of the block (its solids of kind 'building'; thin walls and banks are not buildings), and its trees
      const blds = ch.solids.filter(so => so.kind === 'building' && Math.min(so.hx, so.hz) >= 2)
        .map(so => [so.x - so.hx, so.z - so.hz, 2 * so.hx, 2 * so.hz, roofOf(so.x, so.z)]);
      const trees = (ch.trees || []).map(t => [t.x, t.z]);
      const lm = (ch.landmarks || []).map(l => [l.x, l.z, l.name]);
      const hp = ch.heli ? [[ch.heli.padX, ch.heli.padZ, ch.heli.padR]] : [];
      seen.set(key, { type: ch.mapType, water: ch.radarWater || [], blds, trees, lm, hp });
    }
  }
}

// The map remembers the blocks as the car drives past them, not only while the map is open (so a route driven
// through a block is on the map afterwards).
setInterval(learn, 500);

// a new game forgets the parts of the city the car had seen
export function forgetSeen() { seen.clear(); }
