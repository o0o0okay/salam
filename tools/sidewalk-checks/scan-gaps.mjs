/* Prints the narrow-gap scenes of police-chase.mjs: passages 2.4 to 3.6 m wide between two solids inside a block, where
   the road grid does not reach, each with a start for the pursuer about 30 m off. The list in police-chase.mjs is this
   script's output. When the city changes, run it again and paste what it prints over that list.
   Usage:  node tools/sidewalk-checks/scan-gaps.mjs            (the list on stdout; every gap found, on stderr)
     SCAN_R=400   half the side of the square scanned round (0, 0), in metres
     GAPS_N=2     how many gaps the list takes
     ASCII=1      also draws each gap of the list on stderr
   A gap is kept when
   - two solids that are not trees (buildings, shopfronts, scaffolds, fences, parked cars...) face each other 2.4 to 3.6 m
     apart over 4.8 m or more (a car's length), and the player's car parked in the middle, facing along the gap, is clear
     of everything;
   - a car can drive along the gap at least 6 m either way from that spot;
   - the spot is more than 12.6 m (the far edge of the pavement) from every road's centre line: off the road grid.
   The pursuer starts 26 to 34 m off (as near 30 m as there is room for), clear of everything, with 12 m or more of free
   run along both axes, and
   - the straight line from it to the player runs through 6 m or more of a building or another wall, and is blocked for
     the AI's own sight test (losBlocked in js/police.js);
   - a car that only drives straight at the player, sliding along whatever it meets, does not get within 4 m of him (so
     the wall does not just steer it into the gap: it has to find the way round);
   - there is a way in for a car: a search over 0.5 m cells that keeps the car's half width (1.0 m) clear of every solid,
     like the pursuit's own route search, gets from the start to the spot.
   The list takes the gaps whose width is nearest 2.8 m first (the gaps the check was written for were about 2.8 m wide)
   and tries everything in a fixed order, so a city that has not changed gives the same list. Those first gaps lay
   between a shop front and a parked car's nose. There are still some (2.81 m), but the car covers only 2.5 m of the
   passage, short of the 4.8 m asked for here, and in them the pursuit gets in as often without its route search as
   with it. */
import { modulePath } from './harness.mjs';
const W = await import(modulePath);

