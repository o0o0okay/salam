/* The ships: the traffic on the sea round the island.
 *
 * Vessels of real types, at their real sizes, sail round the island in four lanes: two close in for small craft and
 * two further out for ships. In each pair one lane runs one way and the other the other way. Each vessel keeps to
 * its own starboard side, the rule of the road at sea, so the lane with the island to starboard is the inner one.
 * They are only ever seen from the coast through the haze (the fog ends at 215 m by day), so the lanes run closer
 * in than real shipping lanes would: small craft 40 and 66 m off the seawall, ships 126 and 188 m off it.
 *   * Sizes (L, the length overall, and B, the beam) and speeds are drawn from each type's real range (SHIP_TYPES):
 *     a sailing yacht of 9 to 18 m at 5 to 8 knots, a container ship of 200 to 300 m at 16 to 21 knots, and so on.
 *     For scale, a car is about 4.5 m long and a block is 80 m, so a 300 m ship is nearly four blocks long.
 *   * How many there are is random: each lane is filled at the start of a run with random gaps of open sea (gap,
 *     kilometres of it). The sea is kept quiet: about a dozen vessels round the whole island (a tenth of the first,
 *     busier fill), about half of them small craft and most of the rest merchant ships; a lane may have only one.
 *     From a point on the coast nothing is in sight most of the time: about one look in four finds a vessel, and
 *     two at once are rare. The navy is rare: about one vessel in thirty is a grey frigate, and very rarely the
 *     333 m carrier comes by.
 *   * The lanes never come near each other, at the corners either. A lane is a fixed line round the island at its
 *     offset, with a quarter circle at each corner. The ship lanes swing out before the corners (bulge, over the last T
 *     metres of each side), so a 300 m hull turning there stays clear of the next lane out. Every hull stays inside its
 *     lane's band (lo..hi across the line, turns included), and no two bands meet (tools/sidewalk-checks/ships.mjs).
 *     Inside a lane a vessel keeps its distance behind a slower one. Small craft overtake, on the side away from the
 *     other lane (pass), and only on the straight with room to spare before a bend; ships only follow. None closes to
 *     less than the hard gap (BAND.hardMin), or moves sideways into another vessel.
 *   * A vessel sails a trip of a few kilometres. Once the trip is over and the vessel is out of sight (SIGHT_R from
 *     the camera and the player), it is taken away, and a new one is put into the same lane at a random place that
 *     is also out of sight, with room around it. So nothing appears or vanishes in view, and the traffic changes.
 *   * The fleet has its own random stream (mulberry32), seeded at each reset. It never draws Math.random (three.js's
 *     uuids for the models included, see ownRandom), so the city, the traffic and everything else random in the game
 *     are the same with or without the ships.
 *   * A vessel's model is built only near the camera, at most one a frame, nearest first (BUILD_R), and thrown away
 *     further out (DROP_R). It is built from its own seed, so a rebuilt model is the same. The plain parts of a model
 *     are one geometry with vertex colours. Window bands use one lit material (ASSET.litMats, lit at night), and the
 *     navigation lights one unlit geometry: red to port, green to starboard, white at the masthead and the stern,
 *     shown at night and seen beyond the fog (past the fog nothing else of a vessel is drawn). Models cast no shadows.
 *     A vessel rocks on the swell (small craft more), leaves a wake that grows with its speed, and shows a bow wave.
 *   * A ship passing near the player now and then sounds its horn (sfx.shipHorn), louder the closer it is, and
 *     heard a little late (sound takes d / 343 s to arrive). Horns are more frequent in fog.
 *   * The radar draws every vessel within its range at its true length and beam (shipOutline, js/radar.js).
 * The vessels are only seen: cars do not collide with them, and they keep out of the seawall's way on their own.
 */
import * as THREE from 'three';
import { PI, clamp, lerp, mulberry32 } from './utils.js';
import { ISLAND_MAX } from './island.js';
import { scene, camera } from './renderer.js';
import { ASSET } from './assets.js';
import { env } from './environment.js';
import { game, player } from './state.js';
import { sfx } from './audio.js';
import { weatherSystem } from './weather.js';

const A = ISLAND_MAX;                    // the coast line: the seawall's outer face on every side (js/island.js)
export const SEA_Y = -0.3;               // the sea's surface (ensureSea, js/world.js): the waterline of every vessel
export const KNOT = 1852 / 3600;         // m/s
const LANE_DS = 2;                       // metres between the stored points of a lane's line
export const SIGHT_R = 450;              // a vessel this far (its nearest point) from the camera and the player is out of sight
export const BUILD_R = 560, DROP_R = 760, SHOW_R = 410;   // build its model inside, drop it outside, draw it inside
export const HORN_R = 280, HORN_GAP = 40; // a ship this near the player may sound its horn; never two within HORN_GAP s

/* ---------------------------------------------------------------- lanes ---------------------------------------------------------------- */

// band: which vessels sail it. d: its offset from the coast along the sides (m). bulge, T: how far it swings out
// before each corner, and over how many metres. dir +1: the island on its starboard side (the inner lane of a
// pair); -1: the island to port. pass: the side it overtakes on (-1 towards the coast, +1 out to sea, 0 never).
// jitter: each vessel keeps its own place within ±jitter m of the lane's line. gap: the mean clear water between
// vessels when the lane is filled, over the distance they keep (m). It is kilometres, so a lane of 16 to 18 km
// holds about three, sometimes only one. trip: how far a vessel sails (m) before it leaves.
export const LANES = [
  { id: 'small-in', band: 'small', d: 40, bulge: 0, T: 0, dir: 1, pass: -1, jitter: 0, gap: 8000, trip: [2500, 6000] },
  { id: 'small-out', band: 'small', d: 66, bulge: 0, T: 0, dir: -1, pass: 1, jitter: 0, gap: 8000, trip: [2500, 6000] },
  { id: 'ship-in', band: 'big', d: 126, bulge: 40, T: 800, dir: 1, pass: 0, jitter: 0, gap: 7500, trip: [3000, 9000] },
  { id: 'ship-out', band: 'big', d: 188, bulge: 100, T: 1200, dir: -1, pass: 0, jitter: 0, gap: 7500, trip: [3000, 9000] },
];
// How each band's vessels keep their distance: the gap they keep behind another (gapMin + gapL·L + headway·v, m),
// the gap they never close below (hardMin), how far ahead they look, the clear water kept at the side (latClear),
// how fast they speed up and slow down (m/s²), and how they move sideways (latK /s, at most latRate m/s, and
// turning at most maxYaw rad off the lane's line while they do). Small craft overtake (passGap, passDv, passBack,
// backGap: when they pull out and when they come back in) only on the straight, with passMargin m to spare before
// a bend: on a bend a long hull swings out of its place, so two side by side there could touch. Ships only follow.
export const BAND = {
  small: { gapMin: 25, gapL: 1.5, headway: 4, hardMin: 12, look: 500, latClear: 2.5, followK: 0.12, acc: 0.6, dec: 1.0,
    latK: 0.5, latRate: 2.5, latMin: 0.8, maxYaw: 0.12, yawK: 2.0, passGap: 70, passDv: 0.6, passBack: 90, backGap: 90, passMargin: 250 },
  big: { gapMin: 80, gapL: 0.6, headway: 8, hardMin: 60, look: 1600, latClear: 6, followK: 0.02, acc: 0.04, dec: 0.12,
    latK: 0.02, latRate: 0.6, latMin: 0, maxYaw: 0.03, yawK: 0.5 },
};

const smoothRamp = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// a lane's offset from the coast at u metres along a side (u from -A to A)
export function laneOffset(L, u) {
  if (!L.bulge) return L.d;
  return L.d + L.bulge * smoothRamp((Math.abs(u) - (A - L.T)) / L.T);
}
// The lane's line: round the island with the angle growing (seen on the x-z plane): along the north side towards -x,
// round the corner, down the west side, and so on. It is stored at even steps of LANE_DS along its length, with its
// heading and its outward normal at each. A lane with dir -1 is the same line the other way round.
function buildLane(L) {
  const raw = [], R = L.d + L.bulge, step = 2;
  const side = f => { for (let u = A; u > -A + 1e-6; u -= step) raw.push(f(u)); };
  const arc = (cx, cz, a0) => {
    const n = Math.max(8, Math.ceil(R * PI / 2 / step));
    for (let i = 0; i < n; i++) { const a = a0 + PI / 2 * i / n; raw.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]); }
  };
  side(u => [u, A + laneOffset(L, u)]);   arc(-A, A, PI / 2);
  side(u => [-A - laneOffset(L, u), u]);  arc(-A, -A, PI);
  side(u => [-u, -A - laneOffset(L, u)]); arc(A, -A, 1.5 * PI);
  side(u => [A + laneOffset(L, u), -u]);  arc(A, A, 0);
  let total = 0; const cum = [0];
  for (let i = 0; i < raw.length; i++) { const p = raw[i], q = raw[(i + 1) % raw.length]; total += Math.hypot(q[0] - p[0], q[1] - p[1]); cum.push(total); }
  const n = Math.round(total / LANE_DS), ds = total / n;
  const x = new Float64Array(n), z = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const s = i * ds;
    while (cum[j + 1] < s) j++;
    const p = raw[j], q = raw[(j + 1) % raw.length], f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    x[i] = p[0] + (q[0] - p[0]) * f; z[i] = p[1] + (q[1] - p[1]) * f;
  }
  if (L.dir < 0) { x.reverse(); z.reverse(); }
  const tx = new Float64Array(n), tz = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n, dx = x[b] - x[a], dz = z[b] - z[a], m = Math.hypot(dx, dz) || 1;
    tx[i] = dx / m; tz[i] = dz / m;
    // outward: on the left of the line for dir +1, on its right for dir -1
    nx[i] = L.dir * tz[i]; nz[i] = -L.dir * tx[i];
  }
  Object.assign(L, { n, ds, len: total, x, z, tx, tz, nx, nz, list: [], pending: 0, index: LANES.indexOf(L) });
}
for (const L of LANES) buildLane(L);

// The point `lat` metres out from the lane's line at `s` metres along it (out.x, out.z), and the lane's heading there (out.h)
export function laneAt(L, s, lat, out = {}) {
  let f = (s % L.len + L.len) % L.len / L.ds, i = Math.floor(f);
  if (i >= L.n) { i = 0; f = 0; }
  const j = (i + 1) % L.n, k = f - i;
  const px = L.x[i] + (L.x[j] - L.x[i]) * k, pz = L.z[i] + (L.z[j] - L.z[i]) * k;
  const nx = L.nx[i] + (L.nx[j] - L.nx[i]) * k, nz = L.nz[i] + (L.nz[j] - L.nz[i]) * k;
  out.x = px + nx * lat; out.z = pz + nz * lat;
  out.h = Math.atan2(L.tx[i] + (L.tx[j] - L.tx[i]) * k, L.tz[i] + (L.tz[j] - L.tz[i]) * k);
  return out;
}

/* ---------------------------------------------------------------- types ---------------------------------------------------------------- */

const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const C = { white: 0xf2f3ef, glass: 0x1f2b38, steel: 0xd6d8d4, black: 0x24262a, deck: 0x585c60 };
const HULL_COLS = [0x1f3550, 0x24262a, 0x6e1f1f, 0x2a5c8f, 0x2d5a3f, 0x5f666c, 0x1f6f78, 0x5a3b2a, 0xa8322a];
const BOOT_COLS = [0x9a2b25, 0x9a2b25, 0x8a2624, 0x24262a];
const FUNNEL_COLS = [0x24262a, 0xf2f3ef, 0xc8282a, 0x1f3550, 0xe8b830, 0x2a6fb2, 0xd8642a];
const BAND_COLS = [0xc8282a, 0x2a6fb2, 0xf2f3ef, 0xe8b830, 0x2d8a4f, 0x24262a];
const BOX_COLS = [0xb5312a, 0x2f5e9e, 0x3c7d46, 0xd2a33a, 0x7c7f83, 0xe0e0dc, 0x8a4a2b, 0x2c8a8a, 0xd96b2b, 0x5b3d7a, 0x9e2b3c, 0x2b4f6e];

