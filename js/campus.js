// Campus buildings beside the start: the hospital (with its air ambulance and the box-pixel lettering used on signs),
// the fire station, the school and the filling station. Each builder returns a group plus the solids it stands on;
// js/world.js places them into a block and records what they block.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, box, cyl, ASSET } from './assets.js';
import { PI } from './utils.js';

// ---- Hospital ----
// Box-pixel lettering: every lit pixel of a 5x7 glyph becomes one thin box, so signs are plain geometry with no
// texture work. Text is centred on the origin, runs along +x and faces +z; rotate the group for other walls.
export const FONT3D = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01110,10001,10000,10000,10000,10001,01110', D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111', F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111', H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111', J: '00111,00010,00010,00010,00010,10010,01100',
  K: '10001,10010,10100,11000,10100,10010,10001', L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110', P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101', R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01111,10000,10000,01110,00001,00001,11110', T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110', V: '10001,10001,10001,10001,10001,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001', X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100', Z: '11111,00001,00010,00100,01000,10000,11111',
  '0': '01110,10001,10011,10101,11001,10001,01110', '1': '00100,01100,00100,00100,00100,00100,01110',
  '2': '01110,10001,00001,00010,00100,01000,11111', '3': '11111,00010,00100,00010,00001,10001,01110',
  '4': '00010,00110,01010,10010,11111,00010,00010', '5': '11111,10000,11110,00001,00001,10001,01110',
  '6': '00110,01000,10000,11110,10001,10001,01110', '7': '11111,00001,00010,00100,01000,01000,01000',
  '8': '01110,10001,10001,01110,10001,10001,01110', '9': '01110,10001,10001,01111,00001,00010,01100',
  ' ': '00000,00000,00000,00000,00000,00000,00000', '-': '00000,00000,00000,11111,00000,00000,00000',
};
// Sign lettering: every pixel of a glyph is a square, 5 columns by 7 rows for the classic 5x7 proportions.
// The letters are merged once per (string, size) and that merged geometry is shared by every sign that asks for
// it. A shop name used to cost the chunk builder ~150 separate little boxes and a parade of shopfronts plus its
// tower titles well over two thousand; sharing them is what keeps a shopping street from stalling the streamer.
const textGeoCache = new Map();
const TEXT_BOX = new THREE.BoxGeometry(1, 1, 1);
const _textM = new THREE.Matrix4();
export function textGeometry(str, h = 1.2, depth = 0.14, gap = 0.8, mirror = false) {
  const key = h + '|' + depth + '|' + gap + '|' + str.toUpperCase() + '|' + (mirror ? 'm' : 'n');
  let geo = textGeoCache.get(key);
  if (geo === undefined) {
    const pw = h / 7, ph = h / 7;
    const total = str.length * (pw + gap) - gap;
    const geos = [];
    for (let i = 0; i < str.length; i++) {
      const rows = (FONT3D[str[i].toUpperCase()] || FONT3D[' ']).split(',');
      const x0 = mirror ? total / 2 - i * (pw + gap) : -total / 2 + i * (pw + gap);
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (rows[r][c] !== '1') continue;
        const g = TEXT_BOX.clone();
        _textM.makeScale(pw * 1.02, ph * 1.02, depth);
        _textM.setPosition(mirror ? x0 - c * pw + pw / 2 : x0 + c * pw + pw / 2, (6 - r) * ph + ph / 2, 0);
        g.applyMatrix4(_textM);
        geos.push(g);
      }
    }
    geo = geos.length ? mergeGeometries(geos, false) : null;
    geos.forEach(g => g.dispose());
    textGeoCache.set(key, geo);
  }
  return geo;
}
export function textBlocks(str, m, h = 1.2, depth = 0.14, gap = 0.8, mirror = false) {
  const g = new THREE.Group();
  const geo = textGeometry(str, h, depth, gap, mirror);
  if (geo) g.add(new THREE.Mesh(geo, m));
  return g;
}
// Hospital air ambulance: a proper rescue helicopter — cabin with a glass canopy, engine deck, tapered tail
// boom, fin, horizontal stabiliser, skids and a four-blade main rotor. Generous proportions (fuselage 6 m,
// rotor 9 m) so it reads as a helicopter from the street and not as a stick on the roof. The two rotor groups
// are returned centred on their own axes so the caller can merge them and spin the merged result.
export function buildAirAmbulance() {
  const body = new THREE.Group(), main = new THREE.Group(), tail = new THREE.Group();
  const white = mat(0xf2f5f7), red = mat(0xd6342c), glass = mat(0x1f3444), dark = mat(0x22252a), steel = mat(0xa9b0b6);
  const beaconB = new THREE.MeshBasicMaterial({ color: 0x2a6cff });      // roof beacon
  const beaconR = new THREE.MeshBasicMaterial({ color: 0xff2d2d });      // belly beacon
  const B = (w, h, d, m, x, y, z, cast = true) => body.add(box(w, h, d, m, x, y, z, cast));

  // ---- fuselage ----
  B(2.0, 0.5, 4.8, white, 0, 0.85, 0.1);                                // belly
  B(2.3, 1.15, 3.5, white, 0, 1.62, 0.3);                               // cabin
  B(2.34, 0.42, 4.9, red, 0, 1.06, 0.1);                                // red livery band
  B(1.95, 1.0, 1.7, glass, 0, 1.72, 2.1);                               // canopy
  B(1.75, 0.62, 1.0, white, 0, 1.32, 2.75);                             // nose
  B(1.4, 0.42, 0.6, white, 0, 1.1, 3.15);                               // nose tip
  B(1.7, 0.34, 2.9, white, 0, 2.32, 0.15);                              // cabin roof
  B(1.9, 0.62, 2.1, white, 0, 2.5, -0.5);                               // engine deck
  B(1.5, 0.22, 1.0, red, 0, 1.06, 2.9);                                 // nose stripe
  for (const sx of [-1, 1]) {
    B(0.06, 0.52, 1.6, glass, sx * 1.16, 1.72, 1.05, false);            // side windows
    B(0.06, 1.05, 0.28, red, sx * 1.17, 1.66, 0.35, false);             // flank cross, vertical
    B(0.06, 0.28, 1.05, red, sx * 1.17, 1.66, 0.35, false);             // flank cross, horizontal
    B(0.14, 0.14, 4.9, dark, sx * 1.06, 0.14, 0.05);                    // skid
    B(0.12, 0.62, 0.12, steel, sx * 0.78, 0.45, 1.35, false);           // struts
    B(0.12, 0.62, 0.12, steel, sx * 0.78, 0.45, -1.35, false);
  }
  // ---- tail ----
  B(0.66, 0.66, 3.0, white, 0, 1.78, -3.6);                             // boom
  B(0.5, 0.5, 1.3, white, 0, 1.95, -5.3);                               // boom taper
  B(0.5, 1.35, 0.62, red, 0, 2.5, -5.85);                               // fin
  B(2.1, 0.12, 0.8, white, 0, 1.78, -5.3);                              // stabiliser
  B(0.2, 0.9, 0.9, dark, 0.36, 2.55, -5.9, false);                      // tail rotor housing
  // ---- mast, beacons, light ----
  B(0.2, 0.55, 0.2, steel, 0, 2.95, -0.2);                              // mast
  B(0.4, 0.2, 0.4, beaconB, 0, 2.86, 0.75, false);                      // roof beacon
  B(0.38, 0.16, 0.38, beaconR, 0, 0.62, -1.5, false);                   // belly beacon
  B(0.4, 0.24, 0.18, ASSET.headMat, 0, 1.06, 3.4, false);               // landing light

  // ---- main rotor: four blades around the hub, origin on the mast ----
  main.add(cyl(0.42, 0.42, 0.3, 10, dark, 0, 0.1, 0, false));           // rotor head
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = 4.4, w = 0.58, t = 0.13;
    if (dx) {
      main.add(box(len, t, w, dark, dx * (len / 2 + 0.35), 0, 0, false));
      main.add(box(0.7, t + 0.02, w * 0.92, red, dx * (len + 0.1), 0, 0, false));      // painted tip
    } else {
      main.add(box(w, t, len, dark, 0, 0, dz * (len / 2 + 0.35), false));
      main.add(box(w * 0.92, t + 0.02, 0.7, red, 0, 0, dz * (len + 0.1), false));
    }
  }
  // ---- tail rotor: two broad blades turning about x ----
  tail.add(cyl(0.14, 0.14, 0.44, 8, steel, 0, 0, 0, false));
  tail.add(box(0.11, 1.65, 0.3, dark, 0, 0, 0, false));
  tail.add(box(0.11, 0.3, 1.65, dark, 0, 0, 0, false));
  tail.add(box(0.12, 0.34, 0.26, red, 0, 0.72, 0, false));
  tail.add(box(0.12, 0.34, 0.26, red, 0, -0.72, 0, false));
  return { body, main, tail, beacons: [beaconB, beaconR], mast: [0, 3.2, -0.2], tailPos: [0.36, 2.55, -5.9] };
}
// A hospital campus in the flat-illustration style of the reference art: white slab wings with blue window
// bands, a glazed tower carrying the red-cross emblem, a glass entrance under a HOSPITAL sign board, an
// emergency bay under an EMERGENCY sign and a rooftop helipad. Returns the unpositioned group plus the
// collision volumes and the painted parking bays (world coordinates).
export function buildHospitalMesh(bx, bz, rng) {
  const g = new THREE.Group(), solids = [], bays = [], paint = [];
  const M = {
    white: mat(0xedf0f1), trim: mat(0xd3d8da), facade: mat(0xe3ecef), glass: mat(0x3d86c2), glassDark: mat(0x2b638f),
    frame: mat(0xf7f9fa), red: mat(0xd6342c), steel: mat(0xb3bac0), paint: mat(0xe9e8df), ambBay: mat(0xc0453c),
    doorGlass: mat(0x27455c), walk: mat(0xc9ccce),
    padDark: mat(0x5b6167), padDarkBright: mat(0xd9dde0),
  };
  const B = (w, h, d, m, x, y, z, cast) => g.add(box(w, h, d, m, x, y, z, cast));
  const Y = 0.25;                                        // lot surface height
  const solid = (x, z, hx, hz) => solids.push({ x: bx + x, z: bz + z, hx, hz });

  // ---- slab wing: the bed block, three floors of windows facing the car park ----
  const A = { x: -7, z: -19, w: 24, d: 14, h: 11.4 };
  B(A.w, A.h, A.d, M.white, A.x, Y + A.h / 2, A.z);
  for (let f = 0; f < 3; f++) {
    const y = Y + 3.1 + f * 3.1;
    B(A.w + 0.3, 1.62, 0.16, M.glass, A.x, y, A.z + A.d / 2 + 0.09);              // front glazing band
    B(A.w + 0.34, 0.2, 0.24, M.frame, A.x, y + 0.9, A.z + A.d / 2 + 0.12);
    B(A.w + 0.34, 0.2, 0.24, M.frame, A.x, y - 0.9, A.z + A.d / 2 + 0.12);
    B(0.16, 1.62, A.d + 0.3, M.glass, A.x - A.w / 2 - 0.09, y, A.z);             // west elevation
    for (let c = 0; c < 6; c++) {                                                // mullions split the band
      B(0.22, 1.62, 0.22, M.frame, A.x - A.w / 2 + 2 + c * 4, y, A.z + A.d / 2 + 0.14, false);
    }
  }
  B(A.w + 0.7, 0.5, A.d + 0.7, M.trim, A.x, Y + A.h + 0.25, A.z, false);         // roof parapet
  solid(A.x, A.z, A.w / 2, A.d / 2);

  // ---- glazed tower with the red-cross emblem on the roof ----
  const T = { x: 12, z: -20.5, w: 13, d: 13, h: 21 };
  B(T.w, T.h, T.d, M.facade, T.x, Y + T.h / 2, T.z);
  for (let f = 0; f < 6; f++) {
    const y = Y + 2.2 + f * 3.1;
    B(T.w + 0.24, 1.9, 0.16, M.glass, T.x, y, T.z + T.d / 2 + 0.08);
    B(0.16, 1.9, T.d + 0.24, M.glass, T.x + T.w / 2 + 0.08, y, T.z);
    B(0.16, 1.9, T.d + 0.24, M.glass, T.x - T.w / 2 - 0.08, y, T.z);
    for (let c = 0; c < 4; c++) {
      B(0.2, 1.9, 0.2, M.frame, T.x - T.w / 2 + 1.6 + c * 3.2, y, T.z + T.d / 2 + 0.13, false);
      B(0.2, 1.9, 0.2, M.frame, T.x + T.w / 2 + 0.13, y, T.z - T.d / 2 + 1.6 + c * 3.2, false);
    }
  }
  B(T.w + 0.8, 0.6, T.d + 0.8, M.trim, T.x, Y + T.h + 0.3, T.z, false);
  solid(T.x, T.z, T.w / 2, T.d / 2);
  const ct = Y + T.h + 0.6;
  // Blue cross emblem standing on the tower roof, facing the car park like the reference art.
  const emblem = cyl(2.7, 2.7, 0.3, 18, mat(0x3a7fd0), T.x, ct + 2.7, T.z + T.d / 2 - 0.4, false);
  emblem.rotation.x = PI / 2; g.add(emblem);
  B(2.1, 0.34, 0.34, M.white, T.x, ct + 2.7, T.z + T.d / 2 - 0.18, false);        // white cross on its face
  B(0.34, 2.1, 0.34, M.white, T.x, ct + 2.7, T.z + T.d / 2 - 0.18, false);
  B(1.0, 1.0, 0.6, M.steel, T.x, ct + 0.5, T.z + T.d / 2 - 0.4, false);           // its foot on the parapet

  // ---- west wing: emergency department with the helipad on its roof ----
  const W = { x: -20, z: -16.5, w: 11, d: 12, h: 6.6 };
  B(W.w, W.h, W.d, M.white, W.x, Y + W.h / 2, W.z);
  B(W.w + 0.3, 1.5, 0.16, M.glass, W.x, Y + 4.1, W.z + W.d / 2 + 0.09);
  B(W.w + 0.6, 0.44, W.d + 0.6, M.trim, W.x, Y + W.h + 0.22, W.z, false);
  solid(W.x, W.z, W.w / 2, W.d / 2);
  // ---- helipad ----
  // The deck sits on the roof of the tall slab wing, not the low emergency wing: the wing roof is 24x14 m,
  // so a disc wide enough for the whole 9 m rotor fits inside the parapet, and the nearest taller structure
  // (the glazed tower) is more than a rotor-radius away, so the blades never sweep into a wall.
  const hpY = Y + A.h + 0.5;
  const pad = { x: A.x, z: A.z, r: 6.2 };
  g.add(cyl(pad.r, pad.r, 0.34, 28, M.steel, pad.x, hpY + 0.17, pad.z, false));   // platform drum
  g.add(cyl(pad.r - 0.35, pad.r - 0.35, 0.36, 28, M.padDark, pad.x, hpY + 0.18, pad.z, false));
  g.add(cyl(pad.r + 0.05, pad.r + 0.05, 0.06, 28, M.white, pad.x, hpY + 0.36, pad.z, false));   // white rim lip
  g.add(cyl(5.2, 5.2, 0.03, 28, M.white, pad.x, hpY + 0.375, pad.z, false));      // painted touch-down ring
  g.add(cyl(4.8, 4.8, 0.03, 28, M.padDark, pad.x, hpY + 0.39, pad.z, false));
  const hMark = textBlocks('H', M.white, 4.2, 0.14, 0.6);                        // the big H
  hMark.rotation.x = -PI / 2; hMark.position.set(pad.x, hpY + 0.41, pad.z); g.add(hMark);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {                  // perimeter lights
    g.add(box(0.34, 0.16, 0.34, (sx * sz > 0) ? M.padDarkBright : mat(0xf0b429), pad.x + sx * (pad.r - 0.35), hpY + 0.45, pad.z + sz * (pad.r - 0.35), false));
  }
  g.add(cyl(0.07, 0.07, 2.6, 6, M.steel, pad.x - 7.6, hpY + 1.7, pad.z - 5.4, false));   // windsock pole
  for (let i = 0; i < 4; i++) {
    const w = 0.46 - i * 0.08;
    g.add(box(w, w, 0.44, i % 2 ? M.white : mat(0xef7d1a), pad.x - 7.15 + i * 0.46, hpY + 2.85 - i * 0.03, pad.z - 5.4, false));
  }
  // ---- air ambulance parked on the pad, nose towards the car park ----
  const heli = buildAirAmbulance();
  const HY = hpY + 0.37, HX = pad.x, HZ = pad.z + 0.95;  // tail points at -z, so a +z offset keeps the whole tail on the roof
  heli.body.position.set(HX, HY, HZ);
  g.add(heli.body);

  // ---- main entrance: glass lobby, canopy and the HOSPITAL board ----
  const E = { x: -1, z: -11.6, w: 11, d: 3.4, h: 4.6 };
  B(E.w, E.h, E.d, M.facade, E.x, Y + E.h / 2, E.z);
  B(E.w + 0.2, 2.5, 0.14, M.doorGlass, E.x, Y + 1.35, E.z + E.d / 2 + 0.08);      // glass doors
  B(1.8, 1.0, 0.2, M.walk, E.x, Y + 1.4, E.z + E.d / 2 + 0.16, false);
  B(E.w + 3.4, 0.42, 4.6, M.trim, E.x, Y + E.h + 0.21, E.z + 0.9, false);         // canopy slab
  for (const sx of [-1, 1]) B(0.36, E.h, 0.36, M.steel, E.x + sx * (E.w / 2 + 1.2), Y + E.h / 2, E.z + 2.9, false);
  solid(E.x, E.z, E.w / 2, E.d / 2);
  B(14.2, 2.6, 0.5, M.white, E.x, Y + E.h + 1.9, E.z + 0.7, false);               // sign board
  const sign = textBlocks('HOSPITAL', M.red, 1.65, 0.18, 0.6);
  sign.position.set(E.x, Y + E.h + 1.9, E.z + 0.98); g.add(sign);

  // ---- emergency bay: red EMERGENCY sign and the ambulance apron ----
  B(7.6, 1.15, 0.34, M.red, W.x, Y + 5.0, W.z + W.d / 2 + 0.02, false);           // red sign board
  const emerg = textBlocks('EMERGENCY', M.white, 0.62, 0.14, 0.24);
  emerg.position.set(W.x, Y + 5.0, W.z + W.d / 2 + 0.22); g.add(emerg);
  B(W.w + 2, 0.1, 6.4, M.walk, W.x, Y + 0.06, W.z + W.d / 2 + 3.4, false);        // ambulance apron

  // ---- car park: three painted rows, the last stall of the far row reserved for an ambulance ----
  const stallW = 4.5, perRow = 12, startX = -(perRow * stallW) / 2;
  const rows = [0, 9, 18];
  rows.forEach((rz, ri) => {
    for (let i = 0; i <= perRow; i++) paint.push({ w: 0.16, d: 5.0, m: M.paint, x: bx + startX + i * stallW, z: bz + rz });
    for (let i = 0; i < perRow; i++) {
      const x = startX + (i + 0.5) * stallW, z = rz;
      const ambulance = ri === rows.length - 1 && i >= perRow - 2;                 // two reserved stalls
      if (ambulance) {
        paint.push({ w: stallW, d: 5.0, m: M.ambBay, x: bx + x, z: bz + z });
        bays.push({ x: bx + x, z: bz + z, rotY: 0, hx: 1.25, hz: 2.9, ambulance: true });
      } else {
        bays.push({ x: bx + x, z: bz + z, rotY: rng() < 0.5 ? 0 : PI, hx: 1.25, hz: 2.9, ambulance: false });
      }
    }
  });
  // ambulance standing at the emergency entrance, parked crosswise to the apron
  bays.push({ x: bx + W.x + 4.6, z: bz + W.z + W.d / 2 + 3.4, rotY: PI / 2, hx: 2.9, hz: 1.25, ambulance: true, apron: true });
  paint.push({ w: 6.2, d: 5.6, m: M.ambBay, x: bx + W.x + 4.6, z: bz + W.z + W.d / 2 + 3.4 });
  // low planted islands framing the entrance walk
  for (const sx of [-1, 1]) B(3.2, 0.5, 3.2, mat(0x7ba96a), E.x + sx * 9, Y + 0.25, E.z + 1.6, false);

  return {
    group: g, solids, bays, paint,
    // campus volumes with their roof heights (block-local), used by the blade-clearance checks
    volumes: [
      { x: A.x, z: A.z, hx: A.w / 2, hz: A.d / 2, top: Y + A.h, name: 'bed wing' },
      { x: T.x, z: T.z, hx: T.w / 2, hz: T.d / 2, top: Y + T.h, name: 'tower' },
      { x: W.x, z: W.z, hx: W.w / 2, hz: W.d / 2, top: Y + W.h, name: 'emergency wing' },
      { x: E.x, z: E.z, hx: E.w / 2, hz: E.d / 2, top: Y + E.h, name: 'entrance' },
    ],
    // kept out of the merged building so the parking/ambience system can spin them around their own axes
    heliBody: heli.body, heliMain: heli.main, heliTail: heli.tail, heliBeacons: heli.beacons,
    padR: pad.r, padY: hpY, padX: pad.x, padZ: pad.z, rotorR: 4.85,   // pad centre and the aircraft position differ
    heliMast: [HX + heli.mast[0], HY + heli.mast[1], HZ + heli.mast[2]],
    heliTailPos: [HX + heli.tailPos[0], HY + heli.tailPos[1], HZ + heli.tailPos[2]],
    heliPos: [HX, HY, HZ],
  };
}
// ---- Fire station ----
// Red appliance hall with white bands, three to five open garage bays, a hose tower and a big FIRE STATION
// fascia sign (box-pixel lettering, same font the hospital signs use). The appliance apron in front of the
// bay doors is where the fleet lives: three to five appliances, always including at least one large engine
// and one small squad, on station from the first frame.
export function buildFireStationMesh(bx, bz, rng) {
  const g = new THREE.Group(), solids = [], doors = [], bays = [];
  const M = {
    red: mat(0xc8342e), darkRed: mat(0xa52620), white: mat(0xf1f2f0), band: mat(0xd9dcdd), steel: mat(0xb3bac0),
    door: mat(0x2f343b), doorGlow: mat(0x3d444c), bay: mat(0x3a3f45), apron: mat(0x6d727a), roof: mat(0xa52620), glass: mat(0x2c4356),
  };
  const B = (w, h, d, m, x, y, z, cast = true) => g.add(box(w, h, d, m, x, y, z, cast));
  const Y = 0.25;
  const solid = (x, z, hx, hz) => solids.push({ x: bx + x, z: bz + z, hx, hz });

  // ---- the fleet: three to five appliances, always with a large engine and a small squad ----
  const nBays = 3 + Math.floor(rng() * 3);                     // 3, 4 or 5 bays, decided per station
  const doorW = 5.6, doorH = 4.2, midDoor = nBays >> 1;
  const spacing = nBays <= 3 ? 10.5 : (nBays === 4 ? 8.5 : 7);  // tighter door line the more bays are in service
  const doorX = [];
  for (let i = 0; i < nBays; i++) doorX.push((i - (nBays - 1) / 2) * spacing);
  const span = (nBays - 1) * spacing;                           // how much wall the doors need
  const fleet = [];
  for (let i = 0; i < nBays; i++) {
    if (i === midDoor) fleet.push('firesmall');                 // the squad sits in the middle bay
    else fleet.push(i > 0 && rng() < 0.3 ? 'firesmall' : 'firetruck');   // the rest are engines, and bay 0 always is
  }

  // ---- appliance hall: the trucks are parked in front of its bay doors ----
  const H = { x: 0, z: -11, w: Math.max(32, span + 6), d: 16, h: 8.2 };
  B(H.w, H.h, H.d, M.red, H.x, Y + H.h / 2, H.z);
  B(H.w + 0.4, 1.1, H.d + 0.4, M.white, H.x, Y + 1.35, H.z, false);            // white belly band
  B(H.w + 0.4, 0.7, H.d + 0.4, M.band, H.x, Y + 3.5, H.z, false);              // upper band
  B(H.w + 0.9, 0.6, H.d + 0.9, M.roof, H.x, Y + H.h + 0.3, H.z, false);        // roof cap
  B(H.w + 0.5, 0.35, 0.5, M.white, H.x, Y + H.h + 0.7, H.z + H.d / 2 - 0.1, false);
  solid(H.x, H.z, H.w / 2, H.d / 2);
  const frontZ = H.z + H.d / 2;                                                // the face with the bay doors

  // ---- fascia sign: FIRE STATION on the white board above the doors ----
  B(H.w - 2, 2.3, 0.5, M.white, H.x, Y + 6.6, frontZ + 0.2, false);
  const sign = textBlocks('FIRE STATION', M.red, 1.35, 0.18, 0.5);
  sign.position.set(H.x, Y + 6.6, frontZ + 0.48); g.add(sign);

  // ---- open bay doors with a dark interior and a rolled-up shutter ----
  doorX.forEach((dx, i) => {
    const open = i !== midDoor || rng() < 0.5;                                 // one bay may be shut
    doors.push({ x: dx, z: frontZ, w: doorW, open });
    B(doorW, doorH, 0.18, M.band, dx, Y + doorH / 2, frontZ + 0.06, false);    // frame
    B(doorW - 0.5, doorH - 0.4, 1.4, M.bay, dx, Y + (doorH - 0.4) / 2, frontZ - 0.7, false);   // bay interior
    B(doorW - 0.5, 0.42, 0.2, open ? M.darkRed : M.red, dx, Y + doorH - 0.42, frontZ + 0.14, false);   // rolled shutter
    if (!open) B(doorW - 0.5, doorH - 0.9, 0.1, M.darkRed, dx, Y + (doorH - 0.9) / 2, frontZ + 0.14, false);
    B(doorW - 0.7, 0.1, 1.3, M.doorGlow, dx, Y + 0.06, frontZ - 0.7, false);
  });

  // ---- hose tower at the side, with the station bell on top ----
  const T = { x: -20.5, z: -13, w: 6, d: 6, h: 15.5 };
  B(T.w, T.h, T.d, M.red, T.x, Y + T.h / 2, T.z);
  for (let f = 1; f <= 3; f++) B(T.w + 0.3, 0.5, T.d + 0.3, M.white, T.x, Y + f * 3.6, T.z, false);
  B(T.w + 0.3, 0.62, 0.16, M.glass, T.x, Y + 12.6, T.z + T.d / 2 + 0.12, false);
  B(T.w + 0.9, 0.6, T.d + 0.9, M.roof, T.x, Y + T.h + 0.3, T.z, false);
  B(1.5, 0.5, 1.5, M.white, T.x, Y + T.h + 0.85, T.z, false);
  B(0.9, 0.5, 0.9, M.red, T.x, Y + T.h + 1.35, T.z, false);
  B(0.34, 0.5, 0.34, mat(0xf4c020), T.x, Y + T.h + 1.85, T.z, false);
  solid(T.x, T.z, T.w / 2, T.d / 2);

  // ---- rear training annex with a small gear store ----
  const N = { x: 15, z: -22, w: 12, d: 8, h: 4.4 };
  B(N.w, N.h, N.d, M.band, N.x, Y + N.h / 2, N.z);
  B(N.w + 0.4, 0.4, N.d + 0.4, M.roof, N.x, Y + N.h + 0.2, N.z, false);
  for (let i = 0; i < 3; i++) B(1.5, 1.2, 0.14, M.glass, N.x - 4 + i * 4, Y + 2.6, N.z + N.d / 2 + 0.1, false);
  solid(N.x, N.z, N.w / 2, N.d / 2);

  // ---- appliance apron: the concrete pad the trucks stand on, plus a hydrant and cones ----
  const apronW = Math.max(38, span + doorW + 6);
  B(apronW, 0.12, 16, M.apron, 0, Y + 0.06, frontZ + 6.4, false);
  for (let i = 0; i <= 3; i++) B(0.16, 0.05, 15.4, M.white, -apronW / 2 + 5 + i * (apronW - 10) / 3, Y + 0.14, frontZ + 6.4, false);
  g.add(cyl(0.34, 0.38, 1.1, 8, mat(0xd93a2b), -16.5, Y + 0.55, frontZ + 9.5, false));   // hydrant
  g.add(cyl(0.42, 0.42, 0.16, 8, mat(0xd93a2b), -16.5, Y + 1.14, frontZ + 9.5, false));
  for (let i = 0; i < 3; i++) g.add(cyl(0.1, 0.34, 0.9, 8, mat(0xf47a1a), 17.5, Y + 0.45, frontZ + 2 + i * 2.2, false));

  // ---- the vehicle bays: the whole fleet, each appliance in front of its own door ----
  const truck = (x, kind, hx, hz) => bays.push({ x: bx + x, z: bz + (kind === 'firesmall' ? 1.5 : 2.6), rotY: 0, hx, hz, kind, color: 0xc8342e, y: Y - 0.05, door: x });
  doorX.forEach((dx, i) => fleet[i] === 'firesmall'
    ? truck(dx, 'firesmall', 1.05, 2.6)
    : truck(dx, 'firetruck', 1.3, 3.7));

  return {
    group: g, solids, doors, bays,
    volumes: [
      { x: H.x, z: H.z, hx: H.w / 2, hz: H.d / 2, top: Y + H.h, name: 'appliance hall' },
      { x: T.x, z: T.z, hx: T.w / 2, hz: T.d / 2, top: Y + T.h, name: 'hose tower' },
      { x: N.x, z: N.z, hx: N.w / 2, hz: N.d / 2, top: Y + N.h, name: 'annex' },
    ],
  };
}
// ---- School ----
// A neighbourhood school on its own block: a two-storey classroom wing with a glazed gym beside it, a grass
// yard behind a chain-link fence, a playground and basketball court in that yard, and a lot out front where the
// yellow school buses stand nose-out along the kerb. The fence is real geometry (posts, rails, a light mesh
// panel and a concrete plinth) and real collision, with a gate at the walkway and a service gate for the yard.
export function buildSchoolMesh(bx, bz, rng) {
  const g = new THREE.Group(), solids = [], bays = [], paint = [], fence = [], playground = [];
  const M = {
    brick: mat(0xd8c9a8), brickDark: mat(0xc2b18d), trim: mat(0xf0ece1), band: mat(0xe6e2d6),
    glass: mat(0x3f7fb5), glassDark: mat(0x2b5f8c), frame: mat(0xf7f9fa), roof: mat(0x9aa0a6),
    door: mat(0x2f4a63), steel: mat(0x9aa2a8), fenceMesh: mat(0x9aa79f, { transparent: true, opacity: 0.22 }),
    plinth: mat(0xb9b6ad), walk: mat(0xc9ccce), court: mat(0x4b5058), line: mat(0xe9e8df),
    yellow: mat(0xf7b500), red: mat(0xd6503f), blue: mat(0x3f7fd0), green: mat(0x4ca85c),
    sand: mat(0xe0cf9a), mulch: mat(0xb08a5c), playBlue: mat(0x4a8fd0), playRed: mat(0xd05a4a), playYellow: mat(0xe8c33a),
    busBay: mat(0xf7b500), pole: mat(0x6d747c),
  };
  const B = (w, h, d, m, x, y, z, cast = true) => g.add(box(w, h, d, m, x, y, z, cast));
  const R = (bw, bh, bd, m, x, y, z, rx, rz) => { const o = box(bw, bh, bd, m, x, y, z, false); if (rx) o.rotation.x = rx; if (rz) o.rotation.z = rz; g.add(o); return o; };
  const C = (rt, rb, h, seg, m, x, y, z) => { const o = cyl(rt, rb, h, seg, m, x, y, z, false); g.add(o); return o; };   // returns the cylinder: g.add() returns the group
  const Y = 0.25;                                          // yard and lot surface height
  const solid = (x, z, hx, hz) => solids.push({ x: bx + x, z: bz + z, hx, hz, kind: 'building' });
  const mark = (x, z, name) => playground.push({ name, x: bx + x, z: bz + z });

  // ================= the school building: classroom wing, gym and entrance =================
  const A = { x: -10, z: -24, w: 34, d: 8, h: 8.4 };                       // two-storey classroom wing
  B(A.w, A.h, A.d, M.brick, A.x, Y + A.h / 2, A.z);
  B(A.w + 0.5, 0.5, A.d + 0.5, M.trim, A.x, Y + A.h + 0.25, A.z, false);   // parapet
  B(A.w + 0.3, 0.9, A.d + 0.3, M.brickDark, A.x, Y + 0.45, A.z, false);    // plinth course
  for (let f = 0; f < 2; f++) {
    const y = Y + 2.3 + f * 3.2;
    B(A.w - 2, 1.5, 0.16, M.glass, A.x, y, A.z + A.d / 2 + 0.09, false);   // band of classroom windows
    B(A.w - 2, 0.16, 0.2, M.frame, A.x, y + 0.83, A.z + A.d / 2 + 0.12, false);
    B(A.w - 2, 0.16, 0.2, M.frame, A.x, y - 0.83, A.z + A.d / 2 + 0.12, false);
    for (let c = 0; c < 9; c++) B(0.22, 1.5, 0.2, M.frame, A.x - (A.w - 2) / 2 + 0.6 + c * (A.w - 3.2) / 8, y, A.z + A.d / 2 + 0.14, false);
  }
  solid(A.x, A.z, A.w / 2, A.d / 2);

  const G = { x: 17, z: -23, w: 20, d: 10, h: 10 };                        // gymnasium / hall
  B(G.w, G.h, G.d, M.brickDark, G.x, Y + G.h / 2, G.z);
  B(G.w + 0.5, 0.6, G.d + 0.5, M.trim, G.x, Y + G.h + 0.3, G.z, false);
  for (let c = 0; c < 5; c++) B(2.4, 2.2, 0.16, M.glassDark, G.x - 7 + c * 3.5, Y + 7.4, G.z + G.d / 2 + 0.09, false);   // clerestory
  B(G.w - 2, 2.6, 0.16, M.glass, G.x, Y + 1.9, G.z + G.d / 2 + 0.09, false);                                              // tall hall windows
  B(G.w, 0.8, 0.24, M.brick, G.x, Y + 5.6, G.z + G.d / 2 + 0.06, false);
  const gymSign = textBlocks('GYMNASIUM', M.trim, 1.0, 0.16, 0.35);
  gymSign.position.set(G.x, Y + 8.9, G.z + G.d / 2 + 0.4); g.add(gymSign);
  solid(G.x, G.z, G.w / 2, G.d / 2);

  // entrance: projecting lobby with a canopy, steps, a clock and the SCHOOL board
  const E = { x: -10, z: -19.2, w: 11, d: 2.6, h: 4.4 };
  B(E.w, E.h, E.d, M.trim, E.x, Y + E.h / 2, E.z);
  B(E.w - 2, 2.3, 0.14, M.door, E.x, Y + 1.25, E.z + E.d / 2 + 0.08, false);
  B(3.0, 2.3, 0.1, M.glass, E.x, Y + 1.25, E.z + E.d / 2 + 0.12, false);
  B(E.w + 4, 0.36, 4.2, M.trim, E.x, Y + E.h + 0.18, E.z + 1.2, false);    // canopy
  for (const sx of [-1, 1]) C(0.16, 0.16, E.h, 8, M.steel, E.x + sx * (E.w / 2 + 1.4), Y + E.h / 2, E.z + 3.1);
  B(E.w + 1.6, 2.4, 0.45, M.brick, E.x, Y + E.h + 1.6, E.z + 0.4, false);  // the board above the doors
  const sign = textBlocks('SCHOOL', M.trim, 1.35, 0.18, 0.5);
  sign.position.set(E.x, Y + E.h + 1.6, E.z + 0.66); g.add(sign);
  C(0.95, 0.95, 0.16, 14, M.trim, E.x + 3.6, Y + E.h + 1.7, E.z + 0.5);    // clock
  C(0.8, 0.8, 0.06, 14, M.brickDark, E.x + 3.6, Y + E.h + 1.7, E.z + 0.6);
  B(0.1, 0.42, 0.06, M.trim, E.x + 3.6, Y + E.h + 1.86, E.z + 0.62, false);
  B(0.32, 0.1, 0.06, M.trim, E.x + 3.72, Y + E.h + 1.7, E.z + 0.62, false);
  for (let i = 0; i < 2; i++) B(E.w + 3, 0.16, 0.5, M.walk, E.x, Y - 0.02 - i * 0.14, E.z + E.d / 2 + 1.1 + i * 0.5, false);   // steps
  mark(E.x, E.z, 'entrance');
  solid(E.x, E.z, E.w / 2, E.d / 2);

  // ================= yard, fence and gates =================
  const YARD_Z = 0, GATE = { a: -3, b: 3 }, SERVICE = { a: 19, b: 23 };
  // Chain-link run: posts every 3 m, two rails, a light mesh panel and a concrete plinth. The plinth is poured
  // into the block like any other concrete; the fence itself is built as separate pieces (up to 7 m each) and
  // handed to the collision system as stand-alone kits, so a real hit tears a panel off its base and the yard
  // opens up — see breakFence() in js/collisions.js.
  const fenceRuns = [];
  const fenceRun = (ax, az, bx2, bz2) => {
    const len = Math.hypot(bx2 - ax, bz2 - az), alongX = Math.abs(bx2 - ax) > Math.abs(bz2 - az);
    const cx = (ax + bx2) / 2, cz = (az + bz2) / 2;
    if (alongX) B(len, 0.22, 0.16, M.plinth, cx, Y + 0.11, cz, false);
    else B(0.16, 0.22, len, M.plinth, cx, Y + 0.11, cz, false);
    const dir = alongX ? (Math.sign(bx2 - ax) || 1) : (Math.sign(bz2 - az) || 1);   // which way the run is laid
    const segs = Math.max(1, Math.round(len / 7)), segLen = len / segs, pieces = [];
    for (let i = 0; i < segs; i++) {
      const mid = (-len / 2 + (i + 0.5) * segLen) * dir;              // the piece's centre, along the run
      const grp = new THREE.Group();
      const F = (w, h, d, m, x, y, z) => grp.add(box(w, h, d, m, x, y, z, false));
      if (alongX) {
        F(segLen, 1.8, 0.04, M.fenceMesh, 0, Y + 1.12, 0);
        F(segLen, 0.08, 0.08, M.steel, 0, Y + 2.02, 0);
        F(segLen, 0.06, 0.06, M.steel, 0, Y + 0.72, 0);
      } else {
        F(0.04, 1.8, segLen, M.fenceMesh, 0, Y + 1.12, 0);
        F(0.08, 0.08, segLen, M.steel, 0, Y + 2.02, 0);
        F(0.06, 0.06, segLen, M.steel, 0, Y + 0.72, 0);
      }
      pieces.push({ group: grp, x: bx + cx + (alongX ? mid : 0), z: bz + cz + (alongX ? 0 : mid),
        hx: alongX ? segLen / 2 : 0.12, hz: alongX ? 0.12 : segLen / 2, alongX, segLen, run: fenceRuns.length, mesh: null });
    }
    // posts every 3 m from the run's start, plus one at the far end so the run closes: each post lands in the
    // piece that stands over it, and travels with that piece when the fence comes down
    const posts = [];
    for (let d = 0; d < len - 1e-6; d += 3) posts.push(d);
    posts.push(len);
    for (const d of posts) {
      const i = Math.min(segs - 1, Math.floor(d / segLen + 1e-9));
      const off = (d - (i + 0.5) * segLen) * dir;                     // distance from that piece's own centre
      pieces[i].group.add(alongX ? box(0.1, 2.05, 0.1, M.steel, off, Y + 1.02, 0, false)
                                 : box(0.1, 2.05, 0.1, M.steel, 0, Y + 1.02, off, false));
    }
    fenceRuns.push({ pieces });
    fence.push({ x: bx + cx, z: bz + cz, hx: alongX ? len / 2 : 0.14, hz: alongX ? 0.14 : len / 2 });
  };
  fenceRun(-28, YARD_Z, GATE.a, YARD_Z);                    // front, west of the main gate
  fenceRun(GATE.b, YARD_Z, SERVICE.a, YARD_Z);              // front, between the gates
  fenceRun(SERVICE.b, YARD_Z, 28, YARD_Z);                  // front, east of the service gate
  fenceRun(-28, YARD_Z, -28, -20);                          // west side, up to the classroom wing
  fenceRun(-28, -20, -27, -20);                             // return to the wing's corner
  fenceRun(28, YARD_Z, 28, -18);                            // east side, up to the gym
  fenceRun(28, -18, 27, -18);                               // return to the gym's corner
  // gate posts and the little roofs over the gates
  for (const gx of [GATE.a, GATE.b, SERVICE.a, SERVICE.b]) { B(0.24, 2.4, 0.24, M.brick, gx, Y + 1.2, YARD_Z, false); C(0.3, 0.3, 0.14, 8, M.trim, gx, Y + 2.5, YARD_Z); }

  // ================= playground (inside the fence, east half of the yard) =================
  const play = { x: 12, z: -9 };
  paint.push({ w: 26, d: 17, m: M.mulch, x: bx + play.x, z: bz + play.z });         // soft safety surface
  for (let i = 0; i < 8; i++) {                                                      // coloured tiles around the gear
    const px = play.x - 10 + (i % 4) * 6.4, pz = play.z - 6 + Math.floor(i / 4) * 9;
    paint.push({ w: 3.2, d: 3.2, m: [M.playBlue, M.playRed, M.playYellow, M.green][i % 4], x: bx + px, z: bz + pz });
  }
  // swing set: two braced A-frames with a top bar and two hanging seats
  const SW = { x: play.x - 6, z: play.z - 3 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.12, 2.8, 0.12, M.pole, SW.x + sx * 3.1, Y + 1.4, SW.z + sz * 0.5, false);
  for (const sx of [-1, 1]) B(0.1, 0.1, 1.15, M.pole, SW.x + sx * 3.1, Y + 2.72, SW.z, false);
  C(0.08, 0.08, 6.4, 8, M.pole, SW.x, Y + 2.76, SW.z).rotation.z = PI / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) C(0.02, 0.02, 1.9, 5, M.steel, SW.x + sx * 0.8 + sz * 0.24, Y + 1.75, SW.z);
    B(0.62, 0.06, 0.26, M.playRed, SW.x + sx * 0.8, Y + 0.78, SW.z, false);
  }
  mark(SW.x, SW.z, 'swing set');
  // slide: ladder, platform, blue chute
  const SL = { x: play.x + 3, z: play.z - 4 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.12, 2.3, 0.12, M.playBlue, SL.x + sx * 0.7, Y + 1.15, SL.z + sz * 0.7, false);
  B(1.7, 0.12, 1.7, M.playYellow, SL.x, Y + 2.3, SL.z, false);
  for (const sx of [-1, 1]) B(0.08, 1.0, 0.08, M.pole, SL.x + sx * 0.7, Y + 2.8, SL.z - 0.7, false);
  B(1.5, 0.08, 0.08, M.pole, SL.x, Y + 3.25, SL.z - 0.7, false);
  for (let i = 0; i < 5; i++) B(1.3, 0.07, 0.09, M.pole, SL.x, Y + 0.4 + i * 0.42, SL.z - 1.05, false);      // ladder rungs
  for (const sx of [-1, 1]) B(0.09, 0.09, 2.9, M.playBlue, SL.x + sx * 0.55, Y + 1.5, SL.z - 1.2, false);
  R(1.0, 0.1, 3.2, M.playRed, SL.x, Y + 1.15, SL.z + 0.75, -0.52, 0);                                       // the chute
  for (const sx of [-1, 1]) R(0.09, 0.34, 3.2, M.playRed, SL.x + sx * 0.5, Y + 1.36, SL.z + 0.75, -0.52, 0);
  mark(SL.x, SL.z, 'slide');
  // climbing frame with a roof, a scramble net and a fireman's pole
  const CF = { x: play.x + 9, z: play.z - 1 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.14, 2.5, 0.14, M.green, CF.x + sx * 1.4, Y + 1.25, CF.z + sz * 1.4, false);
  B(3.1, 0.14, 3.1, M.playYellow, CF.x, Y + 2.5, CF.z, false);
  R(1.9, 0.14, 1.9, M.green, CF.x, Y + 3.35, CF.z, 0, PI / 4);                                              // roof, turned 45 degrees
  for (let i = 0; i < 4; i++) B(2.6, 0.08, 0.08, M.playBlue, CF.x, Y + 0.65 + i * 0.5, CF.z + 1.4, false);   // rungs up one side
  for (const sx of [-1, 1]) B(0.08, 0.08, 2.4, M.playBlue, CF.x + sx * 1.3, Y + 0.4, CF.z, false);
  C(0.09, 0.09, 2.4, 6, M.playRed, CF.x + 1.75, Y + 1.2, CF.z - 1.2);
  mark(CF.x, CF.z, 'climbing frame');
  // see-saw, sandbox and two spring riders
  const SS = { x: play.x - 4, z: play.z + 4 };
  B(0.3, 0.9, 0.5, M.pole, SS.x, Y + 0.45, SS.z, false);
  R(0.34, 0.1, 3.6, M.playBlue, SS.x, Y + 0.95, SS.z, 0, 0.09);
  for (const sz of [-1, 1]) { B(0.34, 0.08, 0.08, M.playRed, SS.x, Y + 1.28, SS.z + sz * 1.55, false); B(0.06, 0.36, 0.06, M.playRed, SS.x, Y + 1.12, SS.z + sz * 1.55, false); }
  mark(SS.x, SS.z, 'see-saw');
  const SB = { x: play.x + 4, z: play.z + 5 };
  for (const sx of [-1, 1]) B(4.4, 0.3, 0.3, M.brickDark, SB.x + sx * 2.05, Y + 0.15, SB.z, false);
  for (const sz of [-1, 1]) B(0.3, 0.3, 4.4, M.brickDark, SB.x, Y + 0.15, SB.z + sz * 2.05, false);
  B(3.8, 0.1, 3.8, M.sand, SB.x, Y + 0.12, SB.z, false);
  mark(SB.x, SB.z, 'sandbox');
  for (const [rx2, rz2, col] of [[play.x - 8, play.z + 6, M.playRed], [play.x - 6, play.z + 8, M.playYellow]]) {
    C(0.12, 0.12, 0.5, 8, M.steel, rx2, Y + 0.25, rz2);
    B(0.9, 0.34, 0.3, col, rx2, Y + 0.62, rz2, false);
    B(0.34, 0.3, 0.3, col, rx2, Y + 0.88, rz2 - 0.3, false);
    for (const sz of [-1, 1]) B(0.06, 0.28, 0.06, M.pole, rx2 + 0.24, Y + 0.82, rz2 + sz * 0.2, false);
    mark(rx2, rz2, 'spring rider');
  }

  // ================= basketball court (west half of the yard) =================
  const CT = { x: -18, z: -11, w: 15, d: 10 };
  paint.push({ w: CT.w + 0.6, d: CT.d + 0.6, m: M.court, x: bx + CT.x, z: bz + CT.z });
  paint.push({ w: 0.18, d: CT.d, m: M.line, x: bx + CT.x - CT.w / 2, z: bz + CT.z });
  paint.push({ w: 0.18, d: CT.d, m: M.line, x: bx + CT.x + CT.w / 2, z: bz + CT.z });
  paint.push({ w: CT.w, d: 0.18, m: M.line, x: bx + CT.x, z: bz + CT.z - CT.d / 2 });
  paint.push({ w: CT.w, d: 0.18, m: M.line, x: bx + CT.x, z: bz + CT.z + CT.d / 2 });
  paint.push({ w: 0.18, d: CT.d, m: M.line, x: bx + CT.x, z: bz + CT.z });
  C(2.6, 2.6, 0.04, 20, M.line, CT.x, Y + 0.05, CT.z, false);
  for (const [hx2, dir] of [[CT.x - CT.w / 2 - 1.1, 1], [CT.x + CT.w / 2 + 1.1, -1]]) {
    C(0.1, 0.12, 3.6, 8, M.pole, hx2, Y + 1.8, CT.z + 0.5);
    B(1.1, 0.1, 0.1, M.pole, hx2 + dir * 0.6, Y + 3.5, CT.z + 0.5, false);       // arm over the baseline
    B(0.1, 1.15, 1.85, M.trim, hx2 + dir * 1.15, Y + 3.3, CT.z + 0.5, false);    // backboard
    C(0.24, 0.24, 0.05, 10, mat(0xe8703a), hx2 + dir * 1.35, Y + 2.95, CT.z + 0.5);
    mark(hx2, CT.z + 0.5, 'basketball hoop');
  }

  // paths: gate to the entrance, along the yard, and the apron in front of the lobby
  paint.push({ w: 2.6, d: 16.5, m: M.walk, x: bx + 0, z: bz - 8.2 });
  paint.push({ w: 12.5, d: 4.2, m: M.walk, x: bx + E.x, z: bz - 17.6 });
  paint.push({ w: 21, d: 2.2, m: M.walk, x: bx + 10, z: bz - 0.9 });
  // flagpole and a couple of benches inside the yard
  C(0.09, 0.12, 8.5, 8, M.trim, -4.4, Y + 4.25, -3.6);
  C(0.5, 0.5, 0.2, 10, M.plinth, -4.4, Y + 0.1, -3.6);
  B(1.5, 0.9, 0.03, M.red, -3.65, Y + 7.8, -3.6, false);
  B(0.55, 0.35, 0.03, M.trim, -4.12, Y + 7.8, -3.6, false);
  mark(-4.4, -3.6, 'flagpole');

  // ================= the lot out front: staff rows and the bus stand =================
  // three rows of staff bays (filled by the day/night curve like any other lot) ...
  const stallW = 4.6, perRow = 10, startX = -(perRow * stallW) / 2;
  [4.2, 11.6, 19.0].forEach((rz, ri) => {
    for (let i = 0; i <= perRow; i++) paint.push({ w: 0.16, d: 5.0, m: M.line, x: bx + startX + i * stallW, z: bz + rz });
    for (let i = 0; i < perRow; i++) {
      bays.push({ x: bx + startX + (i + 0.5) * stallW, z: bz + rz, rotY: rng() < 0.5 ? 0 : PI, hx: 1.25, hz: 2.6, bus: false });
    }
  });
  // ... and the bus stand: three long yellow bays along the kerb, marked out and signed
  for (const bxp of [-16, -3, 10]) {
    paint.push({ w: 11.6, d: 3.4, m: M.busBay, x: bx + bxp, z: bz + 25.4 });
    bays.push({ x: bx + bxp, z: bz + 25.4, rotY: PI / 2, hx: 5.3, hz: 1.5, bus: true });
  }
  const busMark = textBlocks('BUS', mat(0x2b2b2b), 1.5, 0.1, 0.4);
  busMark.rotation.x = -PI / 2; busMark.position.set(bx - 7, Y + 0.045, bz + 25.4); g.add(busMark);
  B(0.9, 2.4, 0.16, M.yellow, 23.6, Y + 1.2, 25.4, false);                      // BUS STOP blade by the lane
  const busSign = textBlocks('BUS', mat(0x2b2b2b), 0.5, 0.1, 0.3);
  busSign.position.set(23.6, Y + 1.9, 25.5); g.add(busSign);

  return {
    group: g, solids, bays, paint, fence, fenceRuns, playground,
    yard: { x: bx, z: bz + (YARD_Z - 20) / 2, hx: 28, hz: 10 },                 // the fenced yard, block-local centre
    lot: { x: bx, z: bz + 13.7, hx: 28, hz: 13.7 },
  };
}
// ---- Fuel station ----
// Procedural forecourt in the style of a modern filling station: a big flat canopy with a lit underside and
// the brand's colours on the fascia, two pump islands with two dispensers each, a glazed convenience store
// behind it and a tall price pylon on the kerb. Three invented brands keep the three reference looks (white
// canopy with a red band, the yellow-and-red one, and the cool blue night canopy).
//
// The dispensers are built as their own little groups so the block can register each one as a separate
// destructible solid: js/collisions.js knocks a pump over, it tumbles off the island and the spill burns.
export const FUEL_BRANDS = [
  { name: 'OCTANE 66', dark: 0xd42b2b, band: 0xf4f5f3, pump: 0xd8342c, shop: 0xeceeed, glow: 0xfff3d6, trim: 0x2a2f3a },
  { name: 'SUNCO',     dark: 0xd42b2b, band: 0xf2c200, pump: 0xf2c200, shop: 0xf0b705, glow: 0xfff6cc, trim: 0x33302a },
  { name: 'BLUEWAVE',  dark: 0x1f4fd8, band: 0xeef2f8, pump: 0x2a6cff, shop: 0xe9eef6, glow: 0xdce9ff, trim: 0x22303f },
];
// One dispenser, sized like a real one: plinth, a tall white body about 1 m across, a lit top lightbox and a
// brand-coloured cap well over head height (~2.4 m), big lit displays on both faces, and a nozzle and hose on
// each side so a car can fuel from either lane.
function buildPumpMesh(brand) {
  const g = new THREE.Group();
  const body = mat(0xf2f3f1), cap = mat(brand.pump), dark = mat(0x1d2026), steel = mat(0xa9b0b6), hose = mat(0x2a2d33);
  const display = new THREE.MeshBasicMaterial({ color: 0x39e08c });       // lit price display
  const topLit = new THREE.MeshBasicMaterial({ color: brand.glow });     // lit lightbox under the cap
  g.add(box(1.14, 0.26, 1.0, steel, 0, 0.13, 0, false));                 // island plinth
  g.add(box(1.06, 0.1, 0.92, dark, 0, 0.31, 0, false));                  // skirt shadow
  g.add(box(0.94, 1.56, 0.62, body, 0, 1.14, 0));                        // tall body
  g.add(box(0.98, 0.14, 0.66, cap, 0, 1.99, 0, false));                  // brand band
  g.add(box(1.08, 0.28, 0.78, cap, 0, 2.2, 0, false));                   // top cap
  g.add(box(1.16, 0.08, 0.86, cap, 0, 2.38, 0, false));                  // cap lip
  for (const sz of [-1, 1]) {
    g.add(box(0.8, 0.2, 0.03, topLit, 0, 1.99, sz * 0.34, false));       // lit lightbox, both faces
    g.add(box(0.66, 0.5, 0.05, display, 0, 1.7, sz * 0.33, false));      // big lit displays
    g.add(box(0.72, 0.36, 0.04, dark, 0, 1.24, sz * 0.33, false));       // grade / price strips
  }
  g.add(box(0.44, 0.6, 0.06, dark, 0, 0.95, 0.34, false));               // keypad and card reader
  for (const sx of [-1, 1]) {
    g.add(box(0.2, 0.5, 0.2, steel, sx * 0.52, 1.05, 0, false));         // nozzle holster
    g.add(box(0.16, 0.32, 0.16, cap, sx * 0.55, 1.26, 0.08, false));     // nozzle head
    g.add(box(0.07, 0.95, 0.07, hose, sx * 0.56, 0.72, -0.22, false));   // hose run down the side
    g.add(box(0.07, 0.3, 0.07, hose, sx * 0.56, 0.3, -0.3, false));
  }
  return g;
}
export function buildFuelStationMesh(bx, bz, rng) {
  const brand = FUEL_BRANDS[Math.floor(rng() * FUEL_BRANDS.length)];
  const g = new THREE.Group(), solids = [], pumps = [], lamps = [];
  const M = {
    band: mat(brand.band), dark: mat(brand.dark), white: mat(0xf3f4f2), steel: mat(0xb6bcc2),
    concrete: mat(0x9aa0a6), glass: mat(0x1e3140), shop: mat(brand.shop), trim: mat(brand.trim),
    lit: new THREE.MeshBasicMaterial({ color: brand.glow }),                       // canopy underside glow
    inside: new THREE.MeshBasicMaterial({ color: 0xf6e3ac }),                      // lit shop interior
  };
  const Y = 0.25;                                         // forecourt surface (the block lays the pad)
  const B = (w, h, d, m, x, y, z, cast = true) => g.add(box(w, h, d, m, x, Y + y, z, cast));
  const CYL = (rt, rb, h, m, x, y, z, cast = false) => g.add(cyl(rt, rb, h, 8, m, x, Y + y, z, cast));

  // ---- canopy: flat white roof, brand fascia on all four edges, lit underside ----
  const CAN = { w: 27, d: 18, h: 6.3, z: 8 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * 10.6, cz = CAN.z + sz * 6.4;
    B(0.64, CAN.h - 0.4, 0.64, M.steel, cx, (CAN.h - 0.4) / 2, cz);
    B(0.86, 0.24, 0.86, M.concrete, cx, 0.12, cz, false);
    solids.push({ x: bx + cx, z: bz + cz, hx: 0.45, hz: 0.45, kind: 'column' });
  }
  B(CAN.w, 0.5, CAN.d, M.white, 0, CAN.h + 0.25, CAN.z);
  for (const [w, d, dx, dz] of [[CAN.w + 0.5, 0.7, 0, CAN.d / 2], [CAN.w + 0.5, 0.7, 0, -CAN.d / 2], [0.7, CAN.d + 0.5, CAN.w / 2, 0], [0.7, CAN.d + 0.5, -CAN.w / 2, 0]])
    B(w, 0.98, d, M.dark, dx, CAN.h + 0.2, CAN.z + dz);                          // fascia band
  B(CAN.w - 1.4, 0.14, CAN.d - 1.4, M.lit, 0, CAN.h - 0.04, CAN.z, false);       // lit ceiling panel
  for (const lx of [-9.5, -3.2, 3.2, 9.5]) for (const lz of [-4.6, 0, 4.6])
    B(2.7, 0.1, 0.55, M.lit, lx, CAN.h - 0.16, CAN.z + lz, false);               // strip lights
  const canopySign = textBlocks(brand.name, M.dark, 0.72, 0.16, 0.42);
  canopySign.position.set(0, Y + CAN.h + 0.31, CAN.z + CAN.d / 2 + 0.42); g.add(canopySign);
  for (const sx of [-1, 1]) {                                                    // the sides carry the name too
    const side = textBlocks(brand.name, M.dark, 0.6, 0.16, 0.36);
    side.position.set(sx * (CAN.w / 2 + 0.42), Y + CAN.h + 0.28, CAN.z); side.rotation.y = sx * PI / 2; g.add(side);
  }

  // ---- two pump islands, two dispensers each, bollards fore and aft ----
  for (const sx of [-1, 1]) {
    const ix = sx * 4.8;
    B(2.5, 0.26, 12.4, M.concrete, ix, 0.13, CAN.z, false);
    B(2.5, 0.06, 12.8, M.white, ix, 0.28, CAN.z, false);
    for (const pz of [CAN.z - 3.4, CAN.z + 3.4]) pumps.push({ x: ix, z: pz, y: Y, rotY: 0, group: buildPumpMesh(brand) });
    for (const sz of [-1, 1]) CYL(0.15, 0.17, 0.95, M.dark, ix, 0.47, CAN.z + sz * 6.9);
  }

  // ---- convenience store: glazed front facing the pumps, brand fascia, roof plant ----
  const S = { w: 22, d: 12, h: 4.7, x: 0, z: -18 };
  const fz = S.z + S.d / 2;
  B(S.w, S.h, S.d, M.shop, S.x, S.h / 2, S.z);
  solids.push({ x: bx + S.x, z: bz + S.z, hx: S.w / 2, hz: S.d / 2, kind: 'building' });
  B(S.w - 1.6, 2.9, 0.14, M.inside, S.x, 1.95, fz - 0.08, false);               // lit interior
  B(S.w - 1.2, 3.0, 0.1, M.glass, S.x, 1.95, fz + 0.04, false);                 // shopfront glass
  for (let i = -3; i <= 3; i++) B(0.14, 3.0, 0.18, M.white, S.x + i * 3.1, 1.95, fz + 0.12, false);
  B(2.4, 3.0, 0.18, M.trim, S.x + 8.6, 1.5, fz + 0.12, false);                  // entrance
  B(2.9, 0.28, 2.2, M.dark, S.x + 8.6, 3.32, fz + 0.5, false);                  // door canopy
  for (const sx of [-1, 1]) B(0.2, 3.2, 0.2, M.white, S.x + 8.6 + sx * 1.45, 1.5, fz + 0.9, false);
  B(S.w + 0.6, 1.2, 0.55, M.band, S.x, 3.7, fz + 0.22);                          // fascia band
  const shopSign = textBlocks(brand.name, M.dark, 0.82, 0.18, 0.5);
  shopSign.position.set(S.x, Y + 3.72, fz + 0.56); g.add(shopSign);
  const openSign = textBlocks('OPEN 24', M.dark, 0.3, 0.1, 0.24);
  openSign.position.set(S.x - 6.4, Y + 2.85, fz + 0.2); g.add(openSign);
  B(S.w + 0.4, 0.36, S.d + 0.4, M.white, S.x, S.h + 0.16, S.z, false);           // parapet
  for (const ax of [-6.5, 0, 6.5]) B(2.6, 1.1, 2.2, M.steel, S.x + ax, S.h + 0.72, S.z - 1.6);

  // ---- price pylon on the kerb, brand name over three lit grade/price rows ----
  const P = { x: -23, z: 21.5 };
  B(1.0, 8.7, 0.9, M.steel, P.x, 4.35, P.z);
  B(4.9, 3.7, 0.42, M.dark, P.x, 8.35, P.z);
  B(5.1, 0.55, 0.46, M.band, P.x, 10.45, P.z, false);
  const pylonName = textBlocks(brand.name, M.white, 0.46, 0.12, 0.34);
  pylonName.position.set(P.x, Y + 9.95, P.z + 0.28); g.add(pylonName);
  [['REG', '3.79'], ['MID', '4.05'], ['PREM', '4.29']].forEach(([grade, price], i) => {
    const y = Y + 9.05 - i * 0.82;
    const gt = textBlocks(grade, M.white, 0.3, 0.1, 0.26); gt.position.set(P.x - 1.5, y, P.z + 0.28); g.add(gt);
    const pt = textBlocks(price, M.white, 0.46, 0.1, 0.2); pt.position.set(P.x + 0.95, y, P.z + 0.28); g.add(pt);
  });
  solids.push({ x: bx + P.x, z: bz + P.z, hx: 0.72, hz: 0.62, kind: 'pole' });

  // ---- forecourt fittings: lamp masts, drains, bins, an air-and-water box, painted lanes ----
  for (const sx of [-1, 1]) {
    const lx = sx * 13.5, lz = 17.5;
    CYL(0.16, 0.2, 7.4, M.steel, lx, 3.7, lz, true);
    B(1.5, 0.22, 0.7, M.lit, lx, 7.35, lz, false);
    solids.push({ x: bx + lx, z: bz + lz, hx: 0.34, hz: 0.34, kind: 'lamp' });
    B(0.4, 0.02, 12, M.white, sx * 7.8, 0.02, CAN.z, false);                     // lane markings
  }
  for (const [dx, dz] of [[0, 16.6], [-9.5, -3.4], [9.5, -3.4]]) B(2.2, 0.05, 0.9, M.trim, dx, 0.03, dz, false);
  for (const sx of [-1, 1]) { CYL(0.34, 0.36, 0.9, M.trim, sx * 8.6, 0.45, S.z + 7.4); }
  B(1.9, 1.5, 1.1, M.steel, 12.6, 0.75, S.z + 8.2);                              // air / water box
  B(2.0, 0.14, 1.2, M.dark, 12.6, 1.56, S.z + 8.2, false);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) CYL(0.13, 0.15, 0.8, M.dark, sx * 12.2, 0.4, 17.4 + i * 2.1);
  lamps.push({ x: bx - 13.5, z: bz + 17.5 }, { x: bx + 13.5, z: bz + 17.5 });

  return { group: g, solids, pumps, brand, canopy: CAN, store: S, pylon: P, lamps };
}
