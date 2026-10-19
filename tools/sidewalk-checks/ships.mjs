/* The ships on the sea round the island (js/ships.js):
   * the lanes: closed lines round the island, smooth, at their offsets off the seawall (small craft 40 and 66 m, ships
     126 and 188 m) on the sides; the band each one's hulls stay in, swept along it by its biggest vessel as the game
     places it (a rigid hull on the lane's heading, turned as far as it may turn), keeps at least ISLAND_CLEAR from the
     island and LANE_CLEAR from every other lane's, the corners and the swings out before them included;
   * the vessels: every type's sizes (length overall, beam), the height of its model over the waterline and its speed
     are within those of the real vessels of its kind (REAL, below), and its model is as long and as wide as it says;
   * the fleet: random in size and mix with each seed (small craft the most common, the navy about one in thirty),
     the same for the same seed, and drawn without Math.random (three.js's own uuids included), so nothing else
     random in the game moves;
   * the traffic, driven for many minutes with the camera going round the coast at 30, 60 and 15 frames a second:
     no two hulls ever touch (their true boxes, on their headings), none comes within ISLAND_CLEAR of the island or
     leaves its lane's band, none is out of its place where its lane bends, nothing appears or vanishes within sight
     (SIGHT_R), no vessel ever closes to the hard gap, speeds stay in range, and small craft overtake;
   * from the coast (a camera 12 m inside the seawall) two or three vessels are in sight on average, sometimes none,
     sometimes five or more; ships (not only small craft) are among them;
   * the models are built near the camera only, at most one a frame, dropped further out, the same when built again,
     cast no shadows, show their navigation lights only at night, and their window bands light up with the city's;
   * the radar draws a ship within its reach at its true length and beam where it is, and none beyond;
   * a ship passing near the player now and then sounds its horn: only while playing, only a ship (not small craft)
     within HORN_R, louder the nearer, heard d / 343 s late, never two within HORN_GAP.
   Run:  node tools/sidewalk-checks/ships.mjs      (exits non-zero on a failure) */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let checks = 0, failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures <= 40) console.log('  FAIL ' + msg); } return cond; };
const section = t => console.log('\n' + t);

// the radar's canvas: a 2D context that keeps its transform and records the paths it fills (as radar.mjs does)
function recorder() {
  let m = [1, 0, 0, 1, 0, 0], path = [];
  const stack = [], fills = [];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const apply = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const api = {
    save() { stack.push(m); }, restore() { if (stack.length) m = stack.pop(); },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; }, resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    transform(a, b, c, d, e, f) { m = mul(m, [a, b, c, d, e, f]); },
    translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); }, scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); m = mul(m, [c, s, -s, c, 0, 0]); },
    beginPath() { path = []; }, moveTo(x, y) { path.push(apply(x, y)); }, lineTo(x, y) { path.push(apply(x, y)); },
    fill() { fills.push({ pts: path.slice(), style: this.fillStyle }); },
    measureText: () => ({ width: 8 }), getLineDash: () => [],
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
  };
  const ctx = new Proxy(api, {
    get(t, k) { if (k in t) return t[k]; return typeof k === 'string' ? (t[k] = () => {}) : undefined; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, fills };
}
const R0 = recorder();
const radarCv = { width: 260, height: 260, clientWidth: 190, style: {}, getContext: () => R0.ctx };
const getEl = document.getElementById;
document.getElementById = id => (id === 'radar' ? radarCv : getEl(id));
globalThis.fetch = async url => {
  try { const txt = readFileSync(path.join(ROOT, String(url)), 'utf8'); return { ok: true, json: async () => JSON.parse(txt) }; }
  catch { return { ok: false, json: async () => null }; }
};

const S = await import('../../js/ships.js');
const { game, player } = await import('../../js/state.js');
const { sfx } = await import('../../js/audio.js');
const { env } = await import('../../js/environment.js');
const { ASSET } = await import('../../js/assets.js');
const { scene } = await import('../../js/renderer.js');
const { weatherSystem } = await import('../../js/weather.js');
const { mulberry32 } = await import('../../js/utils.js');
const THREE = await import('three');
const { LANES, BAND, SHIP_TYPES, ships } = S;
const A = 2000, ISLAND_CLEAR = 12, LANE_CLEAR = 6;

// A box's corners on the water: centre (x, z), heading h (forward (sin h, cos h)), half-length hl, half-width hw
const boxAt = (x, z, h, hl, hw) => { const s = Math.sin(h), c = Math.cos(h); return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([u, v]) => [x + u * s + v * c, z + u * c - v * s]); };
const hullBox = a => boxAt(a.x, a.z, a.h, a.L / 2, a.B / 2);
function apart(P, Q) {   // separating axis: true when the two convex quads do not overlap
  for (const poly of [P, Q]) for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4], nx = b[1] - a[1], nz = a[0] - b[0];
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
    for (const p of P) { const d = p[0] * nx + p[1] * nz; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
    for (const q of Q) { const d = q[0] * nx + q[1] * nz; q0 = Math.min(q0, d); q1 = Math.max(q1, d); }
    if (p1 < q0 || q1 < p0) return true;
  }
  return false;
}
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
function quadDist(P, Q) {
  if (!apart(P, Q)) return -1;
  let d = Infinity;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) d = Math.min(d, segDist(P[i], Q[j], Q[(j + 1) % 4]), segDist(Q[i], P[j], P[(j + 1) % 4]));
  return d;
}
const islandDist = (x, z) => (Math.abs(x) <= A && Math.abs(z) <= A) ? -1 : Math.hypot(Math.max(0, Math.abs(x) - A), Math.max(0, Math.abs(z) - A));
function quadIsland(P) {
  let d = Infinity;
  for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let k = 0; k <= n; k++) d = Math.min(d, islandDist(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)); }
  return d;
}