const R = +(process.env.SCAN_R || 400), N = +(process.env.GAPS_N || 2);
const WALL = new Set(['building', 'shopfront', 'fence', 'scaffold', 'column', 'playground']);
const S = [], seen = new Set();
for (let cx = -R; cx <= R; cx += 80) for (let cz = -R; cz <= R; cz += 80) {
  W.updateChunks(cx, cz, 999);
  for (const [k, ch] of W.chunks) {
    if (seen.has(k)) continue; seen.add(k);
    for (const s of (ch.solids || [])) {
      if (!(s.hx >= 0 && s.hz >= 0)) continue;
      if (s.headroom !== undefined && s.headroom >= 1.6) continue;          // a slab a car drives under
      if (s.maxY !== undefined && s.maxY < 0.5) continue;                  // too low to stop a car at grade
      if (Math.abs(s.x) > R + 40 || Math.abs(s.z) > R + 40) continue;
      S.push(s);
    }
  }
}
const load = (x, z) => W.updateChunks(x, z, 999);
const free = (x, z, m) => !W.solidAt(x, z, m);
// the player's car (2.4 m half length, 1.0 m half width) parked at (x, z) along the axis (ax 1: along x)
const carClear = (x, z, ax) => [-1.4, 0, 1.4].every(o => free(ax ? x + o : x, ax ? z : z + o, 1.0));
const offGrid = v => Math.abs(v - Math.round(v / 80) * 80) > 12.6;
// free run from (x, z) along a direction, for a car's half width
const runFrom = (x, z, dx, dz, max) => { let r = 0; while (r < max && free(x + dx * (r + 0.5), z + dz * (r + 0.5), 1.0)) r += 0.5; return r; };
// LOS as policeAI's losBlocked: a sample each metre, solidAt(x, z, 1.2, 1.2)
function losBlocked(x0, z0, tx, tz) {
  const dx = tx - x0, dz = tz - z0, d = Math.hypot(dx, dz), n = Math.min(90, Math.ceil(Math.min(d, 90)));
  for (let k = 1; k <= n; k++) { const t = (k / n) * Math.min(1, 90 / d); if (W.solidAt(x0 + dx * t, z0 + dz * t, 1.2, 1.2)) return true; }
  return false;
}
// the longest stretch of the straight line that runs through a wall-kind solid, in metres
function wallRun(x0, z0, tx, tz) {
  const dx = tx - x0, dz = tz - z0, d = Math.hypot(dx, dz), n = Math.ceil(d * 4);
  let run = 0, best = 0;
  for (let k = 1; k < n; k++) {
    const x = x0 + dx * k / n, z = z0 + dz * k / n;
    let wall = false;
    for (const s of W.solidsNear(x, z, 1)) if (WALL.has(s.kind) && s.hx >= 0 && !(s.headroom >= 1.6) && Math.abs(x - s.x) <= s.hx && Math.abs(z - s.z) <= s.hz) { wall = true; break; }
    if (wall) { run++; if (run > best) best = run; } else run = 0;
  }
  return best * d / n;
}
// A car that only drives straight at the player and slides along whatever it meets (no steering round anything): does it
// get within 4 m of him? Steps of 0.25 m; a blocked step slides along x or along z, whichever is free and goes further.
function pushReaches(qx, qz, px, pz) {
  let x = qx, z = qz;
  for (let k = 0; k < 600; k++) {
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
    if (d < 4) return true;
    const ux = dx / d * 0.25, uz = dz / d * 0.25;
    if (free(x + ux, z + uz, 1.0)) { x += ux; z += uz; continue; }
    const sx = Math.abs(ux) > 0.01 && free(x + Math.sign(ux) * 0.25, z, 1.0), sz = Math.abs(uz) > 0.01 && free(x, z + Math.sign(uz) * 0.25, 1.0);
    if (sx && (!sz || Math.abs(ux) >= Math.abs(uz))) x += Math.sign(ux) * 0.25;
    else if (sz) z += Math.sign(uz) * 0.25;
    else return false;
  }
  return false;
}
// a way in for a car: breadth-first over 0.5 m cells free for a 1.0 m half width, in the box round both points
function reachable(qx, qz, px, pz) {
  const c = 0.5, x0 = Math.min(qx, px) - 30, z0 = Math.min(qz, pz) - 30, nx = Math.ceil((Math.abs(qx - px) + 60) / c), nz = Math.ceil((Math.abs(qz - pz) + 60) / c);
  const st = new Uint8Array(nx * nz), q = new Int32Array(nx * nz);
  const ix = x => Math.round((x - x0) / c), iz = z => Math.round((z - z0) / c);
  const s0 = iz(qz) * nx + ix(qx), gi = ix(px), gj = iz(pz);
  let h = 0, t = 0; q[t++] = s0; st[s0] = 1;
  while (h < t) {
    const cur = q[h++], i = cur % nx, j = (cur - i) / nx;
    if (Math.abs(i - gi) <= 1 && Math.abs(j - gj) <= 1) return true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const k = nj * nx + ni; if (st[k]) continue;
      st[k] = free(x0 + ni * c, z0 + nj * c, 1.0) ? 1 : 2;
      if (st[k] === 1) q[t++] = k;
    }
  }
  return false;
}