// band: the lanes it sails. weight: how common it is in them. L, beam(L): its length overall and its beam in metres
// (the beam is the widest part of the vessel: for the carrier, its flight deck). speed: m/s. horn: its pitch (Hz)
// and how long one blast lasts (s); small craft do not sound. navy: drawn darker on the radar. lanes: only these lanes.
export const SHIP_TYPES = {
  sailboat: { band: 'small', weight: 22, L: [9, 18], beam: L => 0.31 * L, speed: [2.5, 4], build: buildSailboat },
  speedboat: { band: 'small', weight: 14, L: [6, 12], beam: L => 0.34 * L, speed: [13, 19], build: buildSpeedboat },
  yacht: { band: 'small', weight: 22, L: [15, 45], beam: L => Math.max(4, 0.23 * L), speed: [7.5, 12.5], build: buildYacht },
  fishing: { band: 'small', weight: 18, L: [18, 40], beam: L => 0.27 * L, speed: [4, 5.5], build: buildFishing },
  tug: { band: 'small', weight: 10, L: [25, 35], beam: L => 0.36 * L, speed: [5, 6.5], build: buildTug },
  container: { band: 'big', weight: 16, L: [200, 300], beam: L => clamp(0.155 * L, 32.2, 48.2), speed: [8, 11], horn: [78, 2.6], build: buildContainer },
  bulk: { band: 'big', weight: 12, L: [180, 260], beam: L => clamp(0.165 * L, 30, 45), speed: [6, 7.5], horn: [82, 2.4], build: buildBulk },
  tanker: { band: 'big', weight: 12, L: [180, 250], beam: L => clamp(0.18 * L, 32, 46), speed: [6.5, 7.5], horn: [74, 2.6], build: buildTanker },
  lng: { band: 'big', weight: 6, L: [280, 295], beam: L => 46 + (L - 280) / 15 * 3, speed: [9, 10], horn: [80, 2.6], build: buildLng },
  carCarrier: { band: 'big', weight: 7, L: [180, 200], beam: () => 32.26, speed: [9, 10], horn: [96, 2.2], build: buildCarCarrier },
  cruise: { band: 'big', weight: 6, L: [250, 330], beam: L => clamp(0.12 * L, 32.2, 41), speed: [9, 11], horn: [88, 3.0], build: buildCruise },
  ferry: { band: 'big', weight: 9, L: [120, 200], beam: L => clamp(0.16 * L, 20, 31), speed: [9, 12], horn: [118, 2.0], build: buildFerry },
  cargo: { band: 'big', weight: 9, L: [100, 160], beam: L => 0.16 * L, speed: [6, 7.5], horn: [126, 2.0], build: buildCargo },
  supply: { band: 'big', weight: 6, L: [60, 90], beam: L => 0.22 * L, speed: [6, 7], horn: [168, 1.6], build: buildSupply },
  frigate: { band: 'big', weight: 6, L: [120, 150], beam: L => 0.125 * L, speed: [9, 13], horn: [150, 1.8], navy: true, build: buildFrigate },
  carrier: { band: 'big', weight: 0.6, L: [320, 333], beam: () => 76.8, speed: [10, 13], horn: [70, 3.0], navy: true, lanes: ['ship-out'], latFix: 14, build: buildCarrier },
};
for (const [k, T] of Object.entries(SHIP_TYPES)) T.key = k;
// the biggest vessel each lane can carry (the clearance between the lanes is worked out for it; see the checks)
for (const L of LANES) {
  const types = Object.values(SHIP_TYPES).filter(T => T.band === L.band && (!T.lanes || T.lanes.includes(L.id)));
  L.types = types; L.weight = types.reduce((s, T) => s + T.weight, 0);
  L.maxL = Math.max(...types.map(T => T.L[1]));
  L.maxB = Math.max(...types.map(T => Math.max(T.beam(T.L[0]), T.beam(T.L[1]))));
  // the furthest a vessel pulls out of its place to overtake (round one in its place, never round one overtaking)
  L.passMax = L.pass ? L.maxB + BAND[L.band].latClear + 2.5 : 0;
  // The lane's band: across its line, from lo to hi (m, outward +), the strip every hull in it stays inside, its place,
  // its overtaking and its turning while it moves across included. The bands of two lanes never meet (see the checks).
  L.lo = Infinity; L.hi = -Infinity;
  for (const T of types) {
    const hb = Math.max(T.beam(T.L[0]), T.beam(T.L[1])) / 2, b0 = T.latFix ?? -L.jitter, b1 = T.latFix ?? L.jitter;
    L.lo = Math.min(L.lo, b0 - (L.pass < 0 ? L.passMax : 0) - hb - 0.5);
    L.hi = Math.max(L.hi, b1 + (L.pass > 0 ? L.passMax : 0) + hb + 0.5);
  }
  // How far the line runs straight on from each of its points (m). A point counts as on a bend where the lane's longest
  // hull would stand more than 1 m off the line at its ends (curvature over 8 / L²).
  const kap0 = 8 / (L.maxL * L.maxL), n = L.n, curved = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    let dh = Math.atan2(L.tx[b], L.tz[b]) - Math.atan2(L.tx[a], L.tz[a]);
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    curved[i] = Math.abs(dh) / (2 * L.ds) > kap0 ? 1 : 0;
  }
  L.straight = new Float32Array(n);
  for (let k = 2 * n - 1, run = 0; k >= 0; k--) { const i = k % n; run = curved[i] ? 0 : run + L.ds; L.straight[i] = run; }
}
// how far the lane runs straight on from s
export function straightAhead(L, s) { return L.straight[Math.floor(((s % L.len) + L.len) % L.len / L.ds) % L.n]; }

/* ---------------------------------------------------------------- the fleet ---------------------------------------------------------------- */

export const ships = [];
export const shipStats = { built: 0, dropped: 0, spawned: 0, retired: 0, clamps: 0, passes: 0, aborts: 0, horns: 0 };
let rng = mulberry32(1), nextId = 0, clock = 0, hornT = 0;
const _p = {};

function pickType(L) {
  let w = rng() * L.weight;
  for (const T of L.types) { w -= T.weight; if (w < 0) return T; }
  return L.types[L.types.length - 1];
}
function makeShip(L) {
  const T = pickType(L);
  const len = lerp(T.L[0], T.L[1], rng()), vWant = lerp(T.speed[0], T.speed[1], rng());
  const latBase = T.latFix ?? (rng() * 2 - 1) * L.jitter;
  const small = T.band === 'small';
  return {
    id: ++nextId, type: T.key, T, lane: L.index, L: len, B: T.beam(len), vWant, v: vWant,
    s: 0, lat: latBase, latBase, latTarget: latBase, passing: false, abort: false, yaw: 0, lead: null,
    trip: lerp(L.trip[0], L.trip[1], rng()), seed: (rng() * 4294967296) >>> 0,
    x: 0, z: 0, h: 0, viewD: Infinity, mesh: null, hornReady: true,
    // the swell: a small craft rolls and pitches more, and quicker
    ph: rng() * PI * 2, bobW: small ? lerp(1.3, 2.0, rng()) : lerp(0.45, 0.6, rng()),
    rollA: small ? clamp(0.5 / len, 0.012, 0.05) : clamp(1.2 / len, 0.0015, 0.01),
    pitchA: small ? clamp(0.25 / len, 0.006, 0.025) : clamp(0.5 / len, 0.0008, 0.004),
    heaveA: small ? clamp(2.4 / len, 0.06, 0.22) : 0.12, heel: 0, pitch0: 0,
  };
}
// the desired clear water ahead of `a` (at its speed now, or at speed v)
const wantGap = (a, v = a.v) => { const P = BAND[LANES[a.lane].band]; return P.gapMin + P.gapL * a.L + P.headway * v; };
// how far b's centre is ahead of a's along their lane, in -len/2..len/2
function ahead(L, a, b) { let d = (b.s - a.s) % L.len; if (d < 0) d += L.len; if (d > L.len / 2) d -= L.len; return d; }
// half of the width a vessel takes across the lane (more while it turns off the lane's line)
const halfW = a => a.B / 2 + a.L / 2 * Math.abs(Math.sin(a.yaw));

export function place(a) {
  laneAt(LANES[a.lane], a.s, a.lat, _p);
  a.x = _p.x; a.z = _p.z; a.h = _p.h + a.yaw;
}

// Fill a lane: from a random start, one vessel after another with a random gap of clear water between them,
// until the lane is full round to the first.
function fillLane(L) {
  L.list.length = 0; L.pending = 0;
  let s = rng() * L.len, first = null, prev = null;
  for (let guard = 0; guard < 400; guard++) {
    const a = makeShip(L);
    if (prev) {
      const clear = Math.max(wantGap(prev), wantGap(a)) + 20 + Math.max(0, -Math.log(1 - rng() * 0.999) * L.gap);
      s += (prev.L + a.L) / 2 + clear;
      const back = (first.s - s % L.len + L.len) % L.len;
      if (s - first.s > L.len || back - (a.L + first.L) / 2 < wantGap(a) + 20) break;
    }
    a.s = s % L.len;
    L.list.push(a); ships.push(a);
    if (!first) first = a;
    prev = a;
  }
  L.list.sort((p, q) => p.s - q.s);
}

// A new fleet: every lane filled afresh. With no seed, one from the clock (never from Math.random).
export function resetShips(seed) {
  if (seed === undefined) seed = (Date.now() ^ Math.floor((performance.now() % 1e6) * 1000)) >>> 0;
  for (const a of ships) dropMesh(a);
  ships.length = 0; nextId = 0; clock = 0; hornT = 0;
  rng = mulberry32(seed >>> 0);
  for (const L of LANES) fillLane(L);
  for (const a of ships) place(a);
  return seed;
}

// The distance from (x, z) to a vessel's hull (its box: L long, B wide, on its heading); 0 inside it
export function hullDist(a, x, z) {
  const dx = x - a.x, dz = z - a.z, s = Math.sin(a.h), c = Math.cos(a.h);
  const along = dx * s + dz * c, across = dx * c - dz * s;
  return Math.hypot(Math.max(0, Math.abs(along) - a.L / 2), Math.max(0, Math.abs(across) - a.B / 2));
}
// The hull's outline on the water (world x, z), for the radar: a pointed bow, a square stern
export function shipOutline(a, out = []) {
  const hl = a.L / 2, hb = a.B / 2, s = Math.sin(a.h), c = Math.cos(a.h);
  const pts = a.type === 'carrier'
    ? [[-0.42, 1], [0.42, 0.98], [1, 0.0], [0.62, -1], [-0.62, -1], [-1, -0.2], [-0.52, 0.86]]
    : [[0, 1], [0.6, 0.86], [1, 0.62], [1, -0.94], [0.86, -1], [-0.86, -1], [-1, -0.94], [-1, 0.62], [-0.6, 0.86]];
  out.length = 0;
  for (const [u, v] of pts) { const lx = u * hb, lz = v * hl; out.push([a.x + lx * c + lz * s, a.z - lx * s + lz * c]); }
  return out;
}

/* ---------------------------------------------------------------- the traffic ---------------------------------------------------------------- */

