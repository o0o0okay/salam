/* Low-poly car models (civilians, player, 5 police tiers + new variants) */
import * as THREE from 'three';
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
};


export const isPoliceKind = kind => kind.startsWith('police');


export function buildCar(kind, color, detail = true) {
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
  if (detail) {
    const hl = ASSET.headMat, tl = ASSET.tailMat, lx = kind === 'bus' ? 0.85 : (kind === 'cementtruck' || kind === 'fueltanker') ? 0.95 : 0.65;
    for (const sx of [-1, 1]) { inner.add(box(0.5, 0.22, 0.08, hl, sx * lx, lightY, frontZ, false)); inner.add(box(0.5, 0.2, 0.08, tl, sx * lx, lightY + 0.04, backZ, false)); }
  }
  g.userData.inner = inner; g.userData.lights = lights;
  return g;
}