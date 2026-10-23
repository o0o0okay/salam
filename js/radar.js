/* The radar: the city round the car, turned with it (the car points up), with what matters for getting away.
 *
 * The ground is the map's own picture (js/map.js, paintGround): the blocks, the buildings with their roofs, the parks and
 * the trees, the water, the streets as they really run, the at-grade lanes under the flyovers, the roundabouts, so a gap
 * between two buildings, a way through a park or a street that ends reads on the radar as it does on the map. It is drawn
 * in tiles of one block, each made once (a few a frame, nearest first) and turned with the radar; a tile is made again
 * when the map's data under it changes (js/mapData.js).
 *
 * On it, for the escape:
 *   - the police: each cruiser as an arrow the way it faces, flashing red and blue; one that sees you (or hears you
 *     close by, js/police.js) has a red line to you, so you know whom to put a building between;
 *   - the search zone: once they have lost sight of you, the circle they are searching (where they go, and round which
 *     they patrol the roads, js/police.js searchCentre and SEARCH_R), so you see which way is out of it;
 *   - the blockades: a roadblock's cruisers parked across the road (js/roadblock.js) and a checkpoint on a bridge deck
 *     (js/police.js), joined by a red-and-white bar; the spike strips, blinking;
 *   - the rim tells the chase: red and blue while they see you, amber while they search, white when there is no chase;
 *   - the pickups (nitro, repair, cash), the traffic, the air unit, the route and the pin of the marked place;
 *   - the ships on the sea (js/ships.js), each at its true length and beam and on its heading, the navy's darker;
 *   - the radar looks further as the car goes faster (95 m to the rim standing, 140 m flat out), and dims at night;
 *     a faint ping rings out from the car, as on a radar.
 * N on the rim is the map's up (+z). */
import { $, PI, CHUNK, clamp, lerp, ck } from './utils.js';
import { game, player, sight, police, civs, spikes } from './state.js';
import { env } from './environment.js';
import { nearChunks } from './world.js';
import { helicopter } from './helicopter.js';
import { currentMark, currentRoute, paintGround } from './map.js';
import { known, mapVersion } from './mapData.js';
import { FRESH, SEARCH_R, searchCentre } from './police.js';
import { ships, shipOutline } from './ships.js';
import { harborInfo } from './harbor.js';
import { ISLAND_R } from './island.js';

const S = 260, R = 130;                  // the radar's drawing size, in its own units (the canvas has more pixels on a sharp screen)
const RANGE_MIN = 95, RANGE_MAX = 140;   // metres from the car to the rim: standing, and flat out
const RANGE_V0 = 8, RANGE_V1 = 45;       // m/s: the radar starts to widen at RANGE_V0 and is widest from RANGE_V1 on
const RANGE_EASE = 1.5;                  // 1/s: how quickly the range follows the speed
const TILE_S = 2;                        // pixels a metre in a tile: the radar shows 0.93 to 1.37 units a metre, 2 pixels on a 2x screen
const TILE_PAD = 1;                      // metres of overlap round a tile, so no seam shows between two tiles when turned
const TILE_MAX = 64;                     // tiles kept (the farthest from the car are forgotten first)
const TILE_MAKE = 3;                     // tiles made a radar frame at most, nearest first (the rest come in the next frames)
const TILE_BUDGET = 3;                   // ms: past the first tile of a frame, more are made only while the frame has spent less
const LAND = '#c9d3bf';                  // the plain ground where a tile is not made yet
const SIREN_R = '#ff2b2b', SIREN_B = '#2f6bff', AMBER = '255,170,30';

const radar = $('radar'), rctx = radar.getContext('2d');
let k = 1;                               // canvas pixels a radar unit
let fitDue = true;                       // the canvas is sized to the screen's pixels at the next frame
let range = RANGE_MIN, lastT = 0;
const tiles = new Map();                 // block key -> { cx, cz, cv: its picture, x1, z1: its world corner, from, ver }