/* ---------------------------------------------------------------- 1. the lanes ---------------------------------------------------------------- */
section('1. the lanes');
S.resetShips(1);
{
  const want = { 'small-in': 40, 'small-out': 66, 'ship-in': 126, 'ship-out': 188 };
  for (const L of LANES) {
    // closed and even: every step LANE_DS long (the last back to the first too), the heading turning no faster than its corners
    let worst = 0, turn = 0;
    for (let i = 0; i < L.n; i++) {
      const j = (i + 1) % L.n, d = Math.hypot(L.x[j] - L.x[i], L.z[j] - L.z[i]);
      worst = Math.max(worst, Math.abs(d - L.ds));
      let dh = Math.atan2(L.tx[j], L.tz[j]) - Math.atan2(L.tx[i], L.tz[i]); dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      turn = Math.max(turn, Math.abs(dh) / L.ds);
    }
    ok(worst < 0.05 * L.ds, `${L.id}: its points are not evenly spaced (off by ${worst.toFixed(3)} m)`);
    ok(turn <= 1.02 / (L.d + L.bulge), `${L.id}: it turns tighter than its corners (radius ${(1 / turn).toFixed(0)} m < ${L.d + L.bulge} m)`);
    // on the middle of each side it is d off the coast, going its way (dir +1: the island to starboard)
    const mids = [];
    for (let i = 0; i < L.n; i += 7) { const x = L.x[i], z = L.z[i]; if (Math.min(Math.abs(x), Math.abs(z)) < 50) mids.push(i); }
    ok(mids.length >= 4, `${L.id}: no points found on the middle of the sides`);
    for (const i of mids) {
      const off = Math.max(Math.abs(L.x[i]), Math.abs(L.z[i])) - A;
      ok(Math.abs(off - L.d) < 0.5, `${L.id}: ${off.toFixed(1)} m off the coast on the middle of a side, not ${L.d}`);
      // starboard is (-tz, tx) for a heading (tx, tz)
      const toIsland = Math.abs(L.x[i]) > Math.abs(L.z[i]) ? [-Math.sign(L.x[i]), 0] : [0, -Math.sign(L.z[i])];
      ok(Math.sign(-L.tz[i] * toIsland[0] + L.tx[i] * toIsland[1]) === L.dir, `${L.id}: the island is not on the side its direction says`);
    }
    ok(want[L.id] === L.d, `${L.id}: its offset is ${L.d} m, not ${want[L.id]}`);
  }
  ok(LANES.filter(L => L.band === 'big').every(L => L.d >= 110 && L.d <= 190), 'a ship lane is not 110 to 190 m off the seawall');
  ok(LANES.filter(L => L.band === 'small').every(L => L.d >= 25 && L.d <= 90), 'a small-craft lane is not 25 to 90 m off the seawall');
  // the bands, swept along each lane by its biggest hull (rigid, on the lane's heading, as long as it may get when it turns)
  const STEP = 5;
  const rect = (L, s) => {
    const P = BAND[L.band], yaw = L.pass ? P.maxYaw : 0, p = S.laneAt(L, s, (L.lo + L.hi) / 2, {});
    return boxAt(p.x, p.z, p.h, L.maxL / 2 + L.maxB / 2 * Math.sin(yaw), (L.hi - L.lo) / 2);
  };
  const rects = LANES.map(L => { const out = []; for (let s = 0; s < L.len; s += STEP) { const q = rect(L, s); out.push({ q, x: (q[0][0] + q[2][0]) / 2, z: (q[0][1] + q[2][1]) / 2, r: Math.hypot(q[0][0] - q[2][0], q[0][1] - q[2][1]) / 2 }); } return out; });
  LANES.forEach((L, k) => {
    let d = Infinity; for (const r of rects[k]) d = Math.min(d, quadIsland(r.q));
    ok(d >= ISLAND_CLEAR, `${L.id}: its band comes ${d.toFixed(1)} m from the island (at least ${ISLAND_CLEAR})`);
    console.log(`  ${L.id.padEnd(9)} d ${String(L.d).padStart(3)} m, band ${L.lo.toFixed(1)}..${L.hi.toFixed(1)} m, ${L.list.length} vessels at start, ${(L.len / 1000).toFixed(2)} km round; island clearance ${d.toFixed(1)} m`);
  });
  for (let i = 0; i < LANES.length; i++) for (let j = i + 1; j < LANES.length; j++) {
    const G = 200, grid = new Map();
    for (const r of rects[j]) { const key = Math.floor(r.x / G) + ',' + Math.floor(r.z / G); (grid.get(key) || grid.set(key, []).get(key)).push(r); }
    let d = Infinity;
    for (const ra of rects[i]) {
      const gx = Math.floor(ra.x / G), gz = Math.floor(ra.z / G);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const rb of grid.get((gx + dx) + ',' + (gz + dz)) || []) {
        if (Math.hypot(rb.x - ra.x, rb.z - ra.z) > ra.r + rb.r + Math.min(d, 50)) continue;
        d = Math.min(d, quadDist(ra.q, rb.q));
      }
    }
    ok(d >= LANE_CLEAR, `${LANES[i].id} and ${LANES[j].id}: their bands come ${d < 0 ? 'into each other' : d.toFixed(1) + ' m apart'} (at least ${LANE_CLEAR})`);
    if (j === i + 1) console.log(`  ${LANES[i].id} / ${LANES[j].id}: least clearance ${d.toFixed(1)} m`);
  }
}

