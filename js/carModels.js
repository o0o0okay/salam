/* Low-poly car models (civilians, player, 5 police tiers + new variants) */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, box, cyl, ASSET, mixerMat } from './assets.js';


export const CAR_DIMS = {
  player: { e1: 2.05, e2: 0.95, mass: 1.3, hp: 100 },
  police1: { e1: 2.05, e2: 0.95, mass: 1.0, hp: 55 },
  police2: { e1: 2.25, e2: 1.02, mass: 1.55, hp: 90 },
  police3: { e1: 2.55, e2: 1.28, mass: 3.2, hp: 190 },
  police4: { e1: 3.15, e2: 1.45, mass: 5.4, hp: 330 },
  police5: { e1: 3.7,  e2: 1.65, mass: 8.3, hp: 520 },
  policeMoto:     { e1: 1.1,  e2: 0.45, mass: 0.4, hp: 25 },
  policeUnmarked: { e1: 2.05, e2: 0.95, mass: 1.0, hp: 55 },
  policeVan:      { e1: 2.7,  e2: 1.35, mass: 3.8, hp: 170 },
  civ:    { e1: 2.05, e2: 0.95, mass: 1.0, hp: 40 },
  sedan:  { e1: 2.05, e2: 0.95, mass: 1.0, hp: 40 },
  taxi:   { e1: 2.05, e2: 0.95, mass: 1.0, hp: 40 },
  pickup: { e1: 2.35, e2: 1.0,  mass: 1.3, hp: 55 },
  bus:    { e1: 4.6,  e2: 1.25, mass: 3.2, hp: 140 },
  hatchback:  { e1: 1.75, e2: 0.85, mass: 0.75, hp: 30 },
  suv:        { e1: 2.3,  e2: 1.05, mass: 1.5,  hp: 60 },
  van:        { e1: 2.5,  e2: 1.1,  mass: 1.6,  hp: 65 },
  sportscar:  { e1: 1.9,  e2: 0.85, mass: 0.9,  hp: 50 },
  oldclassic: { e1: 2.1,  e2: 0.9,  mass: 1.1,  hp: 35 },
  limo:       { e1: 3.4,  e2: 0.95, mass: 1.8,  hp: 55 },
  cementtruck:{ e1: 4.5,  e2: 1.35, mass: 5.0,  hp: 170 },
  fueltanker: { e1: 5.6,  e2: 1.35, mass: 5.6,  hp: 45 },
  semi:    { e1: 4.1, e2: 1.3, mass: 3.6, hp: 170 },   // tractor unit alone (rigid body)
  semibox: { e1: 6.1, e2: 1.35, mass: 6.0, hp: 170 }, // tractor with a 7.6 m box container (rigid body)
  flatbed: { e1: 6.1, e2: 1.35, mass: 6.0, hp: 170 }, // tractor with a dropside flatbed
  lowboy:  { e1: 6.1, e2: 1.4,  mass: 6.4, hp: 170 }, // tractor with a lowboy trailer
  logtruck:{ e1: 6.1, e2: 1.35, mass: 6.4, hp: 170 }, // tractor with a log trailer
  ambulance:  { e1: 2.75, e2: 1.2,  mass: 3.4,  hp: 180 },
  firetruck:  { e1: 3.7,  e2: 1.3,  mass: 6.2,  hp: 240 },
  firesmall:  { e1: 2.6,  e2: 1.05, mass: 2.6,  hp: 120 },
  schoolbus:  { e1: 4.6,  e2: 1.28, mass: 4.4,  hp: 200 },
  icecream:   { e1: 2.9,  e2: 1.15, mass: 2.6,  hp: 110 },   // the ice cream van: a step van with the cone on its roof
  garbage:    { e1: 4.35, e2: 1.3,  mass: 5.0,  hp: 180 },   // the garbage truck: a rear-loading refuse truck, 8.7 m on three axles
};


export const isPoliceKind = kind => typeof kind === 'string' && kind.startsWith('police');
// A vehicle's height: the top of its model above the road (the light bar, the cone on an ice cream van's roof and all),
// taken from the first model of each kind that is built. A car drives in under a roof (a solid with `headroom`, see
// collideSolids in js/collisions.js) when this fits under it.
const _heightOf = new Map(), _heightBox = new THREE.Box3();
export function carHeight(kind, mesh) {
  let h = _heightOf.get(kind);
  if (h === undefined) { h = _heightBox.setFromObject(mesh).max.y - mesh.position.y; _heightOf.set(kind, h); }
  return h;
}


