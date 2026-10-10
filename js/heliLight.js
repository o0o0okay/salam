/* Police air unit — searchlight maths: where the pool of light lands, how it sways on the car and how it is
   tinted. Deliberately free of three.js: js/helicopter.js feeds these numbers into the spotlight and the beam
   cone, and tools/sidewalk-checks/run.mjs asserts them in Node (see the "air unit searchlight" section). */

// The beam is aimed at the car's body, not at the tarmac behind it, so the middle of the lit circle ends up
// on the car. Aiming at 0.95 m (roof height) also means the axis crosses the road essentially under the car.
export const AIM_Y = 0.95;

// Sway of the pool around the car, in metres: across the car (left/right) and along its heading (which reads as
// up/down the road) — plus a slow rise and fall of the aim height. A searchlight is hand-flown, so even on a
// dead-straight run the circle drifts a little instead of being welded to the roof.
export const SWAY = { lat: 1.55, fore: 1.95, y: 0.22 };

// How fast the beam chases the car (1/s) — a hard change of direction sweeps the pool over the car rather than
// teleporting it — and how far off the aim may drift before it is taken outright (lock-on, respawn, teleport).
export const AIM_RATE = 14;
export const SNAP = 14;

// Beacon cycle: the light leans to the police colours (blue then red, the two on the light bars) on a ~1 s
// cycle and never rests on plain white.
export const BEACON_HZ = 6.0;

// Mixing happens in sRGB bytes so the result matches the setHex() values used everywhere else in the game;
// blue and red are the police light-bar colours from js/carModels.js (0x2a6cff / 0xff3b30).
const BASE_COOL = [0xbf, 0xe9, 0xff];   // tracking: the lamp's own cool white
const BASE_WARM = [0xff, 0xe0, 0xa8];   // searching: the lamp's own warm white
const POLICE_BLUE = [0x2a, 0x6c, 0xff], POLICE_RED = [0xff, 0x3b, 0x30];

const mix = (a, b, k) => a + (b - a) * k;

// Ground point the pool must cover: the car itself, swayed a little across it and along it. Two slow waves per
// axis at periods that do not line up (3.7 s + 1.6 s across the car, 5.7 s + 2.4 s along it), so the sway never
// reads as a metronome. The pool does NOT lead the car with speed — that was what pushed the circle down the
// road at 40 m/s while the car had already gone straight past it.
export function poolPoint(t, x, z, h, out = {}) {
  const lat = Math.sin(t * 1.7 + 0.9) * 1.55 + Math.sin(t * 3.9) * 0.45;
  const fore = Math.sin(t * 1.1 + 2.3) * 1.95 + Math.sin(t * 2.6) * 0.5;
  const s = Math.sin(h), c = Math.cos(h);              // forward = (sin h, cos h), right = (cos h, -sin h)
  out.x = x + c * lat + s * fore;
  out.z = z - s * lat + c * fore;
  out.y = AIM_Y + Math.sin(t * 2.15 + 0.4) * SWAY.y;
  return out;
}

// The spotlight is not stood on the car: it is pulled back along the line to the aircraft by exactly the amount
// the cone's axis travels between the aim height and the road. The axis then crosses the tarmac in the middle of
// the pool point instead of a metre past the car's nose (at 38 m up and 40 m out that is about 1.0 m).
export function aimPoint(lx, ly, lz, gx, gy, gz, out = {}) {
  const k = (ly - gy) / Math.max(ly, 1e-3);
  out.x = lx + (gx - lx) * k;
  out.z = lz + (gz - lz) * k;
  out.y = gy;
  return out;
}

// Light trailing filter: the pool lags a change of direction instead of snapping, but a big jump is taken
// outright so the beam never sweeps across the whole city on a respawn. The car's velocity is fed in as a lead
// (v / rate) — without it the filter would sit v/rate metres behind a car that never stops moving, which is
// exactly the "the circle is not on my car" complaint; with it the pool is dead on the sway point on a straight
// run and only trails while the car is actually turning.
export function followAim(cur, raw, dt, vx = 0, vz = 0) {
  const tx = raw.x + vx / AIM_RATE, tz = raw.z + vz / AIM_RATE;
  const far = !cur.ok || Math.hypot(tx - cur.x, tz - cur.z) > SNAP;
  const k = far ? 1 : 1 - Math.exp(-dt * AIM_RATE);
  cur.x = far ? raw.x : cur.x + (tx - cur.x) * k;
  cur.z = far ? raw.z : cur.z + (tz - cur.z) * k;
  cur.y = far ? raw.y : cur.y + (raw.y - cur.y) * k;
  cur.ok = true;
  return cur;
}

// 0 = blue end of the beacon cycle, 1 = red end.
export const beaconStrobe = t => 0.5 - 0.5 * Math.cos(t * BEACON_HZ);

// Both police colours are always present (a police light bar shows blue and red, it does not fade between
// them); one of them dominates at each end of the cycle. `amount` scales the whole lean — the beam leans less
// while the unit is only searching, because the warm "I have not found you" look has to stay readable.
export function beaconTint(strobe, tracking, amount = 1) {
  const base = tracking ? BASE_COOL : BASE_WARM;
  const kb = (0.20 + 0.55 * (1 - strobe)) * amount, kr = (0.12 + 0.62 * strobe) * amount;
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) c[i] = Math.max(0, Math.min(255, Math.round(mix(mix(base[i], POLICE_BLUE[i], kb), POLICE_RED[i], kr))));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

// Brightness rides the same cycle: the light bar is brightest on the flip, dimmest between.
export const beaconPulse = strobe => 0.88 + 0.24 * strobe;
