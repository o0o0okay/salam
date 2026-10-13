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
import { player } from './state.js';
import { CHUNK, hash2, ck } from './utils.js';
import { radarStreets, RIVER_ROW } from './flyover.js';
import { districtOf } from './districts.js';
import { chunks } from './chunkState.js';
import { ISLAND_R, ISLAND_MIN, ISLAND_MAX } from './island.js';

const LAND = { centre: '#ebe5d5', old: '#e6dbc3', industrial: '#dcd8cd', suburb: '#e0e4c9', harbour: '#d3e2e8' };
const C = {
  sea: '#9fcde4', beach: '#efe4c6', casing: '#b9b1a0', street: '#fffefb', main: '#f6ad3e', bank: '#b5dbeb', water: '#72bfe4', deck: '#9c9385',
  building: '#c6c0b2', park: '#b8dc98', quay: '#d9d2c0', you: '#e63946',
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

// a value in [0, 1) from a block and a salt, for the generic building layout
const hb = (cx, cz, k) => hash2(cx * 31 + k * 7 + 5, cz * 17 + k * 3 + 11) / 4294967296;

function learn() {
  for (const [key, ch] of chunks) {
    if (ch.mapType !== undefined && !seen.has(key)) seen.set(key, { type: ch.mapType, water: ch.radarWater || [] });
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

  // 1. the ground of each block, by district; parks and the harbour quay where the block has been built
  for (let cx = gx0; cx < gx1; cx++) for (let cz = gz0; cz < gz1; cz++) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    rect(x0, z0, CHUNK, CHUNK, LAND[districtOf(cx, cz)] || LAND.centre);
    const k = seen.get(ck(cx, cz));
    if (k && k.type === 'park') rect(x0 + 8, z0 + 8, CHUNK - 16, CHUNK - 16, C.park);
    else if (k && k.type === 'harbour') rect(x0 + 40 - 28, z0 + 40 - 28, 56, 56, C.quay);
    else {
      // 2. generic buildings on the block: up to four in the quarters, always clear of the streets (8 m in)
      for (let q = 0; q < 4; q++) {
        if (hb(cx, cz, q) < 0.2) continue;
        const qx = x0 + 8 + (q & 1) * 32, qz = z0 + 8 + (q >> 1) * 32;
        const w = 16 + hb(cx, cz, q + 4) * 8, d = 16 + hb(cx, cz, q + 8) * 8;
        rect(qx + 3 + hb(cx, cz, q + 12) * Math.max(0, 26 - w), qz + 3 + hb(cx, cz, q + 16) * Math.max(0, 26 - d), w, d, C.building);
      }
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
  for (const k of seen.values()) for (const [x, z, w, d, kind] of k.water) {
    if (kind === 'deck') rect(x, z, w, d, C.street);
  }

  // 6. the route from the car to the mark (a blue line with a white casing, as in a navigation map), the car, the pin
  if (mark) {
    const ax = sx(player.x), ay = sy(player.z), bx = sx(mark.x), by = sy(mark.z);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = C.route; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
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
    const label = fmtDist(Math.hypot(mark.x - player.x, mark.z - player.z));
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
    ? 'Mark: ' + fmtDist(Math.hypot(mark.x - player.x, mark.z - player.z)) + ' from the car'
    : 'Left click: mark a place · Right click: clear';
}

function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; }

export function mapOpen() { return open; }

export function toggleMap() {
  if (!overlay) build();
  open = !open;
  overlay.style.display = open ? 'block' : 'none';
  if (open) {
    size();
    view.cx = player.x; view.cz = player.z;
    draw();
    timer = setInterval(draw, 100);
  } else {
    clearInterval(timer); timer = 0;
  }
}
