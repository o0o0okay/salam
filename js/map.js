/* The city map (M): a full-screen street map of the whole city, drawn in the style of a printed town map.
 *
 * What is exact, for the whole city, from the rules the city is built with (no chunk has to be loaded):
 *   - the open streets (radarStreets); the two main roads, the avenue (x = 0) and the cross street (z = 0), are orange;
 *   - the river: the straight water line at z = RIVER_ROW * CHUNK, with its bridge decks where the streets cross it;
 *   - the districts, as the colour of the ground.
 * What is known only where the city has been built (the chunks are generated as you drive near them): parks, and the
 * harbour quay and basin. Those are remembered from then on (`seen`). Elsewhere the buildings are a generic layout.
 *
 * Controls on the map: drag to move, the wheel (or + / -) to zoom, a left click to mark a place, a right click or
 * "Clear" to remove the mark, "Me" to centre on the car. M or Escape closes it. The game keeps running behind it.
 */
import { player, game } from './state.js';
import { CHUNK, hash2, ck } from './utils.js';
import { radarStreets, RIVER_ROW, segClosed } from './flyover.js';
import { AVENUES, AVENUE_W } from './avenues.js';
import { districtOf } from './districts.js';
import { chunks } from './chunkState.js';
import { ISLAND_R, ISLAND_MIN, ISLAND_MAX, CORE } from './island.js';

const LAND = { centre: '#ebe5d5', old: '#e6dbc3', industrial: '#dcd8cd', suburb: '#e0e4c9', harbour: '#d3e2e8' };
const C = {
  sea: '#9fcde4', beach: '#efe4c6', casing: '#9d988c', street: '#b9b6ae', main: '#f6ad3e', bank: '#b5dbeb', water: '#72bfe4', deck: '#9c9385',
  building: '#c6c0b2', park: '#a6d57f', quay: '#d9d2c0', you: '#e63946',
  // the building roofs, as in the reference: sand, orange, rose, blue, green, pale grey, brick
  roofs: ['#f0e2b8', '#e8934a', '#ef8f96', '#6fa8de', '#8fc777', '#e3dfd6', '#c46d4c'],
  tree: '#4d8f3c', treeLight: '#7fbf5e', lot: '#bfbab0', lotLine: '#f4f3ee', dash: '#ffffff',
  pin: '#ea4335', route: '#4285f4', label: '#1a73e8',
};
const ZOOM_MIN = 0.12, ZOOM_MAX = 2.5;
const DIST_NAMES = { centre: 'City centre', old: 'Old town', industrial: 'Industrial', suburb: 'Suburbs', harbour: 'Harbour' };

const view = { cx: 0, cz: 0, s: 0.45 };     // centre (world metres), screen pixels per metre
let mark = null;                           // { x, z } or null
let open = false, timer = 0, W = 0, H = 0, dpr = 1;
let overlay, canvas, ctx, infoBox;
const seen = new Map();                    // chunk key -> { type, water } for chunks that have been built
let streetKey = '', streetCache = [];      // the open streets for the visible range, cached while the range is unchanged

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick) {
  const b = el('button', 'pointer-events:auto;background:#fff;border:1px solid #888;border-radius:4px;padding:6px 12px;'
    + 'font:14px monospace;color:#222;cursor:pointer;', label);
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); draw(); });
  return b;
}

