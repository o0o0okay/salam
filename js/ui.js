/* HUD, radar, toasts */
import { $, PI, CHUNK, clamp, fmtTime } from './utils.js';
import { game, player, sight, police, civs, spikes, calcScore } from './state.js';
import { DIFF, POLICE_TIERS } from './config.js';
import { env } from './environment.js';
import { nearChunks } from './world.js';
import { helicopter } from './helicopter.js';
import { radarStreets } from './flyover.js';
import { currentMark, currentRoute } from './map.js';
export function toast(text) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = text; $('toasts').appendChild(d); setTimeout(() => d.remove(), 1500);
  if ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}
const radar = $('radar'), rctx = radar.getContext('2d');
export function drawRadar() {
  const S = 260, R = 130, range = 95, s = R / range;
  rctx.clearRect(0, 0, S, S); rctx.save(); rctx.beginPath(); rctx.arc(R, R, R - 2, 0, PI * 2); rctx.clip();
  rctx.fillStyle = '#4b5d4e'; rctx.fillRect(0, 0, S, S);
  rctx.translate(R, R); const h = player.h, co = Math.cos(h), si = Math.sin(h);
  rctx.transform(-co * s, -si * s, si * s, -co * s, 0, 0); rctx.translate(-player.x, -player.z);
  rctx.fillStyle = '#23262d';
  const gx0 = Math.floor((player.x - range * 1.5) / CHUNK), gx1 = Math.ceil((player.x + range * 1.5) / CHUNK), gz0 = Math.floor((player.z - range * 1.5) / CHUNK), gz1 = Math.ceil((player.z + range * 1.5) / CHUNK);
  // The streets, as far as they really run: a closed arm (a three-way junction, see segClosed) and a filled one are grass,
  // so they are not drawn, and a junction square shows only while one of its arms is open.
  for (const [x, z, w, d] of radarStreets(gx0, gx1, gz0, gz1)) rctx.fillRect(x, z, w, d);
  // water (the river, a harbour basin) and bridge decks: closed streets are not in radarStreets, so they come from the chunks
  for (const ch of nearChunks(player.x, player.z)) for (const [x, z, w, d, k] of ch.radarWater || []) {
    rctx.fillStyle = k === 'water' ? '#2d6f8c' : '#7a8088'; rctx.fillRect(x, z, w, d);
  }
  for (const ch of nearChunks(player.x, player.z)) for (const pk of ch.pickups) {
    if (pk.taken) continue;
    rctx.fillStyle = pk.kind === 'nitro' ? '#4aa8ff' : pk.kind === 'repair' ? '#44ff77' : '#ffd23b';
    rctx.fillRect(pk.x - 1.4 / s * 1.2, pk.z - 1.4 / s * 1.2, 2.8 / s * 1.2, 2.8 / s * 1.2);
  }
  for (const c of civs) { rctx.fillStyle = c.wrecked ? '#666' : '#e8e8e8'; rctx.beginPath(); rctx.arc(c.x, c.z, 3 / s, 0, PI * 2); rctx.fill(); }
  // the route to the marked place, on the streets (js/map.js): a white casing and a blue line, in the radar's frame
  const rt = currentMark() ? currentRoute() : null;
  if (rt) {
    rctx.lineJoin = 'round'; rctx.lineCap = 'round';
    for (const [w, c] of [[6 / s, '#ffffff'], [3.6 / s, '#4285f4']]) {
      rctx.strokeStyle = c; rctx.lineWidth = w;
      rctx.beginPath(); rt.pts.forEach(([x, z], k) => (k ? rctx.lineTo(x, z) : rctx.moveTo(x, z))); rctx.stroke();
    }
  }
  const ph = Math.floor(game.t * 6) % 2;
  for (const sp of spikes) { // spike strips: blinking red bars
    rctx.fillStyle = ph ? '#ff2a2a' : '#ffffff';
    const sw = sp.axisZ ? 13 : 5, sh = sp.axisZ ? 5 : 13; rctx.fillRect(sp.x - sw / 2, sp.z - sh / 2, sw, sh);
  }
  for (const p of police) {
    if (p.wrecked) { rctx.fillStyle = '#777'; } else rctx.fillStyle = ph ? '#ff3030' : '#3a6bff';
    rctx.beginPath(); rctx.arc(p.x, p.z, 4.5 / s, 0, PI * 2); rctx.fill();
  }
  if (helicopter && helicopter.visible) { // air unit: spinning police-liveried pinwheel (2x scale), synced to the real 3D rotor
    const locked = sight.heliOn;
    rctx.save();
    rctx.globalAlpha = locked ? 1 : 0.55;                              // dimmer while only searching
    rctx.translate(helicopter.x, helicopter.z);
    // faint rotor-disc ring — reads as the silhouette of a spinning fan
    rctx.strokeStyle = 'rgba(255,255,255,0.4)'; rctx.lineWidth = 2 / s;
    rctx.beginPath(); rctx.arc(0, 0, 14 / s, 0, PI * 2); rctx.stroke();
    // blades — rotate with the real 3D rotor; two pairs flash red/blue like a cop beacon
    rctx.rotate(helicopter.rotor.rotation.y);
    const bl = 13.2 / s, bw = 4.8 / s;
    const cA = ph ? '#ff3030' : '#2a6bff', cB = ph ? '#2a6bff' : '#ff3030';
    rctx.fillStyle = cA; rctx.fillRect(-bl, -bw / 2, bl * 2, bw);
    rctx.fillStyle = cB; rctx.fillRect(-bw / 2, -bl, bw, bl * 2);
    // hub
    rctx.fillStyle = '#17232e';
    rctx.beginPath(); rctx.arc(0, 0, 4.4 / s, 0, PI * 2); rctx.fill();
    rctx.restore();
  }
  rctx.restore();
  // the marked place (the pin on the map, js/map.js): drawn upright in screen space, at the spot in the radar's frame. A
  // mark outside the radar's range sits on the rim in its direction, dimmed.
  const mk = currentMark();
  if (mk) {
    const dx = mk.x - player.x, dz = mk.z - player.z, co = Math.cos(player.h), si = Math.sin(player.h);
    let X = (-co * dx + si * dz) * s, Y = (-si * dx - co * dz) * s;      // the same rotation as the radar's transform
    const dist = Math.hypot(X, Y), rim = R - 18, inside = dist <= rim;
    if (!inside) { X *= rim / dist; Y *= rim / dist; }
    const tx = R + X, ty = R + Y, hy = ty - 15;                           // the tip is the marked spot, the head 15 px above
    rctx.save(); rctx.globalAlpha = inside ? 1 : 0.6;
    rctx.fillStyle = '#ea4335'; rctx.strokeStyle = '#a52714'; rctx.lineWidth = 1.2;
    rctx.beginPath(); rctx.moveTo(tx, ty); rctx.lineTo(tx - 4.7, hy + 2.7); rctx.lineTo(tx + 4.7, hy + 2.7); rctx.closePath(); rctx.fill(); rctx.stroke();
    rctx.beginPath(); rctx.arc(tx, hy, 6.5, 0, PI * 2); rctx.fill(); rctx.stroke();
    rctx.fillStyle = '#fff'; rctx.beginPath(); rctx.arc(tx, hy, 2.5, 0, PI * 2); rctx.fill();
    rctx.restore();
  }
  rctx.fillStyle = '#fff'; rctx.beginPath(); rctx.moveTo(R, R - 11); rctx.lineTo(R - 7, R + 8); rctx.lineTo(R + 7, R + 8); rctx.closePath(); rctx.fill();
}
let hudCache = {};
// The dial, after the reference design. Angles are degrees, clockwise from 3 o'clock, as SVG draws them. The scale
// runs from 0 at 88 degrees (bottom) to 8 at 312 degrees (upper right), 28 degrees a unit, and the redline covers 7-8.
// The needle reads 7.5 at 153 km/h: 20.4 km/h a unit up to 153 km/h; the last half unit then stretches over the rest of
// the range up to 240 km/h (GAUGE_MAX), so the needle keeps moving on a boosted car (about 233 km/h).
// The N2O arc (the outer, cyan one) is filled by the nitro level (game.nitro).
const GAUGE_MAX = 240;
const SCALE_A0 = 88, SCALE_STEP = 28;
const NITRO_A0 = 176, NITRO_A1 = 332, NITRO_R = 92.5;
const dialUnits = kmh => kmh <= 153 ? kmh / 20.4 : Math.min(8, 7.5 + (kmh - 153) / 174);
const dialPt = (r, a) => [100 + r * Math.cos(a * PI / 180), 100 + r * Math.sin(a * PI / 180)];
const arcD = (r, a0, a1) => {
  const [x0, y0] = dialPt(r, a0), [x1, y1] = dialPt(r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
{ // the static parts of the dial, drawn once, bottom to top
  const g = $('gaugeTicks'), NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, cls) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cls) e.setAttribute('class', cls);
    g.appendChild(e); return e;
  };
  el('circle', { cx: 100, cy: 100, r: 26.5 }, 'dialHub');                                      // the dark centre
  el('circle', { cx: 100, cy: 100, r: 46 }, 'dialRing');                                       // the light ring round it
  el('path', { d: arcD(NITRO_R, NITRO_A0, NITRO_A1) }, 'dialTrack');                           // the empty N2O arc
  const fill = el('path', { d: arcD(NITRO_R, NITRO_A0, NITRO_A1), pathLength: 100 }, 'nitroFill');
  fill.id = 'nitroFill';                                                                       // filled by updateHUD
  for (let k = 1; k <= 11; k++) {                                                              // notches across the N2O arc, every 14 degrees
    const a = NITRO_A0 + k * 14, [x1, y1] = dialPt(87.5, a), [x2, y2] = dialPt(96, a);
    el('line', { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) }, 'nitroNotch');
  }
  el('path', { d: arcD(79, SCALE_A0, SCALE_A0 + 8 * SCALE_STEP) }, 'dialBand');                // the grey scale band
  el('path', { d: arcD(79, SCALE_A0 + 7 * SCALE_STEP, SCALE_A0 + 8 * SCALE_STEP) }, 'dialRed'); // the redline, 7 to 8
  for (let i = 0; i <= 8; i++) {                                                               // a tick and a number per unit
    const a = SCALE_A0 + i * SCALE_STEP;
    const [x1, y1] = dialPt(73, a), [x2, y2] = dialPt(85, a);
    el('line', { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) }, 'dialTick');
    const [x, y] = dialPt(65, a);
    el('text', { x: x.toFixed(2), y: y.toFixed(2) }, 'dialNum').textContent = String(i);
  }
  const [lx, ly] = dialPt(NITRO_R, 314), lb = el('text', { x: lx.toFixed(2), y: ly.toFixed(2), transform: `rotate(44 ${lx.toFixed(2)} ${ly.toFixed(2)})` }, 'nitroLbl');
  lb.textContent = 'N2O';
}
// the gear is derived from the speed (the car has no gearbox): 1 to 5, stepping up at 40, 80, 160 and 210 km/h (3 at 153)
const GEAR_STEPS = [40, 80, 160, 210];
export function resetHudCache() { hudCache = {}; }
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
export function updateHUD() {
  game.score = calcScore();
  setText('score', game.score.toLocaleString()); setText('timeDist', fmtTime(game.time) + ' · ' + (game.dist / 1000).toFixed(2) + ' km');
  const kmh = Math.round(player.speed * 3.6);
  setText('speed', kmh); setText('cash', game.cash); setText('takedowns', game.takedowns);
  const ang = SCALE_A0 + SCALE_STEP * dialUnits(clamp(kmh, 0, GAUGE_MAX)) - 270;   // the needle is drawn pointing up (270 degrees)
  if (hudCache.needle !== ang) { hudCache.needle = ang; $('needle').setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' 100 100)'); }
  setText('gear', 1 + GEAR_STEPS.filter(v => kmh >= v).length);
  const hrs = (env.phase * 24 + 6) % 24, hh = Math.floor(hrs), mm = Math.floor((hrs - hh) * 60);
  setText('clock', (env.day > 0.5 ? '☀ ' : '🌙 ') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'));
  const hp = clamp(game.hp, 0, 100); $('hpFill').style.width = hp + '%';
  $('hpFill').style.background = hp > 55 ? 'linear-gradient(#7dff7a,#27c93f)' : hp > 28 ? 'linear-gradient(#ffe14a,#ffb21a)' : 'linear-gradient(#ff7a7a,#e02020)';
  const nf = $('nitroFill'), nit = clamp(game.nitro, 0, 100);
  if (hudCache.nitro !== nit) { hudCache.nitro = nit; nf.style.strokeDasharray = nit.toFixed(1) + ' 100'; }
  nf.classList.toggle('on', game.nitroOn); nf.classList.toggle('lock', game.nitroLock);
  $('boostFx').style.opacity = String(clamp(player.boost, 0, 1) * 0.9);
  $('flatWarn').style.opacity = player.flatT > 0 ? '1' : '0';
  const pw = $('pinWrap'); pw.classList.toggle('on', game.pin > 0.05); $('pinFill').style.width = clamp(game.pin / DIFF.pin, 0, 1) * 100 + '%';
  setText('heat', 'WANTED ' + '★'.repeat(game.wanted) + '☆'.repeat(5 - game.wanted));
  setText('wantedDetail', 'LEVEL ' + game.wanted + ' · ' + POLICE_TIERS[game.wanted - 1].name);
  const live = game.t - sight.t < 0.6, heliVis = helicopter && helicopter.visible;
  let at, ac;
  if (heliVis && sight.heliOn) { at = '🚁 AIR UNIT TRACKING YOU'; ac = '#ff5a5a'; }
  else if (live) { at = '👁 SPOTTED'; ac = '#ffd23b'; }
  else if (heliVis) { at = '🚁 AIR UNIT SEARCHING…'; ac = '#ffb347'; }
  else if (game.hideT > 0) { at = '⚠ HIDING · ' + Math.floor(game.hideT) + 's'; ac = '#ff7a3d'; }
  else { at = '🔍 COPS SEARCHING · ' + Math.floor(game.t - sight.t) + 's'; ac = '#7dff7a'; }
  setText('alertLine', at); $('alertLine').style.color = ac;
}