/* The city map (M): a full-screen street map of the whole city, drawn in the style of a printed town map.
 *
 * What is exact, for the whole city, from the rules the city is built with (no chunk has to be loaded):
 *   - the open streets (radarStreets); the two main roads, the avenue (x = 0) and the cross street (z = 0), are orange;
 *   - the interchanges (flyovers: the deck, the ramps and the at-grade lanes beside them) and the roundabouts (junction
 *     plazas), from the same rules (nodeAt, plazaAt, atGradeSide in js/flyover.js);
 *   - the tram lines (routeOf in js/tram.js), on the streets;
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
import { radarStreets, RIVER_ROW, segClosed, segFilled, nodeAt, plazaAt, atGradeSide, FLY, roadEdge, bridgeAt, besideFlyover,
  flyoverNear, alongOf, bridgeHeight, laneOffset } from './flyover.js';
import { known, allKnown, learn, forgetSeen, mapVersion } from './mapData.js';
import { routeOf as tramRouteOf } from './tram.js';   // the tram routes (js/tram.js): the same rule the rails are laid by
const RAIL_G = 0.72;      // half the distance between the two rails, in metres (GAUGE in js/tram.js)
import { AVENUES, AVENUE_W } from './avenues.js';
import { districtOf } from './districts.js';
import { ISLAND_R, ISLAND_MIN, ISLAND_MAX, CORE, onIsland } from './island.js';
import { harborInfo } from './harbor.js';

const LAND = { centre: '#c3e08a', old: '#cfe59a', industrial: '#bcd39c', suburb: '#b5dc7f', harbour: '#aad6e0' };
const C = {
  sea: '#9fcde4', beach: '#efe4c6', casing: '#9d988c', street: '#5d6065', main: '#5d6065', bank: '#b5dbeb', water: '#72bfe4', deck: '#9c9385',
  building: '#c6c0b2', park: '#a6d57f', quay: '#d9d2c0', you: '#e63946',
  // the building roofs, as in the reference: sand, orange, rose, blue, green, pale grey, brick
  roofs: ['#f0e2b8', '#e8934a', '#ef8f96', '#6fa8de', '#8fc777', '#e3dfd6', '#c46d4c'],
  tree: '#4d8f3c', treeLight: '#7fbf5e', lot: '#bfbab0', lotLine: '#f4f3ee', dash: '#ffffff',
  pin: '#ea4335', route: '#4285f4', label: '#1a73e8',
};
const ZOOM_MIN = 0.12, ZOOM_MAX = 2.5;
const START_ZOOM = 2.5;   // the map opens at the zoom where its scale bar reads 50 m (the largest zoom)
// The map shows the island and the sea up to PAST_COAST metres beyond its coast, and no further: it cannot be zoomed out
// past that, and the view cannot be moved past it.
const PAST_COAST = 1000;
// the most the view can show: the island and PAST_COAST of sea on each side. At this zoom the view is centred and cannot move.
function minZoom() { return W ? Math.min(W, H) / (ISLAND_MAX - ISLAND_MIN + 2 * PAST_COAST) : ZOOM_MIN; }
function clampView() {
  view.s = Math.min(ZOOM_MAX, Math.max(minZoom(), view.s));
  const hx = W / 2 / view.s, hz = H / 2 / view.s;
  const mid = (ISLAND_MIN + ISLAND_MAX) / 2, span = ISLAND_MAX - ISLAND_MIN + 2 * PAST_COAST;
  const lo = ISLAND_MIN - PAST_COAST, hi = ISLAND_MAX + PAST_COAST;
  view.cx = 2 * hx >= span ? mid : Math.min(hi - hx, Math.max(lo + hx, view.cx));
  view.cz = 2 * hz >= span ? mid : Math.min(hi - hz, Math.max(lo + hz, view.cz));
}
const DIST_NAMES = { centre: 'City centre', old: 'Old town', industrial: 'Industrial', suburb: 'Suburbs', harbour: 'Harbour' };

const view = { cx: 0, cz: 0, s: 0.45 };     // centre (world metres), screen pixels per metre
let mark = null;                           // { x, z } or null
let seaNoteAt = -1e9;                       // when a click in the sea was refused (the map says so for a moment)
let open = false, timer = 0, W = 0, H = 0, dpr = 1;
let overlay, canvas, ctx, infoBox;


let streetKey = '', streetCache = [];      // the open streets for the visible range, cached while the range is unchanged
let noLabels = false;                      // painting for the radar (paintGround): no place names, they would turn with it
let tileBlocks = null;                     // painting for the radar: [bx0, bx1, bz0, bz1], the only blocks whose own ground is drawn

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

// the GPS button: a crosshair; it centres the map on the car, at the zoom the map is at
function gpsButton(onClick) {
  const b = button('', onClick);
  b.title = 'Centre on my car'; b.setAttribute('aria-label', 'Centre on my car');
  b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" style="display:block" fill="none" stroke="#222" stroke-width="2">'
    + '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="#222"/>'
    + '<path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>';
  return b;
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
      + `border:1px solid #bbb;margin-right:6px;vertical-align:-1px"></span>${DIST_NAMES[k]}</div>`).join('')
    + `<div><span style="display:inline-block;width:16px;height:8px;border-top:2px solid #4a4f57;border-bottom:2px solid #4a4f57;margin-right:6px;vertical-align:middle;`
    + `background:repeating-linear-gradient(90deg,#8b6f47 0 2px,transparent 2px 5px)"></span>Tram line</div>`;
  overlay.appendChild(tl);
  infoBox = el('div', 'position:absolute;left:16px;bottom:14px;background:rgba(255,255,255,.85);padding:8px 12px;'
    + 'border-radius:6px;font-size:13px;pointer-events:none;');
  overlay.appendChild(infoBox);

  const bar = el('div', 'position:absolute;right:16px;top:14px;display:flex;gap:8px;');
  bar.append(gpsButton(() => { view.cx = player.x; view.cz = player.z; }),
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
      view.cx = drag.cx + dx / view.s; view.cz = drag.cz + dy / view.s;   // the map is mirrored in x (see sx), so the pan is too
      draw();
    }
  });
  const release = e => {
    if (drag && !drag.moved) {
      if (drag.btn === 0) {
        const w = worldAt(e.clientX, e.clientY);
        if (onIsland(w.x, w.z, 2)) setMark(w.x, w.z);
        else seaNoteAt = performance.now();                 // no pin in the sea
      }
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
function worldAt(px, py) { return { x: view.cx - (px - W / 2) / view.s, z: view.cz - (py - H / 2) / view.s }; }
// The map is north up (+z up the screen), and x is turned round: +x is on the LEFT. This is the driver's view: the car's
// right-hand side is -x when it drives +z (the 3D camera and the radar agree), so the right-hand street is on the right.
// A rectangle with its left edge at x (w wide) is therefore drawn from sx(x + w), its left edge on the screen.
const sx = x => W / 2 - (x - view.cx) * view.s;
const sy = z => H / 2 - (z - view.cz) * view.s;

// zoom by f, keeping the world point under (px, py) where it is on screen
function zoomAt(px, py, f) {
  const before = worldAt(px, py);
  view.s = Math.min(ZOOM_MAX, Math.max(minZoom(), view.s * f));
  const after = worldAt(px, py);
  view.cx += before.x - after.x; view.cz += before.z - after.z;
  draw();
}

// a helicopter pad on a roof (the hospital's): a white disc with a red H, drawn over the building it stands on
function helipad(x, z, r) {
  const X = sx(x), Y = sy(z), R = Math.max(5, r * view.s);
  ctx.save();
  ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.12); ctx.strokeStyle = '#5b6167'; ctx.stroke();
  ctx.fillStyle = '#d6342c'; ctx.font = `bold ${Math.max(8, R * 1.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', X, Y + 0.5);
  ctx.restore();
}
// a rectangle in world metres (x, z = its lower-left corner, w, d) filled in colour c
// a rounded rectangle in world metres (a street: round ends and corners, as in the reference)
function rrect(x, z, w, d, c) {
  const X = sx(x + w), Y = sy(z + d), W2 = w * view.s, D2 = d * view.s;
  ctx.beginPath(); ctx.roundRect(X, Y, W2, D2, Math.min(W2, D2) * 0.4); ctx.fillStyle = c; ctx.fill();
}
// a real place of the city (hospital, school, bank, ...): a white badge with its name, when the map is zoomed in enough
function landmark(x, z, name) {
  const X = sx(x), Y = sy(z);
  ctx.save();
  ctx.font = 'bold 10px system-ui, sans-serif';
  const tw = ctx.measureText(name).width + 12, th = 16;
  if (tw > CHUNK * view.s * 0.92) { ctx.restore(); return; }   // a name wider than its block is left out, not cut off
  ctx.beginPath(); ctx.roundRect(X - tw / 2, Y - th / 2, tw, th, th / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fill();
  ctx.strokeStyle = '#3d4a2a'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#2b3520'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, X, Y + 0.5);
  ctx.restore();
}
function rect(x, z, w, d, c) {
  ctx.fillStyle = c;
  ctx.fillRect(sx(x + w), sy(z + d), w * view.s, d * view.s);
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

// a colour darker (f < 1) or lighter (f > 1) than a #rrggbb colour
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16 & 255)},${c(n >> 8 & 255)},${c(n & 255)})`;
};
// one box seen from above: its roof, flat. A gable roof is two halves with a ridge along the long side.
function box(x, z, w, d, roof, hm, gable) {
  const X = sx(x + w), Y = sy(z + d), W2 = w * view.s, D2 = d * view.s;   // the footprint, top-left corner on screen
  const c = C.roofs[roof];
  ctx.fillStyle = c;
  ctx.fillRect(X, Y, W2, D2);
  if (gable) {
    const along = w >= d;                                          // the ridge runs along the long side
    ctx.fillStyle = shade(c, 0.86);                                // the half in shadow
    if (along) ctx.fillRect(X, Y + D2 / 2, W2, D2 / 2);
    else ctx.fillRect(X + W2 / 2, Y, W2 / 2, D2);
    ctx.strokeStyle = shade(c, 0.6); ctx.lineWidth = 0.6;
    ctx.beginPath();
    if (along) { ctx.moveTo(X, Y + D2 / 2); ctx.lineTo(X + W2, Y + D2 / 2); }
    else { ctx.moveTo(X + W2 / 2, Y); ctx.lineTo(X + W2 / 2, Y + D2); }
    ctx.stroke();
  }
  ctx.strokeStyle = shade(c, 0.6); ctx.lineWidth = 0.7;
  ctx.strokeRect(X, Y, W2, D2);
}
// a building: a plain box, a pitched-roof box, an L-shaped building, or a box with a rooftop unit (by its place)
function building(x, z, w, d, roof, hm, st) {
  if (st === 2 && w > 14 && d > 14) {                              // an L: a leg at the bottom left, a bar along the top
    box(x, z, w * 0.5, d * 0.5, roof, hm, false);
    box(x, z + d * 0.5, w, d * 0.5, roof, hm, false);
    return;
  }
  box(x, z, w, d, roof, hm, st === 1);
  if (st === 3 && w > 8 && d > 8) {                                // a rooftop unit: a small grey box on the roof
    const X = sx(x + w), Y = sy(z + d);
    ctx.fillStyle = shade(C.roofs[roof], 0.7);
    ctx.fillRect(X + w * view.s * 0.55, Y + d * view.s * 0.2, w * view.s * 0.22, d * view.s * 0.26);
  }
}
// a pool in a yard: a free corner of the block (clear of the buildings), and only in some blocks
function poolSpot(cx, cz, blds) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  if (hash2(cx * 7 + 3, cz * 13 + 5) % 3 !== 0) return null;
  const spots = [[x0 + 8, z0 + 8], [x0 + CHUNK - 24, z0 + 8], [x0 + 8, z0 + CHUNK - 20], [x0 + CHUNK - 24, z0 + CHUNK - 20]];
  const start = hash2(cx * 11 + 1, cz * 5 + 9) % 4;
  for (let i = 0; i < 4; i++) {
    const [px, pz] = spots[(start + i) % 4];
    const clear = blds.every(([x, z, w, d]) => !(px - 4 < x + w && px + 18 > x && pz - 4 < z + d && pz + 13 > z));
    if (clear) return [px, pz];
  }
  return null;
}

// a tree as a crown: a shadow, a dark round crown, a light patch on its top-left
function crown(tx, tz) {
  const r = Math.max(2.4, 3.4 * view.s), x = sx(tx), y = sy(tz);
  if (view.s < 0.5) {                                              // zoomed out: one disc (the shadow and the light are too small to see)
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.tree; ctx.fill();
    return;
  }
  ctx.beginPath(); ctx.arc(x + r * 0.7, y + r * 0.7, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40,36,28,0.25)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = shade(C.tree, 0.8); ctx.fill();
  ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.66, 0, Math.PI * 2);
  ctx.fillStyle = C.treeLight; ctx.fill();
}

// ---- the interchanges (flyovers) and the roundabouts (junction plazas), exact from the rules in js/flyover.js ----
// A rectangle in world metres along a main road: `u0..u1` is the run along the road, `hw` the half width across it.
// `edge` is the casing colour round it; (dx, dz) shifts it (the shadow of a deck).
function slab(x0, z0, x1, z1, fill, pad, edge = C.casing, dx = 0, dz = 0) {
  if (pad > 0) rrect(x0 + dx - pad, z0 + dz - pad, x1 - x0 + 2 * pad, z1 - z0 + 2 * pad, edge);
  rrect(x0 + dx, z0 + dz, x1 - x0, z1 - z0, fill);
}
function alongRect(f, u0, u1, hw, fill, pad, edge, dx = 0, dz = 0) {
  if (u1 <= u0) return;
  if (f.axis === 'z') slab(-hw, u0, hw, u1, fill, pad, edge, dx, dz);
  else slab(u0, -hw, u1, hw, fill, pad, edge, dx, dz);
}
// The at-grade lanes: beside a flyover the street gains a lane on the ground, from 8 m to roadEdge() (22 m) out from the
// main road's centre line, along the whole block that carries it (atGradeSide, js/flyover.js). Drawn as the main road.
function drawAtGradeLanes(gx0, gx1, gz0, gz1) {
  const a = FLY.halfW, b = roadEdge(), pad = Math.max(1.2, 0.9 / view.s);
  for (let cx = gx0; cx < gx1; cx++) for (let cz = gz0; cz < gz1; cz++) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    if (atGradeSide(cx, cz, 0)) { rect(x0 + a, z0, b - a, CHUNK, C.main); rect(x0 + b - pad, z0, pad, CHUNK, C.casing); }
    if (atGradeSide(cx, cz, 1)) { rect(x0 + CHUNK - b, z0, b - a, CHUNK, C.main); rect(x0 + CHUNK - b, z0, pad, CHUNK, C.casing); }
    if (atGradeSide(cx, cz, 2)) { rect(x0, z0 + a, CHUNK, b - a, C.main); rect(x0, z0 + b - pad, CHUNK, pad, C.casing); }
    if (atGradeSide(cx, cz, 3)) { rect(x0, z0 + CHUNK - b, CHUNK, b - a, C.main); rect(x0, z0 + CHUNK - b, CHUNK, pad, C.casing); }
  }
}
// The flyovers: a shadow and the deck on the main road over the junction (the crossing street runs underneath it), and
// the two ramps that climb to it from the ground at ±rampEnd. A long bridge runs its deck on past the next junction.
const FLY_DECK = C.street, FLY_RAMP = C.street, FLY_EDGE = C.casing;   // the main roads are asphalt, like every street
function drawFlyovers(gx0, gx1, gz0, gz1) {
  const flys = [];
  for (let k = gx0; k <= gx1; k++) { const f = nodeAt(k, 0); if (f) flys.push(f); }
  for (let k = gz0; k <= gz1; k++) { const f = nodeAt(0, k); if (f) flys.push(f); }
  const hw = FLY.halfW, pad = Math.max(2, 1.4 / view.s);
  for (const f of flys) {
    const D = FLY.deckHalf, R = FLY.rampEnd;
    const a = f.node + f.lo, b = f.node + f.hi;                 // the junction (and a long bridge's far end)
    alongRect(f, a - R, a - D, hw, FLY_RAMP, pad, FLY_EDGE);
    alongRect(f, b + D, b + R, hw, FLY_RAMP, pad, FLY_EDGE);
    alongRect(f, a - D, b + D, hw, 'rgba(40,36,30,0.22)', 0, 'rgba(40,36,30,0.22)', 3, 3);   // the shadow, cast to the south-east
    alongRect(f, a - D, b + D, hw, FLY_DECK, pad * 1.4, FLY_EDGE);
    if (view.s > 0.25) {                                         // the centre line along the deck
      ctx.save(); ctx.strokeStyle = C.dash; ctx.lineWidth = Math.max(1.2, 0.7 * view.s); ctx.setLineDash([2.5 * view.s, 2.5 * view.s]);
      ctx.beginPath();
      if (f.axis === 'z') { ctx.moveTo(sx(0), sy(a - D)); ctx.lineTo(sx(0), sy(b + D)); }
      else { ctx.moveTo(sx(a - D), sy(0)); ctx.lineTo(sx(b + D), sy(0)); }
      ctx.stroke(); ctx.restore();
    }
  }
}
// The tram lines (js/tram.js): a route is a run of street segments that carries rails, and the rails run down the centre line
// of the street. The map draws each segment on that rule (tramRouteOf), as two rails at the game's gauge, with sleepers.
function drawTramLines(gx0, gx1, gz0, gz1) {
  const segs = [];
  for (let k = gx0; k <= gx1; k++) for (let j = gz0; j < gz1; j++) if (tramRouteOf('z', k, j)) segs.push(['z', k, j]);
  for (let k = gz0; k <= gz1; k++) for (let j = gx0; j < gx1; j++) if (tramRouteOf('x', k, j)) segs.push(['x', k, j]);
  if (!segs.length) return;
  const rw = Math.max(1.6, 0.45 * view.s), e = 0.6;                   // a rail's width on screen; each segment runs 0.6 m past its ends so they join
  ctx.save(); ctx.lineCap = 'butt';
  // the track bed: a light band along the centre line, so the track stands out from the dark asphalt
  ctx.strokeStyle = '#e9e3d2'; ctx.lineWidth = Math.max(4, 2 * RAIL_G * view.s + 4); ctx.beginPath();
  for (const [a, k, j] of segs) {
    if (a === 'z') { ctx.moveTo(sx(k * CHUNK), sy(j * CHUNK - e)); ctx.lineTo(sx(k * CHUNK), sy((j + 1) * CHUNK + e)); }
    else { ctx.moveTo(sx(j * CHUNK - e), sy(k * CHUNK)); ctx.lineTo(sx((j + 1) * CHUNK + e), sy(k * CHUNK)); }
  }
  ctx.stroke();
  // the sleepers: a bar across the track every 4 m (when the map is zoomed in far enough to see them)
  if (view.s > 0.25) {
    ctx.strokeStyle = '#8b6f47'; ctx.lineWidth = Math.max(1.2, 0.9 * view.s); ctx.beginPath();
    for (const [a, k, j] of segs) for (let t = 0; t <= CHUNK; t += 4) {
      if (a === 'z') { const z = j * CHUNK + t, x = k * CHUNK; ctx.moveTo(sx(x - 1.3), sy(z)); ctx.lineTo(sx(x + 1.3), sy(z)); }
      else { const x = j * CHUNK + t, z = k * CHUNK; ctx.moveTo(sx(x), sy(z - 1.3)); ctx.lineTo(sx(x), sy(z + 1.3)); }
    }
    ctx.stroke();
  }
  // the two rails, each RAIL_G from the centre line
  ctx.strokeStyle = '#2a2e35'; ctx.lineWidth = rw; ctx.beginPath();
  for (const [a, k, j] of segs) for (const o of [-RAIL_G, RAIL_G]) {
    if (a === 'z') { ctx.moveTo(sx(k * CHUNK + o), sy(j * CHUNK - e)); ctx.lineTo(sx(k * CHUNK + o), sy((j + 1) * CHUNK + e)); }
    else { ctx.moveTo(sx(j * CHUNK - e), sy(k * CHUNK + o)); ctx.lineTo(sx((j + 1) * CHUNK + e), sy(k * CHUNK + o)); }
  }
  ctx.stroke();
  ctx.restore();
}
// The roundabouts: a junction with a plaza is a round asphalt island in its 16 m square, with a grass island in the middle
// (5 m, a curb round it) and the feature on the grass: 0 a fountain, 1 a statue, 2 a tree grove (plazaAt, js/flyover.js).
function drawRoundabouts(gx0, gx1, gz0, gz1) {
  const circle = (x, z, r, c) => { ctx.beginPath(); ctx.arc(sx(x), sy(z), Math.max(0.5, r * view.s), 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); };
  for (let cx = gx0; cx <= gx1; cx++) for (let cz = gz0; cz <= gz1; cz++) {
    const p = plazaAt(cx, cz);
    if (!p) continue;
    const X = cx * CHUNK, Z = cz * CHUNK;
    circle(X, Z, 8.5 + Math.max(1.2, 0.9 / view.s), C.casing);
    circle(X, Z, 8.5, C.street);
    circle(X, Z, 5 + 0.4, '#e9e4d6');                            // the curb
    circle(X, Z, 5, C.park);
    if (p.feature === 0) { circle(X, Z, 1.9, '#ffffff'); circle(X, Z, 1.4, '#5bbde9'); }
    else if (p.feature === 1) circle(X, Z, 1.5, '#8e8e8e');
    else for (const [dx, dz] of [[-2, 0], [2, 0], [0, 2], [0, -2], [0, 0]]) circle(X + dx, Z + dz, 1.5, C.tree);
  }
}

// ---- the base picture ----
// The ground, the blocks, the streets, the water and the tram lines do not change while the map is open (the game is
// paused then), so they are drawn once into an off-screen picture, at one zoom, and that picture is copied to the map on
// each redraw. A pan copies it; a zoom copies the old picture scaled at once and draws the new one a moment later; the
// picture is drawn again only when the view leaves it, or when the map learns new blocks.
const base = { canvas: document.createElement('canvas'), s: 0, ver: -1, x0: 0, x1: 0, z0: 0, z1: 0, timer: 0, due: false };
const LIM = { x0: ISLAND_MIN - CHUNK, x1: ISLAND_MAX + CHUNK, z0: ISLAND_MIN - CHUNK, z1: ISLAND_MAX + CHUNK };
// the ground the picture covers: the view and half a view width on each side, on the island (and its beach)
function wantRect() {
  const hx = W / 2 / view.s, hz = H / 2 / view.s;
  const mx = hx * 0.5, mz = hz * 0.5;
  return { x0: Math.max(LIM.x0, view.cx - hx - mx), x1: Math.min(LIM.x1, view.cx + hx + mx),
           z0: Math.max(LIM.z0, view.cz - hz - mz), z1: Math.min(LIM.z1, view.cz + hz + mz) };
}
function drawBaseCached() {
  const want = wantRect(), ver = mapVersion();
  // the picture is good while the visible part of the map (on the island) is inside it
  const vx0 = Math.max(LIM.x0, view.cx - W / 2 / view.s), vx1 = Math.min(LIM.x1, view.cx + W / 2 / view.s);
  const vz0 = Math.max(LIM.z0, view.cz - H / 2 / view.s), vz1 = Math.min(LIM.z1, view.cz + H / 2 / view.s);
  const covered = vx0 >= base.x0 - 1e-6 && vx1 <= base.x1 + 1e-6 && vz0 >= base.z0 - 1e-6 && vz1 <= base.z1 + 1e-6;
  if (base.s === view.s && base.ver === ver && covered) { blitBase(); return; }
  if (base.s && base.s !== view.s && base.ver === ver && !base.due) {
    // a zoom: the old picture now, scaled; the new one when the zoom has settled (150 ms without another zoom step)
    blitBase();
    clearTimeout(base.timer);
    base.timer = setTimeout(() => { base.timer = 0; base.due = true; draw(); }, 150);
    return;
  }
  base.due = false;
  renderBase(want, ver);
  blitBase();
}
function blitBase() {
  if (!base.s) return;
  ctx.drawImage(base.canvas, 0, 0, base.canvas.width, base.canvas.height,
    sx(base.x1), sy(base.z1), (base.x1 - base.x0) * view.s, (base.z1 - base.z0) * view.s);
}
// draws the base ground of rect r into the picture; the drawing code runs with a view whose screen is the picture
// (x and z are mirrored on the map, so the picture's top-left is the corner (x1, z1))
function renderBase(r, ver) {
  const ew = Math.max(1, r.x1 - r.x0), eh = Math.max(1, r.z1 - r.z0), s = view.s;
  const k = Math.min(dpr, Math.sqrt(16e6 / Math.max(1, ew * s * eh * s)));   // at most about 16 Mpx
  const c = base.canvas;
  c.width = Math.max(1, Math.ceil(ew * s * k)); c.height = Math.max(1, Math.ceil(eh * s * k));
  const saved = { cx: view.cx, cz: view.cz, W, H, ctx };
  view.cx = r.x1 - ew / 2; view.cz = r.z1 - eh / 2; W = ew * s; H = eh * s; ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  try { drawBase(); }
  finally { view.cx = saved.cx; view.cz = saved.cz; W = saved.W; H = saved.H; ctx = saved.ctx; }
  Object.assign(base, { s, ver, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
}
// The map's picture of the ground (all that drawBase draws: the district ground, the lawns, the parks and quays, the
// buildings with their roofs, the pools, the trees, the helipads, the river and the water, the streets, the at-grade lanes,
// the flyovers, the roundabouts, the tram lines, the avenues and the bridge decks) of the world rectangle x0..x1, z0..z1,
// into the 2D context c at s pixels a metre. It is mirrored as the map is (x is turned round: the picture's top-left
// corner is the world's corner (x1, z1)), and it has no place names. The radar is made of these (js/radar.js).
// The blocks' own ground (the lawns, the buildings, the trees: the costly part) is drawn only for the blocks that reach
// into the rectangle (a tree's crown reaches TILE_REACH metres over its block's edge at most), not for the ring of blocks
// round the view that the map draws; the streets and the structures keep the map's range (a long bridge's ramp ends
// 137 m from its junction).
const TILE_REACH = 8;
export function paintGround(c, x0, z0, x1, z1, s) {
  const saved = { cx: view.cx, cz: view.cz, s: view.s, W, H, ctx };
  view.cx = (x0 + x1) / 2; view.cz = (z0 + z1) / 2; view.s = s; W = (x1 - x0) * s; H = (z1 - z0) * s; ctx = c; noLabels = true;
  tileBlocks = [Math.max(-ISLAND_R, Math.floor((x0 - TILE_REACH) / CHUNK)), Math.min(ISLAND_R, Math.floor((x1 + TILE_REACH) / CHUNK) + 1),
    Math.max(-ISLAND_R, Math.floor((z0 - TILE_REACH) / CHUNK)), Math.min(ISLAND_R, Math.floor((z1 + TILE_REACH) / CHUNK) + 1)];
  try { drawBase(); }
  finally { view.cx = saved.cx; view.cz = saved.cz; view.s = saved.s; W = saved.W; H = saved.H; ctx = saved.ctx; noLabels = false; tileBlocks = null; }
}
function drawBase() {
  ctx.fillStyle = C.sea; ctx.fillRect(0, 0, W, H);                // the sea, outside the island
  rect(ISLAND_MIN, ISLAND_MIN, ISLAND_MAX - ISLAND_MIN, ISLAND_MAX - ISLAND_MIN, C.beach);   // the beach round the island
  const half = { x: W / 2 / view.s, z: H / 2 / view.s };
  // the blocks in view, on the island only (chunks -ISLAND_R..ISLAND_R-1)
  const gx0 = Math.max(-ISLAND_R, Math.floor((view.cx - half.x) / CHUNK) - 1), gx1 = Math.min(ISLAND_R, Math.ceil((view.cx + half.x) / CHUNK) + 1);
  const gz0 = Math.max(-ISLAND_R, Math.floor((view.cz - half.z) / CHUNK) - 1), gz1 = Math.min(ISLAND_R, Math.ceil((view.cz + half.z) / CHUNK) + 1);

  // 1. the ground of each block, by district; then, for a block the player has been near (it is built and remembered),
  // its parks, its harbour quay, its real buildings and its real trees. A block never visited is only its ground, so the
  // map never shows a building that is not in the world. (For the radar's tile, only the blocks that reach into it: this is
  // the costly part, see paintGround.)
  const [bx0, bx1, bz0, bz1] = tileBlocks || [gx0, gx1, gz0, gz1];
  for (let cx = bx0; cx < bx1; cx++) for (let cz = bz0; cz < bz1; cz++) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const hb = harborInfo(cx, cz);
    const k = known(ck(cx, cz));
    if (hb) {
      // harbor: concrete quay always visible, even before visited
      rect(x0, z0, CHUNK, CHUNK, '#b8b6ad');
      if (!k) {
        // unvisited placeholder — so harbor is findable on first open
        rect(x0 + 4, z0 + 4, CHUNK - 8, CHUNK - 8, C.quay);
        if (hb.inland === 0) {
          if (hb.side === 'west') rect(x0 - 24, z0 + 10, 24, CHUNK - 20, C.water);
          else if (hb.side === 'east') rect(x0 + CHUNK, z0 + 10, 24, CHUNK - 20, C.water);
          else if (hb.side === 'south') rect(x0 + 10, z0 - 24, CHUNK - 20, 24, C.water);
          else rect(x0 + 10, z0 + CHUNK, CHUNK - 20, 24, C.water);
        }
        // harbor ship placeholder (west central) — shows even before visited (110m long) — offset -14, parallel to quay
        if(hb.side==='west'&&hb.inland===0&&hb.along===0){
          rect(x0-20, z0+CHUNK/2-55, 12, 110, '#3a4552'); rect(x0-18, z0+CHUNK/2-53, 8, 106, '#d2d6db');
          for(let i=0;i<8;i++) rect(x0-17, z0+CHUNK/2-48+i*12, 6, 6, ['#d64545','#3a7bd5','#f2c230','#2e7d6b','#e8e8e8','#8e44ad'][i%6]);
          rect(x0-18, z0+CHUNK/2-55, 8, 11, '#e9eef2'); rect(x0-17, z0+CHUNK/2-48, 6, 2, '#22262b');
        } else if(hb.side==='east'&&hb.inland===0&&hb.along===0){
          rect(x0+CHUNK+8, z0+CHUNK/2-55, 12, 110, '#3a4552'); rect(x0+CHUNK+10, z0+CHUNK/2-53, 8, 106, '#d2d6db');
          for(let i=0;i<8;i++) rect(x0+CHUNK+11, z0+CHUNK/2-48+i*12, 6, 6, ['#d64545','#3a7bd5','#f2c230','#2e7d6b','#e8e8e8','#8e44ad'][i%6]);
          rect(x0+CHUNK+10, z0+CHUNK/2-55, 8, 11, '#e9eef2');
        } else if(hb.side==='south'&&hb.inland===0&&hb.along===0){
          rect(x0+CHUNK/2-55, z0-20, 110, 12, '#3a4552'); rect(x0+CHUNK/2-53, z0-18, 106, 8, '#d2d6db');
          for(let i=0;i<8;i++) rect(x0+CHUNK/2-48+i*12, z0-17, 6, 6, ['#d64545','#3a7bd5','#f2c230'][i%3]);
          rect(x0+CHUNK/2-55, z0-18, 11, 8, '#e9eef2');
        } else if(hb.side==='north'&&hb.inland===0&&hb.along===0){
          rect(x0+CHUNK/2-55, z0+CHUNK+8, 110, 12, '#3a4552'); rect(x0+CHUNK/2-53, z0+CHUNK+10, 106, 8, '#d2d6db');
          for(let i=0;i<8;i++) rect(x0+CHUNK/2-48+i*12, z0+CHUNK+11, 6, 6, ['#d64545','#3a7bd5','#f2c230'][i%3]);
          rect(x0+CHUNK/2+44, z0+CHUNK+10, 11, 8, '#e9eef2');
        } else {
          rect(x0 + 18, z0 + 18, 18, 10, '#c94a3a'); rect(x0 + 40, z0 + 32, 16, 10, '#3a7bd5'); rect(x0 + 22, z0 + 50, 20, 8, '#e8d840');
        }
        if (!noLabels && view.s > 0.22) {
          if (hb.inland === 1 && hb.along === 0) landmark(x0 + 40, z0 + 40, 'PORT WEST');
          else if (hb.inland === 0 && hb.along === 0) landmark(x0 + 40, z0 + 40, 'QUAY');
        }
        continue;
      }
      // visited harbor
      if (k.type === 'harbor_quay' || k.type === 'harbor_yard' || k.type === 'harbor_warehouse' || k.type === 'harbour') {
        rect(x0 + 4, z0 + 4, CHUNK - 8, CHUNK - 8, C.quay);
        // water adjacent to quay — only for quay (inland 0) so ship is in sea, not hiding under yard blue
        if (hb.inland === 0) {
          if (hb.side === 'west') rect(x0 - 24, z0 + 10, 24, CHUNK - 20, C.water);
          else if (hb.side === 'east') rect(x0 + CHUNK, z0 + 10, 24, CHUNK - 20, C.water);
          else if (hb.side === 'south') rect(x0 + 10, z0 - 24, CHUNK - 20, 24, C.water);
          else rect(x0 + 10, z0 + CHUNK, CHUNK - 20, 24, C.water);
        }
        const isWestEastGate = hb.inland===2 && hb.along===0;
        if (hb.side === 'west') {
          rect(x0, z0+4, 3, CHUNK-8, '#8e8a80'); // seaward west
          if(isWestEastGate){ rect(x0+CHUNK-12.6, z0+8, 3, 64, '#8e8a80'); rect(x0+CHUNK-18.6, z0-8, 14, 16, C.street); rect(x0+CHUNK-18.6, z0+CHUNK-8, 14, 16, C.street); }
          else rect(x0+CHUNK-12.6, z0+4, 3, CHUNK-8, '#8e8a80');
          rect(x0+4, z0+8, CHUNK-8, 3, '#8e8a80'); rect(x0+4, z0+CHUNK-11, CHUNK-8, 3, '#8e8a80');
        } else if (hb.side === 'east') {
          rect(x0+CHUNK-3, z0+4, 3, CHUNK-8, '#8e8a80'); // seaward east
          if(isWestEastGate){ rect(x0+12.6, z0+8, 3, 64, '#8e8a80'); rect(x0+2, z0-8, 14, 16, C.street); rect(x0+2, z0+CHUNK-8, 14, 16, C.street); }
          else rect(x0+12.6, z0+4, 3, CHUNK-8, '#8e8a80');
          rect(x0+4, z0+8, CHUNK-8, 3, '#8e8a80'); rect(x0+4, z0+CHUNK-11, CHUNK-8, 3, '#8e8a80');
        } else if (hb.side === 'south') {
          rect(x0+4, z0, CHUNK-8, 3, '#8e8a80'); // seaward south
          if(isWestEastGate){ rect(x0+12.6, z0+CHUNK-12.6, 64, 3, '#8e8a80'); rect(x0-8, z0+CHUNK-14, 16, 14, C.street); rect(x0+CHUNK-12.6, z0+CHUNK-14, 16, 14, C.street); }
          else rect(x0+4, z0+CHUNK-8, CHUNK-8, 3, '#8e8a80');
          rect(x0+12.6, z0+4, 3, CHUNK-8, '#8e8a80'); rect(x0+CHUNK-15.6, z0+4, 3, CHUNK-8, '#8e8a80');
        } else {
          rect(x0+4, z0+CHUNK-3, CHUNK-8, 3, '#8e8a80'); // seaward north
          if(isWestEastGate){ rect(x0+12.6, z0+12.6, 64, 3, '#8e8a80'); rect(x0-8, z0+2, 16, 14, C.street); rect(x0+CHUNK-12.6, z0+2, 16, 14, C.street); }
          else rect(x0+4, z0+8, CHUNK-8, 3, '#8e8a80');
          rect(x0+12.6, z0+4, 3, CHUNK-8, '#8e8a80'); rect(x0+CHUNK-15.6, z0+4, 3, CHUNK-8, '#8e8a80');
        }
        if (hb.inland === 0) rect(x0 + 14, z0 + CHUNK / 2 - 1, CHUNK - 28, 2, '#e8a00a');
        if (hb.inland === 0 && hb.along === 0) { rect(x0 + 6, z0 + 14, 14, 4, '#f2a90e'); rect(x0 + 6, z0 + 58, 14, 4, '#f2a90e'); rect(x0 - 8, z0 + 6, 8, 68, '#1a3a5a'); }
        if (hb.inland === 1 && hb.along === 0) { rect(x0 + 10, z0 + 14, 12, 3, '#f2a90e'); rect(x0 + 10, z0 + 58, 12, 3, '#f2a90e'); }
        // harbor container ship on map (central quay) — 110m long, visible even at low zoom — offset -14 parallel to quay in water
        if(hb.inland===0&&hb.along===0){
          if(hb.side==='west'){
            rect(x0-20, z0+CHUNK/2-55, 12, 110, '#3a4552'); rect(x0-18, z0+CHUNK/2-53, 8, 106, '#d2d6db');
            for(let i=0;i<8;i++) rect(x0-17, z0+CHUNK/2-48+i*12, 6, 6, ['#d64545','#3a7bd5','#f2c230','#2e7d6b','#e8e8e8','#8e44ad'][i%6]);
            rect(x0-18, z0+CHUNK/2-55, 8, 11, '#e9eef2'); rect(x0-17, z0+CHUNK/2-48, 6, 2, '#22262b'); rect(x0-17, z0+CHUNK/2-52, 6, 0.6, '#f2a900');
          } else if(hb.side==='east'){
            rect(x0+CHUNK+8, z0+CHUNK/2-55, 12, 110, '#3a4552'); rect(x0+CHUNK+10, z0+CHUNK/2-53, 8, 106, '#d2d6db');
            for(let i=0;i<8;i++) rect(x0+CHUNK+11, z0+CHUNK/2-48+i*12, 6, 6, ['#d64545','#3a7bd5','#f2c230','#2e7d6b','#e8e8e8','#8e44ad'][i%6]);
            rect(x0+CHUNK+10, z0+CHUNK/2-55, 8, 11, '#e9eef2'); rect(x0+CHUNK+11, z0+CHUNK/2-48, 6, 2, '#22262b');
          } else if(hb.side==='south'){
            rect(x0+CHUNK/2-55, z0-20, 110, 12, '#3a4552'); rect(x0+CHUNK/2-53, z0-18, 106, 8, '#d2d6db');
            for(let i=0;i<8;i++) rect(x0+CHUNK/2-48+i*12, z0-17, 6, 6, ['#d64545','#3a7bd5','#f2c230'][i%3]);
            rect(x0+CHUNK/2-55, z0-18, 11, 8, '#e9eef2'); rect(x0+CHUNK/2-48, z0-17, 2, 6, '#22262b');
          } else {
            rect(x0+CHUNK/2-55, z0+CHUNK+8, 110, 12, '#3a4552'); rect(x0+CHUNK/2-53, z0+CHUNK+10, 106, 8, '#d2d6db');
            for(let i=0;i<8;i++) rect(x0+CHUNK/2-48+i*12, z0+CHUNK+11, 6, 6, ['#d64545','#3a7bd5','#f2c230'][i%3]);
            rect(x0+CHUNK/2+44, z0+CHUNK+10, 11, 8, '#e9eef2'); rect(x0+CHUNK/2+48, z0+CHUNK+11, 2, 6, '#22262b');
          }
        }
        if(isWestEastGate){
          const gx = hb.side==='west'? x0+CHUNK-10 : x0+10;
          for(const gz of [z0, z0+CHUNK]){ rect(gx-2, gz-6, 4, 3, '#d8dde3'); rect(gx-2, gz+3, 4, 3, '#d8dde3'); }
        }
        if (!noLabels && view.s > 0.22 && k.lm) for (const [lx, lz, name] of k.lm) if (name === 'PORT WEST' || name === 'HARBOUR QUAY') landmark(lx, lz, name);
      } else {
        rect(x0 + 3, z0 + 3, CHUNK - 6, CHUNK - 6, '#7fa857');
        rect(x0 + 4.5, z0 + 4.5, CHUNK - 9, CHUNK - 9, '#b9e28a');
        if (k.type === 'park') rect(x0 + 8, z0 + 8, CHUNK - 16, CHUNK - 16, C.park);
        else if (k.type === 'harbour') rect(x0 + 40 - 28, z0 + 40 - 28, 56, 56, C.quay);
      }
    } else {
      rect(x0, z0, CHUNK, CHUNK, LAND[districtOf(cx, cz)] || LAND.centre);
      if (!k) continue;
      rect(x0 + 3, z0 + 3, CHUNK - 6, CHUNK - 6, '#7fa857');
      rect(x0 + 4.5, z0 + 4.5, CHUNK - 9, CHUNK - 9, '#b9e28a');
      if (k.type === 'park') rect(x0 + 8, z0 + 8, CHUNK - 16, CHUNK - 16, C.park);
      else if (k.type === 'harbour') rect(x0 + 40 - 28, z0 + 40 - 28, 56, 56, C.quay);
    }
    // each building is a raised block; its height is a fixed value for its place, so it does not change between redraws
    for (const [x, z, w, d, roof] of k.blds) {
      const st = Math.abs(Math.round(x * 13 + z * 29)) % 4;          // the style of the building: flat, pitched, L, flat with a unit
      building(x, z, w, d, roof, 6 + (Math.abs(Math.round(x * 5 + z * 11)) % 5) * 3, st);
    }
    const pool = poolSpot(cx, cz, k.blds);
    if (pool) { rect(pool[0] - 1.5, pool[1] - 1.5, 17, 12, '#f4f1ea'); rect(pool[0], pool[1], 14, 9, '#5bbde9'); }
    if (view.s > 0.12) for (const [tx, tz] of k.trees) crown(tx, tz);
    if (view.s > 0.12) for (const [hx, hz, hr] of k.hp || []) helipad(hx, hz, hr);
    if (view.s > 0.9 && !noLabels) for (const [lx, lz, name] of k.lm) landmark(lx, lz, name);   // only when the names fit the block
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
  for (const k of allKnown()) for (const [x, z, w, d, kind] of k.water) {
    if (x > view.cx + half.x || x + w < view.cx - half.x || z > view.cz + half.z || z + d < view.cz - half.z) continue;
    if (kind === 'water') rect(x, z, w, d, C.water);
  }

  // 5. the streets: a casing, then the minor streets, then the main roads on top
  let st = streetsIn(gx0, gx1, gz0, gz1);
  // Harbor compound: hide internal streets (the 9 blocks should read as one yard, not 9 separate blocks)
  st = st.filter(([x,z,w,d])=>{
    const isVert = w===16 && d>=80; const isHoriz = d===16 && w>=80; const isJunc = w===16 && d===16;
    if (isVert) {
      const i=Math.round((x+8)/CHUNK); const j=Math.floor((z+d/2)/CHUNK);
      const a=harborInfo(i-1,j), b=harborInfo(i,j);
      if (a && b && a.anchor===b.anchor) return false;
    } else if (isHoriz) {
      const j=Math.round((z+8)/CHUNK); const i=Math.floor((x+w/2)/CHUNK);
      const a=harborInfo(i,j-1), b=harborInfo(i,j);
      if (a && b && a.anchor===b.anchor) return false;
    } else if (isJunc) {
      const i=Math.round((x+8)/CHUNK), j=Math.round((z+8)/CHUNK);
      const blocks=[harborInfo(i-1,j-1),harborInfo(i,j-1),harborInfo(i-1,j),harborInfo(i,j)];
      if (blocks.every(b=>b && b.anchor===blocks[0].anchor)) return false;
      // also hide if at least 3 of 4 are harbor of same anchor (internal intersection)
      const same = blocks.filter(b=>b && b.anchor===blocks.find(x=>x)?.anchor).length;
      if (same>=3) return false;
    }
    return true;
  });
  const pad = Math.max(2.5, 1.6 / view.s);                         // the casing: a thin dark edge round every street
  for (const [x, z, w, d] of st) rrect(x - pad, z - pad, w + 2 * pad, d + 2 * pad, C.casing);
  for (const r of st) if (!isMain(r)) rrect(r[0], r[1], r[2], r[3], C.street);
  for (const r of st) if (isMain(r)) rrect(r[0], r[1], r[2], r[3], C.main);
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
  // 5b. the interchanges and the roundabouts: the at-grade lanes beside each flyover, its ramps and deck (over the crossing
  // street), then the roundabouts on the plain junctions
  drawAtGradeLanes(gx0, gx1 - 1, gz0, gz1 - 1);
  drawFlyovers(gx0, gx1, gz0, gz1);
  drawRoundabouts(gx0, gx1, gz0, gz1);
  drawTramLines(gx0, gx1, gz0, gz1);                     // the tram lines, on the streets (their rails are on the centre line)
  // the diagonal avenues (js/avenues.js): a main road, drawn as a thick line with its casing
  for (const av of AVENUES) {
    ctx.beginPath(); ctx.moveTo(sx(av.a[0]), sy(av.a[1])); ctx.lineTo(sx(av.b[0]), sy(av.b[1]));
    ctx.lineCap = 'butt';
    ctx.strokeStyle = C.casing; ctx.lineWidth = AVENUE_W * view.s + 2 * pad; ctx.stroke();
    ctx.strokeStyle = C.main; ctx.lineWidth = AVENUE_W * view.s; ctx.stroke();
  }
  for (const k of allKnown()) for (const [x, z, w, d, kind] of k.water) {
    if (kind === 'deck') rect(x, z, w, d, C.street);
  }
}

function draw() {
  if (!open || !ctx) return;
  clampView();
  learn();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.sea; ctx.fillRect(0, 0, W, H);                // the sea, outside the island
  rect(ISLAND_MIN, ISLAND_MIN, ISLAND_MAX - ISLAND_MIN, ISLAND_MAX - ISLAND_MIN, C.beach);   // the beach round the island

  drawBaseCached();                                             // the ground, the blocks, the streets (a picture, see below)

  // 6. the road route from the car to the street nearest the mark (a blue line with a white casing, as in a navigation map),
  // the car, the pin. With no street route there is no line: a straight line would cross the sea, the blocks or the river.
  const route = currentRoute();
  if (mark && route) {
    const pts = route.pts;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, c] of [[9, '#ffffff'], [5, C.route]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([x, z], k) => (k ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
      ctx.stroke();
    }
  }
  if (mark && route) {
    // the pin to the street nearest it: a dashed line, and a dot on the street at its nearest point
    const e = route.pts[route.pts.length - 1];
    ctx.save();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = C.route; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx(mark.x), sy(mark.z)); ctx.lineTo(sx(e[0]), sy(e[1])); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(sx(e[0]), sy(e[1]), 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = C.route; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }
  const fx = -Math.sin(player.h), fy = -Math.cos(player.h);     // forward on the map (at h = 0 the car faces up; the map is mirrored in x)
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

  // the scale bar: a round length (1, 2 or 5 times a power of ten, in metres or kilometres) that is at most about 160 px
  const len = scaleLength(), bw = len * view.s;
  ctx.fillStyle = '#222'; ctx.fillRect(W - 32 - bw, H - 34, bw, 4);
  ctx.font = '13px monospace'; ctx.fillStyle = '#222';
  ctx.fillText(len >= 1000 ? (len / 1000) + ' km' : len + ' m', W - 32 - bw, H - 40);
  infoBox.textContent = performance.now() - seaNoteAt < 2500 ? 'No pin in the sea: choose a place on the island.'
    : mark
    ? (route ? 'Mark: ' + fmtDist(route.len) + ' by road' : 'Mark: ' + fmtDist(Math.hypot(mark.x - player.x, mark.z - player.z)) + ' straight (no street route)')
    : 'Left click: mark a place · Right click: clear';
}

// ---- the road distance ----
// The streets as a graph. A node is a place where roads meet: a junction of the core's street lines (x = i * CHUNK,
// z = j * CHUNK) and, round an interchange, the places where its at-grade lanes meet the streets. An edge is a stretch of
// road between two nodes, with its own centre line (`pts`, a polyline) and its length, and the shortest route is a
// Dijkstra over that graph. The car and the mark each join the graph at the nearest point of a road near them
// (accessLegs); a point on the same road as the other is joined to it directly.
//
// An interchange has two roads, one above the other, and they do not meet (js/flyover.js):
//   - the deck road: the main road's own carriageway. It climbs a ramp, crosses the junction on the deck (on a long bridge,
//     two or three junctions) and comes down the far ramp. It meets the other streets only at the junctions beyond the
//     ramps' feet, one block either side of the bridge (the junctions besideFlyover names). Nobody turns under it;
//   - the ground road: the at-grade lane on each side of the structure (laneOffset(), 15 m from the main road's centre
//     line). It runs the whole length of those blocks and through the junction, where it crosses the street that runs
//     under the deck at grade. The two lanes meet under the deck (the junction box) and at the junctions beside it.
// So a junction under a deck has three nodes: the deck itself (k = 0), and G+ and G- (k = 1, 2), where the lanes cross the
// street underneath. A junction beside a bridge has its own node and L+ and L-, where the lanes leave its cross street.
// The route moves out from the main road's centre into a lane past the nose guards at the ramp's foot (node E, 17 m on
// from the junction beside the bridge: FLY.rampEnd + 6 from the bridge's junction, the point the police aim at in
// js/police.js), and it ends on the road it is on, so a mark beside a ramp is reached along the lane, never from the
// ramp above it.
const GN = 2 * CORE + 1;
// A street the route may use: the same streets the map draws (radarStreets): open, and not a filled (grass) street.
const isOpen = (axis, i, j) => !segClosed(axis, i, j) && !segFilled(axis, i, j);
const nid = (i, j) => (i + CORE) * GN + (j + CORE);
const jid = (i, j, k) => nid(i, j) * 3 + k;
const LANE = laneOffset();                          // the at-grade lane's centre line, from the main road's centre line
const LANE_IN = CHUNK - (FLY.rampEnd + 6);          // the route is in the lane this far past the junction beside the bridge
// A point in a main road's own frame: `u` along the road (the world coordinate along it), `v` across it from its centre
// line (the main roads run along x = 0 and z = 0).
const atUV = (axis, u, v) => (axis === 'x' ? [u, v] : [v, u]);
// What a junction is to an interchange: { role: 'bridge' (under the deck) | 'beside' (one block from it), axis (the main
// road that flies) }, or null for any other junction.
function flyRole(i, j) {
  const b = bridgeAt(i, j);
  if (b) return { role: 'bridge', axis: b.f.axis };
  if (besideFlyover(i, j)) return { role: 'beside', axis: i === 0 ? 'z' : 'x' };
  return null;
}
// The height of a structure's driving surface (a ramp or the deck) over the point, or 0 off the structure. Below UP_MIN a
// place is on the ground: the last few centimetres of a ramp's foot are at grade, and a car there still steers out of it.
const UP_MIN = 0.05;
export function structureAt(x, z) {
  const f = flyoverNear(x, z);
  return f ? bridgeHeight(f, alongOf(f, x, z)) : 0;
}
// Is the place up on a structure? A car is when it rides the surface of a ramp or the deck (from there the parapets hold
// it in); a car at grade under a deck is on the ground. A mark has no height: inside the structure's outline as the map
// draws it (the ramps and the deck) it is up on the structure, and anywhere else it is on the ground. (Exported with
// structureAt for the mark's light, js/markBeam.js: it stands on the mark's level, and the car arrives only on that level.)
export function onDeck(p) {
  const h = structureAt(p.x, p.z);
  if (h <= UP_MIN) return false;
  return p.y === undefined || p.y > Math.max(UP_MIN, h - FLY.on);
}
// Is the point (x, z) of an edge up on a structure? Only a deck edge climbs, and only where its ramps and deck are: the
// stretch before a ramp's foot is the main road at grade.
const edgeUp = (deck, x, z) => deck && structureAt(x, z) > UP_MIN;

let graphCache = null;
function roadGraph() {
  if (graphCache) return graphCache;
  const nodes = [], adj = [], edges = [], blockEdges = new Map();
  let count = GN * GN * 3;                                   // the ids past the junctions' own: the lane nodes E
  const node = (id, x, z) => { if (!nodes[id]) { nodes[id] = [x, z]; adj[id] = []; } return id; };
  // `deck`: the edge is the deck road (it climbs onto the structure); `blocks`: the blocks it runs along, so a point
  // looks for its roads among the blocks round it (accessLegs)
  const edge = (a, b, pts, deck, blocks) => {
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const id = edges.length, len = cum[cum.length - 1];
    edges.push({ a, b, pts, cum, len, deck, blocks });
    adj[a].push([b, len, id]); adj[b].push([a, len, id]);
    for (const [bi, bj] of blocks) {
      const key = bi + ',' + bj;
      if (!blockEdges.has(key)) blockEdges.set(key, []);
      blockEdges.get(key).push(id);
    }
  };
  const J = (i, j) => node(jid(i, j, 0), i * CHUNK, j * CHUNK);
  // the lane's node on side s (+1 / -1 across the main road `axis`) at junction (i, j): G at a bridge, L beside one
  const Lp = (i, j, axis, s) => {
    const [x, z] = atUV(axis, axis === 'x' ? i * CHUNK : j * CHUNK, s * LANE);
    return node(jid(i, j, s > 0 ? 1 : 2), x, z);
  };
  const line = (a, b) => [nodes[a], nodes[b]];
  for (let i = -CORE; i <= CORE; i++) for (let j = -CORE; j <= CORE; j++) for (const axis of ['x', 'z']) {
    if (!isOpen(axis, i, j)) continue;
    const i1 = axis === 'x' ? i + 1 : i, j1 = axis === 'z' ? j + 1 : j;
    const blocks = axis === 'z' ? [[i - 1, j], [i, j]] : [[i, j - 1], [i, j]];
    const r0 = flyRole(i, j), r1 = flyRole(i1, j1);
    const b0 = !!r0 && r0.role === 'bridge' && r0.axis === axis, b1 = !!r1 && r1.role === 'bridge' && r1.axis === axis;
    if (!b0 && !b1) {
      // A street. Where it crosses an interchange's main road (it is the street under a deck, or the cross street of the
      // junction beside one), it ends at the lane on its own side: that is where it meets the ground road.
      const end = (ii, jj, r, s) => (r && r.axis !== axis ? Lp(ii, jj, r.axis, s) : J(ii, jj));
      const a = end(i, j, r0, 1), b = end(i1, j1, r1, -1);
      edge(a, b, line(a, b), false, blocks);
      continue;
    }
    // A block of an interchange's main road: the deck road on the centre line, from one junction to the other (at a bridge
    // junction that is its deck node, which nothing else meets)...
    edge(J(i, j), J(i1, j1), line(J(i, j), J(i1, j1)), true, blocks);
    // ... and the ground road beside it, a lane on each side
    for (const s of [1, -1]) {
      if (b0 && b1) { edge(Lp(i, j, axis, s), Lp(i1, j1, axis, s), line(Lp(i, j, axis, s), Lp(i1, j1, axis, s)), false, blocks); continue; }
      // one end is the junction beside the bridge (P): the lane starts at P's cross street (L), and the main road moves
      // out into it past the nose guards (E); the other end is the bridge's junction, where the lane meets the street under
      // the deck (G)
      const pAt0 = !b0, P = pAt0 ? J(i, j) : J(i1, j1), L = pAt0 ? Lp(i, j, axis, s) : Lp(i1, j1, axis, s);
      const G = pAt0 ? Lp(i1, j1, axis, s) : Lp(i, j, axis, s);
      const uP = (axis === 'x' ? (pAt0 ? i : i1) : (pAt0 ? j : j1)) * CHUNK;
      const [ex, ez] = atUV(axis, uP + (pAt0 ? 1 : -1) * LANE_IN, s * LANE);
      const E = node(count++, ex, ez);
      edge(L, E, line(L, E), false, blocks);
      edge(P, E, line(P, E), false, blocks);
      edge(E, G, line(E, G), false, blocks);
    }
  }
  for (let i = -CORE; i <= CORE; i++) for (let j = -CORE; j <= CORE; j++) {
    const r = flyRole(i, j);
    if (!r) continue;
    const A = r.axis;
    if (r.role === 'bridge') {
      // the junction box under the deck: the street that crosses there, from one lane to the other at grade
      const gm = Lp(i, j, A, -1), gp = Lp(i, j, A, 1);
      edge(gm, gp, [nodes[gm], atUV(A, A === 'x' ? i * CHUNK : j * CHUNK, 0), nodes[gp]], false, [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]);
    } else {
      // the junction beside a bridge: its cross street, from the junction out to where each lane starts
      for (const s of [1, -1]) {
        const blocks = A === 'x' ? [[i - 1, s > 0 ? j : j - 1], [i, s > 0 ? j : j - 1]] : [[s > 0 ? i : i - 1, j - 1], [s > 0 ? i : i - 1, j]];
        edge(J(i, j), Lp(i, j, A, s), line(J(i, j), Lp(i, j, A, s)), false, blocks);
      }
    }
  }
  return (graphCache = { nodes, adj, edges, blockEdges, count });
}
// The point of an edge nearest to p: its distance d, the point (x, z), and its place t (the length along the edge to it).
function nearestOnEdge(e, p) {
  let best = null;
  for (let k = 0; k + 1 < e.pts.length; k++) {
    const [ax, az] = e.pts[k], [bx, bz] = e.pts[k + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const f = L2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / L2)) : 0;
    const x = ax + dx * f, z = az + dz * f, d = Math.hypot(p.x - x, p.z - z);
    if (!best || d < best.d) best = { d, x, z, t: e.cum[k] + f * (e.cum[k + 1] - e.cum[k]) };
  }
  return best;
}
// The ways from a point onto the roads: for each node a road reaches, the nearest point P of that road to the point, and
// the leg (point -> P, then along the road to the node). The legs are taken only from the roads that run along the
// point's own block (ring 0); if the block has no open road at all (a closed estate or park), the next ring of blocks is
// tried, and so on up to three rings. So a car on a street starts from that street, and no leg runs across a block to a far
// street. A place up on a structure joins only the deck road, and a place on the ground only the roads at grade: nothing
// steps from a lane up onto the ramp beside it or down off the deck. Returns { legs, segs }: legs is a Map node ->
// { acc, x, z, e, t } (the best leg per node; e is the edge and t the place of P along it); segs lists every road the point
// joins: { key (the edge), t, leg, x, z }, so two points on the same road can be joined directly.
// (maxLeg: the longest leg allowed; the start of a route uses ACCESS_MAX, so the car's own step onto the street is short
// and the route never runs across a block, the yards and sidewalks beside the car.)
const ACCESS_MAX = 12;
// Is the place inside a building's footprint (the real footprints, from the map data)?
function insideBlds(x, z) {
  const k = known(ck(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  return !!k && k.blds.some(([bx, bz, w, d]) => x >= bx && x <= bx + w && z >= bz && z <= bz + d);
}
// Does the straight line from a to b pass through a building?
function legCrossesBuilding(ax, az, bx, bz) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
  for (let s = 1; s < n; s++) if (insideBlds(ax + (bx - ax) * s / n, az + (bz - az) * s / n)) return true;
  return false;
}
// A leg from the point to the street point (px, pz). The start of a route (maxLeg finite) must be short and must not go
// through a building; the mark's own leg (maxLeg Infinity) is not limited, so a mark in a building still gets its route.
const legOk = (p, px, pz, maxLeg) => Math.hypot(p.x - px, p.z - pz) <= maxLeg && (maxLeg === Infinity || !legCrossesBuilding(p.x, p.z, px, pz));
function accessLegs(p, maxLeg = Infinity) {
  const g = roadGraph(), up = onDeck(p);
  // A car at grade under a deck (in the junction box, or under a long bridge's span) gets out sideways to the lane beside
  // the structure, which is further than a car's usual step onto a street.
  const reach = !up && structureAt(p.x, p.z) > UP_MIN ? Math.max(maxLeg, LANE + 2) : maxLeg;
  const bi = Math.floor(p.x / CHUNK), bj = Math.floor(p.z / CHUNK);
  for (let r = 0; r <= 3; r++) {
    const legs = new Map(), segs = [], seen = new Set();
    const put = (n, acc, q, e) => { const b = legs.get(n); if (!b || acc < b.acc) legs.set(n, { acc, x: q.x, z: q.z, e, t: q.t }); };
    for (let i = bi - r; i <= bi + r; i++) for (let j = bj - r; j <= bj + r; j++) {
      for (const id of g.blockEdges.get(i + ',' + j) || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const e = g.edges[id], q = nearestOnEdge(e, p);
        if (edgeUp(e.deck, q.x, q.z) !== up) continue;      // the other level: not a road this place is on
        if (!legOk(p, q.x, q.z, reach)) continue;
        put(e.a, q.d + q.t, q, id);
        put(e.b, q.d + (e.len - q.t), q, id);
        segs.push({ key: id, t: q.t, leg: q.d, x: q.x, z: q.z });
      }
    }
    if (legs.size) return { legs, segs };
  }
  return { legs: new Map(), segs: [] };
}
// Dijkstra from the start nodes (each with its leg length): returns the distance of every node, and the node and the edge
// it is reached from
function shortest(starts) {
  const g = roadGraph(), adj = g.adj;
  const dist = new Float64Array(g.count).fill(Infinity), prev = new Int32Array(g.count).fill(-1), prevE = new Int32Array(g.count).fill(-1);
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
    for (const [m, w, e] of adj[n]) if (d + w < dist[m]) { dist[m] = d + w; prev[m] = n; prevE[m] = e; push(d + w, m); }
  }
  return { dist, prev, prevE };
}
// The point at t along an edge, and the way along it from t0 to t1 (both ends, and the edge's own bends between them).
function pointAt(e, t) {
  let k = 0;
  while (k + 2 < e.pts.length && t > e.cum[k + 1]) k++;
  const L = e.cum[k + 1] - e.cum[k], f = L ? Math.max(0, Math.min(1, (t - e.cum[k]) / L)) : 0;
  return [e.pts[k][0] + (e.pts[k + 1][0] - e.pts[k][0]) * f, e.pts[k][1] + (e.pts[k + 1][1] - e.pts[k][1]) * f];
}
function stretch(e, t0, t1) {
  const out = [pointAt(e, t0)], n = e.pts.length;
  if (t1 >= t0) { for (let k = 1; k < n - 1; k++) if (e.cum[k] > t0 && e.cum[k] < t1) out.push(e.pts[k]); }
  else { for (let k = n - 2; k >= 1; k--) if (e.cum[k] < t0 && e.cum[k] > t1) out.push(e.pts[k]); }
  out.push(pointAt(e, t1));
  return out;
}
// The road route, from its pieces (each { pts, deck }: a way along one edge). Its `pts` is the whole way: the point, its
// step onto the road, along the roads round every corner and bend, to the point on the road nearest the mark. `deck[k]`
// tells whether the piece pts[k] -> pts[k + 1] is on the deck road (it is up on the structure wherever that is: edgeUp),
// and `cum` is the length along `pts` up to each point.
function makeRoute(from, pieces) {
  const pts = [[from.x, from.z]], deck = [];
  for (const pc of pieces) for (const [x, z] of pc.pts) {
    const l = pts[pts.length - 1];
    if (Math.hypot(x - l[0], z - l[1]) < 0.01) continue;
    pts.push([x, z]); deck.push(pc.deck);
  }
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { len: cum[cum.length - 1], pts, deck, cum };
}
// The road nearest the point: the nearest of the roads the point can reach (accessLegs), and the ways to its two ends,
// along it from the point. The way to the mark ends on this road, at the point nearest the mark.
function nearestLegs(segs) {
  let nb = null;
  for (const s of segs) if (!nb || s.leg < nb.leg) nb = s;
  const legs = new Map();
  if (!nb) return { legs, key: null, seg: null };
  const e = roadGraph().edges[nb.key];
  legs.set(e.a, { acc: nb.leg + nb.t, x: nb.x, z: nb.z, e: nb.key, t: nb.t });
  legs.set(e.b, { acc: nb.leg + (e.len - nb.t), x: nb.x, z: nb.z, e: nb.key, t: nb.t });
  return { legs, key: nb.key, seg: nb };
}
// The road route from one point to another (`from` may carry the car's height, y), or null if no road is near enough to
// either point. (Exported for the Node suite, tools/sidewalk-checks/route-levels.mjs.)
export function roadRoute(from, to) {
  const g = roadGraph();
  const A = accessLegs(from, ACCESS_MAX), B = accessLegs(to);
  if (!A.legs.size || !B.legs.size) return null;
  const nearest = nearestLegs(B.segs);
  // (a) both ends on one road: walk along it, without going out to a corner and back
  let direct = null;
  for (const a of A.segs) {
    if (a.key !== nearest.key) continue;
    const len = a.leg + nearest.seg.leg + Math.abs(a.t - nearest.seg.t);
    if (!direct || len < direct.len) direct = { len, a };
  }
  // (b) through the nodes of the road network
  const { dist, prev, prevE } = shortest([...A.legs].map(([n, l]) => ({ n, acc: l.acc })));
  let best = null;
  for (const [n, l] of nearest.legs) {
    const len = dist[n] + l.acc;
    if (isFinite(len) && (!best || len < best.len)) best = { len, end: n };
  }
  if (direct && (!best || direct.len <= best.len)) {
    const e = g.edges[nearest.key];
    return makeRoute(from, [{ pts: stretch(e, direct.a.t, nearest.seg.t), deck: e.deck }]);
  }
  if (!best) return null;
  const nodes = [];
  for (let n = best.end; n !== -1; n = prev[n]) nodes.push(n);
  nodes.reverse();
  const first = A.legs.get(nodes[0]), e0 = g.edges[first.e];
  const pieces = [{ pts: stretch(e0, first.t, nodes[0] === e0.a ? 0 : e0.len), deck: e0.deck }];
  for (let k = 1; k < nodes.length; k++) {
    const e = g.edges[prevE[nodes[k]]];
    pieces.push({ pts: e.a === nodes[k - 1] ? e.pts : [...e.pts].reverse(), deck: e.deck });
  }
  // the way ends on the road, at the point nearest the mark: the last leg is not drawn across the block to the mark
  const last = nearest.legs.get(best.end), eL = g.edges[last.e];
  pieces.push({ pts: stretch(eL, best.end === eL.a ? 0 : eL.len, last.t), deck: eL.deck });
  return makeRoute(from, pieces);
}
// The point of a route nearest to `p`: its distance d, and its place s (the length along the route up to it). Only the
// pieces on p's own level count: a car up on a deck is not on a route that runs along the lane beside it or under it, and
// a car on the lane is not on a route over the ramp beside it, however close they are on the map.
function nearestOn(route, p) {
  const up = onDeck(p);
  let best = { d: Infinity, s: 0, k: 0, x: p.x, z: p.z };
  const { pts, cum, deck } = route;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / L2)) : 0;
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(p.x - qx, p.z - qz);
    if (d < best.d && edgeUp(deck[k], qx, qz) === up) best = { d, s: cum[k] + Math.hypot(qx - ax, qz - az), k, x: qx, z: qz };
  }
  return best;
}
// The route for the current mark. It is planned once, from where the car was when the mark was set, and then kept
// while the car stays on it (within 12 m, on the same level): the route does not change shape as the car drives along it.
// Only when the car leaves it, or the mark moves, is a new route planned. The returned view is the rest of the route,
// from the car: { len (what is left), pts (from the car on), base (the planned route), s (the car's place along base) }.
const ON_ROUTE = 12;
let routeCache = { to: null, base: null, view: null, from: null, at: 0 };
export function currentRoute() {
  if (!mark) return null;
  const car = { x: player.x, z: player.z, y: player.y || 0 };
  const c = routeCache;
  if (c.to !== mark) { c.to = mark; c.base = null; c.view = null; c.from = null; c.at = 0; }
  let near = c.base ? nearestOn(c.base, car) : null;
  if (!near || near.d > ON_ROUTE) {
    // plan again (a full search, so not every frame): at most once a second, unless the car has moved 8 m since the last plan.
    // While the car is off the route it keeps the route it has.
    const now = performance.now();
    const fresh = c.from && Math.hypot(c.from.x - car.x, c.from.z - car.z) < 8 && now - c.at < 1000;
    if (!fresh) {
      c.from = car; c.at = now;
      c.base = roadRoute(car, mark); c.view = null;
      if (!c.base) return null;
      near = nearestOn(c.base, car);
    } else if (!c.base) return null;
    if (!near) return null;
  }
  if (c.view && Math.hypot(c.view.car.x - car.x, c.view.car.z - car.z) < 0.5) return c.view;
  const b = c.base;
  const pts = [[car.x, car.z], [near.x, near.z], ...b.pts.slice(near.k + 1)];
  c.view = { len: b.len - near.s, pts, base: b, s: near.s, car: { x: car.x, z: car.z } };
  return c.view;
}

// the length of the scale bar, in metres: the largest round length whose bar is at most 160 px at this zoom
function scaleLength() {
  let best = 1;
  for (let k = 0; k <= 5; k++) for (const f of [1, 2, 5]) {
    const m = f * 10 ** k;
    if (m * view.s <= 160 && m > best) best = m;
  }
  return best;
}
// The place a click means. On a building the pin goes to its entrance: the middle of the wall that faces the nearest open
// street, 1 m outside it (the pin is not put inside the building). Anywhere else it is where the click was.
function entryPoint(x, z) {
  const k = known(ck(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  const b = k && k.blds.find(([bx, bz, w, d]) => x >= bx && x <= bx + w && z >= bz && z <= bz + d);
  if (!b) return { x, z };
  const [bx, bz, w, d] = b, out = 1;
  const walls = [[bx + w / 2, bz - out], [bx + w / 2, bz + d + out], [bx - out, bz + d / 2], [bx + w + out, bz + d / 2]];
  let best = null;
  for (const [px, pz] of walls) {
    const dd = streetDistance(px, pz);
    if (!best || dd < best.dd) best = { x: px, z: pz, dd };
  }
  return { x: best.x, z: best.z };
}
// the distance from a place to the nearest open street (the street's centre line), or Infinity
function streetDistance(x, z) {
  let d = Infinity;
  const jz = Math.round(z / CHUNK), ix = Math.floor(x / CHUNK);
  if (isOpen('x', ix, jz)) d = Math.min(d, Math.abs(z - jz * CHUNK));
  const iz = Math.round(x / CHUNK), jx = Math.floor(z / CHUNK);
  if (isOpen('z', iz, jx)) d = Math.min(d, Math.abs(x - iz * CHUNK));
  return d;
}
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; }

export function mapOpen() { return open; }
// the marked place (or null): the radar shows it too (js/ui.js)
export function currentMark() { return mark; }
// Takes the mark away: the pin on the map, the route, and the pin and route on the radar and the road all go with it.
export function clearMark() { mark = null; }
// Puts the mark at (x, z), as a left click on the map does: a click on a building puts the pin at its entrance.
export function setMark(x, z) { mark = entryPoint(x, z); return mark; }
let pausedByMap = false;
// A new game starts the map afresh: no mark, no route, and the parts of the city it had seen are forgotten.
export function resetMap() {
  pausedByMap = false;                       // a new game does not inherit the map's pause
  if (open) toggleMap();
  mark = null; routeCache = { to: null, base: null, view: null, from: null, at: 0 }; forgetSeen();
}

// The map stops the game while it is open: nothing runs behind it. The map only undoes a pause it made itself.
export function toggleMap() {
  if (!overlay) build();
  open = !open;
  overlay.style.display = open ? 'block' : 'none';
  if (open) {
    size();
    view.cx = player.x; view.cz = player.z; view.s = START_ZOOM;
    draw();
    timer = setInterval(draw, 250);                     // the game is paused: only the map's own data (learned or loaded) can change
    if (game.state === 'playing' && !game.paused) { game.paused = true; pausedByMap = true; }
  } else {
    clearInterval(timer); timer = 0;
    if (pausedByMap && game.paused) game.paused = false;
    pausedByMap = false;
  }
}

