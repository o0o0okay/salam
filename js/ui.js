/* HUD, radar, toasts */
import { $, PI, CHUNK, clamp, fmtTime } from './utils.js';
import { game, player, sight, police, civs, spikes, calcScore } from './state.js';
import { DIFF, POLICE_TIERS } from './config.js';
import { env } from './environment.js';
import { nearChunks } from './world.js';
import { helicopter } from './helicopter.js';
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
  for (let i = gx0; i <= gx1; i++) rctx.fillRect(i * CHUNK - 8, player.z - range * 1.6, 16, range * 3.2);
  for (let j = gz0; j <= gz1; j++) rctx.fillRect(player.x - range * 1.6, j * CHUNK - 8, range * 3.2, 16);
  for (const ch of nearChunks(player.x, player.z)) for (const pk of ch.pickups) {
    if (pk.taken) continue;
    rctx.fillStyle = pk.kind === 'nitro' ? '#4aa8ff' : pk.kind === 'repair' ? '#44ff77' : '#ffd23b';
    rctx.fillRect(pk.x - 1.4 / s * 1.2, pk.z - 1.4 / s * 1.2, 2.8 / s * 1.2, 2.8 / s * 1.2);
  }
  for (const c of civs) { rctx.fillStyle = c.wrecked ? '#666' : '#e8e8e8'; rctx.beginPath(); rctx.arc(c.x, c.z, 3 / s, 0, PI * 2); rctx.fill(); }
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
  rctx.fillStyle = '#fff'; rctx.beginPath(); rctx.moveTo(R, R - 11); rctx.lineTo(R - 7, R + 8); rctx.lineTo(R + 7, R + 8); rctx.closePath(); rctx.fill();
}
let hudCache = {};
// The dial, as in Need for Speed: a 240-degree speed scale, one degree per km/h (so 0-240 km/h, which is above the top
// speed of a boosted car: 48 m/s plus nitro is about 233 km/h), numbered 0-8 (one number per 30 km/h), with a red
// band over 210-240 km/h. The needle is the group #needle, turned about the hub. The nitro is the outer arc, from
// about 10 to 2 o'clock, filled by the nitro level (game.nitro).
const GAUGE_MAX = 240;
const SPEED_A0 = 135, NITRO_A0 = 210, NITRO_A1 = 330, NITRO_R = 90;   // degrees, clockwise from 3 o'clock
const dialPt = (r, a) => [100 + r * Math.cos(a * PI / 180), 100 + r * Math.sin(a * PI / 180)];
const arcD = (r, a0, a1) => {
  const [x0, y0] = dialPt(r, a0), [x1, y1] = dialPt(r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
{ // the static parts of the dial, drawn once
  const g = $('gaugeTicks'), NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, cls) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cls) e.setAttribute('class', cls);
    g.appendChild(e); return e;
  };
  el('path', { d: arcD(NITRO_R, NITRO_A0, NITRO_A1) }, 'dialTrack');                           // the empty nitro arc
  el('path', { d: arcD(66, SPEED_A0 + 210, SPEED_A0 + GAUGE_MAX) }, 'dialRed');              // the red band, 210-240 km/h
  $('nitroFill').setAttribute('d', arcD(NITRO_R, NITRO_A0, NITRO_A1));
  for (let k = 0; k <= GAUGE_MAX / 15; k++) {                                                 // a tick every 15 km/h
    const a = SPEED_A0 + k * 15, major = k % 2 === 0;
    const [x1, y1] = dialPt(major ? 70 : 74, a), [x2, y2] = dialPt(80, a);
    el('line', { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) }, major ? 'dialTick' : 'dialTickMinor');
  }
  for (let i = 0; i <= 8; i++) {                                                              // the numbers 0-8, one per 30 km/h
    const [x, y] = dialPt(54, SPEED_A0 + i * 30);
    el('text', { x: x.toFixed(2), y: y.toFixed(2) }, 'dialNum').textContent = String(i);
  }
  const [lx, ly] = dialPt(NITRO_R, 312), lb = el('text', { x: lx.toFixed(2), y: ly.toFixed(2), transform: `rotate(-40 ${lx.toFixed(2)} ${ly.toFixed(2)})` }, 'nitroLbl');
  lb.textContent = 'N2O';
}
// the gear is derived from the speed (the car has no gearbox): 1 to 5, stepping up at 40, 80, 130 and 200 km/h
const GEAR_STEPS = [40, 80, 130, 200];
export function resetHudCache() { hudCache = {}; }
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
export function updateHUD() {
  game.score = calcScore();
  setText('score', game.score.toLocaleString()); setText('timeDist', fmtTime(game.time) + ' · ' + (game.dist / 1000).toFixed(2) + ' km');
  const kmh = Math.round(player.speed * 3.6);
  setText('speed', kmh); setText('cash', game.cash); setText('takedowns', game.takedowns);
  const ang = SPEED_A0 + clamp(kmh, 0, GAUGE_MAX) - 270;             // the needle is drawn pointing up (270 degrees)
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
  else { at = '🔍 COPS SEARCHING · ' + Math.floor(game.t - sight.t) + 's'; ac = '#7dff7a'; }
  setText('alertLine', at); $('alertLine').style.color = ac;
}