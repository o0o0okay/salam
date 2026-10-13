/* The city map: a full-screen overlay (N key) of the blocks round the player, coloured by district, with the open
 * streets, the river and the player. The radar only shows about 95 m; this shows about 2.4 km each way.
 *
 * Everything is worked out from the same rules the city is built with (districtOf, radarStreets, RIVER_ROW), so the map
 * does not need the chunks to be loaded. Harbour blocks are shown as harbour; a basin stands in about one harbour block
 * in three, and it is drawn on the map only where its chunk is loaded (the radar shows it when near). */
import { player } from './state.js';
import { CHUNK } from './utils.js';
import { radarStreets, RIVER_ROW } from './flyover.js';
import { districtOf } from './districts.js';

const SIZE = 800;                     // canvas pixels
const REACH = 2400;                   // metres from the player to each edge of the map
const K = SIZE / (2 * REACH);         // pixels per metre
const COLOURS = {
  centre: '#8a8f99', old: '#b58b6a', industrial: '#6f7680', suburb: '#6f9e5a', harbour: '#3f7fa3',
};
let overlay = null, canvas = null, ctx = null, open = false, timer = 0;

function build() {
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(8,10,14,.82);z-index:50;font-family:monospace;color:#eee;';
  canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  canvas.style.cssText = 'width:min(90vw,90vh);height:min(90vw,90vh);background:#1b1f26;border:2px solid #555;';
  ctx = canvas.getContext('2d');
  const legend = document.createElement('div');
  legend.style.cssText = 'position:absolute;left:24px;top:20px;font-size:14px;line-height:1.6;';
  legend.innerHTML = '<b>MAP</b> (N to close)<br>'
    + '<span style="color:#8a8f99">■</span> city centre &nbsp; <span style="color:#b58b6a">■</span> old town<br>'
    + '<span style="color:#6f7680">■</span> industrial &nbsp; <span style="color:#6f9e5a">■</span> suburbs<br>'
    + '<span style="color:#3f7fa3">■</span> harbour &nbsp; <span style="color:#2d6f8c">■</span> river<br>'
    + '<span style="color:#ffd23b">▲</span> you &nbsp; scale bar: 200 m';
  overlay.appendChild(legend);
  overlay.appendChild(canvas);
  document.body.appendChild(overlay);
}

// world metres -> canvas pixels, north (z) up
const sx = x => SIZE / 2 + (x - player.x) * K;
const sy = z => SIZE / 2 + (z - player.z) * K;

function draw() {
  if (!open) return;
  ctx.fillStyle = '#1b1f26'; ctx.fillRect(0, 0, SIZE, SIZE);
  const gx0 = Math.floor((player.x - REACH) / CHUNK), gx1 = Math.ceil((player.x + REACH) / CHUNK);
  const gz0 = Math.floor((player.z - REACH) / CHUNK), gz1 = Math.ceil((player.z + REACH) / CHUNK);
  // the blocks, by district
  for (let cx = gx0; cx < gx1; cx++) for (let cz = gz0; cz < gz1; cz++) {
    ctx.fillStyle = COLOURS[districtOf(cx, cz)] || '#555';
    ctx.fillRect(sx(cx * CHUNK), sy(cz * CHUNK), CHUNK * K + 0.5, CHUNK * K + 0.5);
  }
  // the open streets
  ctx.fillStyle = '#2b2e35';
  for (const [x, z, w, d] of radarStreets(gx0, gx1, gz0, gz1)) ctx.fillRect(sx(x), sy(z), w * K, d * K);
  // the river: one line of water on the river row (it runs the whole width of the map)
  ctx.fillStyle = '#2d6f8c';
  const ry = sy(RIVER_ROW * CHUNK - 8);
  ctx.fillRect(0, ry, SIZE, 16 * K);
  ctx.fillStyle = '#c9d6df'; ctx.font = '13px monospace';
  if (ry > 0 && ry < SIZE) ctx.fillText('river', 8, ry - 4);
  // the player: an arrow along the heading (forward is (sin h, cos h) in the world, see drawRadar)
  const px = SIZE / 2, pz = SIZE / 2, fx = Math.sin(player.h), fz = Math.cos(player.h);
  ctx.fillStyle = '#ffd23b';
  ctx.beginPath();
  ctx.moveTo(px + fx * 12, pz + fz * 12);
  ctx.lineTo(px - fz * 7 - fx * 6, pz + fx * 7 - fz * 6);
  ctx.lineTo(px + fz * 7 - fx * 6, pz - fx * 7 - fz * 6);
  ctx.closePath(); ctx.fill();
  // scale bar: 200 m
  ctx.fillStyle = '#eee'; ctx.fillRect(SIZE - 40 - 200 * K, SIZE - 30, 200 * K, 4);
  ctx.fillText('200 m', SIZE - 40 - 200 * K, SIZE - 36);
}

export function toggleMap() {
  if (!overlay) build();
  open = !open;
  overlay.style.display = open ? 'flex' : 'none';
  if (open) { draw(); timer = setInterval(draw, 250); }
  else { clearInterval(timer); timer = 0; }
}