function build() {
  overlay = el('div', 'position:fixed;inset:0;display:none;z-index:18;background:#f1ede4;font-family:monospace;'
    + 'color:#222;user-select:none;touch-action:none;');
  canvas = el('canvas', 'position:absolute;inset:0;width:100%;height:100%;cursor:grab;');
  ctx = canvas.getContext('2d');
  overlay.appendChild(canvas);

  const tl = el('div', 'position:absolute;left:16px;top:14px;pointer-events:none;background:rgba(255,255,255,.85);'
    + 'padding:10px 12px;border-radius:6px;font-size:13px;line-height:1.6;');
  tl.innerHTML = '<b style="font-size:16px">MAP</b>'
    + Object.keys(DIST_NAMES).map(k => `<div><span style="display:inline-block;width:12px;height:12px;background:${LAND[k]};`
      + `border:1px solid #bbb;margin-right:6px;vertical-align:-1px"></span>${DIST_NAMES[k]}</div>`).join('');
  overlay.appendChild(tl);
  infoBox = el('div', 'position:absolute;left:16px;bottom:14px;background:rgba(255,255,255,.85);padding:8px 12px;'
    + 'border-radius:6px;font-size:13px;pointer-events:none;');
  overlay.appendChild(infoBox);

  const bar = el('div', 'position:absolute;right:16px;top:14px;display:flex;gap:8px;');
  bar.append(button('Me', () => { view.cx = player.x; view.cz = player.z; }),
    button('Clear mark', () => { mark = null; }),
    button('+', () => zoomAt(W / 2, H / 2, 1.25)),
    button('\u2212', () => zoomAt(W / 2, H / 2, 0.8)),
    button('Close (M)', () => toggleMap()));
  overlay.appendChild(bar);
  document.body.appendChild(overlay);

  // The map is drawn in its own canvas, so it pans and zooms with the pointer and marks places with a click.
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false, btn: e.button };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      canvas.style.cursor = 'grabbing';
      view.cx = drag.cx - dx / view.s; view.cz = drag.cz + dy / view.s;
      draw();
    }
  });
  const release = e => {
    if (drag && !drag.moved) {
      if (drag.btn === 0) { const w = worldAt(e.clientX, e.clientY); mark = { x: w.x, z: w.z }; }
      else if (drag.btn === 2) mark = null;
      draw();
    }
    drag = null; canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { drag = null; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  window.addEventListener('resize', () => { if (open) { size(); draw(); } });
}

function size() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
}

// screen point -> world point, north (+z) up
function worldAt(px, py) { return { x: view.cx + (px - W / 2) / view.s, z: view.cz - (py - H / 2) / view.s }; }
const sx = x => W / 2 + (x - view.cx) * view.s;
const sy = z => H / 2 - (z - view.cz) * view.s;

// zoom by f, keeping the world point under (px, py) where it is on screen
function zoomAt(px, py, f) {
  const before = worldAt(px, py);
  view.s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.s * f));
  const after = worldAt(px, py);
  view.cx += before.x - after.x; view.cz += before.z - after.z;
  draw();
}

// a rectangle in world metres (x, z = its lower-left corner, w, d) filled in colour c
function rect(x, z, w, d, c) {
  ctx.fillStyle = c;
  ctx.fillRect(sx(x), sy(z + d), w * view.s, d * view.s);
}

// the open streets in the visible range, from radarStreets; cached while the range of chunks is the same
function streetsIn(gx0, gx1, gz0, gz1) {
  const key = gx0 + ',' + gx1 + ',' + gz0 + ',' + gz1;
  if (key !== streetKey) { streetKey = key; streetCache = radarStreets(gx0, gx1, gz0, gz1); }
  return streetCache;
}

// The main roads are the avenue (x = 0: the streets with x = -8 and w = 16, which includes junction squares on it)
// and the cross street (z = 0: the streets with z = -8 and d = 16). Nothing else has either coordinate.
const isMain = ([x, z, w, d]) => (x === -8 && w === 16) || (z === -8 && d === 16);

// the roof colour of a building, from where it stands (the same colour every time it is drawn)
const roofOf = (x, z) => Math.abs(Math.round(x * 3 + z * 7)) % 7;

function learn() {
  for (const [key, ch] of chunks) {
    if (ch.mapType !== undefined && !seen.has(key)) {
      // the real buildings of the block (its solids of kind 'building'; thin walls and banks are not buildings), and its trees
      const blds = ch.solids.filter(so => so.kind === 'building' && Math.min(so.hx, so.hz) >= 2)
        .map(so => [so.x - so.hx, so.z - so.hz, 2 * so.hx, 2 * so.hz, roofOf(so.x, so.z)]);
      const trees = (ch.trees || []).map(t => [t.x, t.z]);
      seen.set(key, { type: ch.mapType, water: ch.radarWater || [], blds, trees });
    }
  }
}