/* ---------------------------------------------------------------- 2. the vessels ---------------------------------------------------------------- */
section('2. the vessels: real sizes, heights and speeds');
// Real vessels of each kind: length overall and beam (m), the highest point over the waterline (m), service speed (knots)
const REAL = {
  sailboat: { L: [6, 25], B: [2, 7], H: [8, 35], kn: [3, 9] },          // cruising yachts; the mast about 1.3-1.5 x the length
  speedboat: { L: [4, 14], B: [1.8, 4.2], H: [1, 4], kn: [20, 45] },
  yacht: { L: [12, 60], B: [3.5, 11], H: [3, 18], kn: [12, 28] },        // motor yachts
  fishing: { L: [12, 50], B: [4, 12], H: [6, 25], kn: [7, 12] },         // trawlers
  tug: { L: [20, 40], B: [8, 14], H: [8, 20], kn: [9, 14] },             // harbour tugs
  container: { L: [140, 400], B: [22, 62], H: [30, 70], kn: [14, 24] },  // feeders to the biggest (400 m, 61.5 m beam)
  bulk: { L: [150, 330], B: [23, 58], H: [25, 50], kn: [11, 16] },       // Handysize to Capesize
  tanker: { L: [150, 340], B: [25, 60], H: [25, 50], kn: [12, 16] },     // product tankers to VLCCs
  lng: { L: [270, 300], B: [42, 50], H: [35, 60], kn: [17, 20] },        // Moss-type gas carriers
  carCarrier: { L: [170, 240], B: [30, 38], H: [30, 50], kn: [17, 21] }, // PCTCs (beam 32.26 m: the old Panamax)
  cruise: { L: [200, 365], B: [28, 50], H: [45, 75], kn: [16, 23] },
  ferry: { L: [100, 230], B: [18, 35], H: [20, 50], kn: [16, 27] },      // ro-pax
  cargo: { L: [80, 180], B: [12, 30], H: [15, 40], kn: [11, 16] },       // general cargo, with their own cranes
  supply: { L: [50, 100], B: [11, 24], H: [12, 35], kn: [11, 16] },      // offshore supply vessels
  frigate: { L: [110, 160], B: [13, 21], H: [25, 50], kn: [16, 30] },
  carrier: { L: [300, 340], B: [70, 80], H: [55, 80], kn: [16, 32] },    // supercarriers (Nimitz: 333 m, flight deck 76.8 m)
};
{
  const CAR = 4.5;   // a car's length (m), for scale
  const lineup = [];
  for (const [key, T] of Object.entries(SHIP_TYPES)) {
    const R = REAL[key];
    if (!ok(R, `${key}: no real vessels to compare with`)) continue;
    const L = LANES.find(l => l.types.includes(T));
    for (const len of [T.L[0], (T.L[0] + T.L[1]) / 2, T.L[1]]) {
      const B = T.beam(len);
      ok(len >= R.L[0] && len <= R.L[1], `${key}: ${len.toFixed(1)} m long, real ones ${R.L[0]}-${R.L[1]} m`);
      ok(B >= R.B[0] && B <= R.B[1], `${key}: ${B.toFixed(1)} m beam, real ones ${R.B[0]}-${R.B[1]} m`);
      for (const seed of [11, 222, 3333]) {
        const a = { id: 0, type: key, T, lane: L.index, L: len, B, vWant: T.speed[1], v: T.speed[1], s: 0, lat: 0, latBase: 0, latTarget: 0, yaw: 0, x: 0, z: 0, h: 0, seed, mesh: null };
        const m = S.buildMesh(a), box = new THREE.Box3();
        for (const c of m.body.children) { c.geometry.computeBoundingBox(); box.union(c.geometry.boundingBox); }
        const bl = box.max.z - box.min.z, bw = box.max.x - box.min.x, H = box.max.y;
        ok(Math.abs(bl - len) <= 0.01 * len + 0.05, `${key} ${len.toFixed(0)} m: its model is ${bl.toFixed(2)} m long`);
        ok(Math.abs(bw - B) <= 0.01 * B + 0.15, `${key} ${len.toFixed(0)} m: its model is ${bw.toFixed(2)} m wide, not ${B.toFixed(2)}`);
        ok(H >= R.H[0] && H <= R.H[1], `${key} ${len.toFixed(0)} m: its model stands ${H.toFixed(1)} m over the water, real ones ${R.H[0]}-${R.H[1]} m`);
        ok(box.min.y <= -1.5, `${key}: its hull does not reach under the water (${box.min.y.toFixed(2)} m)`);
        const tris = m.body.children.reduce((n, c) => n + c.geometry.attributes.position.count / 3, 0);
        ok(tris <= 6000, `${key}: ${tris} triangles`);
        let shadow = false; m.root.traverse(o => { if (o.castShadow) shadow = true; });
        ok(!shadow, `${key}: its model casts shadows`);
        if (seed === 11 && len === T.L[1]) lineup.push(`${key} ${len.toFixed(0)}x${B.toFixed(1)} m, ${H.toFixed(0)} m high (${(len / CAR).toFixed(0)} cars)`);
        S.dropMesh(a);
      }
    }
    const kn = T.speed.map(v => v / S.KNOT);
    ok(kn[0] >= R.kn[0] && kn[1] <= R.kn[1], `${key}: ${kn[0].toFixed(1)}-${kn[1].toFixed(1)} knots, real ones ${R.kn[0]}-${R.kn[1]}`);
  }
  console.log('  biggest of each: ' + lineup.join('; '));
  ok(SHIP_TYPES.container.L[1] / 4.5 > 60 && SHIP_TYPES.sailboat.L[0] / 4.5 < 3, 'the sizes are not to scale with a car');
}