// The vessel ahead of list[i] in its lane whose width overlaps its own: the one it has to keep behind
function leaderOf(L, i) {
  const list = L.list, n = list.length, a = list[i], P = BAND[L.band];
  for (let k = 1; k < n; k++) {
    const b = list[(i + k) % n];
    let fd = (b.s - a.s) % L.len; if (fd < 0) fd += L.len;
    if (fd > P.look) break;
    if (Math.abs(a.lat - b.lat) < halfW(a) + halfW(b) + P.latClear) return b;
  }
  return null;
}
// how fast a vessel moves across its lane: turning no more than maxYaw off its line, but a small craft can always
// edge across at latMin, however slow it goes; and how long it takes to get to `lat`
const latSpeed = (P, a) => Math.max(P.latMin, Math.min(P.latRate, a.v * Math.tan(P.maxYaw)));
const latTime = (L, a, lat) => { const P = BAND[L.band]; return Math.abs(lat - a.lat) / Math.max(0.3, latSpeed(P, a)) + 1; };
// Is the water clear for `a` to move across to `lat`? A vessel alongside it may not be anywhere in the strip it sweeps;
// one ahead of its bow or behind its stern may not be in the strip it ends up in, within `front` / `back` m and as
// much more as the two close on each other while it moves across and then slows to the other's speed.
function clearFor(L, a, lat, front, back) {
  const P = BAND[L.band], wa = halfW(a) + P.latClear;
  const lo = Math.min(a.lat, lat) - wa, hi = Math.max(a.lat, lat) + wa;
  const tLat = latTime(L, a, lat);
  for (const b of L.list) {
    if (b === a) continue;
    const d = ahead(L, a, b), wb = halfW(b), reach = (a.L + b.L) / 2;
    if (Math.abs(d) < reach + P.hardMin) { if (b.lat + wb > lo && b.lat - wb < hi) return false; continue; }
    if (Math.abs(b.lat - lat) >= wa + wb) continue;
    const dv = Math.max(0, d > 0 ? a.v - b.v : b.v - a.v), extra = dv * tLat + dv * dv / (2 * P.dec);
    if (d > 0 ? d < reach + front + extra : d > -reach - back - extra) return false;
  }
  return true;
}
// Would a sideways step to `lat` put `a` into a vessel alongside it? (A step that opens the distance is always allowed.)
function blockedAt(L, a, lat) {
  const P = BAND[L.band], wa = halfW(a);
  for (const b of L.list) {
    if (b === a) continue;
    const d = ahead(L, a, b);
    if (Math.abs(d) >= (a.L + b.L) / 2 + P.hardMin) continue;
    const need = wa + halfW(b) + P.latClear;
    if (Math.abs(lat - b.lat) < need && Math.abs(lat - b.lat) <= Math.abs(a.lat - b.lat)) return true;
  }
  return false;
}

function stepLane(L, dt) {
  const list = L.list, n = list.length, P = BAND[L.band];
  if (!n) return;
  for (let i = 0; i < n; i++) list[i].lead = leaderOf(L, i);
  // overtaking: pull out round a slower vessel ahead and back in once there is room, all of it on the straight. A pass
  // is begun only far enough behind to be clear of the slower one before reaching it, and with straight water ahead
  // for the whole pass and passMargin more; one still out when a bend comes near gives up and drops back behind.
  if (L.pass) for (const a of list) {
    if (!a.passing) {
      const b = a.lead;
      if (!b || b.v > a.vWant - P.passDv) continue;
      const gap = ahead(L, a, b) - (a.L + b.L) / 2;
      if (gap > wantGap(a, a.vWant) + P.passGap) continue;
      const lat = b.lat + L.pass * ((a.B + b.B) / 2 + P.latClear + 2.5);
      if (Math.abs(lat - a.latBase) > L.passMax) continue;
      if (gap - P.hardMin < (a.v - b.v) * latTime(L, a, lat) + 5) continue;
      // all the slower ones it has to get past before there is room to come back in, and the straight water that takes
      let ext = b.L, last = b, vq = b.v;
      for (let k = 0; k < 12; k++) {
        const c = last.lead;
        if (!c || c === a) break;
        const g = ahead(L, last, c) - (last.L + c.L) / 2;
        if (g > a.L + 2 * (P.hardMin + 5) + wantGap(a, vq)) break;
        ext += g + c.L; vq = Math.max(vq, c.v); last = c;
      }
      if (vq > a.vWant - P.passDv) continue;
      const run = a.vWant * (gap + a.L + ext + P.backGap) / (a.vWant - vq) + P.passMargin;
      if (straightAhead(L, a.s - a.L / 2) < run) continue;
      if (clearFor(L, a, lat, wantGap(a), P.passBack)) { a.passing = b; a.abort = false; a.latTarget = lat; shipStats.passes++; }
    } else {
      const b = a.passing, d = L.list.includes(b) ? ahead(L, a, b) : -Infinity;
      const back = a.v * latTime(L, a, a.latBase) + a.v * a.v / (2 * P.dec) + a.L + 30;   // what getting back in takes
      if (!a.abort && straightAhead(L, a.s - a.L / 2) < Math.max(P.passMargin * 0.5, back)) { a.abort = true; shipStats.aborts++; }
      const done = a.abort || d < -(a.L + b.L) / 2 - P.backGap || d > wantGap(a, a.vWant) + P.passGap + 200;
      const m = a.abort ? P.hardMin + 5 : 0;
      if (done && clearFor(L, a, a.latBase, m || wantGap(a), m || P.backGap)) { a.passing = false; a.abort = false; a.latTarget = a.latBase; }
    }
  }
  // speed: its own, or less to keep its distance behind the one ahead (never more than it can stop for)
  for (const a of list) {
    let v = a.vWant;
    const b = a.lead;
    if (b) {
      const gap = ahead(L, a, b) - (a.L + b.L) / 2, g = wantGap(a);
      if (gap < g) v = Math.min(v, Math.max(0, b.v + (gap - g) * P.followK));
      v = Math.min(v, Math.sqrt(b.v * b.v + 2 * P.dec * Math.max(0, gap - P.hardMin)));   // it could stop behind it, even were it to brake
    }
    if (a.passing && a.abort) {   // gave up a pass: drop back behind whatever is in its place, and stop short of the bend
      for (const b of list) {
        if (b === a) continue;
        const d = ahead(L, a, b);
        if (d >= 0 && d < (a.L + b.L) / 2 + P.hardMin + 5 && Math.abs(b.lat - a.latBase) < halfW(a) + halfW(b) + P.latClear) v = Math.min(v, Math.max(0, b.v - 1.5));
      }
    }
    // out of its place (overtaking, or still getting back in): it stops short of a bend until it is back in its place
    if (L.pass && Math.abs(a.lat - a.latBase) > 0.3 && straightAhead(L, a.s - a.L / 2) < a.v * a.v / (2 * P.dec) + a.L + 8) v = 0;
    a.v = v > a.v ? Math.min(v, a.v + P.acc * dt) : Math.max(v, a.v - P.dec * dt);
    a.s += a.v * dt;
    a.trip -= a.v * dt;
  }
  // never closer than the hard gap to the one ahead
  for (let k = 0; k < 4; k++) {
    let moved = false;
    for (const a of list) {
      const b = a.lead;
      if (!b) continue;
      const gap = ahead(L, a, b) - (a.L + b.L) / 2;
      if (gap < P.hardMin - 1e-6) { a.s -= P.hardMin - gap; a.v = Math.min(a.v, b.v); moved = true; shipStats.clamps++; }
    }
    if (!moved) break;
  }
  // sideways, towards its place (easing in), turned a little off the line while it moves
  for (const a of list) {
    const err = a.latTarget - a.lat;
    let vLat = 0;
    if (Math.abs(err) > 0.01) {
      const vmax = latSpeed(P, a);
      vLat = clamp(err * P.latK, -vmax, vmax);
      if (Math.abs(vLat) < P.latMin * 0.4) vLat = Math.sign(err) * P.latMin * 0.4;   // no long creep over the last metre
      if (Math.abs(vLat * dt) > Math.abs(err)) vLat = err / dt;
      const lat = a.lat + vLat * dt;
      if (blockedAt(L, a, lat)) vLat = 0; else a.lat = lat;
    } else a.lat = a.latTarget;
    const yaw = L.dir * clamp(Math.atan2(vLat, Math.max(a.v, 0.5)), -P.maxYaw, P.maxYaw);
    a.yaw += (yaw - a.yaw) * Math.min(1, dt * P.yawK);
    // the hull stays inside the lane's band: it turns no further than the band has room for
    const room = Math.min(a.lat - L.lo, L.hi - a.lat) - a.B / 2;
    const sMax = clamp(room / (a.L / 2), 0, Math.sin(P.maxYaw));
    if (Math.abs(Math.sin(a.yaw)) > sMax) a.yaw = Math.sign(a.yaw) * Math.asin(sMax);
  }
  for (const a of list) { a.s %= L.len; if (a.s < 0) a.s += L.len; }
  for (let i = 1; i < n; i++) {   // insertion sort: the order hardly changes from one frame to the next
    const a = list[i]; let j = i - 1;
    while (j >= 0 && list[j].s > a.s) { list[j + 1] = list[j]; j--; }
    list[j + 1] = a;
  }
}

// Is there room for `c` at its place: the clear water each side of it at least what the vessels there keep?
function roomFor(L, c) {
  for (const b of L.list) {
    const d = ahead(L, c, b), clear = Math.abs(d) - (b.L + c.L) / 2;
    if (clear < (d >= 0 ? wantGap(c, c.vWant) : wantGap(b)) + 20) return false;
  }
  return true;
}
const outOfSight = (a, vx, vz, m = 0) => hullDist(a, vx, vz) > SIGHT_R + m && hullDist(a, player.x || 0, player.z || 0) > SIGHT_R + m;

// Vessels whose trip is over leave once out of sight; a new one takes each one's place, out of sight too.
function turnover(vx, vz) {
  for (const L of LANES) {
    for (let i = L.list.length - 1; i >= 0; i--) {
      const a = L.list[i];
      if (a.trip > 0 || !outOfSight(a, vx, vz)) continue;
      L.list.splice(i, 1); ships.splice(ships.indexOf(a), 1); dropMesh(a);
      L.pending++; shipStats.retired++;
    }
    if (!L.pending) continue;
    const c = makeShip(L);
    for (let k = 0; k < 12; k++) {
      c.s = rng() * L.len; place(c);
      if (!outOfSight(c, vx, vz, 40) || !roomFor(L, c)) continue;
      let j = 0; while (j < L.list.length && L.list[j].s < c.s) j++;
      L.list.splice(j, 0, c); ships.push(c);
      L.pending--; shipStats.spawned++;
      break;
    }
  }
}

/* ---------------------------------------------------------------- per frame ---------------------------------------------------------------- */