// ---- the gaps ----
const NT = S.filter(s => s.kind !== 'tree');
const gaps = [];
for (const a of NT) for (const b of NT) {
  if (a === b) continue;
  for (const ax of [1, 0]) {                                          // ax 1: the gap runs along x (the two face each other across z)
    const [aLo, aHi, bLo, bHi] = ax ? [a.x - a.hx, a.x + a.hx, b.x - b.hx, b.x + b.hx] : [a.z - a.hz, a.z + a.hz, b.z - b.hz, b.z + b.hz];
    const over = Math.min(aHi, bHi) - Math.max(aLo, bLo);
    if (over < 4.8) continue;
    const aF = ax ? a.z + a.hz : a.x + a.hx, bN = ax ? b.z - b.hz : b.x - b.hx;   // a lies on the low side of b
    const w = bN - aF;
    if (w < 2.4 || w > 3.6) continue;
    const along = (Math.max(aLo, bLo) + Math.min(aHi, bHi)) / 2, across = (aF + bN) / 2;
    const x = Math.round((ax ? along : across) * 10) / 10, z = Math.round((ax ? across : along) * 10) / 10;
    if (!offGrid(x) || !offGrid(z)) continue;
    load(x, z);
    if (!carClear(x, z, ax)) continue;
    if (runFrom(x, z, ax, 1 - ax, 12) < 6 || runFrom(x, z, -ax, -(1 - ax), 12) < 6) continue;
    if (gaps.some(g => Math.hypot(g.x - x, g.z - z) < 20)) continue;
    gaps.push({ x, z, ax, w: Math.round(w * 100) / 100, kinds: (a.kind || '?') + '/' + (b.kind || '?') });
  }
}
gaps.sort((p, q) => Math.abs(p.w - 2.8) - Math.abs(q.w - 2.8) || p.x - q.x || p.z - q.z);
console.error(`${gaps.length} gaps within ${R} m of (0, 0), nearest 2.8 m wide first:`);
const hash = (a, b) => { let h = (Math.round(a) * 73856093) ^ (Math.round(b) * 19349663); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0; };
const picks = [];
for (const g of gaps) {
  const opts = [];
  for (let qx = Math.round(g.x) - 34; qx <= Math.round(g.x) + 34; qx++) for (let qz = Math.round(g.z) - 34; qz <= Math.round(g.z) + 34; qz++) {
    const d = Math.hypot(qx - g.x, qz - g.z); if (d < 26 || d > 34) continue;
    opts.push({ qx, qz, d });
  }
  opts.sort((p, q) => Math.abs(p.d - 30) - Math.abs(q.d - 30) || hash(p.qx, p.qz) - hash(q.qx, q.qz));
  let pick = null;
  for (const o of opts) {
    load(o.qx, o.qz);
    if (!free(o.qx, o.qz, 2.4)) continue;
    if (runFrom(o.qx, o.qz, 1, 0, 6) + runFrom(o.qx, o.qz, -1, 0, 6) < 12 || runFrom(o.qx, o.qz, 0, 1, 6) + runFrom(o.qx, o.qz, 0, -1, 6) < 12) continue;
    if (!losBlocked(o.qx, o.qz, g.x, g.z) || wallRun(o.qx, o.qz, g.x, g.z) < 6) continue;
    if (pushReaches(o.qx, o.qz, g.x, g.z)) continue;
    if (!reachable(o.qx, o.qz, g.x, g.z)) continue;
    pick = o; break;
  }
  console.error(`  (${g.x}, ${g.z}) along ${g.ax ? 'x' : 'z'}, ${g.w} m between ${g.kinds}: ${pick ? `pursuer from (${pick.qx}, ${pick.qz}), ${pick.d.toFixed(1)} m off` : 'no start for the pursuer'}`);
  if (pick && picks.length < N) picks.push({ ...g, qx: pick.qx, qz: pick.qz });
}
console.log(picks.map(p => `    { x: ${p.x}, z: ${p.z}, h: ${p.ax ? 'Math.PI / 2' : '0'}, qx: ${p.qx}, qz: ${p.qz} }`).join(',\n'));
if (process.env.ASCII) for (const p of picks) {
  load(p.x, p.z);
  console.error(`gap (${p.x}, ${p.z}), 1 m a column and 2 m a row, x to the right, z down: '#' wall, 'o' other solid, 't' tree, 'P' player, 'Q' pursuer`);
  for (let z = p.z - 36; z <= p.z + 36; z += 2) {
    let row = '';
    for (let x = p.x - 44; x <= p.x + 44; x++) {
      if (Math.abs(x - p.x) < 1 && Math.abs(z - p.z) < 1.5) { row += 'P'; continue; }
      if (Math.abs(x - p.qx) < 1 && Math.abs(z - p.qz) < 1.5) { row += 'Q'; continue; }
      let ch = '.';
      for (const s of W.solidsNear(x, z, 1)) { if (!(s.hx >= 0) || s.headroom >= 1.6 || s.maxY < 0.5) continue; if (Math.abs(x - s.x) <= s.hx && Math.abs(z - s.z) <= s.hz) { ch = WALL.has(s.kind) ? '#' : s.kind === 'tree' ? 't' : 'o'; break; } }
      row += ch;
    }
    console.error(row);
  }
}
