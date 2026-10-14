/* Renders what the police air unit's searchlight does to the road, straight from the numbers the game uses
   (js/heliLight.js), plus the pool radius derived from the spotlight in js/helicopter.js: a night plan of the
   car with the pool sampled over ten seconds, the old "aimed 0.7 s ahead" circle for comparison, and the
   beacon colour cycle.
   Run:  node tools/sidewalk-checks/plan-airunit.mjs   -> plan-airunit.png */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { writePNG, canvas, drawText } from './png.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const L = await import(url.pathToFileURL(path.join(repo, 'js/heliLight.js')).href);

// the spotlight itself: distance and half-angle read out of the real light so the sheet cannot drift from it
const heliSrc = fs.readFileSync(path.join(repo, 'js/helicopter.js'), 'utf8');
const spot = heliSrc.match(/new THREE\.SpotLight\(0x[0-9a-f]+,\s*0,\s*([\d.]+),\s*([\d.]+)/);
if (!spot) throw new Error('plan-airunit: could not read the air unit spotlight out of js/helicopter.js');
const SPOT_RANGE = +spot[1], SPOT_ANGLE = +spot[2];

const W = 1180, H = 780;
const cv = canvas(W, H, [12, 15, 24]);
const INK = [232, 238, 246], DIM = [128, 142, 160], ROAD = [38, 42, 50], KERB = [150, 156, 166];
const BLUE = [42, 108, 255], RED = [255, 59, 48];
const S = 9;                       // pixels per metre
const CX = 355, CY = 485;          // the car sits here
const X = m => CX + m * S, Y = m => CY - m * S;      // heading +z points up the sheet

drawText(cv, 24, 20, 'POLICE AIR UNIT - SEARCHLIGHT POOL', INK, 3);
drawText(cv, 24, 46, 'POOL CENTRED ON THE CAR, SWAYING AROUND IT, TINTED TO THE BEACON COLOURS', DIM, 1);

// ---- road: 16 m of asphalt between kerb faces (js/world.js PAVE_IN = 8.0) ----
cv.rect(X(-8) - 6, 70, X(8) + 6, 740, KERB);
cv.rect(X(-8), 70, X(8), 740, ROAD);
for (const s of [-1, 1]) for (let i = -3; i <= 3; i++) cv.rect(X(s * 15) - 3, 200 + i * 90, X(s * 15) + 3, 260 + i * 90, [26, 30, 38]);
for (let i = 0; i < 9; i++) cv.rect(X(0) - 2, 90 + i * 75, X(0) + 2, 120 + i * 75, [70, 76, 84]);   // centre dashes

// ---- the searchlight: aircraft 8 m behind the car at 38 m up, as js/helicopter.js flies it ----
const AC = { x: 0, z: -8, y: 38 - 0.4 };            // the lamp hangs 0.4 m under the body
const pool = {}, aim = {};
const samples = [];
for (let i = 0; i < 14; i++) {
  const t = i * 0.72;                               // ~10 s of driving straight at 40 m/s
  L.poolPoint(t, 0, 0, 0, pool);                    // the car parked at the origin, heading +z
  L.aimPoint(AC.x, AC.y, AC.z, pool.x, pool.y, pool.z, aim);
  const slant = Math.hypot(AC.x - pool.x, AC.y, AC.z - pool.z);
  const strobe = L.beaconStrobe(t);
  const hex = L.beaconTint(strobe, true);
  samples.push({ t, x: pool.x, z: pool.z, y: pool.y, aimX: aim.x, aimZ: aim.z, strobe, hex, r: Math.tan(SPOT_ANGLE) * slant });
}
// pool outline: draw as an ellipse in the drawing plane (the cone is round; on plan it stays round)
for (const s of samples) {
  const c = [s.hex >> 16 & 255, s.hex >> 8 & 255, s.hex & 255];
  const px = X(s.x), py = Y(s.z), r = s.r * S;
  for (let a = 0; a < 360; a += 1.1) {
    const rad = a * Math.PI / 180;
    cv.px(px + Math.cos(rad) * r, py + Math.sin(rad) * r, c, 0.5);
  }
  cv.disc(px, py, 2.6, c, 0.95);
  cv.vline(px, py, Y(0), c, 0.28);                  // where the pool centre sits along the road
}
// the old behaviour: the beam was aimed at a 0.7 s lead position, 28 m past the car at 40 m/s
const OLD = 40 * 0.7;
for (let a = 0; a < 360; a += 2.2) {
  const rad = a * Math.PI / 180, r = Math.tan(SPOT_ANGLE) * Math.hypot(0 - 0, 37.35, -OLD + 8) * S;
  cv.px(X(0) + Math.cos(rad) * r, Y(OLD) + Math.sin(rad) * r, [255, 176, 66], 0.30);
}
cv.vline(X(0), Y(OLD), Y(0), [255, 176, 66], 0.45);
drawText(cv, X(0) + 14, Y(OLD) - 6, 'BEFORE: AIMED 0.7 S AHEAD', [255, 176, 66], 1);
drawText(cv, X(0) + 14, Y(OLD) + 8, `= ${OLD.toFixed(0)} M PAST THE CAR AT 40 M/S`, [255, 176, 66], 1);

// ---- the car ----
cv.rect(X(-1.05), Y(2.3), X(1.05), Y(-2.3), [232, 238, 246]);
cv.rect(X(-0.75), Y(1.0), X(0.75), Y(-0.5), [90, 130, 200]);
drawText(cv, X(0) + 16, Y(-2.3) + 6, 'OUR CAR', INK, 1);
for (let i = 0; i < 30; i++) cv.vline(X(0), Y(3.2) - i, Y(3.2) - i, INK, 1 - i / 34);   // heading arrow
drawText(cv, X(0) + 8, Y(3.4) - 14, 'DIRECTION OF TRAVEL', DIM, 1);

// ---- side panel: the beacon cycle swatches ----
const PANEL = 720;
drawText(cv, PANEL, 90, 'BEACON CYCLE (1.05 S)', INK, 2);
drawText(cv, PANEL, 116, 'BLUE END AND RED END OF THE POLICE LIGHT BAR', DIM, 1);
for (let i = 0; i < 6; i++) {
  const strobe = i / 5, hex = L.beaconTint(strobe, true);
  const c = [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
  const y = 140 + i * 62;
  cv.rect(PANEL, y, PANEL + 92, y + 40, c);
  drawText(cv, PANEL + 104, y + 4, `R${String(c[0]).padStart(3, ' ')} G${String(c[1]).padStart(3, ' ')} B${String(c[2]).padStart(3, ' ')}`, INK, 2);
  drawText(cv, PANEL + 104, y + 24, `STROBE ${strobe.toFixed(2)}  BRIGHT ${L.beaconPulse(strobe).toFixed(2)}`, DIM, 1);
}
drawText(cv, PANEL, 540, 'LIGHT BARS ON THE CRUISERS', DIM, 1);
cv.rect(PANEL, 556, PANEL + 92, 596, BLUE); cv.rect(PANEL + 104, 556, PANEL + 196, 596, RED);
drawText(cv, PANEL + 210, 566, '0X2A6CFF / 0XFF3B30', INK, 2);

// ---- side panel: what the check suite measures ----
const stats = [];
{
  const p = {};
  let worst = 0, sum = 0, n = 0;
  for (let h = 0; h < Math.PI * 2; h += Math.PI / 12) for (let v = 0; v <= 48; v += 8) for (let t = 0; t < 30; t += 0.05) {
    const x = Math.sin(h) * v * t, z = Math.cos(h) * v * t;
    L.poolPoint(t, x, z, h, p);
    const d = Math.hypot(p.x - x, p.z - z); worst = Math.max(worst, d); sum += d; n++;
  }
  let latMin = 9, latMax = -9, foreMin = 9, foreMax = -9, yMin = 9, yMax = -9;
  for (let t = 0; t < 40; t += 0.01) {
    L.poolPoint(t, 0, 0, 0, p);
    latMin = Math.min(latMin, p.x); latMax = Math.max(latMax, p.x);
    foreMin = Math.min(foreMin, p.z); foreMax = Math.max(foreMax, p.z);
    yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
  }
  stats.push(`POOL CENTRE OFF THE CAR: ${worst.toFixed(2)} M WORST, ${(sum / n).toFixed(2)} M MEAN (ANY SPEED)`);
  stats.push(`SWAY: ${(latMax - latMin).toFixed(2)} M LEFT/RIGHT, ${(foreMax - foreMin).toFixed(2)} M UP/DOWN THE ROAD`);
  stats.push(`AIM HEIGHT ${yMin.toFixed(2)}..${yMax.toFixed(2)} M — THE POOL RISES AND FALLS`);
  stats.push(`SPOT: HALF-ANGLE ${SPOT_ANGLE} RAD, RANGE ${SPOT_RANGE} M -> POOL RADIUS ${samples[0].r.toFixed(1)} M`);
  stats.push('THE BEAM IS AIMED SHORT BY THE CONE PROJECTION, SO THE MIDDLE LANDS ON THE CAR');
}
drawText(cv, PANEL, 640, 'MEASURED BY THE CHECK SUITE', INK, 2);
for (let i = 0; i < stats.length; i++) drawText(cv, PANEL, 664 + i * 16, stats[i], DIM, 1);

// ---- legend for the plan ----
drawText(cv, 24, 752, 'CIRCLES = THE POOL OVER 10 S.  DOTS = ITS CENTRE.  ORANGE = THE OLD 0.7 S LEAD.', DIM, 1);

const file = path.join(here, 'plan-airunit.png');
fs.writeFileSync(file, writePNG(W, H, cv.buf));
console.log(`wrote ${file}  (spot half-angle ${SPOT_ANGLE} rad, pool radius ${samples[0].r.toFixed(1)} m, ${samples.length} pool samples over ${(samples.length * 0.72).toFixed(1)} s)`);