// Move the fleet on by dt, seen from (vx, vz) (the camera): models built and dropped, drawn, rocked; horns.
export function updateShips(dt, vx = camera.position.x, vz = camera.position.z) {
  if (dt > 0) {
    clock += dt;
    for (const L of LANES) stepLane(L, dt);
    turnover(vx, vz);
  }
  for (const a of ships) place(a);
  // models: drop the far ones, build the nearest missing one, draw what is in reach
  let best = null, bestD = BUILD_R;
  for (const a of ships) {
    const d = a.viewD = hullDist(a, vx, vz);
    if (a.mesh) { if (d > DROP_R) dropMesh(a); else a.mesh.root.visible = d < SHOW_R; }
    else if (d < bestD) { best = a; bestD = d; }
  }
  if (best) { buildMesh(best); best.mesh.root.visible = bestD < SHOW_R; }
  // past the fog only the lights can be seen (at night): the rest is not drawn there
  const night = env.night > 0.25, far = Math.min(SHOW_R, (scene.fog ? scene.fog.far : SHOW_R) + 30);
  for (const a of ships) {
    const m = a.mesh;
    if (!m || !m.root.visible) continue;
    const seen = a.viewD < far;
    m.hull.visible = seen; if (m.lit) m.lit.visible = seen;
    m.root.position.set(a.x, SEA_Y, a.z); m.root.rotation.y = a.h;
    const w = clock * a.bobW + a.ph;
    m.body.rotation.z = a.heel + a.rollA * Math.sin(w);
    m.body.rotation.x = a.pitch0 + a.pitchA * Math.sin(w * 0.77 + 1.3);
    m.body.position.y = a.heaveA * Math.sin(w * 1.13 + 0.4);
    const k = clamp(a.v / a.vWant, 0, 1.2);
    m.wake.scale.z = Math.max(0.02, k); m.wake.visible = seen && k > 0.05;
    m.bow.visible = seen && a.v > 1;
    if (m.glow) m.glow.visible = night;
  }
  if (dt > 0) horns(dt);
}

// Now and then a ship passing near the player sounds its horn (more often in fog), heard d/343 s late
function horns(dt) {
  hornT -= dt;
  if (game.state !== 'playing' || !sfx.ctx) return;
  for (const a of ships) {
    if (!a.T.horn) continue;
    const d = hullDist(a, player.x, player.z);
    if (d > SIGHT_R) { a.hornReady = true; continue; }
    if (!a.hornReady || d > HORN_R || hornT > 0) continue;
    if (rng() > dt * (0.012 + 0.04 * weatherSystem.fog)) continue;
    a.hornReady = false; hornT = HORN_GAP; shipStats.horns++;
    const [hz, len] = a.T.horn;
    sfx.shipHorn(Math.pow(1 - d / HORN_R, 1.3), hz * (0.94 + 0.12 * ((a.seed & 255) / 255)), d / 343, len, (a.seed >> 8) % 3 === 0 ? 2 : 1);
  }
}

/* ---------------------------------------------------------------- models ---------------------------------------------------------------- */

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    body: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
    win: windowMaterial(),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
    wake: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  return MATS;
}
// Window bands: eight windows a tile, one deck high, glass in a white wall; at night about two in three are lit
// (the material is one of ASSET.litMats, which js/environment.js lights after dark).
function windowMaterial() {
  if (typeof document === 'undefined') return new THREE.MeshLambertMaterial({ color: 0x8a96a3, flatShading: true });
  const W = 256, H = 32, r = mulberry32(90210);
  const cv = document.createElement('canvas'), ev = document.createElement('canvas');
  cv.width = ev.width = W; cv.height = ev.height = H;
  const g = cv.getContext('2d'), e = ev.getContext('2d');
  g.fillStyle = '#e9ebe7'; g.fillRect(0, 0, W, H);
  e.fillStyle = '#000000'; e.fillRect(0, 0, W, H);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = '#2b3c52'; g.fillRect(i * 32 + 3, 7, 26, 18);
    if (r() < 0.68) { e.fillStyle = r() < 0.5 ? '#ffd790' : '#ffc46a'; e.fillRect(i * 32 + 3, 7, 26, 18); }
  }
  const t = new THREE.CanvasTexture(cv), te = new THREE.CanvasTexture(ev);
  for (const x of [t, te]) { x.colorSpace = THREE.SRGBColorSpace; x.wrapS = THREE.RepeatWrapping; }
  const m = new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: te, emissiveIntensity: 0, flatShading: true });
  ASSET.litMats.push(m);
  return m;
}

// three.js names every object it makes (its uuid) with Math.random: the models are made with a stream of their own in
// its place, so building one never moves the game's random numbers on (the city and the traffic stay as they were).
const uuidRng = mulberry32(0x5f1e7a);
function ownRandom(fn) {
  const saved = Math.random;
  Math.random = uuidRng;
  try { return fn(); } finally { Math.random = saved; }
}
export function buildMesh(a) {
  if (a.mesh) return a.mesh;
  return ownRandom(() => makeMesh(a));
}
function makeMesh(a) {
  const M = mats(), k = new Kit(), r = mulberry32(a.seed);
  const look = a.T.build(k, a, r) || {};
  a.heel = look.heel || 0; a.pitch0 = look.pitch || 0;
  const g = k.finish();
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const hull = new THREE.Mesh(g.body, M.body), lit = g.lit ? new THREE.Mesh(g.lit, M.win) : null;
  body.add(hull);
  if (lit) body.add(lit);
  let glow = null;
  if (g.glow) { glow = new THREE.Mesh(g.glow, M.glow); body.add(glow); }
  const wg = wakeGeo(a), bg = bowWaveGeo(a);
  const wake = new THREE.Mesh(wg, M.wake); wake.position.set(0, 0.06, -a.L / 2); root.add(wake);
  const bow = new THREE.Mesh(bg, M.wake); bow.position.set(0, 0.07, a.L / 2); root.add(bow);
  root.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  root.position.set(a.x, SEA_Y, a.z); root.rotation.y = a.h;
  scene.add(root);
  a.mesh = { root, body, hull, lit, wake, bow, glow, geos: [g.body, g.lit, g.glow, wg, bg].filter(Boolean) };
  shipStats.built++;
  return a.mesh;
}
export function dropMesh(a) {
  if (!a.mesh) return;
  scene.remove(a.mesh.root);
  for (const g of a.mesh.geos) g.dispose();
  a.mesh = null; shipStats.dropped++;
}

// The wake behind the stern (z = 0 there, running back to -len): the churned water straight behind, and the two arms
// out at the Kelvin angle (19.5°). Its length is for the vessel's own speed; js scales it with the speed it has.
function wakeGeo(a) {
  const small = a.T.band === 'small', v = a.vWant, B = a.B;
  const len = small ? 8 + 4.5 * v + 0.6 * a.L : 0.25 * a.L + 9 * v;
  const P = [], Cc = [];
  const quad = (p0, p1, p2, p3, al0, al1) => {
    for (const [p, al] of [[p0, al0], [p1, al0], [p2, al1], [p0, al0], [p2, al1], [p3, al1]]) { P.push(p[0], 0, p[1]); Cc.push(1, 1, 1, al); }
  };
  const w0 = B * 0.38, w1 = B * 0.85, l1 = len * 0.75;
  quad([-w0, 0], [w0, 0], [w1, -l1], [-w1, -l1], small ? 0.8 : 0.7, 0);
  const t = Math.tan(19.5 * PI / 180), aw = Math.max(0.5, B * 0.1);
  for (const sg of [-1, 1]) {
    const x0 = sg * B * 0.45, x1 = sg * (B * 0.45 + len * t);
    quad([x0 - aw / 2, 0], [x0 + aw / 2, 0], [x1 + aw, -len], [x1 - aw, -len], 0.55, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 4));
  g.computeBoundingSphere();
  return g;
}
// The bow wave: white water from the stem along both sides (z = 0 at the bow)
function bowWaveGeo(a) {
  const B = a.B, lb = Math.min(0.3 * a.L, 6 + 0.12 * a.L), P = [], Cc = [];
  for (const sg of [-1, 1]) {
    const pts = [[[0, 0.4], 0.8], [[sg * B * 0.62, -lb], 0], [[sg * B * 0.4, -lb], 0]];
    for (const [p, al] of pts) { P.push(p[0], 0, p[1]); Cc.push(1, 1, 1, al); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 4));
  g.computeBoundingSphere();
  return g;
}

/* The kit a model is built with: plain coloured pieces (one geometry with vertex colours), window bands (the lit window
   material, their u running along the band) and lights (one unlit geometry). Faces wind outwards. */
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _t4 = new THREE.Vector3(), _s4 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _col = new THREE.Color();
const BOX_CORNERS = [];
for (let i = 0; i < 8; i++) BOX_CORNERS.push([(i & 1) ? 0.5 : -0.5, (i & 2) ? 0.5 : -0.5, (i & 4) ? 0.5 : -0.5]);
// each face from outside, anticlockwise from its bottom-left corner; the size its u runs along (the sides)
const BOX_FACES = [[5, 1, 3, 7, 'd'], [0, 4, 6, 2, 'd'], [2, 6, 7, 3, null], [0, 1, 5, 4, null], [4, 5, 7, 6, 'w'], [1, 0, 2, 3, 'w']];
const TRI6 = [0, 1, 2, 0, 2, 3];
export const ringArea = ring => { let s = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
const centroid = ring => { let x = 0, z = 0; for (const p of ring) { x += p[0]; z += p[1]; } return [x / ring.length, z / ring.length]; };
export const scaleRing = (ring, k, kz = k) => { const [cx, cz] = centroid(ring); return ring.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * kz]); };
const ringLerp = (a, b, t) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);

export class Kit {
  constructor() { this.p = []; this.c = []; this.lp = []; this.luv = []; this.gp = []; this.gc = []; }
  rgb(hex) { _col.setHex(hex); return [_col.r, _col.g, _col.b]; }
  xf(x, y, z, rx, ry, rz, sx, sy, sz) { _e4.set(rx, ry, rz); _q4.setFromEuler(_e4); return _m4.compose(_t4.set(x, y, z), _q4, _s4.set(sx, sy, sz)); }
  _box(P, Cl, UV, w, h, d, x, y, z, rx, ry, rz, rgb, pitch) {
    const m = this.xf(x, y, z, rx, ry, rz, w, h, d);
    const v = BOX_CORNERS.map(([a, b, c]) => _v4.set(a, b, c).applyMatrix4(m).toArray());
    for (const [i0, i1, i2, i3, ax] of BOX_FACES) {
      const q = [v[i0], v[i1], v[i2], v[i3]];
      const U = UV && ax ? (ax === 'd' ? d : w) / (8 * pitch) : 0;
      const uv = [[0, 0], [U, 0], [U, 1], [0, 1]];
      for (const t of TRI6) {
        P.push(q[t][0], q[t][1], q[t][2]);
        if (Cl) Cl.push(rgb[0], rgb[1], rgb[2]);
        if (UV) UV.push(uv[t][0], uv[t][1]);
      }
    }
  }
  box(w, h, d, x, y, z, col, ry = 0, rx = 0, rz = 0) { this._box(this.p, this.c, null, w, h, d, x, y, z, rx, ry, rz, this.rgb(col)); }
  // a window band (one deck's row of windows round a block), `pitch` m from one window to the next
  win(w, h, d, x, y, z, pitch = 2.4) { this._box(this.lp, null, this.luv, w, h, d, x, y, z, 0, 0, 0, null, pitch); }
  light(x, y, z, s, col) { this._box(this.gp, this.gc, null, s, s, s, x, y, z, 0, 0, 0, this.rgb(col)); }
  geo(geo, x, y, z, col, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo, pos = g.attributes.position, m = this.xf(x, y, z, rx, ry, rz, 1, 1, 1), [r, gg, b] = this.rgb(col);
    for (let i = 0; i < pos.count; i++) { _v4.fromBufferAttribute(pos, i).applyMatrix4(m); this.p.push(_v4.x, _v4.y, _v4.z); this.c.push(r, gg, b); }
    if (g !== geo) g.dispose();
    geo.dispose();
  }
  cyl(rt, rb, h, seg, x, y, z, col, rx = 0, rz = 0, ry = 0) { this.geo(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, col, rx, ry, rz); }
  sph(r, x, y, z, col, ws = 16, hs = 10) { this.geo(new THREE.SphereGeometry(r, ws, hs), x, y, z, col); }
  // the sides between the ring `lo` at y0 and the ring `hi` at y1 (the same number of points, convex, round one way)
  loft(lo, y0, hi, y1, col) {
    const [r, g, b] = this.rgb(col), n = lo.length, pos = ringArea(lo) > 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = [lo[i][0], y0, lo[i][1]], b0 = [lo[j][0], y0, lo[j][1]], a1 = [hi[i][0], y1, hi[i][1]], b1 = [hi[j][0], y1, hi[j][1]];
      for (const p of pos ? [a0, b1, b0, a0, a1, b1] : [a0, b0, b1, a0, b1, a1]) { this.p.push(p[0], p[1], p[2]); this.c.push(r, g, b); }
    }
  }
  // a lid over the ring at y, facing up (a fan from its centre: the ring is seen whole from there)
  cap(ring, y, col) {
    const [r, g, b] = this.rgb(col), n = ring.length, pos = ringArea(ring) > 0, c = centroid(ring);
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      for (const [x, z] of pos ? [c, q, p] : [c, p, q]) { this.p.push(x, y, z); this.c.push(r, g, b); }
    }
  }
  prism(ring, y0, y1, col, top = col, inset = 1) { const hi = inset === 1 ? ring : scaleRing(ring, inset); this.loft(ring, y0, hi, y1, col); this.cap(hi, y1, top); }
  tri(a, b, c, col) { const [r, g, bb] = this.rgb(col); for (const p of [a, b, c]) { this.p.push(p[0], p[1], p[2]); this.c.push(r, g, bb); } }
  finish() {
    const geo = (pos, col, uv) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    };
    return { body: geo(this.p, this.c, null), lit: this.lp.length ? geo(this.lp, null, this.luv) : null, glow: this.gp.length ? geo(this.gp, this.gc, null) : null };
  }
}