/* ---------------------------------------------------------------- 3. the fleet ---------------------------------------------------------------- */
section('3. the fleet: random, the same for a seed, without Math.random');
const realRandom = Math.random;
Math.random = () => { throw new Error('drew Math.random'); };
{
  const sig = () => ships.map(a => `${a.lane}:${a.type}:${a.L.toFixed(3)}:${a.s.toFixed(3)}`).join('|');
  let threw = null;
  try { S.resetShips(4242); } catch (e) { threw = e; }
  ok(!threw, `resetShips drew Math.random (${threw && threw.message})`);
  const one = sig(); S.resetShips(4242);
  ok(sig() === one, 'the same seed gave another fleet');
  S.resetShips(4243);
  ok(sig() !== one, 'another seed gave the same fleet');
  const sizes = [], mix = {}; let small = 0, all = 0, navy = 0, carriers = 0, carrierLane = true;
  for (let sd = 1; sd <= 40; sd++) {
    S.resetShips(sd * 104729);
    sizes.push(ships.length);
    for (const L of LANES) ok(L.list.length >= 3, `seed ${sd}: lane ${L.id} has ${L.list.length} vessels`);
    for (const a of ships) {
      all++; mix[a.type] = (mix[a.type] || 0) + 1;
      if (a.T.band === 'small') small++;
      if (a.T.navy) navy++;
      if (a.type === 'carrier') { carriers++; if (LANES[a.lane].id !== 'ship-out') carrierLane = false; }
      ok(a.L >= a.T.L[0] && a.L <= a.T.L[1] && a.vWant >= a.T.speed[0] && a.vWant <= a.T.speed[1], `${a.type}: drawn out of its range`);
    }
  }
  ok(Math.min(...sizes) < Math.max(...sizes), 'the fleet is the same size every time');
  ok(small / all > 0.45, `small craft are ${(small / all * 100).toFixed(0)}% of the fleet`);
  ok(navy / all > 0.015 && navy / all < 0.06, `the navy is ${(navy / all * 100).toFixed(1)}% of the fleet (about one in thirty)`);
  ok(carriers / all < 0.01 && carrierLane, `the carrier: ${carriers} of ${all}, ${carrierLane ? 'in the outer ship lane' : 'out of its lane'}`);
  console.log(`  fleet of ${Math.min(...sizes)} to ${Math.max(...sizes)} vessels; small craft ${(small / all * 100).toFixed(0)}%, navy ${(navy / all * 100).toFixed(1)}% (1 in ${(all / navy).toFixed(0)}), carriers ${carriers} in ${all}`);
  console.log('  mix: ' + Object.entries(mix).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} ${(n / all * 100).toFixed(1)}%`).join(', '));
}

/* ---------------------------------------------------------------- 4. the traffic ---------------------------------------------------------------- */
section('4. the traffic, round the coast');
const camAt = s => { const t = ((s % 16000) + 16000) % 16000, side = Math.floor(t / 4000), u = t % 4000 - 2000, m = A - 12; return [[u, m], [m, -u], [-u, -m], [-m, u]][side]; };
function drive(seed, minutes, dt) {
  S.resetShips(seed);
  const st0 = { ...S.shipStats }, counts = LANES.map(L => L.list.length);
  let cs = seed * 977, fails = 0, minIsland = Infinity, maxMeshes = 0, threw = null;
  const seen = new Map(), steps = Math.round(minutes * 60 / dt);
  const bad = msg => { fails++; if (fails <= 5) ok(false, `seed ${seed} dt ${dt.toFixed(3)}: ${msg}`); };
  for (let i = 0; i < steps; i++) {
    cs += 35 * dt; if (i % Math.round(300 / dt) === 0) cs += 2500;      // now and then a jump along the coast
    const [cx, cz] = camAt(cs); player.x = cx; player.z = cz;
    const before = new Set(ships.map(a => a.id)), built = S.shipStats.built;
    try { S.updateShips(dt, cx, cz); } catch (e) { threw = e; break; }
    if (S.shipStats.built - built > 1) bad(`${S.shipStats.built - built} models built in one frame`);
    for (const a of ships) if (!before.has(a.id) && S.hullDist(a, cx, cz) < S.SIGHT_R) bad(`a ${a.type} appeared ${S.hullDist(a, cx, cz).toFixed(0)} m from the camera`);
    const now = new Set(ships.map(a => a.id));
    for (const id of before) if (!now.has(id)) { const a = seen.get(id); if (S.hullDist(a, cx, cz) < S.SIGHT_R) bad(`a ${a.type} vanished ${S.hullDist(a, cx, cz).toFixed(0)} m from the camera`); }
    for (const a of ships) seen.set(a.id, a);
    const boxes = ships.map(hullBox);
    let meshes = 0;
    for (let p = 0; p < ships.length; p++) {
      const a = ships[p], L = LANES[a.lane];
      if (!(Number.isFinite(a.x) && Number.isFinite(a.z) && a.v >= 0 && a.v <= a.vWant + 1e-9)) bad(`${a.type}: position ${a.x}, ${a.z}, speed ${a.v} of ${a.vWant}`);
      for (const q of boxes[p]) minIsland = Math.min(minIsland, islandDist(q[0], q[1]));
      const hw = a.B / 2 + a.L / 2 * Math.abs(Math.sin(a.yaw));
      if (a.lat - hw < L.lo - 1e-6 || a.lat + hw > L.hi + 1e-6) bad(`${a.type} out of its lane's band (lat ${a.lat.toFixed(2)})`);
      if (L.pass && S.straightAhead(L, a.s - a.L / 2) < a.L && Math.abs(a.lat - a.latBase) > 0.5) bad(`${a.type} out of its place (${a.lat.toFixed(1)} m) where ${L.id} bends`);
      if (a.mesh) { meshes++; if (S.hullDist(a, cx, cz) > S.DROP_R + 40) bad(`${a.type}'s model kept ${S.hullDist(a, cx, cz).toFixed(0)} m away`); if (a.mesh.root.visible && S.hullDist(a, cx, cz) > S.SHOW_R + 1) bad(`${a.type} drawn ${S.hullDist(a, cx, cz).toFixed(0)} m away`); }
      for (let q = p + 1; q < ships.length; q++) {
        const b = ships[q];
        if (Math.hypot(a.x - b.x, a.z - b.z) > (a.L + b.L + a.B + b.B) / 2) continue;
        if (!apart(boxes[p], boxes[q])) bad(`a ${a.type} and a ${b.type} touch at (${a.x.toFixed(0)}, ${a.z.toFixed(0)})`);
      }
    }
    maxMeshes = Math.max(maxMeshes, meshes);
  }
  ok(!threw, `seed ${seed}: updateShips threw (${threw && threw.message})`);
  const st = Object.fromEntries(Object.keys(st0).map(k => [k, S.shipStats[k] - st0[k]]));
  ok(minIsland >= ISLAND_CLEAR, `seed ${seed}: a hull came ${minIsland.toFixed(1)} m from the island`);
  ok(st.clamps === 0, `seed ${seed}: ${st.clamps} times a vessel closed to the hard gap`);
  ok(LANES.every((L, k) => L.list.length + L.pending === counts[k]), `seed ${seed}: a lane lost or gained vessels`);
  ok(maxMeshes <= 24, `seed ${seed}: ${maxMeshes} models at once`);
  ok(st.built - st.dropped === ships.filter(a => a.mesh).length, `seed ${seed}: models built and dropped do not add up`);
  console.log(`  seed ${seed}, ${minutes} min at ${Math.round(1 / dt)} fps: ${fails ? fails + ' FAILURES' : 'clean'}; nearest the island ${minIsland.toFixed(1)} m; ${st.passes} overtakes (${st.aborts} given up before a bend); ${st.retired} trips over and as many new; ${st.built} models built, at most ${maxMeshes} at once`);
  return st;
}
{
  let passes = 0;
  for (const [seed, min, dt] of [[1, 10, 1 / 30], [2, 10, 1 / 30], [3, 10, 1 / 30], [4, 4, 1 / 60], [5, 12, 1 / 15]]) passes += drive(seed, min, dt).passes;
  ok(passes > 50, `only ${passes} overtakes in all`);
}

