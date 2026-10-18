/* Prints the alley-mouth scenes of police-chase.mjs: narrow streets of the current city, each with a spot to hide the
   player in and a start for the pursuers on open ground round the corner. The list in police-chase.mjs is this script's
   output. When the city changes, run it again and paste what it prints over that list.
   Usage:  node tools/sidewalk-checks/scan-alleys.mjs            (the list on stdout, the counts on stderr)
     SCAN_R=320   half the side of the square scanned round (0, 0), in metres
     SPACING=40   the least distance between two scenes
     ASCII=0,5    also draws those picks (by their place in the list) on stderr
   The solids are mapped onto a 1 m grid. A roof a car fits under and anything lower than 0.5 m are left out. A street
   cell is kept when
   - there is a wall on both sides of it (a building, shopfront, fence, scaffold, column or playground: not a tree or a
     parked car), 5 to 14 m apart, and the street is 5 to 14 m wide 4 m either way along it too, with 10 m or more of
     free run along it;
   - the player's spot has 2 m or more of free ground to the wall on each side (the car is about 2 m wide);
   - it is on drivable ground (nothing solid in the 3 x 3 cells round it) that joins up with the rest of the city.
   The pursuer starts 22 to 30 m off (as near 26 m as there is room for) on open ground: 16 m or more of free run along
   both axes. The point 3 m to its side, where the test puts the second car, has to be drivable too. From both points
   the straight line to the player has to run through about 2 m or more of wall, so a car that drove straight at him
   would stall against the corner of the street's mouth. The AI's own sight test (losBlocked in js/police.js) has to
   find the line blocked as well. The cells are tried in a fixed hash order, so a city that has not changed gives the
   same list. */
import { modulePath } from './harness.mjs';
const W = await import(modulePath);

const A = +(process.env.SCAN_R || 320) + 20, N = 2 * A + 1;                 // 1 m cells over [-A, A]^2, cell i <-> coordinate i - A
const idx = (i, j) => i * N + j;               // i: x, j: z
const WALL = new Set(['building', 'shopfront', 'fence', 'scaffold', 'column', 'playground']);
const blocked = new Uint8Array(N * N);         // 0 free, 1 obstacle, 2 wall-kind obstacle
const seen = new Set();
for (let cx = -(A - 20); cx <= A - 20; cx += 80) for (let cz = -(A - 20); cz <= A - 20; cz += 80) {
  W.updateChunks(cx, cz, 999);
  for (const [k, ch] of W.chunks) {
    if (seen.has(k)) continue; seen.add(k);
    for (const s of (ch.solids || [])) {
      if (!(s.hx >= 0 && s.hz >= 0)) continue;
      if (s.headroom !== undefined && s.headroom >= 1.6) continue;          // a slab a car drives under
      if (s.maxY !== undefined && s.maxY < 0.5) continue;                  // too low to stop a car at grade
      const v = WALL.has(s.kind) ? 2 : 1;
      const i0 = Math.ceil(s.x - s.hx + A), i1 = Math.floor(s.x + s.hx + A), j0 = Math.ceil(s.z - s.hz + A), j1 = Math.floor(s.z + s.hz + A);
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) blocked[idx(i, j)] = Math.max(blocked[idx(i, j)], v);
    }
  }
}
// free runs in the four directions (cells until the first blocked cell), and what stopped them
const Lr = new Int16Array(N * N), Rr = new Int16Array(N * N), Dr = new Int16Array(N * N), Ur = new Int16Array(N * N);
for (let j = 0; j < N; j++) { let r = 0; for (let i = 0; i < N; i++) { r = blocked[idx(i, j)] ? 0 : r + 1; Lr[idx(i, j)] = r; } r = 0; for (let i = N - 1; i >= 0; i--) { r = blocked[idx(i, j)] ? 0 : r + 1; Rr[idx(i, j)] = r; } }
for (let i = 0; i < N; i++) { let r = 0; for (let j = 0; j < N; j++) { r = blocked[idx(i, j)] ? 0 : r + 1; Dr[idx(i, j)] = r; } r = 0; for (let j = N - 1; j >= 0; j--) { r = blocked[idx(i, j)] ? 0 : r + 1; Ur[idx(i, j)] = r; } }
const kindAt = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? 0 : blocked[idx(i, j)];
// width across the street at a cell: ax = 1 (street along x) -> across is z; ax = 0 (street along z) -> across is x
function across(i, j, ax) {
  if (blocked[idx(i, j)]) return null;
  if (ax) { const d = Dr[idx(i, j)], u = Ur[idx(i, j)]; return { w: d + u - 1, a: d - 1, b: u - 1, ka: kindAt(i, j - d), kb: kindAt(i, j + u) }; }
  const l = Lr[idx(i, j)], r = Rr[idx(i, j)]; return { w: l + r - 1, a: l - 1, b: r - 1, ka: kindAt(i - l, j), kb: kindAt(i + r, j) };
}
// car clearance grid: a cell is drivable if no obstacle within 1 cell (Chebyshev) - a car is about 2 m wide
const drive = new Uint8Array(N * N);
for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {
  let ok = 1; for (let di = -1; di <= 1 && ok; di++) for (let dj = -1; dj <= 1; dj++) if (blocked[idx(i + di, j + dj)]) { ok = 0; break; }
  drive[idx(i, j)] = ok;
}
// connected components of the drivable grid
const comp = new Int32Array(N * N).fill(-1); let nc = 0; const compSize = [];
for (let s = 0; s < N * N; s++) {
  if (!drive[s] || comp[s] >= 0) continue;
  const q = [s]; comp[s] = nc; let size = 0;
  while (q.length) { const c = q.pop(); size++; const i = Math.floor(c / N), j = c % N; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue; const t = idx(ni, nj); if (drive[t] && comp[t] < 0) { comp[t] = nc; q.push(t); } } }
  compSize.push(size); nc++;
}
const mainComp = compSize.indexOf(Math.max(...compSize));
console.error('cells blocked', blocked.reduce((a, b) => a + (b ? 1 : 0), 0), 'components', nc, 'main size', compSize[mainComp]);