/* ---- hull pieces ---- */

// The hull's outline at the waterline (top false) or at the deck (top true): a square-ish stern (transom: its width
// as a share of the beam), the parallel middle body, and the bow tapering over `bow`·L to its tip (tip: the tip's
// width as a share of the beam, 0 for a pointed bow; full: 2 a fine bow, 3 a bluff one). At the deck the bow is
// fuller (its flare) and the stem leans forward by rake·L. Port side (x > 0) from the stern to the bow, then back.
export function hullRing(L, B, o, top) {
  const hb = B / 2, n = 7, zTip = top ? L / 2 : L / 2 - (o.rake ?? 0.012) * L, zb = L / 2 - o.bow * L;
  const zs = -L / 2, ts = o.transom ?? 0.85, sl = (o.stern ?? 0.05) * L, p = (o.full ?? 2.2) * (top ? 0.8 : 1), tip = o.tip ?? 0;
  const port = [[hb * ts, zs], [hb * (0.5 + ts / 2), zs + sl * 0.45], [hb, zs + sl]];
  for (let i = 0; i <= n; i++) { const t = i / n; port.push([hb * Math.max(tip, 1 - Math.pow(t, p)), zb + (zTip - zb) * t]); }
  const ring = port.slice();
  for (let i = port.length - 1; i >= 0; i--) ring.push([-port[i][0], port[i][1]]);
  return ring;
}
// The hull: below the waterline (out of sight under the sea, so a vessel that rolls never shows daylight under it),
// the boot-top band at the waterline, the topsides up to the deck (with a band of another colour if o.band), the deck.
// Returns the deck's outline.
function hull(k, L, B, o) {
  const wl = hullRing(L, B, o, false), dk = hullRing(L, B, o, true), F = o.F;
  const at = y => ringLerp(wl, dk, clamp((y - o.boot) / (F - o.boot), 0, 1));
  k.loft(wl, -1.8, wl, o.boot, o.bootCol);
  if (o.band) {
    const [y0, y1, col] = o.band;
    k.loft(wl, o.boot, at(y0), y0, o.hullCol); k.loft(at(y0), y0, at(y1), y1, col); k.loft(at(y1), y1, dk, F, o.hullCol);
  } else k.loft(wl, o.boot, dk, F, o.hullCol);
  k.cap(dk, F, o.deckCol);
  return dk;
}
// the half-width of an outline at z (its widest point across there)
export function halfWidthAt(ring, z) {
  let w = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if ((p[1] - z) * (q[1] - z) > 0 || p[1] === q[1]) continue;
    w = Math.max(w, Math.abs(p[0] + (q[0] - p[0]) * (z - p[1]) / (q[1] - p[1])));
  }
  return w;
}
// the part of an outline forward of z (keep +1) or aft of it (keep -1)
function clipRing(ring, z, keep) {
  const out = [], inside = p => (p[1] - z) * keep >= 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) { const t = (z - p[1]) / (q[1] - p[1]); out.push([p[0] + (q[0] - p[0]) * t, z]); }
  }
  return out;
}
// a raised deck over the part of the hull forward of z (a forecastle) or aft of it (keep -1): from y0 up to y1
function raised(k, deckRing, z, keep, y0, y1, side, top) { const r = clipRing(deckRing, z, keep); if (r.length >= 3) k.prism(r, y0, y1, side, top); }
// A deckhouse: `decks` decks one above the other from `base`, from z0 (aft) to z1 (forward), w wide; a window band round
// each deck. rake: how far each deck steps back at the front; narrow: how much narrower each deck is. Returns its top.
function deckhouse(k, { z0, z1, w, base, decks, deckH = 2.9, wall = C.white, win = true, rake = 0, aft = 0, narrow = 0, x = 0, pitch = 2.4 }) {
  let y = base;
  for (let i = 0; i < decks; i++) {
    const f = z1 - i * rake, b = z0 + i * aft, ww = w - i * narrow;
    if (f - b < 2 || ww < 2) break;
    k.box(ww, deckH, f - b, x, y + deckH / 2, (f + b) / 2, wall);
    if (win) k.win(ww + 0.14, deckH * 0.46, f - b + 0.14, x, y + deckH * 0.56, (f + b) / 2, pitch);
    y += deckH;
  }
  return y;
}
// The bridge: a deck with windows all round on top of the house, its wings reaching out to the sides; returns its roof
function bridge(k, { z, w, d, y, beam, wall = C.white, deckH = 2.9 }) {
  k.box(w, deckH, d, 0, y + deckH / 2, z, wall);
  k.win(w + 0.16, deckH * 0.5, d + 0.16, 0, y + deckH * 0.6, z, 1.6);
  k.box(beam - 0.5, 0.5, Math.min(3, d * 0.5), 0, y + 0.25, z + d * 0.22, wall);
  k.box(w + 0.6, 0.4, d + 0.6, 0, y + deckH + 0.2, z, wall);
  return { roof: y + deckH + 0.4, wingY: y + 0.9, wingZ: z + d * 0.22 };
}
function mast(k, x, y, z, h, col = C.steel, yard = 3) {
  k.box(0.5, h, 0.5, x, y + h / 2, z, col);
  if (yard) k.box(yard, 0.24, 0.24, x, y + h * 0.78, z, col);
  return y + h;
}
function funnel(k, { x = 0, z, y, w, d, h, col, band, top = 0x26262a }) {
  k.box(w, h, d, x, y + h / 2, z, col);
  if (band) k.box(w + 0.14, h * 0.18, d + 0.14, x, y + h * 0.7, z, band);
  k.box(w + 0.08, Math.min(1, h * 0.08), d + 0.08, x, y + h - Math.min(0.5, h * 0.04), z, top);
}
// Navigation lights: white at the masthead (forward of the mast) and at the stern, red to port (+x), green to starboard
function navLights(k, a, { topY, topZ, wingY, wingZ, sternY, small = false }) {
  const s = small ? 0.32 : clamp(a.L / 200, 0.6, 1.5), hb = a.B / 2 - s;
  k.light(0, topY + s * 0.6, topZ, s, 0xfff6e0);
  k.light(hb, wingY, wingZ, s, 0xff2a20);
  k.light(-hb, wingY, wingZ, s, 0x2aff5a);
  k.light(0, sternY, -a.L / 2 + s, s, 0xfff6e0);
}
function crane(k, y, z, B, dir, col) {
  k.cyl(1.3, 1.5, 7, 10, 0, y + 3.5, z, col);
  k.box(3.6, 3.2, 4.4, 0, y + 8.6, z, col);
  const jl = Math.min(28, B * 0.85), ang = 0.42;
  k.box(0.9, 0.9, jl, 0, y + 9 + Math.sin(ang) * jl / 2, z + dir * Math.cos(ang) * jl / 2, col, 0, -dir * ang);
}

/* ---- the ships ---- */

function buildContainer(k, a, r) {
  const L = a.L, B = a.B, F = 0.036 * L, hullCol = pick(r, HULL_COLS), deck = C.deck;
  const dk = hull(k, L, B, { bow: 0.2, full: 2.1, transom: 0.8, F, boot: 1.3, hullCol, bootCol: pick(r, BOOT_COLS), deckCol: deck });
  raised(k, dk, L / 2 - 0.075 * L, 1, F, F + 2.6, hullCol, deck);
  // most carry their house aft; the biggest have the bridge well forward and the engine (the funnel) aft
  const fwd = L >= 260 && r() < 0.6, decks = Math.round(clamp(L / 38, 5, 8));
  const hd = clamp(0.045 * L, 9, 15), hw = B * (fwd ? 0.8 : 0.62), hz = fwd ? L / 2 - 0.3 * L : -L / 2 + 0.1 * L + hd / 2;
  const top = deckhouse(k, { z0: hz - hd / 2, z1: hz + hd / 2, w: hw, base: F, decks });
  const br = bridge(k, { z: hz, w: hw, d: hd * 0.8, y: top, beam: B });
  const mt = mast(k, 0, br.roof, hz, 7, C.steel, 5);
  const fz = fwd ? -L / 2 + 0.11 * L : hz - hd / 2 - 5, fd = 9;
  funnel(k, { z: fz, y: F, w: B * 0.24, d: fd, h: fwd ? 2.9 * (decks - 2) + 7 : 2.9 * decks + 4, col: pick(r, FUNNEL_COLS), band: pick(r, BAND_COLS) });
  // the boxes: 40-foot containers (12.2 m by 2.44 m, 2.6 m high), stacked in bays from the forecastle aft
  const tiers0 = Math.round(lerp(4, 7, (L - 200) / 100)), bay = 13.2, zF = L / 2 - 0.085 * L, zB = -L / 2 + 0.05 * L;
  for (let z = zF - bay / 2; z - bay / 2 > zB; z -= bay) {
    if (Math.abs(z - hz) < hd / 2 + bay / 2 + 0.5) continue;
    if (Math.abs(z - fz) < fd / 2 + bay / 2 + 0.5) continue;
    if (!fwd && z < hz) continue;
    const rows = Math.floor((2 * Math.min(halfWidthAt(dk, z + bay / 2), halfWidthAt(dk, z)) - 1.6) / 2.5);
    if (rows < 2) continue;
    let left = rows, x = -rows * 2.5 / 2;
    while (left > 0) {
      const nr = Math.min(left, 2 + Math.floor(r() * 4)); left -= nr;
      const t = Math.max(1, tiers0 + Math.floor(r() * 3) - 1 - (z > L / 2 - 0.2 * L ? 1 : 0)), h = t * 2.6;
      k.box(nr * 2.5 - 0.2, h, bay - 0.8, x + nr * 2.5 / 2, F + h / 2, z, pick(r, BOX_COLS));
      x += nr * 2.5;
    }
  }
  navLights(k, a, { topY: mt, topZ: hz + 1, wingY: br.wingY, wingZ: br.wingZ, sternY: F + 1.6 });
}