if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { fitDue = true; });
// The canvas gets as many pixels as the screen shows of it (the page sizes it, css/style.css), so it is not blurred on a
// sharp screen; the drawing stays in the radar's own S x S units.
function fit() {
  fitDue = false;
  const css = typeof radar.clientWidth === 'number' && radar.clientWidth > 0 ? radar.clientWidth : 190;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const px = clamp(Math.round(css * dpr), S, 2 * S);
  if (radar.width !== px) radar.width = px;
  if (radar.height !== px) radar.height = px;
  k = px / S;
}

// ---- the ground: the map's picture, in tiles of one block ----
// The map's records a tile is drawn from: its block and the eight round it (the map draws a block's neighbours into it too:
// a street, a deck or a tree can reach over the edge).
function sources(cx, cz) {
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(known(ck(cx + i, cz + j)) || null);
  return out;
}
function makeTile(cx, cz) {
  const x0 = cx * CHUNK - TILE_PAD, z0 = cz * CHUNK - TILE_PAD, x1 = (cx + 1) * CHUNK + TILE_PAD, z1 = (cz + 1) * CHUNK + TILE_PAD;
  const cv = document.createElement('canvas');
  cv.width = Math.round((x1 - x0) * TILE_S); cv.height = Math.round((z1 - z0) * TILE_S);
  paintGround(cv.getContext('2d'), x0, z0, x1, z1, TILE_S);
  return { cx, cz, cv, x1, z1, from: sources(cx, cz), ver: mapVersion() };
}
// still the picture of what the map knows there? (checked only when the map's data has changed since)
function current(t) {
  if (t.ver === mapVersion()) return true;
  const now = sources(t.cx, t.cz);
  if (now.some((r, i) => r !== t.from[i])) return false;
  t.ver = mapVersion();
  return true;
}
// The blocks that reach into the radar's circle, nearest first.
function blocksInRange(rr) {
  const out = [];
  const bx0 = Math.floor((player.x - rr) / CHUNK), bx1 = Math.floor((player.x + rr) / CHUNK);
  const bz0 = Math.floor((player.z - rr) / CHUNK), bz1 = Math.floor((player.z + rr) / CHUNK);
  for (let cx = bx0; cx <= bx1; cx++) for (let cz = bz0; cz <= bz1; cz++) {
    const nx = clamp(player.x, cx * CHUNK, (cx + 1) * CHUNK), nz = clamp(player.z, cz * CHUNK, (cz + 1) * CHUNK);
    const d = Math.hypot(nx - player.x, nz - player.z);
    if (d <= rr) out.push({ cx, cz, d });
  }
  return out.sort((a, b) => a.d - b.d);
}
// Draws the ground in the radar's world frame (the transform is on). A tile is drawn mirrored as the map is: its picture's
// top-left corner is its world corner (x1, z1).
function drawGround(rr) {
  let made = 0;
  const t0 = performance.now();                                       // a tile takes 1.5 to 5 ms: a slow machine makes one a frame
  for (const { cx, cz } of blocksInRange(rr)) {
    const key = ck(cx, cz);
    let t = tiles.get(key);
    if ((!t || !current(t)) && made < TILE_MAKE && (made === 0 || performance.now() - t0 < TILE_BUDGET)) { t = makeTile(cx, cz); tiles.set(key, t); made++; }
    if (!t) continue;                                                 // not made yet: the plain ground shows there for a moment
    rctx.save(); rctx.translate(t.x1, t.z1); rctx.scale(-1 / TILE_S, -1 / TILE_S); rctx.drawImage(t.cv, 0, 0); rctx.restore();
  }
  if (tiles.size > TILE_MAX) {                                        // forget the farthest
    const far = [...tiles.entries()].map(([key, t]) => [key, Math.hypot((t.cx + 0.5) * CHUNK - player.x, (t.cz + 0.5) * CHUNK - player.z)]);
    far.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < far.length && tiles.size > TILE_MAX; i++) tiles.delete(far[i][0]);
  }
}