function draw() {
  if (!open || !ctx) return;
  learn();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.sea; ctx.fillRect(0, 0, W, H);                // the sea, outside the island
  rect(ISLAND_MIN, ISLAND_MIN, ISLAND_MAX - ISLAND_MIN, ISLAND_MAX - ISLAND_MIN, C.beach);   // the beach round the island

  const half = { x: W / 2 / view.s, z: H / 2 / view.s };
  // the blocks in view, on the island only (chunks -ISLAND_R..ISLAND_R-1)
  const gx0 = Math.max(-ISLAND_R, Math.floor((view.cx - half.x) / CHUNK) - 1), gx1 = Math.min(ISLAND_R, Math.ceil((view.cx + half.x) / CHUNK) + 1);
  const gz0 = Math.max(-ISLAND_R, Math.floor((view.cz - half.z) / CHUNK) - 1), gz1 = Math.min(ISLAND_R, Math.ceil((view.cz + half.z) / CHUNK) + 1);

  // 1. the ground of each block, by district; then, for a block the player has been near (it is built and remembered),
  // its parks, its harbour quay, its real buildings and its real trees. A block never visited is only its ground, so the
  // map never shows a building that is not in the world.
  for (let cx = gx0; cx < gx1; cx++) for (let cz = gz0; cz < gz1; cz++) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    rect(x0, z0, CHUNK, CHUNK, LAND[districtOf(cx, cz)] || LAND.centre);
    const k = seen.get(ck(cx, cz));
    if (!k) continue;
    if (k.type === 'park') rect(x0 + 8, z0 + 8, CHUNK - 16, CHUNK - 16, C.park);
    else if (k.type === 'harbour') rect(x0 + 40 - 28, z0 + 40 - 28, 56, 56, C.quay);
    for (const [x, z, w, d, roof] of k.blds) {
      rect(x + 1.2, z + 1.2, w, d, '#8d8779');                 // the shadow edge
      rect(x, z, w, d, C.roofs[roof]);
    }
    if (view.s > 0.12) for (const [tx, tz] of k.trees) {
      ctx.beginPath(); ctx.arc(sx(tx), sy(tz), Math.max(1.6, 4.2 * view.s), 0, Math.PI * 2);
      ctx.fillStyle = C.tree; ctx.fill();
      ctx.beginPath(); ctx.arc(sx(tx) - 1.2 * view.s, sy(tz) - 1.2 * view.s, Math.max(0.9, 2.2 * view.s), 0, Math.PI * 2);
      ctx.fillStyle = C.treeLight; ctx.fill();
    }
  }

  // 3. the river: its bank and channel, in every visible block (straight, at z = RIVER_ROW * CHUNK, 8 m wide)
  const rz = RIVER_ROW * CHUNK;
  const cw = Math.max(8, 7 / view.s);                              // the channel, at least 7 px wide on screen
  const rx0 = Math.max(view.cx - half.x, ISLAND_MIN), rw = Math.min(view.cx + half.x, ISLAND_MAX) - rx0;   // it runs out to the sea
  if (rw > 0) {
    rect(rx0, rz - cw * 1.3, rw, cw * 2.6, C.bank);
    rect(rx0, rz - cw / 2, rw, cw, C.water);
  }

  // 4. the water and bridge decks that are known from the built chunks (the harbour basin, the river crossings)
  for (const k of seen.values()) for (const [x, z, w, d, kind] of k.water) {
    if (x > view.cx + half.x || x + w < view.cx - half.x || z > view.cz + half.z || z + d < view.cz - half.z) continue;
    if (kind === 'water') rect(x, z, w, d, C.water);
  }

  // 5. the streets: a casing, then the minor streets, then the main roads on top
  const st = streetsIn(gx0, gx1, gz0, gz1);
  const pad = Math.max(2.5, 1.6 / view.s);                         // the casing: a thin dark edge round every street
  for (const [x, z, w, d] of st) rect(x - pad, z - pad, w + 2 * pad, d + 2 * pad, C.casing);
  for (const r of st) if (!isMain(r)) rect(r[0], r[1], r[2], r[3], C.street);
  for (const r of st) if (isMain(r)) rect(r[0], r[1], r[2], r[3], C.main);
  if (view.s > 0.2) {
    // the centre line of each straight street: dashed white, like the reference's roads
    ctx.save(); ctx.strokeStyle = C.dash; ctx.lineWidth = Math.max(1.4, 0.9 * view.s); ctx.setLineDash([2.5 * view.s, 2.5 * view.s]);
    for (const r of st) {
      if (r[2] === r[3]) continue;                     // a junction square: no line
      ctx.beginPath();
      if (r[2] < r[3]) { ctx.moveTo(sx(r[0] + r[2] / 2), sy(r[1])); ctx.lineTo(sx(r[0] + r[2] / 2), sy(r[1] + r[3])); }
      else { ctx.moveTo(sx(r[0]), sy(r[1] + r[3] / 2)); ctx.lineTo(sx(r[0] + r[2]), sy(r[1] + r[3] / 2)); }
      ctx.stroke();
    }
    ctx.restore();
  }
  // the diagonal avenues (js/avenues.js): a main road, drawn as a thick line with its casing
  for (const av of AVENUES) {
    ctx.beginPath(); ctx.moveTo(sx(av.a[0]), sy(av.a[1])); ctx.lineTo(sx(av.b[0]), sy(av.b[1]));
    ctx.lineCap = 'butt';
    ctx.strokeStyle = C.casing; ctx.lineWidth = AVENUE_W * view.s + 2 * pad; ctx.stroke();
    ctx.strokeStyle = C.main; ctx.lineWidth = AVENUE_W * view.s; ctx.stroke();
  }
  for (const k of seen.values()) for (const [x, z, w, d, kind] of k.water) {
    if (kind === 'deck') rect(x, z, w, d, C.street);
  }

  // 6. the road route from the car to the mark (a blue line with a white casing, as in a navigation map), the car, the pin.
  // If there is no street route, the straight line is drawn instead and the distance is the straight one.
  const route = currentRoute();
  if (mark) {
    const pts = route ? route.pts : [[player.x, player.z], [mark.x, mark.z]];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, c] of [[9, '#ffffff'], [5, C.route]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([x, z], k) => (k ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
      ctx.stroke();
    }
  }
  const fx = Math.sin(player.h), fy = -Math.cos(player.h);      // forward on the map (at h = 0 the car faces up)
  const px = sx(player.x), py = sy(player.z);
  ctx.fillStyle = C.you; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px + fx * 16, py + fy * 16);
  ctx.lineTo(px - fx * 9 - fy * 9, py - fy * 9 + fx * 9);
  ctx.lineTo(px - fx * 9 + fy * 9, py - fy * 9 - fx * 9);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // the mark: a red location pin like Google Maps (its tip is the marked point), with a blue distance label above it
  if (mark) {
    const tx = sx(mark.x), ty = sy(mark.z);                      // the tip of the pin = the marked point
    const hy = ty - 30, R = 11;                                  // the head of the pin, 30 px above the tip
    ctx.fillStyle = C.pin; ctx.strokeStyle = '#a52714'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - R * 0.78, hy + R * 0.45); ctx.lineTo(tx + R * 0.78, hy + R * 0.45); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(tx, hy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(tx, hy, 4.2, 0, Math.PI * 2); ctx.fill();
    const label = fmtDist(route ? route.len : Math.hypot(mark.x - player.x, mark.z - player.z));
    ctx.font = 'bold 14px monospace';
    const tw = ctx.measureText ? ctx.measureText(label).width : label.length * 9;
    const bx0 = tx - tw / 2 - 9, by0 = hy - R - 36;
    ctx.fillStyle = C.label; ctx.fillRect(bx0, by0, tw + 18, 26);
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, bx0 + 9, by0 + 18);
  }

  // the scale bar (200 m) and the distance to the mark
  const bw = 200 * view.s;
  ctx.fillStyle = '#222'; ctx.fillRect(W - 32 - bw, H - 34, bw, 4);
  ctx.font = '13px monospace'; ctx.fillStyle = '#222'; ctx.fillText('200 m', W - 32 - bw, H - 40);
  infoBox.textContent = mark
    ? (route ? 'Mark: ' + fmtDist(route.len) + ' by road' : 'Mark: ' + fmtDist(Math.hypot(mark.x - player.x, mark.z - player.z)) + ' straight (no street route)')
    : 'Left click: mark a place · Right click: clear';
}