function buildBulk(k, a, r) {
  const L = a.L, B = a.B, F = 0.04 * L, hullCol = pick(r, HULL_COLS), deck = pick(r, [0x6b2c24, 0x4f5f4f, C.deck]);
  const dk = hull(k, L, B, { bow: 0.16, full: 2.8, transom: 0.86, F, boot: 1.4, hullCol, bootCol: pick(r, BOOT_COLS), deckCol: deck });
  raised(k, dk, L / 2 - 0.06 * L, 1, F, F + 2.5, hullCol, deck);
  const hd = clamp(0.05 * L, 10, 14), hz = -L / 2 + 0.06 * L + hd / 2, hw = B * 0.68;
  const top = deckhouse(k, { z0: hz - hd / 2, z1: hz + hd / 2, w: hw, base: F, decks: 5 });
  const br = bridge(k, { z: hz, w: hw, d: hd * 0.8, y: top, beam: B });
  const mt = mast(k, 0, br.roof, hz, 6);
  funnel(k, { z: hz - hd / 2 - 3.5, y: F, w: B * 0.22, d: 6, h: 2.9 * 5 + 4, col: pick(r, FUNNEL_COLS), band: pick(r, BAND_COLS) });
  // the holds' hatch covers, and on the smaller ones (Handysize to Supramax) their own cranes between them
  const z0 = hz + hd / 2 + 5, z1 = L / 2 - 0.08 * L, n = clamp(Math.round((z1 - z0) / 26), 5, 9), pitch = (z1 - z0) / n, hl = pitch * 0.7;
  const hatch = pick(r, [0x8a3a2c, 0x3f6b4a, 0x6d7378, 0x2f4f6f]), cr = pick(r, [0xe0b52c, 0xf2f3ef, 0xd8642a]);
  for (let i = 0; i < n; i++) {
    const z = z0 + pitch * (i + 0.5), w = Math.min(B * 0.6, 2 * Math.min(halfWidthAt(dk, z + hl / 2), halfWidthAt(dk, z - hl / 2)) - 6);
    if (w > 3) k.box(w, 1.8, hl, 0, F + 0.9, z, hatch);
  }
  if (L <= 215) for (let i = 1; i < n; i += 2) crane(k, F, z0 + pitch * i, B, i % 4 === 1 ? 1 : -1, cr);
  navLights(k, a, { topY: mt, topZ: hz + 1, wingY: br.wingY, wingZ: br.wingZ, sternY: F + 1.6 });
}

function buildTanker(k, a, r) {
  const L = a.L, B = a.B, F = 0.032 * L, hullCol = pick(r, [0x6e1f1f, 0x24262a, 0x1f3550, 0x2d5a3f, 0xa8322a]);
  const deck = pick(r, [0x7a2e26, 0x3f6b4a]);
  const dk = hull(k, L, B, { bow: 0.16, full: 3.0, transom: 0.88, F, boot: 1.2, hullCol, bootCol: pick(r, BOOT_COLS), deckCol: deck });
  raised(k, dk, L / 2 - 0.05 * L, 1, F, F + 2.4, hullCol, deck);
  const hd = clamp(0.05 * L, 10, 14), hz = -L / 2 + 0.055 * L + hd / 2, hw = B * 0.62;
  const top = deckhouse(k, { z0: hz - hd / 2, z1: hz + hd / 2, w: hw, base: F, decks: 6 });
  const br = bridge(k, { z: hz, w: hw, d: hd * 0.8, y: top, beam: B });
  const mt = mast(k, 0, br.roof, hz, 6);
  funnel(k, { z: hz - hd / 2 - 3.5, y: F, w: B * 0.2, d: 6, h: 2.9 * 6 + 4, col: pick(r, FUNNEL_COLS), band: pick(r, BAND_COLS) });
  // the catwalk on its posts from the house to the forecastle, the pipes along the deck, the manifold amidships
  const c0 = hz + hd / 2, c1 = L / 2 - 0.05 * L, cm = (c0 + c1) / 2, cl = c1 - c0;
  k.box(1.4, 0.3, cl, 0, F + 2.4, cm, C.steel);
  for (let z = c0 + 8; z < c1; z += 16) k.box(0.3, 2.3, 0.3, 0, F + 1.15, z, C.steel);
  for (const x of [-3, 2.5, 4]) k.box(0.7, 0.7, cl * 0.96, x, F + 0.5, cm, x < 0 ? 0xc9ccc8 : 0x9aa0a4);
  k.box(B * 0.78, 1.3, 3.2, 0, F + 1.0, -0.02 * L, 0x9aa0a4);
  for (const x of [-B * 0.3, B * 0.3]) { k.cyl(0.5, 0.6, 5, 8, x, F + 2.5, 0.02 * L, 0xe0b52c); k.box(0.5, 0.5, 9, x, F + 5.6, 0.02 * L - 3.5, 0xe0b52c, 0, 0.5); }
  navLights(k, a, { topY: mt, topZ: hz + 1, wingY: br.wingY, wingZ: br.wingZ, sternY: F + 1.6 });
}

function buildLng(k, a, r) {
  const L = a.L, B = a.B, F = 0.045 * L, hullCol = pick(r, [0x24262a, 0x1f3550, 0x6e1f1f, 0xe9e9e4]), deck = 0x6a6e70;
  const dk = hull(k, L, B, { bow: 0.18, full: 2.4, transom: 0.85, F, boot: 1.5, hullCol, bootCol: pick(r, BOOT_COLS), deckCol: deck });
  raised(k, dk, L / 2 - 0.06 * L, 1, F, F + 3, hullCol, deck);
  const hd = 13, hz = -L / 2 + 0.05 * L + hd / 2, hw = B * 0.66;
  const top = deckhouse(k, { z0: hz - hd / 2, z1: hz + hd / 2, w: hw, base: F, decks: 6 });
  const br = bridge(k, { z: hz, w: hw, d: hd * 0.8, y: top, beam: B });
  const mt = mast(k, 0, br.roof, hz, 7);
  funnel(k, { z: hz - hd / 2 - 3.5, y: F, w: B * 0.2, d: 6, h: 2.9 * 6 + 4, col: pick(r, FUNNEL_COLS), band: pick(r, BAND_COLS) });
  // Moss tanks: spheres about 0.8 of the beam across, their lower parts in the hull and their skirts round them
  const D = 0.8 * B, dome = pick(r, [0xd8642a, 0xe9e9e4, 0xe9e9e4, 0xc8282a, 0x2a5c8f]);
  const z0 = hz + hd / 2 + D / 2 + 4, z1 = L / 2 - 0.085 * L - D / 2;
  const n = clamp(Math.floor((z1 - z0) / (D + 1.5)) + 1, 3, 5), step = (z1 - z0) / (n - 1);
  for (let i = 0; i < n; i++) {
    const z = z0 + step * i;
    k.cyl(D / 2, D / 2, D * 0.14, 20, 0, F + D * 0.07, z, hullCol === 0xe9e9e4 ? 0x9aa0a4 : 0xe9e9e4);
    k.sph(D / 2, 0, F + D * 0.14, z, dome, 18, 12);
  }
  k.box(2.4, 1.4, z1 - z0 + D * 0.5, 0, F + D * 0.64 + 0.6, (z0 + z1) / 2, 0xb8bcc0);
  navLights(k, a, { topY: mt, topZ: hz + 1, wingY: br.wingY, wingZ: br.wingZ, sternY: F + 1.6 });
}

function buildCarCarrier(k, a, r) {
  const L = a.L, B = a.B, F = 9.5, H = 30 + r() * 4, body = pick(r, [0xe9eae6, 0x9aa3ab, 0x2c4f7c, 0x6e1f1f, 0xd8dcd8]);
  const stripe = pick(r, BAND_COLS.filter(c => c !== body)), o = { bow: 0.12, full: 3.4, tip: 0.3, transom: 0.96, rake: 0.004 };
  const dk = hull(k, L, B, { ...o, F, boot: 1.4, hullCol: body, bootCol: pick(r, BOOT_COLS), deckCol: body });
  // the box over the whole length, its bow sloping back; a stripe of the line's colour near the top
  const top = hullRing(L * 0.985, B, { ...o, bow: 0.16, tip: 0.36 }, true).map(([x, z]) => [x, z - 0.007 * L]);
  const y1 = F + (H - F) * 0.8, y2 = F + (H - F) * 0.86;
  k.loft(dk, F, ringLerp(dk, top, 0.8), y1, body);
  k.loft(ringLerp(dk, top, 0.8), y1, ringLerp(dk, top, 0.86), y2, stripe);
  k.loft(ringLerp(dk, top, 0.86), y2, top, H, body);
  k.cap(top, H, 0xcfd3d4);
  const zf = top.reduce((m, p) => Math.max(m, p[1]), -L);
  k.win(B * 0.62, 1.5, 2.2, 0, H - 2.3, zf - 4.5, 1.6);
  k.box(B * 0.45, (H - F) * 0.42, 0.5, -B * 0.18, F + (H - F) * 0.23, -L / 2 + 0.3, 0x55595d);
  funnel(k, { z: -L / 2 + 0.12 * L, y: H, w: 5, d: 8, h: 5.5, col: stripe, band: C.white });
  const mt = mast(k, 0, H, zf - 10, 6);
  navLights(k, a, { topY: mt, topZ: zf - 9, wingY: H - 1, wingZ: zf - 6, sternY: F + 1.6 });
}

function buildCruise(k, a, r) {
  const L = a.L, B = a.B, F = 0.04 * L, white = 0xf4f5f2, navy = r() < 0.2, hullCol = navy ? 0x1d2f4f : white;
  hull(k, L, B, { bow: 0.2, full: 2.2, transom: 0.9, F, boot: 1.0, hullCol, bootCol: navy ? 0x1d2f4f : 0x8f2a24, deckCol: 0x9aa0a6 });
  k.win(B + 0.1, 1.1, L * 0.6, 0, F - 3.2, -0.08 * L, 2.0);   // the portholes along the hull
  const decks = Math.round(lerp(9, 12, (L - 250) / 80)), dh = 2.95;
  let y = F, zfTop = 0;
  for (let i = 0; i < decks; i++) {
    const zf = L / 2 - 0.17 * L - i * 1.8, zb = -L / 2 + 0.035 * L + i * 0.9 + Math.max(0, i - decks + 4) * 6;
    const w = i < 2 ? B - 7 : B - 1.2 - Math.max(0, i - decks + 3) * 3;
    k.box(w, dh, zf - zb, 0, y + dh / 2, (zf + zb) / 2, white);
    k.win(w + 0.14, 1.5, zf - zb + 0.14, 0, y + 1.6, (zf + zb) / 2, 2.2);
    y += dh; zfTop = zf;
  }
  // the lifeboats in the promenade's recess, both sides
  for (let z = -0.24 * L; z <= 0.2 * L; z += 12.5) for (const s of [-1, 1]) k.box(3.2, 3, 10, s * (B / 2 - 2.3), F + dh + 1.6, z, 0xf28a1e);
  // the bridge's wings at the front of the top deck, the funnel aft, the pool and a lounge on top
  k.box(B - 0.6, 0.6, 4, 0, y - dh + 0.4, zfTop - 2.2, white);
  funnel(k, { z: -L / 2 + 0.24 * L, y, w: 9, d: 16, h: 9, col: pick(r, [0x1d2f4f, 0xd23a2a, white, 0xe8b830, 0x2c6fb2]), band: pick(r, BAND_COLS) });
  k.box(10, 0.3, 18, 0, y + 0.15, -0.02 * L, 0x3aa3d8);
  k.box(B * 0.5, 2.6, 22, 0, y + 1.3, 0.12 * L, white);
  k.win(B * 0.5 + 0.14, 1.2, 22.14, 0, y + 1.4, 0.12 * L, 2.4);
  const mt = mast(k, 0, y, zfTop - 7, 8);
  navLights(k, a, { topY: mt, topZ: zfTop - 6, wingY: y - dh + 1.2, wingZ: zfTop - 2.2, sternY: F + 1.6 });
}