/* ---------------------------------------------------------------- 5. in sight ---------------------------------------------------------------- */
section('5. how many are in sight from the coast');
{
  const pr = mulberry32(99), hist = new Array(15).fill(0);
  let sum = 0, n = 0, ships180 = 0, smallSeen = 0, bigSeen = 0;
  for (let sd = 1; sd <= 16; sd++) {
    S.resetShips(sd * 7919);
    for (let snap = 0; snap < 10; snap++) {
      for (let k = 0; k < 240; k++) S.updateShips(0.5, 0, 0);   // two minutes on between looks
      for (let v = 0; v < 60; v++) {
        const side = Math.floor(pr() * 4), u = (pr() * 2 - 1) * A, m = A - 12;
        const [cx, cz] = [[u, m], [m, -u], [-u, -m], [-m, u]][side];
        let c = 0;
        for (const a of ships) {
          const d = S.hullDist(a, cx, cz);
          if (d < 200) { c++; if (a.T.band === 'small') smallSeen++; else bigSeen++; }
          if (d < 180 && a.T.band === 'big') ships180++;
        }
        hist[Math.min(14, c)]++; sum += c; n++;
      }
    }
  }
  const mean = sum / n, p0 = hist[0] / n, p5 = hist.slice(5).reduce((x, y) => x + y) / n, max = hist.findLastIndex(x => x > 0);
  ok(mean >= 2 && mean <= 3.2, `on average ${mean.toFixed(2)} in sight (two or three)`);
  ok(p0 > 0 && p0 < 0.1, `none in sight ${(p0 * 100).toFixed(1)}% of the time`);
  ok(p5 > 0.03, `five or more in sight only ${(p5 * 100).toFixed(1)}% of the time`);
  ok(max <= 12, `${max} in sight at once`);
  ok(ships180 / n >= 0.5, `ships (not small craft) within 180 m: ${(ships180 / n).toFixed(2)} on average`);
  console.log(`  in sight (a hull within 200 m of a camera 12 m inside the seawall): ${mean.toFixed(2)} on average; none ${(p0 * 100).toFixed(1)}%, five or more ${(p5 * 100).toFixed(1)}%, at most ${max}`);
  console.log(`  ${(bigSeen / (smallSeen + bigSeen) * 100).toFixed(0)}% of them ships; ships within 180 m: ${(ships180 / n).toFixed(2)} on average`);
  console.log('  ' + hist.slice(0, 10).map((h, i) => `${i}: ${(h / n * 100).toFixed(1)}%`).join(', '));
}