// LOS as policeAI's losBlocked: a sample each metre, solidAt(x, z, 1.2, 1.2)
function losBlocked(ax0, az0, tx, tz) {
  W.updateChunks((ax0 + tx) / 2, (az0 + tz) / 2, 999);
  const dx = tx - ax0, dz = tz - az0, d = Math.hypot(dx, dz), n = Math.min(90, Math.ceil(Math.min(d, 90)));
  for (let k = 1; k <= n; k++) { const t = (k / n) * Math.min(1, 90 / d); if (W.solidAt(ax0 + dx * t, az0 + dz * t, 1.2, 1.2)) return true; }
  return false;
}
// The corner test: the straight line to the player runs through a wall (2 m or more of a building, shopfront, fence...),
// so a pursuer that drove straight at him would stall against the street mouth's corner. A tree or a parked car in the
// way blocks the sight line too, but the look-ahead probe steers round those.
function wallBlocked(ax0, az0, tx, tz) {
  const dx = tx - ax0, dz = tz - az0, d = Math.hypot(dx, dz), n = Math.ceil(d * 2);
  let run = 0;
  for (let k = 1; k < n; k++) {
    const x = Math.round(ax0 + dx * k / n), z = Math.round(az0 + dz * k / n);
    if (kindAt(x + A, z + A) === 2) { run++; if (run >= 4) return true; } else run = 0;
  }
  return false;
}
const R = A - 20;                                  // the player's spots stay inside the square scanned
const cands = [];
for (let x = -R; x <= R; x += 2) for (let z = -R; z <= R; z += 2) {
  const i = x + A, j = z + A;
  if (!drive[idx(i, j)] || comp[idx(i, j)] !== mainComp) continue;
  for (const ax of [0, 1]) {
    const c0 = across(i, j, ax);
    if (!c0 || c0.w < 5 || c0.w > 14 || c0.ka !== 2 || c0.kb !== 2) continue;
    // a street, not a pinch: the same width class 4 m either way along it, and at least 10 m of free run along it
    const st = [-4, 4].map(o => ax ? across(i + o, j, ax) : across(i, j + o, ax));
    if (st.some(c => !c || c.w < 5 || c.w > 14)) continue;
    const run = ax ? Lr[idx(i, j)] + Rr[idx(i, j)] - 1 : Dr[idx(i, j)] + Ur[idx(i, j)] - 1;
    if (run < 10) continue;
    // the car fits facing along the street: 2 free cells or more to the wall on each side (a car is about 2 m wide)
    if (c0.a < 2 || c0.b < 2) continue;
    cands.push({ x, z, ax, w: c0.w, run });
  }
}
console.error('street cells', cands.length);
// pursuers: 22-30 m away, open ground (free run >= 16 m both ways, both axes), drivable and connected, LOS blocked
const hash = (a, b, c) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0; };
cands.sort((p, q) => hash(p.x, p.z, p.ax) - hash(q.x, q.z, q.ax));
const picked = [];
for (const c of cands) {
  if (picked.length >= 30) break;
  if (picked.some(p => Math.hypot(p.x - c.x, p.z - c.z) < +(process.env.SPACING || 40))) continue;
  const opts = [];
  for (let qx = c.x - 30; qx <= c.x + 30; qx++) for (let qz = c.z - 30; qz <= c.z + 30; qz++) {
    const d = Math.hypot(qx - c.x, qz - c.z); if (d < 22 || d > 30) continue;
    const i = qx + A, j = qz + A; if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
    const s = idx(i, j); if (!drive[s] || comp[s] !== mainComp) continue;
    const wx = Lr[s] + Rr[s] - 1, wz = Dr[s] + Ur[s] - 1; if (wx < 16 || wz < 16) continue;
    const hc = Math.atan2(c.x - qx, c.z - qz), q2x = Math.round(qx + 3 * Math.cos(hc)), q2z = Math.round(qz - 3 * Math.sin(hc));
    const s2 = idx(q2x + A, q2z + A); if (!drive[s2] || comp[s2] !== mainComp) continue;
    opts.push({ qx, qz, d });
  }
  opts.sort((a, b) => Math.abs(a.d - 26) - Math.abs(b.d - 26) || hash(a.qx, a.qz, 7) - hash(b.qx, b.qz, 7));
  const q = opts.find(o => { const hc = Math.atan2(c.x - o.qx, c.z - o.qz), o2x = o.qx + 3 * Math.cos(hc), o2z = o.qz - 3 * Math.sin(hc); return wallBlocked(o.qx, o.qz, c.x, c.z) && wallBlocked(o2x, o2z, c.x, c.z) && losBlocked(o.qx, o.qz, c.x, c.z) && losBlocked(o2x, o2z, c.x, c.z); });
  if (!q) continue;
  picked.push({ ...c, qx: q.qx, qz: q.qz, d: q.d });
}
console.error('picked', picked.length);
for (const p of picked) console.error(`  [${p.x}, ${p.z}, ${p.ax}, ${p.qx}, ${p.qz}]: street ${p.w} m wide, ${p.run} m of free run, pursuer ${p.d.toFixed(1)} m off`);
console.log(picked.map(p => `    [${p.x}, ${p.z}, ${p.ax}, ${p.qx}, ${p.qz}]`).join(',\n'));
// ASCII views of a few picks: '#' wall kind, 'o' other solid, 'P' player, 'Q' pursuer, '.' free
if (process.env.ASCII) for (const p of picked.filter((_, k) => process.env.ASCII.split(',').map(Number).includes(k))) {
  console.error(`scene [${p.x}, ${p.z}, ${p.ax}, ${p.qx}, ${p.qz}]  (x right, z down)`);
  for (let z = p.z - 32; z <= p.z + 32; z += 2) {
    let row = '';
    for (let x = p.x - 40; x <= p.x + 40; x += 1) {
      const i = x + A, j = z + A, b = (i >= 0 && j >= 0 && i < N && j < N) ? blocked[idx(i, j)] : 1;
      row += (Math.abs(x - p.x) <= 1 && Math.abs(z - p.z) <= 1) ? 'P' : (Math.abs(x - p.qx) <= 1 && Math.abs(z - p.qz) <= 1) ? 'Q' : b === 2 ? '#' : b === 1 ? 'o' : '.';
    }
    console.error(row);
  }
}