// ---- the radar's frames ----
// screen: the radar's own units (S x S); world: metres, turned with the car (the car points up, world +z is up at h = 0
// and +x is to the left, as on the map)
const toScreen = () => rctx.setTransform(k, 0, 0, k, 0, 0);
function toWorld(s) {
  const co = Math.cos(player.h), si = Math.sin(player.h);
  toScreen(); rctx.translate(R, R); rctx.transform(-co * s, -si * s, si * s, -co * s, 0, 0); rctx.translate(-player.x, -player.z);
}
// where a world point is on the radar, in its own units (the same turn as toWorld)
function onRadar(x, z, s) {
  const dx = x - player.x, dz = z - player.z, co = Math.cos(player.h), si = Math.sin(player.h);
  return { X: R + (-co * dx + si * dz) * s, Y: R + (-si * dx - co * dz) * s };
}

// ---- the marks on it (in the world frame; sizes are in radar units, so divided by s) ----
// a car: an arrow the way it faces (h: forward is (sin h, cos h)), len x wid radar units
function carArrow(x, z, h, s, len, wid, fill, edge) {
  const fx = Math.sin(h), fz = Math.cos(h), L = len / s, W = wid / s;
  rctx.beginPath();
  rctx.moveTo(x + fx * L * 0.6, z + fz * L * 0.6);
  rctx.lineTo(x - fx * L * 0.4 + fz * W / 2, z - fz * L * 0.4 - fx * W / 2);
  rctx.lineTo(x - fx * L * 0.15, z - fz * L * 0.15);
  rctx.lineTo(x - fx * L * 0.4 - fz * W / 2, z - fz * L * 0.4 + fx * W / 2);
  rctx.closePath();
  rctx.fillStyle = fill; rctx.fill();
  rctx.lineJoin = 'round'; rctx.strokeStyle = edge; rctx.lineWidth = 1.3 / s; rctx.stroke();
}
// The search zone: where the police go once they have lost sight of you, and the roads round it they patrol. A pulsing
// amber disc with a marching edge, and a mark at its centre.
function drawSearch(s, t) {
  const c = searchCentre(sight), pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  rctx.beginPath(); rctx.arc(c.x, c.z, SEARCH_R, 0, PI * 2);
  rctx.fillStyle = `rgba(${AMBER},${(0.12 + 0.08 * pulse).toFixed(3)})`; rctx.fill();
  rctx.setLineDash([8 / s, 6 / s]); rctx.lineDashOffset = -t * 16 / s;
  rctx.strokeStyle = `rgba(${AMBER},0.95)`; rctx.lineWidth = 2.2 / s; rctx.stroke();
  rctx.setLineDash([]);
  const m = 5 / s;                                                   // a cross where they are heading
  rctx.beginPath(); rctx.moveTo(c.x - m, c.z - m); rctx.lineTo(c.x + m, c.z + m); rctx.moveTo(c.x + m, c.z - m); rctx.lineTo(c.x - m, c.z + m);
  rctx.strokeStyle = `rgba(${AMBER},0.95)`; rctx.lineWidth = 2.4 / s; rctx.lineCap = 'round'; rctx.stroke();
}
// the route to the marked place, on the streets (js/map.js): a white casing and a blue line
function drawRoute(s) {
  const rt = currentMark() ? currentRoute() : null;
  if (!rt) return;
  rctx.lineJoin = 'round'; rctx.lineCap = 'round';
  for (const [w, c] of [[6 / s, '#ffffff'], [3.6 / s, '#4285f4']]) {
    rctx.strokeStyle = c; rctx.lineWidth = w;
    rctx.beginPath(); rt.pts.forEach(([x, z], i) => (i ? rctx.lineTo(x, z) : rctx.moveTo(x, z))); rctx.stroke();
  }
}
function drawPickups(s) {
  for (const ch of nearChunks(player.x, player.z)) for (const pk of ch.pickups) {
    if (pk.taken) continue;
    rctx.beginPath(); rctx.arc(pk.x, pk.z, 3.6 / s, 0, PI * 2);
    rctx.fillStyle = pk.kind === 'nitro' ? '#2e9bff' : pk.kind === 'repair' ? '#26d65a' : '#ffc61a'; rctx.fill();
    rctx.strokeStyle = '#ffffff'; rctx.lineWidth = 1.4 / s; rctx.stroke();
  }
}
// harbor moored container ship (feeder) — drawn like open-sea ships but stationary
function harborShipAt(hb, out){
  if(!hb || hb.inland!==0 || hb.along!==0) return null;
  let x,z,h;
  if(hb.side==='west'){ x=hb.anchor.cx*CHUNK -22; z=hb.anchor.cz*CHUNK+40; h=Math.PI/2; }
  else if(hb.side==='east'){ x=(hb.anchor.cx+1)*CHUNK +22; z=hb.anchor.cz*CHUNK+40; h=Math.PI/2; }
  else if(hb.side==='south'){ x=hb.anchor.cx*CHUNK+40; z=hb.anchor.cz*CHUNK -22; h=0; }
  else { x=hb.anchor.cx*CHUNK+40; z=(hb.anchor.cz+1)*CHUNK +22; h=0; }
  return { x, z, h, L:110, B:14, type:'cargo', T:{navy:false} };
}
function drawHarborShips(s){
  // single west harbor at -ISLAND_R,4 — find its hb
  const hb=harborInfo(-ISLAND_R,4);
  const a=harborShipAt(hb);
  if(!a) return;
  if(Math.hypot(a.x-player.x,a.z-player.z)-a.L/2 > range+4) return;
  shipOutline(a, _hull);
  rctx.beginPath(); _hull.forEach(([x,z],i)=>(i?rctx.lineTo(x,z):rctx.moveTo(x,z))); rctx.closePath();
  rctx.fillStyle='#3a4552'; rctx.fill();
  rctx.lineJoin='round'; rctx.strokeStyle='rgba(255,255,255,0.95)'; rctx.lineWidth=1.2/s; rctx.stroke();
  // deck containers subtle
  rctx.fillStyle='rgba(214,69,69,0.9)';
  for(let i=0;i<3;i++){ const along=-20+i*12; const cx=a.x+Math.cos(a.h)*along, cz=a.z+Math.sin(a.h)*along; rctx.fillRect(cx-1.5, cz-2, 3,4); }
}
// the ships within its reach: each hull's outline at its true size (a pointed bow, a square stern), slate grey with a
// white edge; the navy's darker
const _hull = [];
function drawShips(s) {
  for (const a of ships) {
    if (Math.hypot(a.x - player.x, a.z - player.z) - a.L / 2 > range + 4) continue;
    shipOutline(a, _hull);
    rctx.beginPath(); _hull.forEach(([x, z], i) => (i ? rctx.lineTo(x, z) : rctx.moveTo(x, z))); rctx.closePath();
    rctx.fillStyle = a.T.navy ? '#454e57' : '#6d7d8e'; rctx.fill();
    rctx.lineJoin = 'round'; rctx.strokeStyle = 'rgba(255,255,255,0.9)'; rctx.lineWidth = 1.2 / s; rctx.stroke();
  }
  drawHarborShips(s);
}
function drawTraffic(s) {
  for (const c of civs) {
    rctx.beginPath(); rctx.arc(c.x, c.z, 2.6 / s, 0, PI * 2);
    rctx.fillStyle = c.wrecked ? '#7b7f86' : '#f2f2f2'; rctx.fill();
    rctx.strokeStyle = 'rgba(30,34,42,0.85)'; rctx.lineWidth = 1 / s; rctx.stroke();
  }
}
// spike strips: a dark strip across the road (13 m) with teeth, blinking red and white
function drawSpikes(s, ph) {
  for (const sp of spikes) {
    const ux = sp.axisZ ? 1 : 0, uz = sp.axisZ ? 0 : 1, L = 13, w = Math.max(2.4, 5.5 / s);   // along the strip; its drawn width
    rctx.lineCap = 'butt';
    rctx.strokeStyle = '#1b1e24'; rctx.lineWidth = w;
    rctx.beginPath(); rctx.moveTo(sp.x - ux * L / 2, sp.z - uz * L / 2); rctx.lineTo(sp.x + ux * L / 2, sp.z + uz * L / 2); rctx.stroke();
    const n = 7, a = w * 0.32;                                       // the teeth: a zigzag along the strip
    rctx.beginPath();
    for (let i = 0; i <= 2 * n; i++) {
      const f = -L / 2 + L * i / (2 * n), o = i % 2 ? a : -a;
      const x = sp.x + ux * f + uz * o, z = sp.z + uz * f + ux * o;
      i ? rctx.lineTo(x, z) : rctx.moveTo(x, z);
    }
    rctx.strokeStyle = ph ? '#ff3b30' : '#ffffff'; rctx.lineWidth = 1.4 / s; rctx.lineJoin = 'miter'; rctx.stroke();
  }
}
// The blockades: a roadblock (its cruisers across the road) and a checkpoint on a bridge deck (its parked cruisers),
// each joined by a red-and-white bar, a little longer than the line of cars.
export function blockades() {
  const out = [];
  const rb = (game.roadblockGroup || []).filter(p => !p.wrecked && p.role === 'roadblock');
  if (rb.length) out.push(rb);
  const chk = police.filter(p => !p.wrecked && p.role === 'bridgeBlock' && p.parked);
  if (chk.length) out.push(chk);
  return out;
}
function drawBlockades(s, ph) {
  for (const cars of blockades()) {
    let a = cars[0], b = cars[0], best = -1;                         // the two farthest apart
    for (const p of cars) for (const q of cars) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d > best) { best = d; a = p; b = q; } }
    let ux, uz;
    if (best > 0.5) { ux = (b.x - a.x) / best; uz = (b.z - a.z) / best; } else { ux = Math.sin(a.h); uz = Math.cos(a.h); }   // one car: along it (it is across the road)
    const ext = 3.5, x0 = a.x - ux * ext, z0 = a.z - uz * ext, x1 = b.x + ux * ext, z1 = b.z + uz * ext;
    rctx.lineCap = 'butt';
    rctx.strokeStyle = '#2a0b0b'; rctx.lineWidth = 8 / s; rctx.beginPath(); rctx.moveTo(x0, z0); rctx.lineTo(x1, z1); rctx.stroke();
    rctx.strokeStyle = '#ffffff'; rctx.lineWidth = 5.5 / s; rctx.stroke();
    rctx.setLineDash([3.2, 3.2]); rctx.lineDashOffset = ph ? 3.2 : 0;
    rctx.strokeStyle = '#ff2323'; rctx.stroke(); rctx.setLineDash([]);
  }
}
// who has you: a red line from each cruiser that sees (or hears) you, and from the air unit while it has you locked
function drawSightLines(s, t) {
  rctx.beginPath();
  for (const p of police) if (!p.wrecked && p.sees) { rctx.moveTo(p.x, p.z); rctx.lineTo(player.x, player.z); }
  if (helicopter && helicopter.visible && sight.heliOn) { rctx.moveTo(helicopter.x, helicopter.z); rctx.lineTo(player.x, player.z); }
  rctx.setLineDash([5 / s, 4 / s]); rctx.lineDashOffset = t * 24 / s;
  rctx.strokeStyle = 'rgba(255,45,45,0.9)'; rctx.lineWidth = 1.7 / s; rctx.lineCap = 'round'; rctx.stroke();
  rctx.setLineDash([]);
}
function drawPolice(s, ph) {
  for (const p of police) if (p.wrecked) carArrow(p.x, p.z, p.h, s, 12, 8.5, '#8d9097', '#3d4047');
  for (const p of police) {
    if (p.wrecked) continue;
    rctx.beginPath(); rctx.arc(p.x, p.z, (p.sees ? 9.5 : 7.5) / s, 0, PI * 2);  // the glow of the light bar (larger: it sees you)
    rctx.fillStyle = ph ? 'rgba(255,43,43,0.32)' : 'rgba(47,107,255,0.32)'; rctx.fill();
    carArrow(p.x, p.z, p.h, s, 13, 9, ph ? SIREN_R : SIREN_B, '#ffffff');
  }
}
// the air unit: a spinning, police-liveried pinwheel, synced to the real rotor; dimmer while it is only searching
function drawHeli(s, ph) {
  if (!helicopter || !helicopter.visible) return;
  rctx.save();
  rctx.globalAlpha = sight.heliOn ? 1 : 0.55;
  rctx.translate(helicopter.x, helicopter.z);
  rctx.strokeStyle = 'rgba(255,255,255,0.55)'; rctx.lineWidth = 2 / s;      // the rotor disc
  rctx.beginPath(); rctx.arc(0, 0, 14 / s, 0, PI * 2); rctx.stroke();
  rctx.rotate(helicopter.rotor.rotation.y);
  const bl = 13.2 / s, bw = 4.8 / s, cA = ph ? SIREN_R : SIREN_B, cB = ph ? SIREN_B : SIREN_R;
  rctx.fillStyle = cA; rctx.fillRect(-bl, -bw / 2, bl * 2, bw);
  rctx.fillStyle = cB; rctx.fillRect(-bw / 2, -bl, bw, bl * 2);
  rctx.fillStyle = '#17232e'; rctx.beginPath(); rctx.arc(0, 0, 4.4 / s, 0, PI * 2); rctx.fill();
  rctx.restore();
}