/* ---------------------------------------------------------------- 6. the models ---------------------------------------------------------------- */
section('6. the models');
{
  S.resetShips(77);
  for (const a of ships) S.dropMesh(a);
  const base = scene.children.length;
  // a big ship and the camera on the coast opposite it
  const a = ships.find(x => x.T.band === 'big' && Math.abs(x.z - (A + LANES[x.lane].d)) < 1 && Math.abs(x.x) < 600) || ships.find(x => x.T.band === 'big');
  const cx = a.x, cz = Math.sign(a.z) * (A - 12);
  S.updateShips(0, cx, cz);
  ok(ships.filter(x => x.mesh).length === 1, 'more than one model built in a frame');
  for (let i = 0; i < 40; i++) S.updateShips(0, cx, cz);
  ok(a.mesh && a.mesh.root.visible, `the ${a.type} ${S.hullDist(a, cx, cz).toFixed(0)} m off the coast has no model shown`);
  for (const x of ships) if (x.mesh) ok(S.hullDist(x, cx, cz) < S.BUILD_R, `a model built ${S.hullDist(x, cx, cz).toFixed(0)} m away`);
  // the same when built again
  const sig = x => { const g = x.mesh.body.children[0].geometry; g.computeBoundingBox(); return g.attributes.position.count + ':' + g.boundingBox.max.toArray().map(v => v.toFixed(3)) + ':' + g.attributes.color.array.slice(0, 30).join(); };
  const s1 = sig(a); S.dropMesh(a); S.buildMesh(a);
  ok(sig(a) === s1, 'a model built again is not the same');
  // night lights: shown at night only, unlit and seen beyond the fog; window bands lit with the city's windows
  env.night = 1; S.updateShips(0, cx, cz);
  ok(a.mesh.glow && a.mesh.glow.visible, 'the navigation lights are not on at night');
  ok(a.mesh.glow.material.fog === false && a.mesh.glow.material.type === 'MeshBasicMaterial', 'the navigation lights are lit by the scene or hidden by the fog');
  env.night = 0; S.updateShips(0, cx, cz);
  ok(!a.mesh.glow.visible, 'the navigation lights are on by day');
  const win = a.mesh.body.children.find(c => c.material && c.material.emissiveMap);
  ok(win && ASSET.litMats.includes(win.material), 'the window bands are not among the lit materials');
  ok(a.mesh.body.children[0].material.vertexColors === true, 'the hull is not one vertex-coloured mesh');
  // the wake grows with the speed, and none when stopped
  const v0 = a.v; a.v = a.vWant; S.updateShips(0, cx, cz); const w1 = a.mesh.wake.scale.z;
  a.v = 0; S.updateShips(0, cx, cz); ok(!a.mesh.wake.visible, 'a wake behind a ship that is not moving');
  a.v = v0; ok(w1 > 0.9, 'the wake is short at full speed');
  // all dropped once the camera is far away; nothing left in the scene
  for (let i = 0; i < 5; i++) S.updateShips(0, 0, 0);
  ok(ships.every(x => !x.mesh), 'models kept with the camera far from the sea');
  ok(scene.children.length === base, `${scene.children.length - base} objects left in the scene`);
  // a new fleet takes the old one's models away
  S.updateShips(0, cx, cz); const had = scene.children.length;
  S.resetShips(78);
  ok(had > base && scene.children.length === base, 'a new fleet left the old one\'s models in the scene');
  const flow = readFileSync(path.join(ROOT, 'js/flow.js'), 'utf8'), upd = readFileSync(path.join(ROOT, 'js/update.js'), 'utf8');
  ok(/resetShips\(\)/.test(flow.slice(flow.indexOf('export function resetWorld'), flow.indexOf('export function startGame'))), 'resetWorld does not put a new fleet on the sea');
  ok(/updateShips\(sdt\)/.test(upd), 'the game does not move the ships each frame');
}

