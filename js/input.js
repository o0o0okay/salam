/* Keyboard + touch input */
import { $ } from './utils.js';
import { game } from './state.js';
import { sfx } from './audio.js';
import { weatherSystem } from './weather.js';
import { toast } from './ui.js';
import { startGame, togglePause } from './flow.js';
import { toggleMap, mapOpen } from './map.js';
import { clearWanted, restoreWanted } from './rules.js';

const keys = {};
const touch = { left: false, right: false, brake: false, drift: false, nitro: false };
let touchMode = false;

function bindTouch(id, key) {
  const el = $(id);
  const on = e => { e.preventDefault(); touch[key] = true; touchMode = true; el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = e => { e.preventDefault(); touch[key] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

export function initInput() {
  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    // P pauses and resumes; Escape does the same, unless the map is open, in which case it closes the map
    if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) {
      if (e.code === 'Escape' && mapOpen()) toggleMap(); else togglePause();
    }
    if (e.code === 'KeyM' && !e.repeat && game.state === 'playing') toggleMap();   // the city map (js/map.js)
    if (e.code === 'KeyB' && !e.repeat) sfx.toggle();                              // sound on / off
    if (e.code === 'Tab' && game.state === 'playing' && !game.paused) {
      e.preventDefault();
      if (!e.repeat) {
        weatherSystem.cycleMode();
        toast('WEATHER: ' + weatherSystem.label);
      }
    }
    // DEBUG: هر بار T = یک ستاره بالاتر (قبل از انتشار حذف شود)
    if (e.code === 'KeyT' && !e.repeat && game.state === 'playing' && !game.paused && game.wanted < 5) {
      game.debugWanted = game.wanted + 1;
    }
    // Y = پاک کردن کامل ستاره‌ها برای تست اسکله بدون تعقیب
    if (e.code === 'KeyY' && !e.repeat && game.state === 'playing') {
      if (game.wanted === 0) restoreWanted(); else clearWanted();
    }
    if (e.code === 'KeyU' && !e.repeat && game.state === 'playing') {
      restoreWanted();
    }
    if ((e.code === 'Enter' || e.code === 'Space') && game.state === 'menu') startGame();
    else if (e.code === 'Enter' && game.state === 'over' && game.overShown) startGame();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  bindTouch('bL', 'left'); bindTouch('bR', 'right'); bindTouch('bB', 'brake'); bindTouch('bD', 'drift'); bindTouch('bN', 'nitro');
  // clear wanted button (HUD) - for testing harbor without chase
  const cw = $('clearWantedBtn'); if (cw) cw.addEventListener('click', (e) => { e.stopPropagation(); if (game.state === 'playing') { if (game.wanted === 0) restoreWanted(); else clearWanted(); } });
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) { touchMode = true; $('touch').classList.add('on'); }
  window.addEventListener('touchstart', () => { if (!touchMode) { touchMode = true; } $('touch').classList.add('on'); }, { passive: true });
}

export function readInput() {
  const L = keys.ArrowLeft || keys.KeyA || touch.left, R = keys.ArrowRight || keys.KeyD || touch.right;
  const up = keys.ArrowUp || keys.KeyW, down = keys.ArrowDown || keys.KeyS || touch.brake;
  let throttle = 0; if (down) throttle = -1; else if (up || touchMode) throttle = 1;
  return { steer: (L ? 1 : 0) - (R ? 1 : 0), throttle, hand: !!(keys.Space || touch.drift), nitro: !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyE || touch.nitro) };
}