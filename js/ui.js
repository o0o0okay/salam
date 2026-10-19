/* HUD, radar, toasts */
import { $, PI, clamp, fmtTime } from './utils.js';
import { game, player, sight, calcScore } from './state.js';
import { DIFF, POLICE_TIERS } from './config.js';
import { env } from './environment.js';
import { helicopter } from './helicopter.js';
export function toast(text, ms = 1500) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = text; $('toasts').appendChild(d); setTimeout(() => d.remove(), ms);
  if ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}
// The radar lives in js/radar.js (the map's picture of the city, with the chase on it); update.js draws it from here.
export { drawRadar } from './radar.js';
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
let _prevHp = 100, _ghostHp = 100, _ghostTimer = null, _sparkTimer = null, _flashTimer = null;
function hpGradient(hp){
  if (hp > 55) return 'linear-gradient(90deg,#27c93f,#7dff7a)';
  if (hp > 28) return 'linear-gradient(90deg,#ff9a1a,#ffe14a)';
  return 'linear-gradient(90deg,#e02020,#ff7a7a)';
}
function triggerDelta(delta){
  const layer = $('hpDeltaLayer'); if (!layer) return;
  const d = document.createElement('div'); d.className = 'hpDelta ' + (delta > 0 ? 'heal' : 'dmg');
  d.textContent = (delta > 0 ? '+' : '') + Math.round(delta);
  layer.appendChild(d); setTimeout(()=> d.remove(), 800);
}
function pulseHealth(newHp, oldHp){
  const wrap = $('hpWrap'), heart = $('hpHeart'), track = $('hpTrack'), fill = $('hpFill'), ghost = $('hpGhost'), spark = $('hpSpark'), flash = $('hpFlash');
  if (!wrap || !fill) return;
  const delta = newHp - oldHp;
  if (Math.abs(delta) < 0.01) return;
  const isDmg = delta < 0;
  // clear pending
  if (_ghostTimer) { clearTimeout(_ghostTimer); _ghostTimer = null; }
  if (_sparkTimer) { clearTimeout(_sparkTimer); _sparkTimer = null; }
  if (_flashTimer) { clearTimeout(_flashTimer); _flashTimer = null; }
  // heart + wrap classes
  if (heart){
    heart.classList.remove('hit','heal'); void heart.offsetWidth;
    heart.classList.add(isDmg ? 'hit' : 'heal');
    setTimeout(()=> heart.classList.remove('hit','heal'), 620);
  }
  if (track){
    if (isDmg){ track.classList.remove('shake'); void track.offsetWidth; track.classList.add('shake'); setTimeout(()=> track.classList.remove('shake'), 420); }
  }
  if (fill){
    fill.classList.remove('dmgFlash','healFlash'); void fill.offsetWidth;
    fill.classList.add(isDmg ? 'dmgFlash' : 'healFlash');
    setTimeout(()=> fill.classList.remove('dmgFlash','healFlash'), 420);
  }
  // spark at tip
  if (spark){
    spark.style.left = newHp + '%';
    spark.classList.remove('on'); void spark.offsetWidth;
    spark.classList.add('on');
    _sparkTimer = setTimeout(()=> spark.classList.remove('on'), 420);
  }
  // white flash
  if (flash){
    flash.style.transition = 'none'; flash.style.opacity = '0.95';
    void flash.offsetWidth;
    flash.style.transition = 'opacity .38s ease-out';
    flash.style.opacity = '0';
  }
  // delta number
  triggerDelta(delta);
  // wrap low handled elsewhere, but add temporary pulse
  wrap.classList.remove('damaged','healed'); void wrap.offsetWidth;
  wrap.classList.add(isDmg ? 'damaged' : 'healed');
  setTimeout(()=> wrap.classList.remove('damaged','healed'), 600);

  // ghost logic
  if (ghost){
    if (isDmg){
      // ghost stays at old, fill goes to new, then ghost catches up
      ghost.style.transition = 'none';
      ghost.style.background = hpGradient(oldHp);
      ghost.style.width = oldHp + '%';
      void ghost.offsetWidth;
      ghost.style.transition = 'width .85s cubic-bezier(.22,.8,.32,1)';
      // fill already set to new via caller, ghost delayed
      _ghostTimer = setTimeout(()=>{
        ghost.style.background = hpGradient(newHp);
        ghost.style.width = newHp + '%';
      }, 220);
    } else {
      // heal: ghost jumps instantly to new, fill animates
      ghost.style.transition = 'none';
      ghost.style.background = hpGradient(newHp);
      ghost.style.width = newHp + '%';
      void ghost.offsetWidth;
      ghost.style.transition = 'width .85s cubic-bezier(.22,.8,.32,1)';
    }
  }
}
export function resetHudCache() { hudCache = {}; _prevHp = clamp(game.hp,0,100); _ghostHp = _prevHp; }
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; const el=$(id); if(el) el.textContent = v; } }
export function updateHUD() {
  game.score = calcScore();
  setText('score', game.score.toLocaleString()); setText('timeDist', fmtTime(game.time) + ' · ' + (game.dist / 1000).toFixed(2) + ' km');
  const kmh = Math.round(player.speed * 3.6);
  setText('speed', kmh); setText('cash', game.cash); setText('takedowns', game.takedowns);
  const ang = SCALE_A0 + SCALE_STEP * dialUnits(clamp(kmh, 0, GAUGE_MAX)) - 270;   // the needle is drawn pointing up (270 degrees)
  if (hudCache.needle !== ang) { hudCache.needle = ang; const n=$('needle'); if(n) n.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' 100 100)'); }
  setText('gear', 1 + GEAR_STEPS.filter(v => kmh >= v).length);
  const hrs = (env.phase * 24 + 6) % 24, hh = Math.floor(hrs), mm = Math.floor((hrs - hh) * 60);
  setText('clock', (env.day > 0.5 ? '☀ ' : '🌙 ') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'));
  // --- animated health ---
  const hp = clamp(game.hp, 0, 100);
  const fill = $('hpFill'), ghost = $('hpGhost'), spark = $('hpSpark'), wrap = $('hpWrap'), val = $('hpValue');
  if (fill && ghost){
    // first frame init
    if (hudCache.hp === undefined){
      fill.style.width = hp + '%'; ghost.style.width = hp + '%';
      fill.style.background = hpGradient(hp); ghost.style.background = hpGradient(hp);
      if (spark) spark.style.left = hp + '%'; _prevHp = hp; _ghostHp = hp;
    } else if (hp !== _prevHp){
      // animate change
      fill.style.background = hpGradient(hp);
      // spark follows immediately to new position even before ghost
      if (spark && hp > 1) spark.style.left = hp + '%';
      fill.style.width = hp + '%';
      pulseHealth(hp, _prevHp);
      _prevHp = hp;
    } else {
      // keep gradient in sync without pulse (e.g. crossing threshold)
      if (hudCache.hp !== hp) fill.style.background = hpGradient(hp);
      if (spark) spark.style.left = hp + '%';
    }
    // low health state
    if (wrap) wrap.classList.toggle('low', hp <= 28 && hp > 0);
    if (val) val.textContent = Math.round(hp) + '%';
    // hide spark at 0 or 100 edge slightly
    if (spark) spark.style.opacity = (hp <= 0 || hp >= 100) ? '0' : '';
  } else {
    // fallback for old markup
    const oldFill = $('hpFill'); if(oldFill){ oldFill.style.width = hp + '%'; oldFill.style.background = hpGradient(hp); }
  }
  if (hudCache.hp !== hp) hudCache.hp = hp;
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