function buildFerry(k, a, r) {
  const L = a.L, B = a.B, F = 0.05 * L, white = 0xf2f3ef, stripe = pick(r, [0x1d4f9c, 0xc8282a, 0x1f7a4a, 0xf2a01e, 0x0f6f8f]);
  hull(k, L, B, { bow: 0.2, full: 2.2, transom: 0.92, F, boot: 1.0, hullCol: white, bootCol: 0x8f2a24, deckCol: 0x9aa0a6, band: [F * 0.45, F * 0.62, stripe] });
  const decks = Math.round(lerp(4, 6, (L - 120) / 80)), z0 = -L / 2 + 0.1 * L, z1 = L / 2 - 0.16 * L;
  const top = deckhouse(k, { z0, z1, w: B - 1.6, base: F, decks, deckH: 2.9, rake: 2.0, aft: 1.2, pitch: 2.2 });
  const zf = z1 - (decks - 1) * 2.0;
  const br = bridge(k, { z: zf - 5, w: B * 0.5, d: 7, y: top, beam: B });
  const nf = r() < 0.4 ? 2 : 1;
  for (let i = 0; i < nf; i++) funnel(k, { x: nf === 2 ? (i ? -1 : 1) * B * 0.18 : 0, z: z0 + 0.12 * L, y: top, w: nf === 2 ? 3.4 : 5, d: 7, h: 7, col: stripe, band: white });
  k.box(B * 0.5, F * 0.6, 0.5, 0, F * 0.55, -L / 2 + 0.3, 0x55595d);
  const mt = mast(k, 0, br.roof, zf - 5, 6);
  navLights(k, a, { topY: mt, topZ: zf - 4, wingY: br.wingY, wingZ: br.wingZ, sternY: F + 1.6 });
}

function buildCargo(k, a, r) {
  const L = a.L, B = a.B, F = 0.045 * L, hullCol = pick(r, HULL_COLS), deck = pick(r, [C.deck, 0x6b2c24, 0x4f5f4f]);
  const dk = hull(k, L, B, { bow: 0.18, full: 2.4, transom: 0.86, F, boot: 1.0, hullCol, bootCol: pick(r, BOOT_COLS), deckCol: deck });
  raised(k, dk, L / 2 - 0.08 * L, 1, F, F + 2.4, hullCol, deck);
  const hd = clamp(0.07 * L, 8, 11), hz = -L / 2 + 0.06 * L + hd / 2, hw = B * 0.7;
  const top = deckhouse(k, { z0: hz - hd / 2, z1: hz + hd / 2, w: hw, base: F, decks: 4 });
  const br = bridge(k, { z: hz, w: hw, d: hd * 0.8, y: top, beam: B });
  const mt = mast(k, 0, br.roof, hz, 5);
  funnel(k, { z: hz - hd / 2 - 2.5, y: F, w: B * 0.2, d: 4.5, h: 2.9 * 4 + 3, col: pick(r, FUNNEL_COLS), band: pick(r, BAND_COLS) });
  const z0 = hz + hd / 2 + 4, z1 = L / 2 - 0.1 * L, n = clamp(Math.round((z1 - z0) / 22), 3, 5), pitch = (z1 - z0) / n, hl = pitch * 0.72;
  const hatch = pick(r, [0x8a3a2c, 0x3f6b4a, 0x6d7378, 0x2f4f6f]), cr = pick(r, [0xe0b52c, 0xf2f3ef, 0xd8642a, 0x2a5c8f]), boxes = r() < 0.4;
  for (let i = 0; i < n; i++) {
    const z = z0 + pitch * (i + 0.5), w = Math.min(B * 0.66, 2 * Math.min(halfWidthAt(dk, z + hl / 2), halfWidthAt(dk, z - hl / 2)) - 3);
    if (w < 3) continue;
    k.box(w, 1.6, hl, 0, F + 0.8, z, hatch);
    if (boxes) { const t = 1 + Math.floor(r() * 2); k.box(w - 0.6, t * 2.6, Math.min(hl - 0.6, 12.2), 0, F + 1.6 + t * 1.3, z, pick(r, BOX_COLS)); }
  }
  for (let i = 1; i < n; i += 2) crane(k, F, z0 + pitch * i, B, i % 4 === 1 ? 1 : -1, cr);   // between every other pair of hatches
  navLights(k, a, { topY: mt, topZ: hz + 1, wingY: br.wingY, wingZ: br.wingZ, sternY: F + 1.6 });
}

function buildSupply(k, a, r) {
  const L = a.L, B = a.B, F = 4, hullCol = pick(r, [0xd8642a, 0xc8282a, 0x1d4f9c, 0xe8b830, 0x2d5a3f]);
  const dk = hull(k, L, B, { bow: 0.26, full: 2.0, transom: 0.97, F, boot: 0.8, hullCol, bootCol: C.black, deckCol: C.deck });
  const zh = L / 2 - 0.36 * L;
  raised(k, dk, zh, 1, F, F + 2.6, hullCol, C.deck);
  const top = deckhouse(k, { z0: zh, z1: L / 2 - 0.14 * L, w: B * 0.8, base: F + 2.6, decks: 2, deckH: 2.8, rake: 1.2 });
  const br = bridge(k, { z: zh + 0.1 * L, w: B * 0.7, d: 0.12 * L, y: top, beam: B });
  const mt = mast(k, 0, br.roof, zh + 0.1 * L, 5, C.steel, 2.5);
  for (const s of [-1, 1]) funnel(k, { x: s * B * 0.26, z: zh - 1.6, y: F, w: 1.6, d: 2.4, h: 9, col: hullCol, band: C.white });
  for (const s of [-1, 1]) k.box(0.25, 1.1, L / 2 - 0.36 * L + L / 2 - 1, s * (B / 2 - 0.4), F + 0.55, (zh - L / 2 + 1) / 2, hullCol);
  for (let i = 0; i < 3; i++) k.box(2.44, 2.6, 6.1, (i - 1) * 3.2, F + 1.3, -L / 2 + 0.15 * L + i * 2.5, pick(r, BOX_COLS));
  navLights(k, a, { topY: mt, topZ: zh + 0.1 * L + 1, wingY: br.wingY, wingZ: br.wingZ, sternY: F + 1.2 });
}

function buildFrigate(k, a, r) {
  const L = a.L, B = a.B, F = 0.05 * L, grey = 0x7c858d, dark = 0x4e555c;
  hull(k, L, B, { bow: 0.34, full: 1.8, transom: 0.86, rake: 0.03, F, boot: 0.8, hullCol: grey, bootCol: 0x2c2f33, deckCol: dark });
  // the superstructure, its walls leaning in (to hide from radar), the bridge on its front
  const s0 = -0.24 * L, s1 = 0.16 * L, sw = B * 0.82;
  const sup = [[sw / 2, s0], [sw / 2, s1 - 6], [sw * 0.3, s1], [-sw * 0.3, s1], [-sw / 2, s1 - 6], [-sw / 2, s0]];
  k.prism(sup, F, F + 8.5, grey, grey, 0.88);
  const br = [[sw * 0.34, s1 - 22], [sw * 0.34, s1 - 7], [sw * 0.2, s1 - 3], [-sw * 0.2, s1 - 3], [-sw * 0.34, s1 - 7], [-sw * 0.34, s1 - 22]];
  k.prism(br, F + 8.5, F + 12.5, grey, grey, 0.86);
  k.box(sw * 0.4, 0.9, 0.4, 0, F + 11, s1 - 3.9, 0x1c2630);
  k.cyl(0.5, 3.0, 15, 4, 0, F + 12.5 + 7.5, s1 - 14, grey, 0, 0, PI / 4);
  k.box(4.6, 5, 9, 0, F + 11, s1 - 34, grey);
  const gz = L / 2 - 0.25 * L;
  k.cyl(1.8, 2.6, 2.2, 8, 0, F + 1.1, gz, grey);
  k.box(0.35, 0.35, 6, 0, F + 1.7, gz + 3.2, dark);
  k.box(B * 0.4, 0.3, 8, 0, F + 0.15, s1 + 6, dark);
  // the hangar and the flight deck aft
  k.box(B * 0.6, 6, 14, 0, F + 3, s0 - 7, grey);
  const hz0 = -L / 2, hz1 = s0 - 14;
  k.box(B * 0.86, 0.12, hz1 - hz0, 0, F + 0.06, (hz0 + hz1) / 2, 0x3c4146);
  k.box(0.4, 0.14, (hz1 - hz0) * 0.9, 0, F + 0.1, (hz0 + hz1) / 2, 0xf2f2f2);
  navLights(k, a, { topY: F + 12.5 + 15, topZ: s1 - 13, wingY: F + 11, wingZ: s1 - 8, sternY: F + 1.2 });
}

function buildCarrier(k, a, r) {
  const L = a.L, B = a.B, Bw = 40.8, Fh = 15.5, Fd = 18.5, grey = 0x737b83, deck = 0x3c4146, h = L / 2, W = B / 2;
  hull(k, L, Bw, { bow: 0.26, full: 1.9, transom: 0.92, rake: 0.025, F: Fh, boot: 1.0, hullCol: grey, bootCol: 0x2c2f33, deckCol: grey });
  // the flight deck, out over the water on both sides: the angled deck to port, the island to starboard
  const fd = [[-W * 0.42, h], [W * 0.42, h - 4], [W * 0.62, h - 0.22 * L], [W * 0.9, h - 0.42 * L], [W, h - 0.6 * L], [W * 0.88, -h + 0.1 * L],
    [W * 0.62, -h], [-W * 0.62, -h], [-W * 0.82, -h + 0.12 * L], [-W, -h + 0.38 * L], [-W, h - 0.45 * L], [-W * 0.7, h - 0.2 * L], [-W * 0.52, h - 0.07 * L]];
  k.loft(fd, Fd - 2.6, fd, Fd, grey); k.cap(fd, Fd, deck);
  k.box(Bw * 0.9, Fd - 2.6 - Fh + 0.3, L * 0.7, 0, Fh + (Fd - 2.6 - Fh) / 2, -0.04 * L, 0x5e666e);
  k.box(0.6, 0.06, 0.6 * L, W * 0.3, Fd + 0.03, -0.1 * L, 0xf4f4f0, 0.16);
  k.box(0.6, 0.06, 0.36 * L, -W * 0.12, Fd + 0.03, 0.27 * L, 0xf4f4f0);
  k.box(0.4, 0.06, 0.72 * L, -W * 0.86, Fd + 0.03, -0.05 * L, 0xe8c02a);
  // the island, on the starboard edge aft of amidships, and its mast
  const iz = -0.12 * L, ix = -W + 7;
  k.box(11, 13, 36, ix, Fd + 6.5, iz, grey);
  k.box(9, 6.5, 24, ix, Fd + 16.25, iz + 2, grey);
  k.box(9.4, 1.4, 12, ix, Fd + 17, iz + 8, 0x1c2630);
  k.cyl(0.9, 1.6, 20, 6, ix, Fd + 29.5, iz + 2, grey);
  k.box(5, 3.2, 0.4, ix, Fd + 24, iz + 2, 0x5e666e);
  k.box(0.3, 0.3, 7, ix, Fd + 34, iz + 2, 0x5e666e);
  // aircraft parked along the starboard side and aft
  const nAir = 6 + Math.floor(r() * 8);
  for (let i = 0; i < nAir; i++) {
    const aft = i % 2 === 0, z = aft ? -h + 0.05 * L + (i >> 1) * 11 : iz + 26 + (i >> 1) * 14, x = aft ? W * 0.32 : -W + 9;
    jet(k, x, Fd, z, aft ? PI : 0.7);
  }
  navLights(k, a, { topY: Fd + 39.5, topZ: iz + 2, wingY: Fd + 17, wingZ: iz + 10, sternY: Fd - 1 });
}
function jet(k, x, y, z, h) {
  const s = Math.sin(h), c = Math.cos(h), at = (dx, dz) => [x + dx * c + dz * s, z - dx * s + dz * c];
  const col = 0x8f969d;
  let p = at(0, 0); k.box(1.6, 1.4, 16, p[0], y + 1.3, p[1], col, h);
  p = at(0, -1.5); k.box(9, 0.25, 4.5, p[0], y + 1.5, p[1], col, h);
  for (const sx of [-1, 1]) { p = at(sx * 1.1, -6.5); k.box(0.25, 3, 2.6, p[0], y + 3, p[1], col, h); }
}