// ---- SCHOOL BUS and ICE CREAM lettering ----
// The classic 5x7 box-pixel face the street signs use (js/world.js) is not reachable from here without a module
// cycle, so the letters the bus boards and the ice cream van need carry their own patterns. Every vehicle of a kind
// asks for the same strings at the same size, so the merged lettering geometry is cached and shared.
const BUS_LETTERS = {
  S: '01111,10000,10000,01110,00001,00001,11110', C: '01110,10001,10000,10000,10000,10001,01110',
  H: '10001,10001,10001,11111,10001,10001,10001', O: '01110,10001,10001,10001,10001,10001,01110',
  L: '10000,10000,10000,10000,10000,10000,11111', B: '11110,10001,10001,11110,10001,10001,11110',
  U: '10001,10001,10001,10001,10001,10001,01110', ' ': '00000,00000,00000,00000,00000,00000,00000',
  I: '01110,00100,00100,00100,00100,00100,01110', E: '11111,10000,10000,11110,10000,10000,11111',
  R: '11110,10001,10001,11110,10100,10010,10001', A: '01110,10001,10001,11111,10001,10001,10001',
  M: '10001,11011,10101,10101,10001,10001,10001',
};
// the ice cream van's scoops: one unit ball for all of them (indexed, like the unit box), scaled per scoop
const SCOOP_GEO = new THREE.SphereGeometry(1, 10, 7);
const busSignCache = new Map();
const _busBox = new THREE.BoxGeometry(1, 1, 1);
const _busM = new THREE.Matrix4();
function busSignGeometry(str, h, depth, gap) {
  const key = str + '|' + h + '|' + depth + '|' + gap;
  let geo = busSignCache.get(key);
  if (geo !== undefined) return geo;
  // a letter is 5 pixels wide (pw = h / 7 each); the next one starts a letter and a gap further on
  const pw = h / 7, adv = 5 * pw + gap, total = str.length * adv - gap, geos = [];
  for (let i = 0; i < str.length; i++) {
    const rows = (BUS_LETTERS[str[i]] || BUS_LETTERS[' ']).split(',');
    const x0 = -total / 2 + i * adv;
    // one box for each run of lit pixels in a row: the same face (each run overhangs its pixels by 1% at either end,
    // as every pixel did), with a fraction of the boxes
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (rows[r][c] !== '1') continue;
      let n = 1; while (c + n < 5 && rows[r][c + n] === '1') n++;
      const g = _busBox.clone();
      _busM.makeScale(pw * (n + 0.02), pw * 1.02, depth);
      _busM.setPosition(x0 + (c + n / 2) * pw, (6 - r) * pw + pw / 2, 0);
      g.applyMatrix4(_busM);
      geos.push(g);
      c += n - 1;
    }
  }
  geo = geos.length ? mergeGeometries(geos, false) : null;
  geos.forEach(g => g.dispose());
  busSignCache.set(key, geo);
  return geo;
}
// ---- the garbage truck: its liveries and its beacons ----
// A livery is the body's colour (the colour the traffic gives the truck) and the cab and trim that go with it.
export const GARBAGE_LIVERIES = [
  { body: 0x3e8e47, cab: 0xf2f3f1, trim: 0x2f7a3a, band: null },        // green, with a white cab
  { body: 0x666d75, cab: 0xb4bac1, trim: 0xff8a1f, band: null },        // grey, with orange trim
  { body: 0xeef0eb, cab: 0xf2f3f1, trim: 0xf2c230, band: 0xf2c230 },    // white, with a yellow band
];
// Its four amber beacons, two on the cab roof and two on the tailgate, are one geometry shared by every truck. Their
// material is a light the truck owns (js/vehicle.js syncCarMesh flashes it), so they are not merged with the body.
export const GARBAGE_BEACONS = [[-0.72, 3.2, 3.45], [0.72, 3.2, 3.45], [-1.0, 3.7, -2.75], [1.0, 3.7, -2.75]];
let garbageBeaconGeo = null;
function garbageBeacons() {
  if (garbageBeaconGeo) return garbageBeaconGeo;
  const parts = GARBAGE_BEACONS.map(([x, y, z]) => new THREE.CylinderGeometry(0.11, 0.11, 0.17, 8).translate(x, y, z));
  garbageBeaconGeo = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return garbageBeaconGeo;
}
// ---- the log truck's load ----
// Six logs in three layers on the log trailer: the (x, y) of each log's axis in the truck's frame, the z of their
// middle, their radius and length, the bark of the even and the odd ones and the colour of the cut ends. The load is a
// group of its own on the truck (g.userData.cargo), not merged into the body, so a hard hit can take it off the
// trailer: js/logSpill.js hides it and sends six loose logs into the street from the same places.
export const LOG_LOAD = {
  at: [[-0.6, 1.15], [0, 1.15], [0.6, 1.15], [-0.3, 1.67], [0.3, 1.67], [0, 2.19]],
  z: -2.35, r: 0.3, len: 7.2, seg: 8, bark: [0x9c5f30, 0xb8733f], end: 0xd9ab6a,
};
// One log lying along z and centred on the origin, in two pieces: its bark (an open cylinder) and its two cut ends.
// The ends' rims sit on the bark's own edge vertices. Shared by every log truck's load and by every loose log.
let logGeo = null;
export function logParts() {
  if (logGeo) return logGeo;
  const { r, len, seg } = LOG_LOAD;
  const bark = new THREE.CylinderGeometry(r, r, len, seg, 1, true).rotateX(Math.PI / 2);
  const front = new THREE.CircleGeometry(r, seg, -Math.PI / 2).translate(0, 0, len / 2);
  const back = new THREE.CircleGeometry(r, seg, -Math.PI / 2).rotateY(Math.PI).translate(0, 0, -len / 2);
  logGeo = { bark, ends: mergeGeometries([front, back], false) };
  front.dispose(); back.dispose();
  return logGeo;
}
// the whole load, stacked as it lies on the trailer (z about its middle): the bark of the even logs, of the odd ones,
// and all the cut ends; one geometry each, shared by every log truck
let logLoadGeo = null;
function logLoadGeometry() {
  if (logLoadGeo) return logLoadGeo;
  const { bark, ends } = logParts(), at = LOG_LOAD.at;
  const stack = (geo, keep) => {
    const parts = at.filter((_, i) => keep(i)).map(([x, y]) => geo.clone().translate(x, y, 0));
    const out = mergeGeometries(parts, false); parts.forEach(p => p.dispose()); return out;
  };
  logLoadGeo = [stack(bark, i => i % 2 === 0), stack(bark, i => i % 2 === 1), stack(ends, () => true)];
  return logLoadGeo;
}
// ---- merged body geometry ----
// A car is some dozens of boxes and cylinders, and each of them was its own draw call (and, in the shadow pass,
// its own caster). The static pieces that share a material are merged into one geometry per material and shadow
// flags. The merged geometry is cached by its exact content (every piece's geometry, transform and material), so
// cars built the same way share one geometry and nothing is merged twice. Light materials are not merged: each
// car owns its own (update.js changes their colour for the police flash and vehicle.js disposes them), so those
// pieces stay separate meshes.
const mergedBodyCache = new Map();
function consolidateBody(inner, ownMats) {
  const items = inner.children.filter(o => o.isMesh && o.children.length === 0 && Object.keys(o.userData).length === 0 && !ownMats.has(o.material));
  const groups = new Map();
  for (const o of items) {
    o.updateMatrix();
    const k = o.material.uuid + (o.castShadow ? '|c' : '|-') + (o.receiveShadow ? 'r' : '-');
    let list = groups.get(k); if (!list) groups.set(k, list = []);
    list.push(o);
  }
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const sig = k + '#' + list.map(o => o.geometry.uuid + ':' + o.matrix.elements.join(',')).join(';');
    let geo = mergedBodyCache.get(sig);
    if (geo === undefined) {
      const parts = list.map(o => o.geometry.clone().applyMatrix4(o.matrix));
      geo = mergeGeometries(parts, false) || null;           // null when the pieces do not share attributes: keep them apart
      parts.forEach(p => p.dispose());
      mergedBodyCache.set(sig, geo);
    }
    if (!geo) continue;
    for (const o of list) inner.remove(o);
    const m = new THREE.Mesh(geo, list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
    inner.add(m);
  }
}
export function buildCar(kind, color, detail = true) {
  if (!CAR_DIMS[kind]) kind = 'civ';                            // never throw on an unknown vehicle type
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const glass = mat(0x18222f), dark = mat(0x1c1d22);
  const lights = {};
  const wm = mat(0x16171b);
  let wheelZ = [-1.4, 1.4], wheelX = 1.0, frontZ = 2.17, backZ = -2.17, lightY = 0.86, wheelY = 0.46, wheelScale = 1;
  // extra outer wheel (dual-tire look) for heavy-truck drive/trailer axles
  const dualWheel = (sx, sz) => { const w2 = new THREE.Mesh(ASSET.wheelGeo, wm); w2.position.set(sx * (wheelX + 0.42), wheelY, sz); w2.scale.setScalar(wheelScale); w2.castShadow = true; inner.add(w2); };


  if (kind === 'bus') {
    wheelZ = [-3.0, 3.0]; wheelX = 1.15; frontZ = 4.52; backZ = -4.52; lightY = 1.0;
    const bc = mat(color);
    inner.add(box(2.4, 2.5, 9, bc, 0, 1.5, 0));
    inner.add(box(2.46, 0.8, 8.0, glass, 0, 2.05, 0));
    inner.add(box(2.0, 1.0, 0.1, glass, 0, 2.0, 4.52));
    inner.add(box(2.2, 0.16, 8.6, mat(0xdcdcdc), 0, 2.83, 0));
    inner.add(box(0.06, 1.7, 1.0, dark, -1.22, 1.15, 2.6, false));
    inner.add(box(2.42, 0.24, 9.02, mat(0x25282f), 0, 0.5, 0, false));

  } else if (kind === 'schoolbus') {
    // Yellow school bus in the classic conventional layout: bonnet, grille and chrome bumper in front, a long
    // passenger box with a row of tall windows, three black rub rails down each flank, the SCHOOL BUS board over
    // the windscreen with its four warning lamps, a folded stop arm on the driver's side and yellow hubs.
    wheelZ = [-2.9, 2.9]; wheelX = 1.2; frontZ = 4.55; backZ = -4.72; lightY = 1.0; wheelY = 0.53; wheelScale = 1.18;
    const yellow = mat(0xf7b500), deep = mat(0xd99e00), black = mat(0x1b1c1f), chrome = mat(0xc9cdd2), roofPanel = mat(0xe9ebea);
    lights.red = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
    lights.amber = new THREE.MeshBasicMaterial({ color: 0xffa41f });
    inner.add(box(2.42, 0.5, 8.7, black, 0, 0.68, -0.25));                        // chassis rail
    inner.add(box(2.5, 1.92, 7.3, yellow, 0, 1.86, -1.35));                       // passenger box: z -5.0 .. 2.3
    inner.add(box(2.14, 1.02, 2.3, yellow, 0, 1.33, 3.35));                       // bonnet
    inner.add(box(1.86, 0.66, 0.16, black, 0, 1.2, 4.5));                         // grille
    inner.add(box(2.36, 0.32, 0.34, chrome, 0, 0.72, 4.6));                       // front bumper
    inner.add(box(2.3, 0.32, 0.28, chrome, 0, 0.72, -4.98));                      // rear bumper
    inner.add(box(1.96, 0.06, 0.9, yellow, 0, 1.85, 3.4, false));                 // bonnet crown
    for (const sx of [-1, 1]) {                                                   // black front fenders over the wheels
      inner.add(box(0.1, 0.46, 1.7, black, sx * 1.3, 1.12, 2.9, false));
      inner.add(box(0.06, 0.9, 0.5, deep, sx * 1.28, 1.5, 2.35, false));          // the entry-door pillar, yellow like the body
    }
    inner.add(box(1.94, 0.98, 0.12, glass, 0, 2.3, 2.3));                         // windscreen ...
    inner.add(box(0.16, 0.98, 0.16, yellow, 0, 2.3, 2.34, false));                 // ... split by its centre pillar
    for (const sx of [-1, 1]) inner.add(box(0.08, 0.72, 1.15, glass, sx * 1.27, 2.28, 1.5, false));   // cab door glass
    for (const sx of [-1, 1]) {                                                   // the row of tall passenger windows
      inner.add(box(0.08, 0.86, 6.5, glass, sx * 1.27, 2.42, -1.6, false));
      for (let i = 0; i < 6; i++) inner.add(box(0.1, 0.86, 0.16, yellow, sx * 1.28, 2.42, -4.6 + i * 1.2, false));
      for (const ry of [0.98, 1.4, 1.82]) inner.add(box(0.05, 0.1, 7.3, black, sx * 1.27, ry, -1.35, false));   // rub rails
      inner.add(box(0.04, 0.6, 0.6, lights.red, sx * 1.31, 1.62, 0.55, false));   // folded stop arm on the driver's side
      inner.add(box(0.06, 0.5, 0.06, black, sx * 1.31, 1.6, 0.2, false));
      inner.add(box(0.09, 0.42, 0.42, deep, sx * 1.44, 0.53, 2.9, false));        // yellow hub caps
      inner.add(box(0.09, 0.42, 0.42, deep, sx * 1.44, 0.53, -2.9, false));
      inner.add(cyl(0.05, 0.05, 0.9, 6, black, sx * 1.5, 2.75, 3.1, false));       // mirror arm ...
      inner.add(box(0.12, 0.42, 0.3, black, sx * 1.5, 2.4, 3.2, false));          // ... and its head
    }
    inner.add(box(2.54, 0.16, 7.4, roofPanel, 0, 2.86, -1.35, false));            // white roof panel
    inner.add(box(2.4, 0.1, 7.1, yellow, 0, 2.78, -1.35, false));
    inner.add(box(0.72, 0.14, 0.72, yellow, 0, 2.96, -2.4, false));               // roof hatch
    inner.add(box(2.06, 0.8, 0.12, glass, 0, 2.42, -4.98, false));                // rear window
    inner.add(box(0.96, 1.1, 0.14, yellow, 0, 1.1, -5.0, false));                 // emergency door
    inner.add(box(0.8, 0.62, 0.1, glass, 0, 1.35, -5.06, false));
    // the SCHOOL BUS boards, black on yellow, above the windscreen and above the rear window
    const boardY = 2.62;
    for (const [bz, flip] of [[2.36, 0], [-4.66, Math.PI]]) {
      inner.add(box(1.98, 0.52, 0.1, yellow, 0, boardY, bz, false));
      const sign = new THREE.Mesh(busSignGeometry('SCHOOL BUS', 0.2, 0.05, 0.035), black);   // 1.74 m of letters, 0.2 m high
      sign.position.set(0, boardY - 0.1, bz + (flip ? -0.09 : 0.09));
      if (flip) sign.rotation.y = flip;
      inner.add(sign);
    }
    // four warning lamps on each end (two red outboard, two amber inboard)
    for (const [bz, flip] of [[2.32, 1], [-4.68, -1]]) for (const sx of [-1, 1]) {
      inner.add(box(0.24, 0.24, 0.12, lights.red, sx * 1.0, 2.5, bz + flip * 0.06, false));
      inner.add(box(0.24, 0.24, 0.12, lights.amber, sx * 0.66, 2.5, bz + flip * 0.06, false));
    }

  } else if (kind === 'ambulance') {
    // White box ambulance with the red livery band, red crosses and a blue roof beacon — the reference art
    // parked in the hospital car park.
    wheelZ = [-1.8, 1.8]; wheelX = 1.16; frontZ = 2.74; backZ = -2.74; lightY = 0.95;
    const white = mat(0xf4f6f8), red = mat(0xd42b2b), steel = mat(0x9aa1a8);
    lights.blue = new THREE.MeshBasicMaterial({ color: 0x2a6cff });
    lights.red = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    inner.add(box(2.34, 1.05, 5.4, white, 0, 0.98, 0));                  // main body
    inner.add(box(2.3, 1.2, 3.7, white, 0, 2.05, -0.78));                // raised treatment box
    inner.add(box(2.24, 0.95, 1.6, white, 0, 1.6, 1.65));                // cab
    inner.add(box(2.08, 0.52, 0.12, glass, 0, 1.78, 2.45));              // windshield
    for (const sx of [-1, 1]) inner.add(box(0.08, 0.46, 1.05, glass, sx * 1.14, 1.66, 1.55, false));
    for (const sx of [-1, 1]) inner.add(box(0.06, 0.6, 1.5, glass, sx * 1.17, 2.16, -0.7, false));
    inner.add(box(2.4, 0.36, 5.44, red, 0, 1.28, 0));                    // livery band
    inner.add(box(2.4, 0.1, 5.44, red, 0, 0.62, 0));                     // lower stripe
    inner.add(box(1.9, 0.8, 0.1, white, 0, 2.05, -2.62, false));         // rear doors
    inner.add(box(0.9, 0.24, 0.06, red, 0, 2.1, -2.68, false));          // red cross on the rear doors
    inner.add(box(0.24, 0.8, 0.06, red, 0, 2.1, -2.68, false));
    for (const sx of [-1, 1]) {                                          // red crosses on the flanks
      inner.add(box(0.06, 0.26, 0.86, red, sx * 1.2, 2.06, -1.5, false));
      inner.add(box(0.06, 0.86, 0.26, red, sx * 1.2, 2.06, -1.5, false));
    }
    inner.add(box(1.7, 0.2, 0.42, steel, 0, 2.75, 0.5, false));          // roof beacon bar
    inner.add(box(1.3, 0.16, 0.36, lights.blue, 0, 2.75, 0.5, false));
    inner.add(box(0.34, 0.14, 0.3, lights.red, -0.9, 2.72, -0.5, false));
    inner.add(box(0.34, 0.14, 0.3, lights.red, 0.9, 2.72, -0.5, false));

  } else if (kind === 'icecream') {
    // The ice cream van of the reference art: a white step van (flat-fronted cab, short bonnet) with its livery band
    // and roof line in its colour (blue or red); the serving window on the kerb side (local -x, the right: traffic
    // drives on the right) under a striped awning in the other colour, the menu board under it with its row of ice
    // creams, a painted cone beside it and ICE / CREAM by the cab; ICE CREAM along the other flank over painted ice
    // creams and across the rear doors; on the roof the big waffle cone with three scoops (strawberry, mint and
    // chocolate) on two posts, the loudspeaker horn and the cooling unit. It chimes as it goes (js/audio.js updateIce).
    wheelZ = [-1.75, 1.95]; wheelX = 1.0; frontZ = 2.84; backZ = -2.8; lightY = 1.0;
    const white = mat(0xf6f7f9), accent = mat(color), col = new THREE.Color(color);
    const otherHex = col.r > col.b ? 0x3f9fe0 : 0xe8434a, other = mat(otherHex);   // blue on a red van, red on a blue one
    const blue = mat(0x3f9fe0), red = mat(0xe8434a), steel = mat(0xb9bec4), grey = mat(0xd9dde2);
    const waffle = mat(0xe39a48), waffleDk = mat(0xc07a30), coneIcon = mat(0xf0c27a);
    const pink = mat(0xf7a6c8), mint = mat(0x7fe0c8), choc = mat(0x7b4a2b), lemon = mat(0xf6d55c), cream = mat(0xfff6e6);
    const orange = mat(0xff9a1f);
    const flavours = [pink, mint, lemon, choc, cream];
    // body
    inner.add(box(2.0, 0.3, 5.3, dark, 0, 0.55, -0.05, false));                   // chassis
    inner.add(box(2.3, 2.13, 3.9, white, 0, 1.685, -0.8));                        // the serving box: z -2.75 .. 1.15
    inner.add(box(2.26, 2.13, 1.05, white, 0, 1.685, 1.675));                     // the cab: z 1.15 .. 2.2
    inner.add(box(2.1, 0.78, 0.6, white, 0, 1.01, 2.5));                          // the bonnet: z 2.2 .. 2.8
    inner.add(box(2.34, 0.36, 4.98, accent, 0, 0.8, -0.29));                      // the livery band
    inner.add(box(2.34, 0.1, 4.98, accent, 0, 2.72, -0.29, false));               // the roof line
    inner.add(box(2.28, 0.06, 4.9, white, 0, 2.78, -0.3, false));                 // the roof
    inner.add(box(1.2, 0.36, 0.06, dark, 0, 1.02, 2.81, false));                  // grille
    inner.add(box(2.16, 0.2, 0.18, dark, 0, 0.66, 2.82, false));                  // front bumper
    inner.add(box(2.2, 0.2, 0.2, dark, 0, 0.66, -2.8, false));                    // rear bumper
    const ws = box(2.0, 0.78, 0.08, glass, 0, 2.1, 2.21, false); ws.rotation.x = -0.12; inner.add(ws);   // raked windscreen
    for (const sx of [-1, 1]) {
      inner.add(box(0.06, 0.6, 0.72, glass, sx * 1.14, 2.08, 1.72, false));       // cab side windows
      inner.add(box(0.06, 0.08, 0.14, orange, sx * 1.06, 1.22, 2.72, false));     // side marker lamps
      inner.add(cyl(0.025, 0.025, 0.3, 6, dark, sx * 1.22, 2.05, 2.12, false));   // mirror arm ...
      inner.add(box(0.07, 0.3, 0.18, dark, sx * 1.27, 1.95, 2.1, false));         // ... and its head
      for (const wz of wheelZ) inner.add(box(0.06, 0.5, 1.12, dark, sx * 1.175, 0.87, wz, false));   // wheel arches
    }
    // the serving window on the kerb side (-x)
    const WZ = -0.7;                                                              // the window's middle
    inner.add(box(0.04, 0.72, 1.5, glass, -1.165, 1.98, WZ, false));              // the open window
    inner.add(box(0.16, 0.05, 1.56, steel, -1.22, 1.6, WZ, false));               // its counter
    const awning = box(0.36, 0.035, 1.72, other, -1.31, 2.43, WZ); awning.rotation.z = 0.35; inner.add(awning);
    for (let i = 0; i < 8; i++) inner.add(box(0.03, 0.11, 0.2, i % 2 ? white : other, -1.48, 2.3, WZ - 0.75 + i * 0.215, false));   // its valance
    inner.add(box(0.04, 0.46, 1.5, blue, -1.165, 1.3, WZ, false));                // the menu board
    for (let i = 0; i < 8; i++) {                                                 // its ice creams: cones and lollies
      const z = WZ - 0.6 + i * 0.17, f = flavours[i % flavours.length];
      if (i % 2 === 0) { inner.add(box(0.02, 0.12, 0.06, coneIcon, -1.19, 1.24, z, false)); inner.add(box(0.02, 0.07, 0.09, f, -1.19, 1.34, z, false)); }
      else { inner.add(box(0.02, 0.14, 0.07, f, -1.19, 1.34, z, false)); inner.add(box(0.02, 0.06, 0.015, coneIcon, -1.19, 1.24, z, false)); }
    }
    const paintedCone = (sx, z, scoop) => {                                       // a big cone painted on a flank
      const x = sx * 1.17;
      [[0.26, 1.55], [0.17, 1.43], [0.08, 1.32]].forEach(([w, y]) => inner.add(box(0.03, 0.12, w, coneIcon, x, y, z, false)));
      [[0.3, 1.68], [0.2, 1.79], [0.1, 1.88]].forEach(([w, y]) => inner.add(box(0.03, 0.11, w, scoop, x, y, z, false)));
    };
    paintedCone(-1, -2.2, cream);
    const sign = (str, h, gap, m, x, y, z, ry) => { const t = new THREE.Mesh(busSignGeometry(str, h, 0.025, gap), m); t.position.set(x, y, z); t.rotation.y = ry; inner.add(t); };
    sign('ICE', 0.15, 0.03, red, -1.165, 1.95, 0.62, -Math.PI / 2);               // ICE / CREAM by the cab, kerb side
    sign('CREAM', 0.15, 0.03, blue, -1.165, 1.72, 0.62, -Math.PI / 2);
    // the other flank (+x): ICE CREAM along the top over painted ice creams
    sign('ICE CREAM', 0.26, 0.06, other, 1.165, 2.2, -0.8, Math.PI / 2);
    paintedCone(1, -2.0, pink); paintedCone(1, 0.4, mint);
    inner.add(box(0.03, 0.42, 0.18, lemon, 1.17, 1.66, -0.8, false));             // and a lolly between them
    inner.add(box(0.03, 0.16, 0.04, coneIcon, 1.17, 1.37, -0.8, false));
    // the rear doors
    inner.add(box(2.1, 1.85, 0.06, white, 0, 1.7, -2.77, false));
    inner.add(box(0.03, 1.85, 0.07, dark, 0, 1.7, -2.775, false));                // the seam between them
    for (const sx of [-1, 1]) inner.add(box(0.55, 0.38, 0.07, glass, sx * 0.5, 2.2, -2.78, false));
    sign('ICE CREAM', 0.15, 0.03, other, 0, 1.38, -2.81, Math.PI);
    // on the roof: the cooling unit, the loudspeaker horn and the big cone
    inner.add(box(0.75, 0.2, 0.55, grey, 0.4, 2.91, 1.55, false));
    inner.add(box(0.6, 0.1, 0.02, dark, 0.4, 2.91, 1.83, false));
    inner.add(cyl(0.025, 0.025, 0.3, 6, dark, -0.55, 2.96, 1.8, false));
    const horn = cyl(0.15, 0.05, 0.34, 10, white, -0.55, 3.14, 1.9, false); horn.rotation.x = Math.PI / 2; inner.add(horn);
    inner.add(box(0.11, 0.11, 0.1, red, -0.55, 3.14, 1.69, false));
    inner.add(cyl(0.035, 0.035, 0.5, 6, dark, 0, 3.0, -1.5, false));              // the cone's posts
    inner.add(cyl(0.035, 0.035, 0.6, 6, dark, 0, 3.05, -0.6, false));
    // the cone lies along the van, its tip low at the back and its mouth high at the front (tip (0, 2.95, -2.1),
    // mouth (0, 3.55, -0.62): 1.6 m along a line that rises 22 degrees)
    const CT = [0, 2.95, -2.1], CM = [0, 3.55, -0.62], cdy = CM[1] - CT[1], cdz = CM[2] - CT[2], CL = Math.hypot(cdy, cdz), tilt = Math.atan2(cdz, cdy);
    const cone = cyl(0.46, 0, CL, 9, waffle, 0, (CT[1] + CM[1]) / 2, (CT[2] + CM[2]) / 2); cone.rotation.x = tilt; inner.add(cone);
    const rim = cyl(0.5, 0.48, 0.1, 9, waffleDk, 0, CM[1], CM[2]); rim.rotation.x = tilt; inner.add(rim);
    for (const [m, r, x, y, z] of [[choc, 0.36, 0, 3.66, -0.45], [pink, 0.33, -0.22, 3.94, -0.68], [mint, 0.35, 0.2, 4.0, -0.42]]) {
      const sc = new THREE.Mesh(SCOOP_GEO, m); sc.position.set(x, y, z); sc.scale.setScalar(r); inner.add(sc);
    }
    // one shadow setting for every piece but the glass, so each colour merges into one mesh (consolidateBody keys on it)
    for (const o of inner.children) if (o.isMesh) { o.castShadow = o.material !== glass; o.receiveShadow = true; }

  } else if (kind === 'garbage') {
    // The rear-loading refuse truck of the reference pictures: a flat-fronted cab (white, or grey on the grey truck)
    // with a black grille, mirrors and steps and two amber beacons on its roof, and the exhaust stack behind it; the
    // compactor body in the truck's colour, ribbed down its flanks, with a logo panel (a recycling triangle) and a red
    // and white reflective strip along its foot; at the back the tailgate, its face sloping out over the loading mouth,
    // which is open: bags, a bin and boxes inside it, red and white chevrons under it, the hydraulic rams up its sides
    // and two more beacons on top. Three axles: one under the cab and a tandem at the back.
    wheelZ = [3.0, -1.65, -2.75]; wheelX = 1.0; wheelY = 0.53; wheelScale = 1.15; frontZ = 4.26; backZ = -4.26; lightY = 0.9;
    const L = GARBAGE_LIVERIES.find(l => l.body === color) || { body: color, cab: 0xf2f3f1, trim: color, band: null };
    const body = mat(color), rib = mat(new THREE.Color(color).multiplyScalar(0.82).getHex()), cab = mat(L.cab), trim = mat(L.trim);
    const chassis = mat(0x2a2d33), steel = mat(0xaab0b7), chrome = mat(0xc9cdd2), black = mat(0x141518);
    const red = mat(0xd8302c), white = mat(0xf4f4f2), recycle = mat(0x2f9a4a);
    lights.amber = new THREE.MeshBasicMaterial({ color: 0xffa41f });
    inner.add(new THREE.Mesh(garbageBeacons(), lights.amber)); g.userData.beacon = lights.amber;
    // the chassis, the guard rails between the axles, the fuel tank and the battery box, the mudguards over the tandem
    inner.add(box(1.0, 0.3, 8.1, chassis, 0, 0.72, -0.1));
    for (const sx of [-1, 1]) {
      for (const y of [0.62, 0.86]) inner.add(box(0.05, 0.08, 3.45, steel, sx * 1.17, y, 0.675, false));
      inner.add(box(0.36, 0.08, 2.35, black, sx * 1.05, 1.1, -2.2, false));
    }
    const tank = cyl(0.3, 0.3, 1.1, 10, chrome, -0.85, 0.8, 1.35, false); tank.rotation.x = Math.PI / 2; inner.add(tank);
    inner.add(box(0.5, 0.45, 0.7, black, 0.85, 0.82, 1.4, false));
    // the cab, z 2.35 .. 4.18, its floor over the front wheels, and its lower front ahead of them
    inner.add(box(2.4, 2.0, 1.83, cab, 0, 2.05, 3.265));
    inner.add(box(2.38, 0.62, 0.62, cab, 0, 0.76, 3.88));
    inner.add(box(2.46, 0.36, 0.3, black, 0, 0.62, 4.13, false));             // bumper
    inner.add(box(1.5, 0.62, 0.05, black, 0, 1.42, 4.2, false));              // grille ...
    for (const y of [1.25, 1.42, 1.59]) inner.add(box(1.4, 0.04, 0.03, steel, 0, y, 4.23, false));   // ... and its slats
    inner.add(box(2.42, 0.16, 0.05, trim, 0, 1.88, 4.2, false));              // the trim stripe across the front ...
    const ws = box(2.24, 0.86, 0.06, glass, 0, 2.43, 4.19, false); ws.rotation.x = -0.06; inner.add(ws);   // windscreen
    inner.add(box(2.3, 0.08, 1.7, cab, 0, 3.09, 3.25, false));                // roof cap
    for (const [x, , z] of GARBAGE_BEACONS.slice(0, 2)) inner.add(box(0.3, 0.06, 0.3, black, x, 3.13, z, false));   // the beacons' bases
    for (const sx of [-1, 1]) {
      inner.add(box(0.05, 0.16, 1.85, trim, sx * 1.205, 1.88, 3.265, false)); // ... and along the cab
      inner.add(box(0.05, 0.72, 0.95, glass, sx * 1.205, 2.4, 3.55, false));  // door window
      inner.add(box(0.05, 0.55, 0.42, glass, sx * 1.205, 2.48, 2.72, false)); // the window behind it
      inner.add(box(0.04, 1.05, 0.04, black, sx * 1.205, 1.4, 3.03, false));  // door seam
      inner.add(box(0.05, 0.26, 1.2, black, sx * 1.205, 1.18, 3.0, false));   // the wheel arch
      for (const y of [0.55, 0.85]) inner.add(box(0.3, 0.06, 0.34, black, sx * 1.06, y, 3.75, false));   // steps
      inner.add(box(0.1, 0.03, 0.03, black, sx * 1.23, 2.62, 4.0, false));    // mirror arm ...
      inner.add(box(0.06, 0.42, 0.2, black, sx * 1.27, 2.4, 4.0, false));     // ... and its head
    }
    // the exhaust stack behind the cab
    inner.add(cyl(0.07, 0.07, 2.5, 8, chrome, 1.0, 2.35, 2.27, false));
    inner.add(cyl(0.09, 0.07, 0.25, 8, black, 1.0, 3.7, 2.27, false));
    // the compactor body: z -2.6 .. 2.2, y 1.12 .. 3.5
    inner.add(box(2.44, 2.38, 4.8, body, 0, 2.31, -0.2));
    inner.add(box(2.5, 0.12, 4.86, rib, 0, 3.53, -0.2, false));              // its top rim ...
    inner.add(box(2.5, 0.14, 4.86, rib, 0, 1.15, -0.2, false));              // ... and its foot
    for (const sx of [-1, 1]) {
      for (const z of [-2.25, -1.45, -0.65, 0.95, 1.75]) inner.add(box(0.06, 2.2, 0.12, rib, sx * 1.235, 2.33, z, false));   // ribs
      if (L.band !== null) inner.add(box(0.03, 0.42, 4.8, mat(L.band), sx * 1.232, 1.65, -0.2, false));   // the band, behind the ribs
      // the logo panel between two ribs, and on it a recycling triangle (three bars, 0.55 m a side)
      inner.add(box(0.03, 0.95, 1.2, white, sx * 1.235, 2.45, 0.15, false));
      inner.add(box(0.03, 0.07, 0.55, recycle, sx * 1.25, 2.291, 0.15, false));
      const tl = box(0.03, 0.07, 0.55, recycle, sx * 1.25, 2.529, 0.0125, false); tl.rotation.x = -Math.PI / 3; inner.add(tl);
      const tr = box(0.03, 0.07, 0.55, recycle, sx * 1.25, 2.529, 0.2875, false); tr.rotation.x = Math.PI / 3; inner.add(tr);
      // the reflective strip along the foot, red and white
      for (let i = 0; i < 10; i++) inner.add(box(0.03, 0.1, 0.44, i % 2 ? white : red, sx * 1.235, 1.3, -2.37 + i * 0.46, false));
    }
    // the tailgate, hinged at the top of the body: its upper block (z -3.6 .. -2.6) over the hopper (z -4.22 .. -3.48)
    inner.add(box(2.48, 2.4, 0.05, black, 0, 2.33, -2.6, false));            // the seam between the body and the tailgate
    inner.add(box(2.44, 2.1, 1.0, body, 0, 2.5, -3.1));                      // y 1.45 .. 3.55
    inner.add(box(2.44, 0.6, 0.88, chassis, 0, 1.15, -3.04, false));         // under it, the hopper's front
    for (const sx of [-1, 1]) inner.add(box(0.2, 0.12, 0.2, black, sx * 0.6, 3.6, -2.62, false));   // hinges
    for (const [x, , z] of GARBAGE_BEACONS.slice(2)) inner.add(box(0.28, 0.06, 0.28, black, x, 3.58, z, false));   // the beacons' bases
    // its face slopes out and down from its top (z -3.6, y 3.55) to the top of the loading mouth (z -4.22, y 1.85):
    // a block 1.81 m long turned 0.35 rad, its rear face on that line
    const SB = [1.85, -4.22], ST = [3.55, -3.6], sl = Math.atan2(ST[1] - SB[1], ST[0] - SB[0]), sn = [-Math.sin(sl), Math.cos(sl)];
    const face = box(2.44, Math.hypot(ST[0] - SB[0], ST[1] - SB[1]), 0.7, body, 0, (SB[0] + ST[0]) / 2 + 0.35 * sn[0], (SB[1] + ST[1]) / 2 + 0.35 * sn[1]);
    face.rotation.x = sl; inner.add(face);
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {                   // its edge, red and white down both sides
      const t = (i + 0.5) / 6, seg = box(0.03, 0.29, 0.08, i % 2 ? white : red, sx * 1.235, SB[0] + t * (ST[0] - SB[0]) + 0.05 * sn[0], SB[1] + t * (ST[1] - SB[1]) + 0.05 * sn[1], false);
      seg.rotation.x = sl; inner.add(seg);
    }
    // the hydraulic rams up its sides, from the body's top corner down to the hopper
    for (const sx of [-1, 1]) { const ram = box(0.1, 2.05, 0.1, steel, sx * 1.25, 2.45, -3.325, false); ram.rotation.x = 0.596; inner.add(ram); }
    // the loading mouth, open: the hopper's cheeks, its floor and sill, the lip over it and its dark back wall
    for (const sx of [-1, 1]) inner.add(box(0.22, 1.0, 0.74, body, sx * 1.11, 1.35, -3.85));
    inner.add(box(2.0, 0.22, 0.74, steel, 0, 0.96, -3.85, false));
    inner.add(box(2.44, 0.14, 0.32, body, 0, 1.78, -4.06, false));
    inner.add(box(2.0, 0.66, 0.06, black, 0, 1.39, -3.62, false));
    // ... and the rubbish in it: bags, a cardboard box, a blue bin and odds and ends
    for (const [hex, sx, sy, sz, x, y, z] of [[0x1d1f22, 0.32, 0.24, 0.26, -0.62, 1.3, -3.9], [0xe9e9e4, 0.26, 0.22, 0.22, 0.2, 1.32, -3.95], [0x7d838a, 0.16, 0.2, 0.2, -0.84, 1.28, -3.95]]) {
      const bag = new THREE.Mesh(SCOOP_GEO, mat(hex)); bag.position.set(x, y, z); bag.scale.set(sx, sy, sz); inner.add(bag);
    }
    const carton = box(0.38, 0.32, 0.34, mat(0xc9a26b), -0.2, 1.24, -3.84, false); carton.rotation.y = 0.3; inner.add(carton);
    inner.add(box(0.3, 0.44, 0.3, mat(0x2e6fd6), 0.6, 1.3, -3.86, false));   // the blue bin
    const lid = box(0.22, 0.12, 0.3, mat(0x46b54a), -0.35, 1.5, -3.95, false); lid.rotation.z = 0.4; inner.add(lid);
    inner.add(box(0.18, 0.16, 0.18, mat(0xe85d9a), 0.05, 1.55, -3.9, false));
    inner.add(box(0.2, 0.14, 0.2, mat(0xf2c230), 0.84, 1.55, -3.95, false));
    // under the mouth the chevron bar, red and white; the crew's steps and grab handles
    for (let i = 0; i < 8; i++) inner.add(box(0.2875, 0.34, 0.06, i % 2 ? white : red, -1.00625 + i * 0.2875, 0.6, -4.25, false));
    for (const sx of [-1, 1]) {
      inner.add(box(0.5, 0.05, 0.12, steel, sx * 0.75, 0.4, -4.28, false));
      inner.add(box(0.04, 0.6, 0.04, steel, sx * 1.05, 1.4, -4.25, false));
    }
    // one shadow setting for every piece but the glass, so each colour merges into one mesh (consolidateBody keys on it)
    for (const o of inner.children) if (o.isMesh) { o.castShadow = o.material !== glass; o.receiveShadow = true; }

  } else if (kind === 'firetruck') {
    // Big red pump/ladder engine: cab with a chrome grille and chevron bumper, white livery stripe,
    // equipment lockers down the flanks, a ladder rack on the roof and a red/amber beacon bar.
    wheelZ = [-2.1, 2.0]; wheelX = 1.2; frontZ = 3.75; backZ = -3.75; lightY = 0.95; wheelScale = 1.3;
    const red = mat(0xc8342e), darkRed = mat(0xa52620), white = mat(0xf1f2f0), chrome = mat(0xc9cdd2), steel = mat(0x7c8288);
    lights.red = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
    lights.amber = new THREE.MeshBasicMaterial({ color: 0xffa41f });
    inner.add(box(2.34, 0.5, 7.3, mat(0x2a2d33), 0, 0.62, -0.1));            // chassis rail
    inner.add(box(2.5, 1.75, 5.4, red, 0, 1.68, -1.0));                      // body
    inner.add(box(2.54, 0.3, 5.44, white, 0, 1.2, -1.0, false));             // white livery stripe
    inner.add(box(2.56, 0.1, 5.44, white, 0, 2.35, -1.0, false));            // roof edge trim
    inner.add(box(2.42, 1.5, 2.2, red, 0, 1.9, 1.9));                        // cab
    inner.add(box(2.2, 0.72, 0.14, glass, 0, 2.16, 2.98));                   // windshield
    for (const sx of [-1, 1]) inner.add(box(0.08, 0.6, 1.2, glass, sx * 1.2, 2.14, 1.75, false));
    inner.add(box(2.34, 0.8, 0.12, chrome, 0, 1.05, 3.05, false));           // grille
    inner.add(box(1.9, 0.16, 0.2, dark, 0, 1.62, 3.06, false));              // grille bar
    inner.add(box(2.6, 0.42, 0.34, red, 0, 0.55, 3.2, false));               // bumper
    for (let i = -2; i <= 2; i++) inner.add(box(0.34, 0.4, 0.1, i % 2 ? mat(0xf4c020) : red, i * 0.5, 0.55, 3.38, false));   // chevrons
    for (const sx of [-1, 1]) {                                              // locker outlines
      inner.add(box(0.06, 1.1, 0.1, white, sx * 1.26, 1.75, 0.6, false));
      inner.add(box(0.06, 1.1, 0.1, white, sx * 1.26, 1.75, -0.8, false));
      inner.add(box(0.06, 0.1, 5.0, white, sx * 1.26, 2.2, -1.0, false));
    }
    inner.add(box(2.3, 1.5, 0.16, darkRed, 0, 1.68, -3.72, false));          // rear panel
    for (const sx of [-1, 1]) inner.add(box(0.3, 0.3, 0.1, lights.red, sx * 0.95, 1.05, -3.8, false));
    // roof: ladder rack with rails, cross bars and a two-rail extension ladder
    for (const sx of [-1, 1]) inner.add(box(0.12, 0.14, 5.5, steel, sx * 0.95, 2.62, -1.1, false));
    for (const sz of [-3.4, -1.6, 0.2, 1.3]) inner.add(box(2.0, 0.1, 0.12, steel, 0, 2.62, sz, false));
    for (const sx of [-0.36, 0.36]) inner.add(box(0.1, 0.1, 5.9, chrome, sx, 2.78, -1.3, false));
    for (let i = 0; i < 7; i++) inner.add(box(0.8, 0.07, 0.09, chrome, 0, 2.78, -4.0 + i * 0.86, false));
    inner.add(box(0.14, 0.14, 5.9, steel, 1.0, 2.6, -1.3, false));           // hose bed rail
    inner.add(box(1.7, 0.22, 0.4, dark, 0, 2.72, 2.1, false));               // beacon bar base
    inner.add(box(0.7, 0.16, 0.32, lights.red, -0.42, 2.72, 2.1, false));
    inner.add(box(0.7, 0.16, 0.32, lights.amber, 0.42, 2.72, 2.1, false));
    inner.add(box(0.4, 0.2, 0.16, ASSET.headMat, 0, 0.95, 3.42, false));     // headlight

  } else if (kind === 'firesmall') {
    // Small squad/pickup: the quick-response unit, red with a white stripe and a low beacon bar.
    wheelZ = [-1.55, 1.6]; frontZ = 2.65; backZ = -2.65; lightY = 0.8;
    const red = mat(0xc8342e), white = mat(0xf1f2f0);
    lights.red = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
    inner.add(box(2.0, 0.62, 4.9, red, 0, 0.78, 0));                        // body
    inner.add(box(2.04, 0.24, 4.92, white, 0, 0.62, 0, false));              // stripe
    inner.add(box(1.86, 0.7, 1.5, red, 0, 1.44, 0.55));                      // cab
    inner.add(box(1.72, 0.42, 0.12, glass, 0, 1.5, 1.34));                   // windshield
    for (const sx of [-1, 1]) inner.add(box(0.07, 0.4, 0.9, glass, sx * 0.94, 1.48, 0.5, false));
    inner.add(box(1.7, 0.5, 2.0, red, 0, 1.1, -1.35));                       // rear equipment box
    inner.add(box(1.74, 0.18, 2.02, white, 0, 0.86, -1.35, false));
    for (const sx of [-1, 1]) inner.add(box(0.06, 0.9, 0.08, white, sx * 1.0, 1.15, -0.5, false));
    inner.add(box(0.9, 0.16, 0.3, lights.red, 0, 1.86, 0.55, false));        // beacon bar
    for (const sx of [-1, 1]) inner.add(box(0.28, 0.24, 0.1, lights.red, sx * 0.7, 0.72, -2.5, false));
    inner.add(box(0.36, 0.18, 0.14, ASSET.headMat, 0, 0.8, 2.42, false));

  } else if (kind === 'pickup') {
    wheelZ = [-1.5, 1.6]; frontZ = 2.32; backZ = -2.32;
    const bc = mat(color);
    inner.add(box(2.0, 0.7, 4.6, bc, 0, 0.74, 0));
    inner.add(box(1.8, 0.75, 1.7, bc, 0, 1.42, 0.7));
    inner.add(box(1.84, 0.4, 1.3, glass, 0, 1.48, 0.7));
    inner.add(box(1.6, 0.44, 1.74, glass, 0, 1.48, 0.7));
    inner.add(box(0.12, 0.42, 2.2, bc, -0.94, 1.28, -1.3)); inner.add(box(0.12, 0.42, 2.2, bc, 0.94, 1.28, -1.3));
    inner.add(box(1.9, 0.42, 0.12, bc, 0, 1.28, -2.34));
    inner.add(box(1.76, 0.08, 2.1, dark, 0, 1.1, -1.3, false));


  } else if (kind === 'hatchback') {
    wheelZ = [-1.2, 1.25]; wheelX = 0.95; frontZ = 1.85; backZ = -1.85; lightY = 0.8;
    const bc = mat(color);
    inner.add(box(1.85, 0.66, 3.5, bc, 0, 0.7, 0));
    inner.add(box(1.62, 0.6, 2.3, bc, 0, 1.28, -0.35));
    inner.add(box(1.66, 0.36, 1.3, glass, 0, 1.33, -0.35));
    inner.add(box(1.4, 0.4, 2.35, glass, 0, 1.33, -0.35));
    inner.add(box(1.5, 0.08, 0.1, dark, 0, 1.58, -1.5, false));


  } else if (kind === 'suv') {
    wheelZ = [-1.6, 1.6]; wheelX = 1.15; frontZ = 2.45; backZ = -2.45; lightY = 0.95;
    const bc = mat(color);
    inner.add(box(2.15, 0.95, 4.75, bc, 0, 0.95, 0));
    inner.add(box(2.0, 0.85, 3.0, bc, 0, 1.75, -0.1));
    inner.add(box(2.04, 0.42, 1.7, glass, 0, 1.8, -0.1));
    inner.add(box(1.82, 0.44, 3.0, glass, 0, 1.8, -0.1));
    inner.add(box(1.7, 0.06, 2.9, dark, 0, 2.2, -0.1, false));


  } else if (kind === 'van') {
    wheelZ = [-1.65, 1.65]; wheelX = 1.2; frontZ = 2.5; backZ = -2.5; lightY = 0.95;
    const bc = mat(color);
    inner.add(box(2.2, 1.75, 5.0, bc, 0, 1.15, 0));
    inner.add(box(2.1, 0.6, 0.1, glass, 0, 1.65, 2.3, false));
    inner.add(box(0.1, 0.5, 1.6, glass, -1.1, 1.6, 1.0, false));
    inner.add(box(0.1, 0.5, 1.6, glass, 1.1, 1.6, 1.0, false));
    inner.add(box(2.24, 0.1, 5.02, mat(0xffffff), 0, 2.03, 0, false));


  } else if (kind === 'sportscar') {
    wheelZ = [-1.3, 1.35]; wheelX = 1.05; frontZ = 2.15; backZ = -2.15; lightY = 0.6;
    const bc = mat(color);
    inner.add(box(2.05, 0.52, 4.3, bc, 0, 0.52, 0));
    inner.add(box(1.6, 0.4, 1.4, bc, 0, 0.95, -0.7));
    inner.add(box(1.62, 0.3, 1.0, glass, 0, 1.0, -0.15));
    inner.add(box(1.4, 0.28, 1.4, glass, 0, 0.98, -0.85));
    inner.add(box(1.5, 0.07, 0.3, dark, 0, 1.1, -2.05, false));


  } else if (kind === 'oldclassic') {
    wheelZ = [-1.35, 1.35]; wheelX = 1.0; frontZ = 2.2; backZ = -2.2; lightY = 0.78;
    const bc = mat(color), chrome = mat(0xc9c9c9);
    inner.add(box(2.0, 0.78, 4.3, bc, 0, 0.78, 0));
    inner.add(box(1.6, 0.55, 2.1, bc, 0, 1.42, -0.1));
    inner.add(box(1.64, 0.35, 1.5, glass, 0, 1.47, -0.1));
    inner.add(box(1.4, 0.36, 1.9, glass, 0, 1.47, -0.1));
    inner.add(box(2.05, 0.18, 0.22, chrome, 0, 0.5, 2.22, false));
    inner.add(box(2.05, 0.18, 0.22, chrome, 0, 0.5, -2.22, false));


  } else if (kind === 'limo') {
    wheelZ = [-2.6, 2.6]; wheelX = 1.0; frontZ = 3.3; backZ = -3.3; lightY = 0.86;
    const bc = mat(color);
    inner.add(box(2.05, 0.68, 6.6, bc, 0, 0.72, 0));
    inner.add(box(1.7, 0.55, 4.6, mat(0x111216), 0, 1.3, -0.1));
    inner.add(box(1.74, 0.3, 1.4, glass, 0, 1.33, 1.9));
    inner.add(box(1.5, 0.3, 4.4, glass, 0, 1.33, -0.3));


  // ===== Cement mixer truck — bulbous lathe-profile drum (real transit-mixer shape) =====
  } else if (kind === 'cementtruck') {
    wheelZ = [3.5, -2.6, -3.5]; wheelX = 1.3; wheelY = 0.58; wheelScale = 1.3; frontZ = 4.05; backZ = -4.5; lightY = 1.0;
    const cab = mat(color), chassis = mat(0x2b2d33), drumMat = mixerMat(0xe3ded2), collarMat = mat(color), capMat = mat(0x111214),
          funnel = mat(0x55595f), ladderMat = mat(0xb9bcc0), motorMat = mat(0x34373c), accent = mat(0x2f5fa8);
    // chassis + front bumper with red/white chevron warning bar
    inner.add(box(2.1, 0.28, 7.4, chassis, 0, 0.46, -0.3, false));
    inner.add(box(2.3, 0.3, 0.3, chassis, 0, 0.55, 4.05, false));
    for (let i = -2; i <= 2; i++) inner.add(box(0.42, 0.22, 0.18, i % 2 === 0 ? mat(0xd6451f) : mat(0xffffff), i * 0.45, 0.55, 4.18, false));
    // hood + grille
    inner.add(box(2.0, 1.0, 1.6, cab, 0, 1.05, 2.95));
    inner.add(box(1.8, 0.1, 1.5, mat(0x1c1d22), 0, 1.57, 2.95, false));
    inner.add(box(1.6, 0.5, 0.1, mat(0x14151a), 0, 0.92, 3.78, false));
    // cab
    inner.add(box(2.15, 1.5, 1.9, cab, 0, 1.78, 1.65));
    const wshield = box(2.0, 0.72, 0.08, glass, 0, 1.98, 2.62, false); wshield.rotation.x = -0.2; inner.add(wshield);
    inner.add(box(0.08, 0.58, 1.5, glass, -1.06, 1.88, 1.55, false)); inner.add(box(0.08, 0.58, 1.5, glass, 1.06, 1.88, 1.55, false));
    inner.add(box(2.2, 0.12, 0.4, cab, 0, 2.58, 2.2, false));
    // small water tank on the chassis (used to wet the drum/chute)
    const fTank = cyl(0.26, 0.26, 1.2, 8, mat(0x9aa0a6), -1.15, 0.78, 0.5); fTank.rotation.x = Math.PI / 2; inner.add(fTank);
    // drum cradle supports (fixed to chassis, do not rotate)
    inner.add(box(0.22, 1.0, 0.22, chassis, -0.85, 1.15, -0.3, false)); inner.add(box(0.22, 1.0, 0.22, chassis, 0.85, 1.15, -0.3, false));
    inner.add(box(0.26, 0.85, 0.26, chassis, -0.95, 1.05, -3.4, false)); inner.add(box(0.26, 0.85, 0.26, chassis, 0.95, 1.05, -3.4, false));
    // rotating drum assembly: bulbous barrel + rear hopper collar + interior cap + front drive motor
    const drum = new THREE.Group();
    const barrel = new THREE.Mesh(ASSET.mixerDrumGeo, drumMat); barrel.castShadow = true; drum.add(barrel);
    const band = cyl(1.33, 1.33, 0.4, 12, accent, 0, 0, 0.1); band.rotation.x = Math.PI / 2; drum.add(band);
    const collar = new THREE.Mesh(ASSET.mixerCollarGeo, collarMat); collar.position.z = -2.85; drum.add(collar);
    const capMesh = new THREE.Mesh(ASSET.mixerCapGeo, capMat); capMesh.position.z = -2.6; capMesh.rotation.y = Math.PI; drum.add(capMesh);
    const motor = cyl(0.33, 0.4, 0.8, 10, motorMat, 0, 0, 2.95); motor.rotation.x = Math.PI / 2; drum.add(motor);
    drum.rotation.x = -0.07; drum.position.set(0, 2.05, -1.4);
    inner.add(drum); g.userData.mixer = drum;
    // fixed side ladder up to the hopper (mounted on the chassis, does not rotate with the drum)
    inner.add(box(0.06, 2.1, 0.06, ladderMat, -1.55, 2.2, -2.8, false));
    inner.add(box(0.06, 2.1, 0.06, ladderMat, -1.2, 2.45, -3.65, false));
    for (let i = 0; i < 5; i++) { const t = i / 4; inner.add(box(0.42, 0.05, 0.05, ladderMat, -1.37, 1.3 + t * 1.85, -2.85 - t * 0.75, false)); }
    inner.add(box(0.7, 0.05, 0.9, ladderMat, -1.0, 3.2, -3.9, false)); // small platform by the hopper
    // discharge chute (sloped trough at the rear-bottom)
    const chute = box(0.5, 0.22, 1.5, funnel, 0, 0.75, -4.65, false); chute.rotation.x = 0.4; inner.add(chute);
    for (const sx of [-1, 1]) { const rail = box(0.06, 0.3, 1.5, funnel, sx * 0.24, 0.88, -4.65, false); rail.rotation.x = 0.4; inner.add(rail); }
    dualWheel(-1, -2.6); dualWheel(1, -2.6); dualWheel(-1, -3.5); dualWheel(1, -3.5);


  // ===== Fuel tanker (cab-over tractor + separate tank trailer look) =====
  } else if (kind === 'fueltanker') {
    wheelZ = [3.5, 1.8, 1.1, -4.3, -5.0, -5.7]; wheelX = 1.22; wheelY = 0.56; wheelScale = 1.25; frontZ = 4.75; backZ = -5.9; lightY = 1.0;
    const cabMat = mat(color), chassis = mat(0x2a2a2d), tankC = mat(0xf0f0f0), tankShade = mat(0xd8d8d8), hazard = mat(0xff6a1a), strap = mat(0xb9bcc0);
    // cab-over tractor
    inner.add(box(2.25, 1.9, 2.2, cabMat, 0, 1.55, 3.6));
    const wshield2 = box(2.1, 0.8, 0.08, glass, 0, 2.05, 4.66, false); wshield2.rotation.x = -0.18; inner.add(wshield2);
    inner.add(box(0.08, 0.65, 1.0, glass, -1.1, 1.95, 3.9, false)); inner.add(box(0.08, 0.65, 1.0, glass, 1.1, 1.95, 3.9, false));
    inner.add(box(1.9, 0.3, 0.9, cabMat, 0, 2.75, 3.3, false));
    inner.add(box(2.3, 0.45, 0.2, chassis, 0, 0.72, 4.78, false));
    inner.add(box(2.0, 0.28, 0.06, mat(0x15161a), 0, 0.85, 4.88, false));
    // chassis + fifth-wheel coupling
    inner.add(box(2.0, 0.22, 1.6, chassis, 0, 0.55, 2.5, false));
    inner.add(box(1.6, 0.14, 0.6, chassis, 0, 0.78, 1.8, false));
    inner.add(box(2.1, 0.2, 5.3, chassis, 0, 0.5, -3.0, false));
    const fTank2 = cyl(0.24, 0.24, 1.1, 8, chassis, -1.1, 0.68, 2.6); fTank2.rotation.x = Math.PI / 2; inner.add(fTank2);
    // tank trailer
    const tank = new THREE.Mesh(ASSET.tankGeo, tankC); tank.castShadow = true; tank.position.set(0, 1.95, -1.5); inner.add(tank);
    const capF = new THREE.Mesh(ASSET.tankCapGeo, tankC); capF.position.set(0, 1.95, 1.8); inner.add(capF);
    const capB = new THREE.Mesh(ASSET.tankCapGeo, tankC); capB.position.set(0, 1.95, -4.8); capB.rotation.x = Math.PI; inner.add(capB);
    for (const sz of [0.6, -1.5, -3.6]) { const ringm = cyl(1.17, 1.17, 0.14, 16, strap, 0, 1.95, sz, false); ringm.rotation.x = Math.PI / 2; inner.add(ringm); }
    inner.add(box(1.9, 0.08, 6.6, tankShade, 0, 2.9, -1.5, false));
    inner.add(cyl(0.22, 0.22, 0.18, 10, mat(0x888f98), 0, 3.14, 0.6));
    inner.add(cyl(0.22, 0.22, 0.18, 10, mat(0x888f98), 0, 3.14, -2.4));
    const haz = box(0.08, 0.62, 0.62, hazard, 1.1, 1.95, -1.5, false); haz.rotation.x = Math.PI / 4; inner.add(haz);
    // rear support legs + mudguard over the tridem
    inner.add(box(0.2, 0.85, 0.2, chassis, -0.9, 1.0, -4.7, false)); inner.add(box(0.2, 0.85, 0.2, chassis, 0.9, 1.0, -4.7, false));
    inner.add(box(2.2, 0.1, 2.0, mat(0x1c1d22), 0, 1.28, -5.0, false));
    dualWheel(-1, 1.8); dualWheel(1, 1.8); dualWheel(-1, 1.1); dualWheel(1, 1.1);
    dualWheel(-1, -4.3); dualWheel(1, -4.3); dualWheel(-1, -5.0); dualWheel(1, -5.0); dualWheel(-1, -5.7); dualWheel(1, -5.7);


  // ===== Semi tractor with an optional trailer (reference: cab-over tractor with chrome stacks and tandem drive) =====
  } else if (kind === 'semi' || kind === 'semibox' || kind === 'flatbed' || kind === 'lowboy' || kind === 'logtruck') {
    const trailer = { semi: null, semibox: 'box', flatbed: 'flat', lowboy: 'low', logtruck: 'logs' }[kind];
    const hasTrailer = trailer !== null;
    const s = hasTrailer ? 2.05 : 0;                       // with a trailer the tractor moves forward so the trailer front meets the sleeper
    const zf = s - 0.6, zr = zf - 7.6, zc = zf - 3.8;      // trailer front, rear and centre (7.6 m trailer)
    const F = 3.9 + s;                                     // nose of the tractor
    const trimM = mat(0x16171b), cab = mat(color), chassis = mat(0x2a2d33), chrome = mat(0xc9cdd2), grey = mat(0x9aa1a8), tankG = mat(0xb8bec6);
    const zs = hasTrailer ? [2.8 + s, -2.6 + s, -3.6 + s, zr + 1.7, zr + 0.7] : [2.8, -2.6, -3.6];
    const dualZ = hasTrailer ? [-2.6 + s, -3.6 + s, zr + 1.7, zr + 0.7] : [-2.6, -3.6];   // twin tyres on the drive and trailer axles
    wheelZ = zs; wheelX = 1.15; wheelY = 0.52; wheelScale = 1.15; frontZ = F - 0.05; backZ = hasTrailer ? zr : -4.2; lightY = 1.0;
    // tractor: cab, sleeper, slanted screen, grille with chrome slats, bumper, chassis, tanks, chrome exhaust stacks
    inner.add(box(2.3, 1.75, 2.5, cab, 0, 1.6, 2.4 + s));
    inner.add(box(2.2, 0.8, 0.4, cab, 0, 1.05, 3.45 + s));
    inner.add(box(2.35, 0.14, 2.6, trimM, 0, 2.55, 2.45 + s, false));
    inner.add(box(2.3, 1.9, 1.6, cab, 0, 1.85, 0.2 + s));
    const ws = box(2.1, 0.9, 0.08, glass, 0, 2.0, 3.66 + s, false); ws.rotation.x = -0.2; inner.add(ws);
    inner.add(box(1.5, 0.95, 0.12, trimM, 0, 1.05, 3.85 + s, false));
    for (let i = 0; i < 4; i++) inner.add(box(1.5, 0.05, 0.05, chrome, 0, 0.72 + i * 0.22, 3.93 + s, false));
    inner.add(box(2.4, 0.4, 0.3, grey, 0, 0.45, 3.8 + s));
    for (const sx of [-1, 1]) {
      inner.add(box(0.08, 0.6, 1.0, glass, sx * 1.17, 2.0, 2.4 + s, false));
      inner.add(box(0.18, 0.5, 0.1, trimM, sx * 1.3, 2.0, 3.0 + s, false));
      const tank = cyl(0.4, 0.4, 1.6, 10, tankG, sx * 1.22, 1.05, -1.2 + s); tank.rotation.x = Math.PI / 2; inner.add(tank);
      inner.add(cyl(0.12, 0.12, 2.4, 10, chrome, sx * 1.05, 2.45, -0.3 + s));
    }
    inner.add(box(1.8, 0.3, 6.0, chassis, 0, 0.55, -0.9 + s, false));
    inner.add(box(1.4, 0.1, 1.0, trimM, 0, 0.8, -0.3 + s, false));     // fifth wheel
    if (!hasTrailer) {
      inner.add(box(2.2, 0.3, 0.2, grey, 0, 0.45, -4.15));              // rear bumper
      for (const sx of [-1, 1]) inner.add(box(0.5, 0.6, 0.04, trimM, sx * 1.0, 0.3, -4.05, false));   // mud flaps
    } else if (trailer === 'box') {
      // box container with a dark underframe, a roof edge and a rear door seam
      const white = mat(0xf2f2f2);
      inner.add(box(2.3, 2.6, 7.6, white, 0, 1.95, zc));
      inner.add(box(2.36, 0.28, 7.6, trimM, 0, 0.5, zc, false));
      inner.add(box(2.36, 0.1, 7.6, grey, 0, 3.27, zc, false));
      inner.add(box(0.04, 2.4, 0.04, grey, 0, 1.95, zr - 0.02, false));
    } else if (trailer === 'flat') {
      // dropside flatbed: a grey deck on a dark frame, low side rails and a drop gate at the back
      const deck = mat(0x5b6066), rail = mat(0x3a3e45);
      inner.add(box(2.0, 0.3, 7.6, chassis, 0, 0.85, zc, false));
      inner.add(box(2.3, 0.12, 7.6, deck, 0, 1.13, zc));
      for (const sx of [-1, 1]) inner.add(box(0.12, 0.65, 7.6, rail, sx * 1.15, 1.55, zc, false));
      inner.add(box(2.3, 0.65, 0.12, rail, 0, 1.55, zr + 0.06, false));
    } else if (trailer === 'low') {
      // lowboy: a low rear deck, a step up over the tractor and two ramps folded down at the back
      const deck = mat(0x3a3e45), steel = mat(0x9aa1a8);
      inner.add(box(2.2, 0.2, 5.2, deck, 0, 0.9, zr + 2.6));
      inner.add(box(2.2, 0.2, 1.2, deck, 0, 1.2, -0.35));
      inner.add(box(2.2, 0.2, 1.2, deck, 0, 1.5, 0.85));
      for (const sx of [-1, 1]) { const ramp = box(0.9, 0.06, 2.12, steel, sx * 0.6, 0.55, zr + 1.0); ramp.rotation.x = -0.34; inner.add(ramp); }
    } else {
      // log trailer: a frame, four pairs of tall stakes and the load (LOG_LOAD): six logs stacked in three layers, a
      // group of its own (g.userData.cargo) that js/logSpill.js takes off the trailer when a hard hit spills it
      inner.add(box(2.0, 0.3, 7.6, chassis, 0, 0.85, zc, false));
      for (const z of [zr + 0.6, zr + 2.4, zr + 4.2, zr + 6.0]) for (const sx of [-1, 1]) inner.add(box(0.12, 1.9, 0.12, trimM, sx * 1.0, 1.85, z, false));
      const cargo = new THREE.Group(), [evenBark, oddBark, cutEnds] = logLoadGeometry();
      [[evenBark, LOG_LOAD.bark[0]], [oddBark, LOG_LOAD.bark[1]], [cutEnds, LOG_LOAD.end]].forEach(([geo, hex]) => {
        const m = new THREE.Mesh(geo, mat(hex)); m.castShadow = true; m.receiveShadow = true; cargo.add(m);
      });
      cargo.position.z = zc;                               // LOG_LOAD.z: the middle of the 7.6 m trailer
      inner.add(cargo); g.userData.cargo = cargo;
    }
    for (const z of dualZ) { dualWheel(-1, z); dualWheel(1, z); }

  // ===== NEW: Police Motorcycle =====
  } else if (kind === 'policeMoto') {
    wheelZ = [-0.95, 0.95]; wheelX = 0; frontZ = 1.3; backZ = -1.1; lightY = 0.75;
    const navy = mat(0x16233b);
    lights.red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    lights.blue = new THREE.MeshBasicMaterial({ color: 0x2a5cff });
    inner.add(box(0.42, 0.32, 1.85, navy, 0, 0.55, 0));
    inner.add(box(0.38, 0.22, 0.6, dark, 0, 0.75, -0.3, false));
    inner.add(box(0.42, 0.5, 0.36, navy, 0, 1.12, -0.15, false));
    inner.add(box(0.3, 0.28, 0.28, mat(0x24262b), 0, 1.48, -0.05, false));
    inner.add(box(0.36, 0.3, 0.14, glass, 0, 0.92, 0.78, false));
    inner.add(box(0.5, 0.14, 0.22, lights.red, -0.14, 0.95, 0.9, false));
    inner.add(box(0.5, 0.14, 0.22, lights.blue, 0.14, 0.95, 0.9, false));


  // ===== NEW: Unmarked Police =====
  } else if (kind === 'policeUnmarked') {
    wheelZ = [-1.4, 1.4]; wheelX = 1.0; frontZ = 2.17; backZ = -2.17; lightY = 0.86;
    const bc = mat(color);
    inner.add(box(2.0, 0.66, 4.3, bc, 0, 0.72, 0));
    inner.add(box(1.72, 0.62, 2.1, bc, 0, 1.34, -0.25));
    inner.add(box(1.76, 0.38, 1.6, glass, 0, 1.38, -0.25));
    inner.add(box(1.5, 0.4, 2.14, glass, 0, 1.38, -0.25));
    lights.red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    lights.blue = new THREE.MeshBasicMaterial({ color: 0x2a5cff });
    inner.add(box(0.5, 0.08, 0.2, lights.red, -0.3, 1.5, 0.3, false));
    inner.add(box(0.5, 0.08, 0.2, lights.blue, 0.3, 1.5, 0.3, false));


  // ===== NEW: Police Van (SWAT) =====
  } else if (kind === 'policeVan') {
    wheelZ = [-1.9, 1.9]; wheelX = 1.3; frontZ = 2.85; backZ = -2.85; lightY = 1.05;
    const navy = mat(0x16233b), armor = mat(0x20242b);
    inner.add(box(2.6, 1.55, 5.9, navy, 0, 1.15, 0));
    inner.add(box(2.64, 0.3, 5.95, mat(0xeceeef), 0, 1.9, 0, false));
    inner.add(box(2.3, 0.5, 1.6, glass, 0, 1.55, 2.7));
    inner.add(box(0.1, 0.5, 0.9, glass, -1.32, 1.55, 1.2, false));
    inner.add(box(0.1, 0.5, 0.9, glass, 1.32, 1.55, 1.2, false));
    inner.add(box(1.8, 0.2, 0.6, armor, 0, 2.25, -0.2, false));
    lights.red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    lights.blue = new THREE.MeshBasicMaterial({ color: 0x2a5cff });
    inner.add(box(0.85, 0.2, 0.5, lights.red, -0.55, 2.35, -0.2, false));
    inner.add(box(0.85, 0.2, 0.5, lights.blue, 0.55, 2.35, -0.2, false));


  } else if (isPoliceKind(kind)) {
    const tier = Number(kind[kind.length - 1]);
    const white = mat(0xf3f3f3), navy = mat(0x16233b), armor = mat(tier >= 4 ? 0x27303a : 0x1b1e26);
    const siren = (y, z, width = 0.62) => {
      lights.red = new THREE.MeshBasicMaterial({ color: 0xff2020 }); lights.blue = new THREE.MeshBasicMaterial({ color: 0x2a5cff });
      inner.add(box(width, 0.2, 0.38, lights.red, -width * .55, y, z, false));
      inner.add(box(width, 0.2, 0.38, lights.blue, width * .55, y, z, false));
    };
    if (tier === 1) {
      inner.add(box(2.0, 0.66, 4.3, navy, 0, 0.72, 0)); inner.add(box(2.05, 0.36, 2.2, white, 0, 0.74, -0.05));
      inner.add(box(1.72, 0.62, 2.1, white, 0, 1.34, -0.25)); inner.add(box(1.76, 0.38, 1.6, glass, 0, 1.38, -0.25));
      inner.add(box(1.5, 0.4, 2.14, glass, 0, 1.38, -0.25)); inner.add(box(1.3, 0.12, 0.42, dark, 0, 1.71, -0.25)); siren(1.84, -0.25, 0.55);
    } else if (tier === 2) {
      wheelZ = [-1.55, 1.55]; wheelX = 1.12; frontZ = 2.42; backZ = -2.42;
      inner.add(box(2.25, 0.55, 4.8, navy, 0, 0.67, 0)); inner.add(box(2.3, 0.3, 2.4, white, 0, 0.72, -0.15));
      inner.add(box(1.9, 0.55, 1.9, navy, 0, 1.25, -0.15)); inner.add(box(1.92, 0.34, 1.45, glass, 0, 1.28, -0.15));
      inner.add(box(1.65, 0.35, 1.94, glass, 0, 1.28, -0.15)); inner.add(box(2.18, 0.18, 0.25, dark, 0, 0.52, 2.4));
      inner.add(box(1.55, 0.14, 0.44, dark, 0, 1.58, -0.15)); siren(1.69, -0.15, 0.5);
    } else if (tier === 3) {
      wheelZ = [-1.75, 1.75]; wheelX = 1.25; frontZ = 2.68; backZ = -2.68; lightY = 1.05;
      inner.add(box(2.55, 1.05, 5.3, armor, 0, 0.9, 0)); inner.add(box(2.3, 0.95, 2.55, armor, 0, 1.72, -0.2));
      inner.add(box(2.34, 0.42, 1.88, glass, 0, 1.75, -0.2)); inner.add(box(2.1, 0.43, 2.6, glass, 0, 1.75, -0.2));
      inner.add(box(2.7, 0.32, 0.34, dark, 0, 0.65, 2.7)); inner.add(box(2.85, 0.12, 0.18, mat(0xb9c0c7), 0, 0.98, 2.78));
      inner.add(box(1.7, 0.18, 0.48, dark, 0, 2.22, -0.2)); siren(2.35, -0.2, 0.62);
    } else if (tier === 4) {
      wheelZ = [-2.2, 2.2]; wheelX = 1.42; frontZ = 3.25; backZ = -3.25; lightY = 1.1;
      inner.add(box(2.9, 1.35, 6.4, armor, 0, 1.05, 0)); inner.add(box(2.64, 1.15, 3.05, armor, 0, 2.0, -0.2));
      inner.add(box(2.68, 0.35, 2.15, glass, 0, 2.1, -0.25));
      for (const x of [-.75, 0, .75]) inner.add(box(0.38, 0.52, 0.08, glass, x, 2.08, 1.36, false));
      inner.add(box(3.05, 0.65, 0.38, dark, 0, 0.75, 3.32)); inner.add(box(3.2, 0.13, 0.16, mat(0xd1d7dc), 0, 1.18, 3.52));
      inner.add(box(2.05, 0.18, 0.55, dark, 0, 2.61, -0.2)); siren(2.74, -0.2, 0.7);
    } else {
      wheelZ = [-2.65, 0, 2.65]; wheelX = 1.62; frontZ = 3.8; backZ = -3.8; lightY = 1.22;
      inner.add(box(3.3, 1.65, 7.5, armor, 0, 1.2, 0)); inner.add(box(3.0, 1.35, 3.5, armor, 0, 2.25, -0.2));
      for (const x of [-1.0, -.35, .35, 1.0]) inner.add(box(0.42, 0.5, 0.1, glass, x, 2.35, 1.48, false));
      inner.add(box(3.55, 0.82, 0.52, dark, 0, 0.82, 3.9)); inner.add(box(3.8, 0.16, 0.2, mat(0xffc928), 0, 1.3, 4.08));
      inner.add(box(2.35, 0.2, 0.65, dark, 0, 3.0, -0.2)); siren(3.15, -0.2, 0.85);
    }


  } else {
    inner.add(box(2.0, 0.7, 4.2, mat(color), 0, 0.74, 0));
    inner.add(box(1.7, 0.62, 2.0, mat(color), 0, 1.35, -0.2));
    inner.add(box(1.74, 0.38, 1.55, glass, 0, 1.4, -0.2));
    inner.add(box(1.5, 0.4, 2.04, glass, 0, 1.4, -0.2));
    if (kind === 'taxi') {
      inner.add(box(1.0, 0.3, 0.5, mat(0xffffff), 0, 1.81, -0.2)); inner.add(box(0.5, 0.2, 0.52, dark, 0, 1.81, -0.2));
      inner.add(box(2.04, 0.16, 1.6, dark, 0, 0.8, 0.6, false));
    }
    if (kind === 'player') {
      inner.add(box(0.36, 0.03, 4.2, mat(0x20222a), 0, 1.1, 0));
      inner.add(box(1.9, 0.1, 0.55, dark, 0, 1.45, -2.0));
      inner.add(box(0.1, 0.3, 0.2, dark, -0.7, 1.28, -1.95)); inner.add(box(0.1, 0.3, 0.2, dark, 0.7, 1.28, -1.95));
      inner.add(box(2.05, 0.28, 0.25, dark, 0, 0.5, 2.15));
    }
  }


  for (const sx of [-1, 1]) for (const sz of wheelZ) {
    const w = new THREE.Mesh(ASSET.wheelGeo, wm); w.position.set(sx * wheelX, wheelY, sz);
    if (wheelScale !== 1) w.scale.setScalar(wheelScale);
    w.castShadow = true; inner.add(w);
  }
  if (kind === 'player') {
    // The player's car gets the finish the traffic does not: chrome rims with dark hubs, a grille with a chrome bar and
    // an intake, wing mirrors, two exhaust tips and door seams. Every piece is a cached unit box or cylinder, so
    // spawning the car again adds no geometry, and all of it stays inside the car's own dimensions.
    const chrome = mat(0xc9cdd2), trim = mat(0x111216), bc = mat(color);
    for (const sx of [-1, 1]) for (const sz of wheelZ) {
      const rim = cyl(0.3, 0.3, 0.05, 14, chrome, sx * (wheelX + 0.22), wheelY, sz); rim.rotation.z = Math.PI / 2; inner.add(rim);
      const hub = cyl(0.12, 0.12, 0.06, 10, trim, sx * (wheelX + 0.25), wheelY, sz); hub.rotation.z = Math.PI / 2; inner.add(hub);
    }
    inner.add(box(1.0, 0.26, 0.06, trim, 0, 0.66, 2.12));                 // grille
    inner.add(box(0.9, 0.04, 0.07, chrome, 0, 0.8, 2.13));                // chrome bar across it
    inner.add(box(1.3, 0.1, 0.06, trim, 0, 0.42, 2.12));                  // lower intake
    for (const sx of [-1, 1]) {
      inner.add(box(0.2, 0.16, 0.3, bc, sx * 0.97, 1.2, 0.5));            // wing mirror
      const tip = cyl(0.1, 0.1, 0.08, 10, chrome, sx * 0.5, 0.3, -2.08); tip.rotation.x = Math.PI / 2; inner.add(tip);
      inner.add(box(0.02, 0.4, 2.0, trim, sx * 1.005, 0.85, -0.2, false)); // door seam
    }
  }
  if (detail) {
    const hl = ASSET.headMat, tl = ASSET.tailMat, lx = (kind === 'bus' || kind === 'schoolbus' || kind === 'garbage') ? 0.85 : kind === 'icecream' ? 0.8 : (kind === 'cementtruck' || kind === 'fueltanker' || kind === 'semi' || kind === 'semibox' || kind === 'flatbed' || kind === 'lowboy' || kind === 'logtruck') ? 0.95 : 0.65;
    for (const sx of [-1, 1]) { inner.add(box(0.5, 0.22, 0.08, hl, sx * lx, lightY, frontZ, false)); inner.add(box(0.5, 0.2, 0.08, tl, sx * lx, lightY + 0.04, backZ, false)); }
  }
  consolidateBody(inner, new Set(Object.values(lights)));
  g.userData.inner = inner; g.userData.lights = lights;
  return g;
}