// ---- in the radar's own units ----
// the chase, for the rim: 'seen' (they see you now), 'search' (they have lost you and are searching) or 'clear'
export function chaseState() {
  if (game.state !== 'playing' || !police.some(p => !p.wrecked)) return 'clear';
  return game.t - sight.t < FRESH ? 'seen' : 'search';
}
function drawRim(state, ph, t) {
  rctx.lineWidth = 5;
  if (state === 'seen') {                                            // a light bar: one half red, the other blue, swapping
    const [a, b] = ph ? [SIREN_R, SIREN_B] : [SIREN_B, SIREN_R];
    rctx.strokeStyle = a; rctx.beginPath(); rctx.arc(R, R, R - 3, -PI / 2, PI / 2); rctx.stroke();
    rctx.strokeStyle = b; rctx.beginPath(); rctx.arc(R, R, R - 3, PI / 2, PI * 1.5); rctx.stroke();
  } else {
    rctx.strokeStyle = state === 'search' ? `rgba(${AMBER},${(0.6 + 0.4 * Math.sin(t * 5)).toFixed(3)})` : 'rgba(255,255,255,0.8)';
    rctx.beginPath(); rctx.arc(R, R, R - 3, 0, PI * 2); rctx.stroke();
  }
}
// The cruisers beyond the radar's edge (up to OFF_MAX metres away): a small arrow on the rim, pointing to each, so you
// see where more are coming from.
const OFF_MAX = 260;
export function offRadar(s) {
  const out = [], rim = R - 9, blocking = new Set(blockades().flat());
  for (const p of police) {
    if (p.wrecked || blocking.has(p)) continue;                     // a blockade's cruisers: its own mark (offRadarBlockades)
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d * s <= R - 6 || d > OFF_MAX) continue;
    const { X, Y } = onRadar(p.x, p.z, s), dx = X - R, dy = Y - R, l = Math.hypot(dx, dy) || 1;
    out.push({ p, x: R + dx / l * rim, y: R + dy / l * rim, ux: dx / l, uy: dy / l, d });
  }
  return out;
}
// a blockade beyond the edge: a red-and-white barrier on the rim, in its direction
export function offRadarBlockades(s) {
  const out = [], rim = R - 10;
  for (const cars of blockades()) {
    const x = cars.reduce((a, p) => a + p.x, 0) / cars.length, z = cars.reduce((a, p) => a + p.z, 0) / cars.length;
    const d = Math.hypot(x - player.x, z - player.z);
    if (d * s <= R - 8 || d > OFF_MAX) continue;
    const { X, Y } = onRadar(x, z, s), dx = X - R, dy = Y - R, l = Math.hypot(dx, dy) || 1;
    out.push({ x: R + dx / l * rim, y: R + dy / l * rim, ux: dx / l, uy: dy / l, d });
  }
  return out;
}
function drawOffRadar(s, ph) {
  for (const { x, y, ux, uy } of offRadarBlockades(s)) {
    rctx.save(); rctx.translate(x, y); rctx.rotate(Math.atan2(uy, ux) + PI / 2);
    rctx.fillStyle = '#ffffff'; rctx.fillRect(-9, -3.5, 18, 7);
    rctx.fillStyle = '#ff2323';
    for (let i = 0; i < 4; i++) if ((i + ph) % 2) rctx.fillRect(-9 + i * 4.5, -3.5, 4.5, 7);
    rctx.strokeStyle = '#2a0b0b'; rctx.lineWidth = 1.2; rctx.strokeRect(-9, -3.5, 18, 7);
    rctx.restore();
  }
  for (const { x, y, ux, uy, d } of offRadar(s)) {
    const a = clamp(1.15 - (d - range) / 160, 0.45, 1);             // fainter the farther
    rctx.save(); rctx.globalAlpha = a;
    rctx.beginPath(); rctx.moveTo(x + ux * 6, y + uy * 6); rctx.lineTo(x - ux * 3 - uy * 5, y - uy * 3 + ux * 5); rctx.lineTo(x - ux * 3 + uy * 5, y - uy * 3 - ux * 5); rctx.closePath();
    rctx.fillStyle = ph ? SIREN_R : SIREN_B; rctx.fill();
    rctx.lineJoin = 'round'; rctx.strokeStyle = '#ffffff'; rctx.lineWidth = 1.3; rctx.stroke();
    rctx.restore();
  }
}
// N: the map's up (+z), on the rim
function drawNorth() {
  const co = Math.cos(player.h), si = Math.sin(player.h), r = R - 14, x = R + si * r, y = R - co * r;
  rctx.beginPath(); rctx.arc(x, y, 8.5, 0, PI * 2); rctx.fillStyle = 'rgba(20,26,36,0.85)'; rctx.fill();
  rctx.strokeStyle = 'rgba(255,255,255,0.9)'; rctx.lineWidth = 1.2; rctx.stroke();
  rctx.fillStyle = '#ffffff'; rctx.font = 'bold 11px system-ui, sans-serif'; rctx.textAlign = 'center'; rctx.textBaseline = 'middle';
  rctx.fillText('N', x, y + 0.5);
}
// the marked place (the pin on the map, js/map.js): upright, at the spot; a mark beyond the range sits on the rim in its
// direction, dimmed
function drawPin(s) {
  const mk = currentMark();
  if (!mk) return;
  let { X, Y } = onRadar(mk.x, mk.z, s);
  X -= R; Y -= R;
  const dist = Math.hypot(X, Y), rim = R - 18, inside = dist <= rim;
  if (!inside) { X *= rim / dist; Y *= rim / dist; }
  const tx = R + X, ty = R + Y, hy = ty - 15;                        // the tip is the marked spot, the head 15 units above
  rctx.save(); rctx.globalAlpha = inside ? 1 : 0.6;
  rctx.fillStyle = '#ea4335'; rctx.strokeStyle = '#a52714'; rctx.lineWidth = 1.2;
  rctx.beginPath(); rctx.moveTo(tx, ty); rctx.lineTo(tx - 4.7, hy + 2.7); rctx.lineTo(tx + 4.7, hy + 2.7); rctx.closePath(); rctx.fill(); rctx.stroke();
  rctx.beginPath(); rctx.arc(tx, hy, 6.5, 0, PI * 2); rctx.fill(); rctx.stroke();
  rctx.fillStyle = '#fff'; rctx.beginPath(); rctx.arc(tx, hy, 2.5, 0, PI * 2); rctx.fill();
  rctx.restore();
}
// the radar's ping: a faint ring out from the car, every PING seconds
const PING = 2.4;
function drawPing(t) {
  const q = (t % PING) / PING;
  rctx.beginPath(); rctx.arc(R, R, 12 + q * (R - 16), 0, PI * 2);
  rctx.strokeStyle = `rgba(255,255,255,${(0.38 * (1 - q) * (1 - q)).toFixed(3)})`; rctx.lineWidth = 2; rctx.stroke();
}
function drawPlayer() {
  rctx.beginPath(); rctx.moveTo(R, R - 12); rctx.lineTo(R - 7.5, R + 8.5); rctx.lineTo(R, R + 4.5); rctx.lineTo(R + 7.5, R + 8.5); rctx.closePath();
  rctx.fillStyle = '#ffffff'; rctx.fill();
  rctx.lineJoin = 'round'; rctx.strokeStyle = '#141a24'; rctx.lineWidth = 1.6; rctx.stroke();
}