// ---- the road distance ----
// The streets as a graph of junctions: a junction is a crossing of the core's street lines (x = i * CHUNK, z = j * CHUNK),
// and an open street (segClosed in js/flyover.js is false) joins two neighbouring junctions. Every street is one block
// long, so the shortest route is a Dijkstra over that graph. The car and the mark each join the graph at the corners
// of their own block (the straight leg is drawn across the block to the corner); a point on the same street as the other
// is joined to it directly.
const GN = 2 * CORE + 1;
const nid = (i, j) => (i + CORE) * GN + (j + CORE);
let adjCache = null;
function roadGraph() {
  if (adjCache) return adjCache;
  const adj = Array.from({ length: GN * GN }, () => []);
  for (let i = -CORE; i <= CORE; i++) for (let j = -CORE; j <= CORE; j++) {
    if (i < CORE && !segClosed('x', i, j)) { adj[nid(i, j)].push([nid(i + 1, j), CHUNK]); adj[nid(i + 1, j)].push([nid(i, j), CHUNK]); }
    if (j < CORE && !segClosed('z', i, j)) { adj[nid(i, j)].push([nid(i, j + 1), CHUNK]); adj[nid(i, j + 1)].push([nid(i, j), CHUNK]); }
  }
  return (adjCache = adj);
}
// The ways from a point onto the streets: for each junction a street reaches, the nearest point P of that street to the
// point, and the leg (point -> P, then along the street to the junction). The legs are taken only from the streets that
// bound the point's own block (ring 0); if the block has no open street at all (a closed estate or park), the next ring
// of blocks is tried, and so on up to three rings. So a car on a street starts from that street, and no leg runs across
// a block to a far street. Returns { legs, segs }: legs is a Map junction node -> { acc, x, z } (the best leg per
// junction); segs lists every street the point joins: { key, t, leg, x, z } where t is the distance of P from the
// street's first junction, so two points on the same street can be joined directly.
function accessLegs(p, adj) {
  const bi = Math.floor(p.x / CHUNK), bj = Math.floor(p.z / CHUNK);
  for (let r = 0; r <= 3; r++) {
    const legs = new Map(), segs = [];
    const put = (n, acc, x, z) => { const b = legs.get(n); if (!b || acc < b.acc) legs.set(n, { acc, x, z }); };
    for (let i = bi - r - 1; i <= bi + r + 1; i++) for (let j = bj - r - 1; j <= bj + r + 1; j++) {
      if (Math.abs(i) > CORE || Math.abs(j) > CORE) continue;
      if (j < CORE && !segClosed('z', i, j)) {                 // the z-street from junction (i, j) to (i, j + 1): it bounds blocks (i - 1, j) and (i, j)
        const ring = Math.min(Math.max(Math.abs(i - 1 - bi), Math.abs(j - bj)), Math.max(Math.abs(i - bi), Math.abs(j - bj)));
        if (ring <= r) {
          const zc = Math.min(Math.max(p.z, j * CHUNK), (j + 1) * CHUNK), px = i * CHUNK;
          const leg = Math.hypot(p.x - px, p.z - zc);
          put(nid(i, j), leg + (zc - j * CHUNK), px, zc);
          put(nid(i, j + 1), leg + ((j + 1) * CHUNK - zc), px, zc);
          segs.push({ key: 'z' + i + ',' + j, t: zc - j * CHUNK, leg, x: px, z: zc });
        }
      }
      if (i < CORE && !segClosed('x', i, j)) {                 // the x-street from junction (i, j) to (i + 1, j): it bounds blocks (i, j - 1) and (i, j)
        const ring = Math.min(Math.max(Math.abs(i - bi), Math.abs(j - 1 - bj)), Math.max(Math.abs(i - bi), Math.abs(j - bj)));
        if (ring <= r) {
          const xc = Math.min(Math.max(p.x, i * CHUNK), (i + 1) * CHUNK), pz = j * CHUNK;
          const leg = Math.hypot(p.x - xc, p.z - pz);
          put(nid(i, j), leg + (xc - i * CHUNK), xc, pz);
          put(nid(i + 1, j), leg + ((i + 1) * CHUNK - xc), xc, pz);
          segs.push({ key: 'x' + i + ',' + j, t: xc - i * CHUNK, leg, x: xc, z: pz });
        }
      }
    }
    if (legs.size) return { legs, segs };
  }
  return { legs: new Map(), segs: [] };
}
// Dijkstra from the start nodes (each with its leg length): returns the distance and the predecessor of every node
function shortest(starts) {
  const adj = roadGraph(), dist = new Float64Array(GN * GN).fill(Infinity), prev = new Int32Array(GN * GN).fill(-1);
  const hd = [], hn = [];
  const swap = (a, k, m) => { [a[k], a[m]] = [a[m], a[k]]; };
  const push = (d, n) => {
    hd.push(d); hn.push(n);
    for (let k = hd.length - 1; k > 0;) { const q = (k - 1) >> 1; if (hd[q] <= hd[k]) break; swap(hd, k, q); swap(hn, k, q); k = q; }
  };
  const pop = () => {
    const d = hd[0], n = hn[0], ld = hd.pop(), ln = hn.pop();
    if (hd.length) {
      hd[0] = ld; hn[0] = ln;
      for (let k = 0;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === k) break;
        swap(hd, k, m); swap(hn, k, m); k = m;
      }
    }
    return [d, n];
  };
  for (const s of starts) if (s.acc < dist[s.n]) { dist[s.n] = s.acc; push(s.acc, s.n); }
  while (hd.length) {
    const [d, n] = pop();
    if (d > dist[n]) continue;
    for (const [m, w] of adj[n]) if (d + w < dist[m]) { dist[m] = d + w; prev[m] = n; push(d + w, m); }
  }
  return { dist, prev };
}
// The road route from one point to another. Its `pts` is the whole way: the point, its step onto the street, the
// street's corners, the step off it, the point. `street` lists only the junctions (corners) of the way, and `sIdx` gives
// the index in `pts` of each of them; `cum` is the length along `pts` up to each point. Returns null if no street is
// near enough to either point.
function routeOf(from, to, list) {
  const pts = [[from.x, from.z]], street = [], sIdx = [];
  for (const q of list) {
    if (q.st) { sIdx.push(pts.length); street.push([q.x, q.z]); }
    pts.push([q.x, q.z]);
  }
  pts.push([to.x, to.z]);
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { len: cum[cum.length - 1], pts, street, sIdx, cum };
}
function roadRoute(from, to) {
  const adj = roadGraph();
  const A = accessLegs(from, adj), B = accessLegs(to, adj);
  if (!A.legs.size || !B.legs.size) return null;
  // (a) both ends on one street: walk along it, without going out to a corner and back
  let direct = null;
  const bseg = new Map(B.segs.map(s => [s.key, s]));
  for (const a of A.segs) {
    const b = bseg.get(a.key);
    if (!b) continue;
    const len = a.leg + b.leg + Math.abs(a.t - b.t);
    if (!direct || len < direct.len) direct = { len, a, b };
  }
  // (b) through the corners of the street network
  const { dist, prev } = shortest([...A.legs].map(([n, l]) => ({ n, acc: l.acc })));
  let best = null;
  for (const [n, l] of B.legs) {
    const len = dist[n] + l.acc;
    if (isFinite(len) && (!best || len < best.len)) best = { len, end: n };
  }
  if (direct && (!best || direct.len <= best.len)) {
    return routeOf(from, to, [{ x: direct.a.x, z: direct.a.z, st: true }, { x: direct.b.x, z: direct.b.z, st: true }]);
  }
  if (!best) return null;
  const nodes = [];
  for (let n = best.end; n !== -1; n = prev[n]) nodes.push(n);
  nodes.reverse();
  const worldOf = n => [(Math.floor(n / GN) - CORE) * CHUNK, ((n % GN) - CORE) * CHUNK];
  const first = A.legs.get(nodes[0]), last = B.legs.get(best.end);
  const list = [];
  if (first) list.push({ x: first.x, z: first.z, st: false });
  for (const n of nodes) { const [x, z] = worldOf(n); list.push({ x, z, st: true }); }
  if (last) list.push({ x: last.x, z: last.z, st: false });
  return routeOf(from, to, list);
}
// The point of a route nearest to `p`: its distance d, and its place s (the length along the route up to it).
function nearestOn(route, p) {
  let best = { d: Infinity, s: 0, k: 0, x: p.x, z: p.z };
  const { pts, cum } = route;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / L2)) : 0;
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(p.x - qx, p.z - qz);
    if (d < best.d) best = { d, s: cum[k] + Math.hypot(qx - ax, qz - az), k, x: qx, z: qz };
  }
  return best;
}
// The route for the current mark. It is planned once, from where the car was when the mark was set, and then kept
// while the car stays on it (within 12 m): the route does not change shape as the car drives along it. Only when the car
// leaves it, or the mark moves, is a new route planned. The returned view is the rest of the route, from the car:
// { len (what is left), pts (from the car on), base (the planned route), s (the car's place along base) }.
const ON_ROUTE = 12;
let routeCache = { to: null, base: null, view: null, from: null };
export function currentRoute() {
  if (!mark) return null;
  const car = { x: player.x, z: player.z };
  const c = routeCache;
  if (c.to !== mark) { c.to = mark; c.base = null; c.view = null; c.from = null; }
  let near = c.base ? nearestOn(c.base, car) : null;
  if (!near || near.d > ON_ROUTE) {
    // plan again, but not more often than every 8 m while there is no route (no street near the car)
    if (!c.base && c.from && Math.hypot(c.from.x - car.x, c.from.z - car.z) <= 8) return null;
    c.from = car;
    c.base = roadRoute(car, mark); c.view = null;
    if (!c.base) return null;
    near = nearestOn(c.base, car);
  }
  if (c.view && Math.hypot(c.view.car.x - car.x, c.view.car.z - car.z) < 0.5) return c.view;
  const b = c.base;
  const pts = [[car.x, car.z], [near.x, near.z], ...b.pts.slice(near.k + 1)];
  c.view = { len: b.len - near.s, pts, street: b.street, base: b, s: near.s, car: { x: car.x, z: car.z } };
  return c.view;
}

function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; }

export function mapOpen() { return open; }
// the marked place (or null): the radar shows it too (js/ui.js)
export function currentMark() { return mark; }
let pausedByMap = false;
// A new game starts the map afresh: no mark, no route, and the parts of the city it had seen are forgotten.
export function resetMap() {
  pausedByMap = false;                       // a new game does not inherit the map's pause
  if (open) toggleMap();
  mark = null; routeCache = { to: null, base: null, view: null, from: null }; seen.clear();
}

// The map stops the game while it is open: nothing runs behind it. The map only undoes a pause it made itself.
export function toggleMap() {
  if (!overlay) build();
  open = !open;
  overlay.style.display = open ? 'block' : 'none';
  if (open) {
    size();
    view.cx = player.x; view.cz = player.z;
    draw();
    timer = setInterval(draw, 100);
    if (game.state === 'playing' && !game.paused) { game.paused = true; pausedByMap = true; }
  } else {
    clearInterval(timer); timer = 0;
    if (pausedByMap && game.paused) game.paused = false;
    pausedByMap = false;
  }
}