/* ---- the small craft ---- */

function buildSailboat(k, a, r) {
  const L = a.L, B = a.B, F = clamp(0.1 * L, 0.9, 1.6);
  const hullCol = pick(r, [C.white, C.white, C.white, 0x1d2f4f, 0x6e1f1f, 0x2d5a3f]), deck = r() < 0.5 ? 0xb08a5a : 0xeceae2;
  hull(k, L, B, { bow: 0.45, full: 1.7, transom: 0.72, rake: 0.07, F, boot: 0.22, hullCol, bootCol: pick(r, [0x1d2f4f, 0x8f2a24, C.black]), deckCol: deck });
  k.box(B * 0.5, 0.75, 0.32 * L, 0, F + 0.37, -0.03 * L, 0xf1f1ee);
  k.box(B * 0.52, 0.22, 0.2 * L, 0, F + 0.47, -0.03 * L, C.glass);
  const mz = 0.1 * L, mh = 1.38 * L, by = F + 1.5, bl = 0.42 * L;
  k.box(0.16, mh, 0.16, 0, F + mh / 2, mz, 0xcfd3d8);
  // the boom and the sails, swung out to one side; she heels away from the wind, the way her sails lean
  const side = r() < 0.5 ? 1 : -1, sw = side * (0.15 + r() * 0.2), bx = Math.sin(sw) * bl, bz = mz - Math.cos(sw) * bl;   // inside the beam
  k.box(0.1, 0.1, bl, bx / 2, by, (mz + bz) / 2, 0xcfd3d8, -sw);
  const sail = r() < 0.85 ? 0xf7f6f0 : pick(r, [0xefe6cf, 0xd23a2a, 0x2a5c8f]);
  k.tri([0, by + 0.15, mz], [0, F + mh * 0.97, mz], [bx, by + 0.15, bz], sail);
  const jl = 0.24 * L, jx = Math.sin(sw * 0.8) * jl, jz = mz - Math.cos(sw * 0.8) * jl;
  k.tri([0, F + mh * 0.8, mz + 0.1], [0, F + 0.6, L / 2 - 0.03 * L], [jx, F + 1.0, jz], sail);
  navLights(k, a, { topY: F + mh, topZ: mz, wingY: F + 0.4, wingZ: L / 2 - 0.12 * L, sternY: F + 0.4, small: true });
  return { heel: -side * (0.07 + r() * 0.08) };
}

function buildSpeedboat(k, a, r) {
  const L = a.L, B = a.B, F = 0.85, hullCol = pick(r, [C.white, C.white, 0xc8282a, 0xe8b830, 0x1d4f9c, C.black]);
  hull(k, L, B, { bow: 0.45, full: 1.6, transom: 0.95, rake: 0.08, F, boot: 0.18, hullCol, bootCol: pick(r, [0x1d2f4f, 0xc8282a, C.black]), deckCol: 0xeceae2 });
  k.box(B * 0.42, 0.75, 0.16 * L, 0, F + 0.37, 0.02 * L, 0xf1f1ee);
  k.box(B * 0.5, 0.45, 0.06, 0, F + 0.95, 0.1 * L + 0.05, 0x2a3a4c, 0, -0.5);
  k.box(B * 0.5, 0.4, 0.12 * L, 0, F + 0.2, -0.15 * L, 0xd8d0c0);
  k.box(0.55, 0.9, 0.6, 0, F - 0.1, -L / 2 + 0.35, C.black);
  navLights(k, a, { topY: F + 1.3, topZ: -0.1 * L, wingY: F + 0.2, wingZ: L / 2 - 0.15 * L, sternY: F + 0.3, small: true });
  return { pitch: -0.05 - r() * 0.03 };
}

function buildYacht(k, a, r) {
  const L = a.L, B = a.B, F = clamp(0.065 * L, 1.5, 3.2), white = 0xf4f5f2, hullCol = pick(r, [white, white, white, 0x1d2f4f, 0x2a2e33, 0xc9ccd0]);
  hull(k, L, B, { bow: 0.36, full: 1.9, transom: 0.92, rake: 0.06, F, boot: 0.25, hullCol, bootCol: 0x1d2f4f, deckCol: 0xb08a5a });
  const nd = L < 22 ? 1 : L < 34 ? 2 : 3, dh = 2.3;
  let y = F, zt = 0;
  for (let i = 0; i < nd; i++) {
    const z0 = -L / 2 + (0.16 + 0.07 * i) * L, z1 = L / 2 - (0.3 + 0.07 * i) * L, w = B - 1 - i * 0.9, f = (z1 - z0) * 0.22;
    const o = [[w / 2, z0], [w / 2, z1 - f], [w * 0.22, z1], [-w * 0.22, z1], [-w / 2, z1 - f], [-w / 2, z0]], top = scaleRing(o, 0.94);
    k.loft(o, y, ringLerp(o, top, 0.3), y + dh * 0.3, white);
    k.loft(scaleRing(ringLerp(o, top, 0.3), 1.01), y + dh * 0.3, scaleRing(ringLerp(o, top, 0.75), 1.01), y + dh * 0.75, C.glass);
    k.loft(ringLerp(o, top, 0.75), y + dh * 0.75, top, y + dh, white);
    k.cap(top, y + dh, white);
    y += dh; zt = (z0 + z1) / 2;
  }
  k.box(0.3, 1.8, 0.3, 0, y + 0.9, zt, C.steel);
  k.sph(0.5, 0, y + 1.9, zt, white, 10, 6);
  navLights(k, a, { topY: y + 2.4, topZ: zt, wingY: F + 0.3, wingZ: L / 2 - 0.3 * L, sternY: F + 0.4, small: true });
}

function buildFishing(k, a, r) {
  const L = a.L, B = a.B, F = clamp(0.08 * L, 2, 3.2), hullCol = pick(r, [0x1d4f9c, 0xc8282a, 0x2d5a3f, 0xd8642a, 0x1f6f78, C.black]);
  const dk = hull(k, L, B, { bow: 0.3, full: 2.2, transom: 0.9, rake: 0.04, F, boot: 0.5, hullCol, bootCol: pick(r, [0x8f2a24, C.black]), deckCol: 0x6d7378 });
  raised(k, dk, L / 2 - 0.2 * L, 1, F, F + 1.4, hullCol, 0x6d7378);
  const hz = L / 2 - 0.34 * L, hd = 0.17 * L, hw = B * 0.62;
  const top = deckhouse(k, { z0: hz - hd / 2, z1: hz + hd / 2, w: hw, base: F, decks: 2, deckH: 2.3, wall: 0xf1f1ee, pitch: 1.4 });
  k.box(hw + 0.4, 0.3, hd + 0.4, 0, top + 0.15, hz, 0xf1f1ee);
  const mh = 0.32 * L, mz = hz - hd * 0.2, my = top + 0.3, mt = mast(k, 0, my, mz, mh, 0xe0e0dc, B * 0.5);
  // the outriggers, raised for the passage; the gantry and the net drum at the stern
  const ol = 0.3 * L, oa = 0.24;
  for (const s of [-1, 1]) k.box(0.18, ol, 0.18, s * Math.sin(oa) * ol / 2, my + mh * 0.2 + Math.cos(oa) * ol / 2, mz, 0xe0e0dc, 0, 0, -s * oa);
  const gc = pick(r, [0xd8642a, 0xe8b830, 0xf2f3ef]);
  for (const s of [-1, 1]) k.box(0.35, 3.2, 0.35, s * (B / 2 - 0.8), F + 1.6, -L / 2 + 1.2, gc);
  k.box(B - 1.4, 0.35, 0.35, 0, F + 3.2, -L / 2 + 1.2, gc);
  k.cyl(0.8, 0.8, B * 0.5, 10, 0, F + 0.9, -L / 2 + 0.2 * L, 0x2a6b3a, 0, PI / 2);
  navLights(k, a, { topY: mt, topZ: mz, wingY: top - 1, wingZ: hz, sternY: F + 0.6, small: true });
  // a trawler's all-round lights: green over white
  k.light(0, mt - 1.2, mz, 0.32, 0x2aff5a); k.light(0, mt - 2.4, mz, 0.32, 0xfff6e0);
}

function buildTug(k, a, r) {
  const L = a.L, B = a.B, F = 2.3, hullCol = pick(r, [0xc8282a, C.black, 0x1d4f9c, 0x2d5a3f, 0xe8b830]);
  hull(k, L, B, { bow: 0.32, full: 2.0, transom: 0.88, rake: 0.03, F, boot: 0.4, hullCol, bootCol: C.black, deckCol: C.deck, band: [F - 0.6, F - 0.05, 0x1c1c1c] });
  const sup = r() < 0.6 ? 0xf1f1ee : hullCol;
  deckhouse(k, { z0: -0.12 * L, z1: 0.26 * L, w: B * 0.66, base: F, decks: 1, deckH: 2.4, wall: sup, pitch: 1.4 });
  const wz = 0.14 * L, wd = 0.2 * L, ww = B * 0.56;
  k.box(ww, 2.2, wd, 0, F + 2.4 + 1.1, wz, sup);
  k.box(ww * 0.92, 2.5, wd * 0.9, 0, F + 4.6 + 1.25, wz, sup);
  k.win(ww * 0.92 + 0.14, 1.2, wd * 0.9 + 0.14, 0, F + 4.6 + 1.4, wz, 1.2);
  k.box(ww, 0.25, wd, 0, F + 7.1 + 0.12, wz, sup);
  const mt = mast(k, 0, F + 7.35, wz - 1, 4.5, C.steel, 2);
  for (const s of [-1, 1]) funnel(k, { x: s * B * 0.2, z: wz - wd / 2 - 2, y: F + 2.4, w: 1.3, d: 1.8, h: 3.4, col: hullCol, band: 0xf1f1ee });
  k.cyl(0.9, 0.9, B * 0.4, 10, 0, F + 0.9, -0.2 * L, 0x3a3f44, 0, PI / 2);
  k.box(1.4, 1.2, 1.2, 0, F - 0.3, L / 2 - 0.9, 0x1c1c1c);
  navLights(k, a, { topY: mt, topZ: wz, wingY: F + 4.2, wingZ: wz, sternY: F + 0.8, small: true });
}

export function shipsInfo() { return { A, SEA_Y, SIGHT_R, BUILD_R, DROP_R, SHOW_R, HORN_R, HORN_GAP, LANE_DS, clock }; }