export function drawRadar() {
  if (fitDue) fit();
  const t = game.t, dt = clamp(t - lastT, 0, 0.25); lastT = t;
  const want = lerp(RANGE_MIN, RANGE_MAX, clamp(((player.speed || 0) - RANGE_V0) / (RANGE_V1 - RANGE_V0), 0, 1));
  range += (want - range) * (1 - Math.exp(-dt * RANGE_EASE));
  const s = R / range, ph = Math.floor(t * 6) % 2, state = chaseState();
  toScreen(); rctx.clearRect(0, 0, S, S);
  rctx.save(); rctx.beginPath(); rctx.arc(R, R, R - 1, 0, PI * 2); rctx.clip();
  rctx.fillStyle = LAND; rctx.fillRect(0, 0, S, S);
  rctx.save(); toWorld(s); drawGround(range + 2); rctx.restore();
  // night: the city dims, the marks on it do not
  if (env.night > 0.02) { toScreen(); rctx.fillStyle = `rgba(10,18,40,${(0.45 * env.night).toFixed(3)})`; rctx.fillRect(0, 0, S, S); }
  rctx.save(); toWorld(s);
  if (state === 'search') drawSearch(s, t);
  drawShips(s); drawRoute(s); drawPickups(s); drawTraffic(s); drawSpikes(s, ph);
  if (state === 'seen') drawSightLines(s, t);
  drawPolice(s, ph); drawBlockades(s, ph); drawHeli(s, ph);         // the barrier over its cruisers, so it reads as one
  rctx.restore();
  // a soft shade towards the rim, so the radar reads as a lens
  toScreen();
  const g = rctx.createRadialGradient(R, R, R * 0.6, R, R, R);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.32)');
  rctx.fillStyle = g; rctx.fillRect(0, 0, S, S);
  drawPing(t);
  rctx.restore();
  toScreen();
  drawRim(state, ph, t); drawOffRadar(s, ph); drawNorth(); drawPin(s); drawPlayer();
}
// for the checks (tools/sidewalk-checks/radar.mjs)
export const radarInfo = () => ({ range, k, R, TILE_S, TILE_PAD, TILE_MAX, TILE_MAKE, RANGE_MIN, RANGE_MAX, OFF_MAX });
export const radarTiles = () => tiles;