/* ---------------------------------------------------------------- 7. the radar ---------------------------------------------------------------- */
section('7. the radar');
Math.random = realRandom;
{
  const RD = await import('../../js/radar.js');
  const MD = await import('../../js/mapData.js');
  ok(await MD.mapDataReady(), 'the baked map data did not load');
  S.resetShips(91);
  const a = ships.find(x => x.T.band === 'big' && Math.abs(x.x) < 1500 && Math.abs(x.z) > A) || ships.find(x => x.T.band === 'big' && Math.abs(x.z) > A);
  Object.assign(player, { x: a.x, z: Math.sign(a.z) * (A - 30), h: 0.4, y: 0, speed: 0, vx: 0, vz: 0 });
  game.state = 'playing';
  const far = ships.find(x => Math.hypot(x.x - player.x, x.z - player.z) - x.L / 2 > 200);
  game.t = 100; R0.fills.length = 0; RD.drawRadar();
  const info = RD.radarInfo(), s = info.R / info.range;
  const expected = (x, z) => { const dx = x - player.x, dz = z - player.z, co = Math.cos(player.h), si = Math.sin(player.h); return [info.R + (-co * dx + si * dz) * s, info.R + (-si * dx - co * dz) * s]; };
  const k = info.k;
  const match = x => { const want = S.shipOutline(x, []).map(([px, pz]) => expected(px, pz)); return R0.fills.find(f => f.pts.length === want.length && f.pts.every((p, i) => Math.abs(p[0] / k - want[i][0]) < 0.05 && Math.abs(p[1] / k - want[i][1]) < 0.05)); };
  const hit = match(a);
  ok(hit, `the ${a.type} ${S.hullDist(a, player.x, player.z).toFixed(0)} m from the car is not on the radar where it is`);
  if (hit) {
    const xs = hit.pts.map(p => p[0] / k), ys = hit.pts.map(p => p[1] / k);
    const span = Math.max(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    ok(span >= a.L * s * 0.98, `the ${a.type} is drawn ${(span / s).toFixed(0)} m long, not ${a.L.toFixed(0)}`);
    ok(hit.style === (a.T.navy ? '#454e57' : '#6d7d8e'), `the ${a.type} is drawn ${hit.style}`);
  }
  ok(!far || !match(far), 'a ship beyond the radar\'s reach is drawn on it');
}

/* ---------------------------------------------------------------- 8. the horn ---------------------------------------------------------------- */
section('8. the horn');
{
  const calls = [];
  const realHorn = sfx.shipHorn, realCtx = sfx.ctx;
  sfx.ctx = {}; sfx.shipHorn = (vol, hz, delay, len, blasts) => calls.push({ vol, hz, delay, len, blasts, t: S.shipsInfo().clock });
  weatherSystem.fog = 0;
  // the menu: never
  S.resetShips(5); game.state = 'menu';
  Object.assign(player, { x: 0, z: A - 10 });
  for (let i = 0; i < 6000; i++) S.updateShips(0.1, player.x, player.z);
  ok(calls.length === 0, `${calls.length} horns while in the menu`);
  // playing on the coast: some, all from ships near enough, louder the nearer, late by the sound's way
  game.state = 'playing';
  let wrong = 0, last = -1e9, close = 0;
  for (let run = 0; run < 3; run++) {
    S.resetShips(500 + run); calls.length = 0; last = -1e9;
    for (let i = 0; i < 36000; i++) {   // an hour, walking along the north coast
      player.x = ((i * 0.6) % 3600) - 1800; player.z = A - 10;
      const n = calls.length;
      S.updateShips(0.1, player.x, player.z);
      if (calls.length > n) {
        const c = calls[calls.length - 1], d = c.delay * 343;
        const who = ships.filter(a => a.T.horn && Math.abs(S.hullDist(a, player.x, player.z) - d) < 0.5 && Math.abs(c.hz - a.T.horn[0]) <= 0.07 * a.T.horn[0]);
        const why = [];
        if (!who.length) why.push('no ship that near with that horn');
        if (d > S.HORN_R || Math.abs(c.vol - Math.pow(1 - d / S.HORN_R, 1.3)) > 1e-6) why.push(`volume ${c.vol} at ${d.toFixed(1)} m`);
        if (c.t - last < S.HORN_GAP - 1e-6) why.push(`${(c.t - last).toFixed(2)} s after the last`);
        if (why.length) { wrong++; if (wrong <= 3) console.log('  horn: ' + why.join(', ')); }
        last = c.t; close++;
      }
    }
  }
  ok(close >= 3, `only ${close} horns in three hours on the coast`);
  ok(wrong === 0, `${wrong} horns from no ship near enough, at the wrong volume, too soon after another, or at the wrong pitch`);
  ok(Object.values(SHIP_TYPES).every(T => (T.band === 'small') === !T.horn), 'a small craft sounds a horn, or a ship has none');
  console.log(`  ${close} horns in three hours walking the coast (each ship at most once a pass, never two within ${S.HORN_GAP} s)`);
  sfx.shipHorn = realHorn; sfx.ctx = realCtx;
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
