/* Sports and play grounds: the football and basketball courts, futsal, hoops, baseball, golf and the playground, with their balls.
 * Split out of js/campus.js. */
import * as THREE from 'three';
import { mat } from './assets.js';
import { box } from './assets.js';
import { cyl } from './assets.js';
import { PI } from './utils.js';

// ---- Sports and play grounds: basketball, futsal, baseball diamond, golf, playground ----
// Each one is a fenced ground with its own markings and fittings. The fences are solids, so a car stops at them
// the way it would at a real chain-link fence, and each fence panel breaks on a hard hit (see the fencePieces);
// the hoops and goal posts are solids too.
export const SPORT_DEFS = {
  hoops:      { pad: [38, 26], ground: 0xb8653a, court: 0x2d5fa8 },
  futsal:     { pad: [46, 30], ground: 0x9aa0a6, court: 0x2f8f4e },
  baseball:   { pad: [52, 52], ground: 0x6b6f76, court: 0x3f7f3a },
  playground: { pad: [34, 28], ground: 0x4f8f45, court: 0xe8d49a },
  golf:       { pad: [48, 48], ground: 0x2f6b35, court: 0x6fb85a },
};
export const SPORT_KINDS = Object.keys(SPORT_DEFS);
// Balls for the courts: one shared sphere and seam ring per size, so a ground with several balls adds no geometry cost.
export const BALL_R = 0.12;
export const BALL_GEO = new THREE.SphereGeometry(BALL_R, 16, 12);
export const SEAM_GEO = new THREE.TorusGeometry(BALL_R * 1.01, 0.006, 4, 24);
export const PATCH_GEO = new THREE.DodecahedronGeometry(0.045);
export const RING_GEO = new THREE.TorusGeometry(0.23, 0.025, 6, 20);
export const GOLF_GEO = new THREE.SphereGeometry(0.03, 10, 8);
export const BASE_GEO = new THREE.SphereGeometry(0.07, 14, 10);
export const BASE_SEAM_GEO = new THREE.TorusGeometry(0.0705, 0.006, 4, 20);
// How far a ground is grown: 1.5 times, or as far as the block allows. A block's interior is 56 m across (the paving
// takes the rest), so the longest side is held to SPORT_MAX_SIDE, which keeps a little clear of the pad edge.
export const SPORT_MAX_SIDE = 55;
export function sportScale(kind) {
  const [w, d] = SPORT_DEFS[kind].pad;
  return Math.min(1.5, SPORT_MAX_SIDE / Math.max(w, d));
}
export function buildSportMesh(kind, bx, bz, rng) {
  const S = SPORT_DEFS[kind];
  const root = new THREE.Group(), solids = [];
  let g = root;                                  // where geometry goes; a breakable piece swaps in its own group
  const M = {
    line: mat(0xf4f4f0), white: mat(0xffffff), fence: mat(0x3b4a44), metal: mat(0x9aa3ab), dark: mat(0x3a3f46),
    orange: mat(0xf07a1e), dirt: mat(0xb88a5a), sand: mat(0xe8d49a), wood: mat(0x8a5a32), concrete: mat(0xb7bcc2),
    red: mat(0xd8452f), yellow: mat(0xf2c230), blue: mat(0x2d5fa8), green: mat(0x2f8f4e), ground: mat(S.ground),
    court: mat(S.court || S.ground), grass: mat(0x3f7f3a),
  };
  const Y = 0.25;
  const B = (w, h, d, m, x, y, z, cast = false) => g.add(box(w, h, d, m, x, Y + y, z, cast));
  const CYL = (rt, rb, h, seg, m, x, y, z, cast = false) => g.add(cyl(rt, rb, h, seg, m, x, Y + y, z, cast));
  const solid = (x, z, hx, hz, k) => solids.push({ x: bx + x, z: bz + z, hx, hz, kind: k });
  // A fence run of length L along x or z, centred on (x, z). It is cut into panels of about 7 m, and every panel is
  // a stand-alone piece with its own group, so the world can register it as a breakable solid: a hard hit takes down
  // the panel it lands on (and the ones next to it), the same way the schoolyard fence comes down.
  const fencePieces = [];
  const fence = (L, h, x, z, along) => {
    const alongX = along === 'x', segs = Math.max(1, Math.round(L / 7)), segLen = L / segs;
    for (let i = 0; i < segs; i++) {
      const off = -L / 2 + (i + 0.5) * segLen;
      const grp = new THREE.Group(), wire = 0.04;
      // a welded-mesh panel, as on a real court: vertical wires every 0.25 m, three rails and a post at each end
      if (alongX) {
        for (let t = -segLen / 2 + 0.12; t <= segLen / 2 - 0.12 + 1e-6; t += 0.25) grp.add(box(wire, h, wire, M.fence, t, Y + h / 2, 0, false));
        for (const ry of [0.2, h / 2, h - 0.15]) grp.add(box(segLen, 0.05, wire, M.fence, 0, Y + ry, 0, false));
        for (const px of [-segLen / 2, segLen / 2]) grp.add(box(0.1, h + 0.3, 0.1, M.metal, px, Y + (h + 0.3) / 2, 0, false));
      } else {
        for (let t = -segLen / 2 + 0.12; t <= segLen / 2 - 0.12 + 1e-6; t += 0.25) grp.add(box(wire, h, wire, M.fence, 0, Y + h / 2, t, false));
        for (const ry of [0.2, h / 2, h - 0.15]) grp.add(box(wire, 0.05, segLen, M.fence, 0, Y + ry, 0, false));
        for (const pz of [-segLen / 2, segLen / 2]) grp.add(box(0.1, h + 0.3, 0.1, M.metal, 0, Y + (h + 0.3) / 2, pz, false));
      }
      grp.scale.set(sc, 1, sc);
      fencePieces.push({ group: grp, x: bx + (x + (alongX ? off : 0)) * sc, z: bz + (z + (alongX ? 0 : off)) * sc,
        hx: (alongX ? segLen / 2 : 0.12) * sc, hz: (alongX ? 0.12 : segLen / 2) * sc, alongX, segLen, mesh: null, broken: false });
    }
  };
  // A breakable element (a hoop, a goal, a ramp, a piece of play equipment): its geometry goes into its own group, so
  // it can come off its base as one piece, and it is registered with a solid that carries the back-reference.
  // x, z are block-local; brk is the speed (divided by sqrt(mass)) at which a hit takes it down; obox is an optional
  // turned footprint for a solid that is not axis-aligned (a ramp).
  const breakable = [];
  const piece = (spec, fn) => {
    const outer = g; g = new THREE.Group();
    fn();
    g.scale.set(sc, 1, sc);
    const ob = spec.obox ? { ...spec.obox, e1: spec.obox.e1 * sc, e2: spec.obox.e2 * sc } : null;
    breakable.push({ group: g, x: bx + spec.x * sc, z: bz + spec.z * sc, hx: spec.hx * sc, hz: spec.hz * sc, kind: spec.kind,
      brk: spec.brk, color: spec.color, obox: ob, mesh: null, broken: false });
    g = outer;
  };
  const sc = sportScale(kind);                   // growth in x and z; heights stay
  const [PW, PD] = S.pad;
  // The playing surface takes about 80% of the enclosure: CW x CD is the court, the field or the deck, and a strip of
  // the pad's own colour (A wide) is left round it. A solves (PW-2A)(PD-2A) = 0.8 PW PD. The fences stand on the pad's edge.
  const A = (2 * (PW + PD) - Math.sqrt(4 * (PW + PD) ** 2 - 3.2 * PW * PD)) / 8, CW = PW - 2 * A, CD = PD - 2 * A;

  // Court markings are thin flat boxes laid end to end along a path, so a circle, an arc or a key is plain geometry.
  // `path` joins points (closed or open), `mark` is one straight line, `flat` a flat rectangle turned by `rot`,
  // `dot` a round spot, `ballAt` a ball on the ground (basket, foot, base, golf).
  const MK = 0.12;
  const mark = (x0, z0, x1, z1, m = M.line) => {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const b = box(L + MK, 0.02, MK, m, (x0 + x1) / 2, Y + 0.04, (z0 + z1) / 2, false);
    b.rotation.y = -Math.atan2(dz, dx); g.add(b);
  };
  const path = (pts, m = M.line, closed = false) => {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; mark(a[0], a[1], b[0], b[1], m); }
  };
  const arcPts = (cx, cz, r, a0, a1, n = 24) => {
    const p = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
    return p;
  };
  const flat = (w, d, x, z, m, rot = 0) => { const b = box(w, 0.03, d, m, x, Y + 0.04, z, false); b.rotation.y = rot; g.add(b); };
  const dot = (x, z, r, m = M.line) => g.add(cyl(r, r, 0.02, 14, m, x, Y + 0.05, z, false));
  const ballAt = (x, z, kind) => {
    const r = kind === 'golf' ? 0.03 : kind === 'base' ? 0.07 : BALL_R;
    const b = new THREE.Group();
    b.position.set(x, Y + r, z); b.scale.set(1 / sc, 1, 1 / sc);         // undoes the ground's x/z growth, so the ball stays round
    if (kind === 'basket') {
      b.add(new THREE.Mesh(BALL_GEO, M.orange));
      for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) {
        const s2 = new THREE.Mesh(SEAM_GEO, M.dark); s2.rotation.x = rx; s2.rotation.y = ry; b.add(s2);
      }
    } else if (kind === 'foot') {                                         // white with black panels
      b.add(new THREE.Mesh(BALL_GEO, M.white));
      for (const [px, py, pz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const pt = new THREE.Mesh(PATCH_GEO, M.dark);
        pt.position.set(px * BALL_R * 0.97, py * BALL_R * 0.97, pz * BALL_R * 0.97); b.add(pt);
      }
    } else if (kind === 'base') {                                         // a white ball with a red seam
      b.add(new THREE.Mesh(BASE_GEO, M.white));
      const seam = new THREE.Mesh(BASE_SEAM_GEO, M.red); seam.rotation.x = 0.4; seam.rotation.z = 0.6; b.add(seam);
    } else {
      b.add(new THREE.Mesh(GOLF_GEO, M.white));
    }
    g.add(b);
  };

  if (kind === 'hoops') {
    // A basketball court at the real 28 x 15 m proportions (f = court width / 15), with the key, the free-throw circle,
    // the three-point line and the centre circle; a backboard, ring and pole at each end; two balls on the court.
    const w = CW, d = CD, f = d / 15;
    B(w, 0.03, d, M.court, 0, 0.015, 0);
    path([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], M.line, true);
    mark(0, -d / 2, 0, d / 2);
    path(arcPts(0, 0, 1.8 * f, 0, 2 * PI, 36), M.line, true);
    dot(0, 0, 0.12 * f);
    for (const s of [-1, 1]) {
      const gx = s * w / 2, c = s > 0 ? PI : 0;                          // c points into the court
      const kx = gx - s * 5.8 * f;                                         // the free-throw line
      const bx = s * (w / 2 - 1.575 * f);                                  // the basket: 1.575 m in from the baseline
      mark(gx, -2.45 * f, kx, -2.45 * f); mark(gx, 2.45 * f, kx, 2.45 * f); mark(kx, -2.45 * f, kx, 2.45 * f);
      path(arcPts(kx, 0, 1.8 * f, c - PI / 2, c + PI / 2, 24));          // the free-throw circle, on the court side
      // three-point line: 6.75 m from the basket, straight in from the corners 0.9 m from the sideline
      const R = 6.75 * f, zc = d / 2 - 0.9 * f, th = Math.asin(Math.min(1, zc / R));
      const arc = arcPts(bx, 0, R, c - th, c + th, 30);
      path(arc);
      for (const q of [arc[0], arc[arc.length - 1]]) mark(gx, Math.sign(q[1]) * zc, q[0], q[1]);
      // pole behind the baseline, arm to a backboard 0.2 m out from the ring, ring 0.45 m in front of the board
      const px = s * (w / 2 + 0.6), boardX = s * (w / 2 - 2.19), ringX = bx;
      piece({ x: px, z: 0, hx: 0.2, hz: 0.2, kind: 'hoop', brk: 5, color: 0x9aa3ab }, () => {
        CYL(0.12, 0.12, 3.4, 8, M.metal, px, 1.7, 0, true);
        B(Math.abs(boardX - px), 0.1, 0.1, M.metal, (px + boardX) / 2, 3.05, 0);
        B(0.06, 1.2, 1.8, M.white, boardX, 3.5, 0);
        const ring = new THREE.Mesh(RING_GEO, M.orange); ring.position.set(ringX, Y + 3.05, 0); ring.rotation.y = PI / 2; g.add(ring);
      });
    }
    ballAt(rng() * 8 - 4, -(d / 2) * 0.35 - rng() * 2, 'basket');
    ballAt(-w / 2 + 2.5 + rng() * 2, d / 2 - 2 - rng() * 2, 'basket');
    for (const s of [-1, 1]) { fence(PW, 3.6, 0, s * PD / 2, 'x'); fence(PD, 3.6, s * PW / 2, 0, 'z'); }
  } else if (kind === 'futsal') {
    // A futsal pitch with markings at the real 40 x 20 m proportions (f = court depth / 20): the boundary, the halfway line,
    // the centre circle and spot, a D-shaped penalty area at each goal, corner flags, and two footballs.
    const w = CW, d = CD, f = d / 20;
    B(w, 0.03, d, M.court, 0, 0.015, 0);
    path([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], M.line, true);
    mark(0, -d / 2, 0, d / 2);
    path(arcPts(0, 0, 3 * f, 0, 2 * PI, 36), M.line, true);
    dot(0, 0, 0.14 * f);
    for (const s of [-1, 1]) {
      const gx = s * w / 2, c = s > 0 ? PI : 0;
      path(arcPts(gx, 0, 6 * f, c - PI / 2, c + PI / 2, 30));              // the penalty D: 6 m out from the goal line
      // a goal: two posts and the bar between them, one breakable piece
      piece({ x: gx, z: 0, hx: 0.2, hz: 3.7, kind: 'goal', brk: 5, color: 0xffffff }, () => {
        for (const zz of [-3.6, 3.6]) CYL(0.06, 0.06, 2.1, 6, M.white, gx, 1.05, zz);
        B(0.12, 0.12, 7.2, M.white, gx, 2.1, 0);
      });
    }
    for (const [cx, cz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
      CYL(0.03, 0.03, 1.4, 6, M.yellow, cx, 0.7, cz, false);             // corner flag: pole and pennant
      B(0.04, 0.3, 0.4, M.yellow, cx, 1.3, cz + Math.sign(-cz) * 0.2, false);
    }
    ballAt(rng() * 6 - 3, rng() * 4 - 2, 'foot');
    ballAt(-w / 2 + 6 + rng() * 3, (rng() - 0.5) * (d * 0.6), 'foot');
    for (const s of [-1, 1]) { fence(PW, 3.6, 0, s * PD / 2, 'x'); fence(PD, 3.6, s * PW / 2, 0, 'z'); }
  } else if (kind === 'baseball') {
    // A ball diamond on the outfield grass: mown stripes, a dirt infield, white bases, home plate, the batters' boxes,
    // the foul lines, a pitcher's mound with its rubber, a dugout on each side, a backstop, and balls and bats on the ground.
    const R = 12.5;                                                      // home plate to each base, along the diagonals
    const stripe = mat(0x4c9440);
    B(CW, 0.03, CD, M.court, 0, 0.015, 0);                              // the outfield grass
    for (let k = -3; k <= 3; k += 2) B(CW, 0.035, CD / 7, stripe, 0, 0.02, k * CD / 7, false);
    CYL(R + 1.5, R + 1.5, 0.04, 4, M.dirt, 0, 0.02, 0, false);          // the infield dirt, a diamond with its corners on the axes
    CYL(1.5, 1.5, 0.2, 12, M.dirt, 0, 0.1, 0);                          // pitcher's mound
    flat(0.6, 0.15, 0, 0, M.white, 0);                                  // pitcher's rubber
    for (const [bxp, bzp] of [[R, 0], [0, -R], [-R, 0]]) flat(0.7, 0.7, bxp, bzp, M.white, PI / 4);
    flat(0.9, 0.9, 0, R, M.white, PI / 4);                              // home plate
    path([[-3.1, R - 1.2], [-0.9, R - 1.2], [-0.9, R + 1.2], [-3.1, R + 1.2]], M.line, true);   // batters' boxes
    path([[0.9, R - 1.2], [3.1, R - 1.2], [3.1, R + 1.2], [0.9, R + 1.2]], M.line, true);
    mark(0, R, 30, R - 30); mark(0, R, -30, R - 30);                    // foul lines, through first and third
    for (const sx of [-1, 1]) {                                          // a dugout on each side, behind the foul lines
      const dx = sx * 12, dz = -10;
      B(6.4, 0.15, 2.4, M.metal, dx, 2.6, dz, false);                    // roof
      B(6.2, 1.6, 0.15, M.dark, dx, 1.05, dz - 1.0, false);             // back wall
      for (const px of [-3, 3]) B(0.1, 2.5, 0.1, M.metal, dx + px, 1.3, dz + 1.0, false);   // posts
      B(5.6, 0.25, 0.8, M.wood, dx, 0.4, dz, false);                     // bench
      solids.push({ x: bx + dx * sc, z: bz + (dz - 1.0) * sc, hx: 3.2 * sc, hz: 0.1 * sc, kind: 'building' });   // back wall, solid
    }
    const bat = cyl(0.03, 0.05, 0.9, 6, M.wood, 9, Y + 0.05, -15.5); bat.rotation.z = PI / 2; bat.rotation.y = 0.3; g.add(bat);
    fence(28, 3.6, 0, 13.5, 'x');                                       // backstop
    ballAt(-6, 11, 'base');
    ballAt(0.4, 0.6, 'base');
    ballAt(-14, 8, 'base');
    for (const s of [-1, 1]) { fence(PW, 3.6, 0, s * PD / 2, 'x'); fence(PD, 3.6, s * PW / 2, 0, 'z'); }
  } else if (kind === 'playground') {
    B(CW, 0.03, CD, M.court, 0, 0.015, 0);                      // the sand, 80% of the enclosure; the grass round it is the pad
    // A children's play centre in the style of the reference pictures. Every piece of equipment is a breakable
    // piece. S() is a box that can be tilted about z (the slides and the seesaw plank); its height is from the ground.
    const S = (w, h, d, m, x, y, z, rz = 0) => { const b = box(w, h, d, m, x, Y + y, z, false); b.rotation.z = rz; g.add(b); };
    const TW = { x: -2, z: -4 };                                       // tower centre
    piece({ x: TW.x, z: TW.z, hx: 2.2, hz: 2.2, kind: 'playground', brk: 8, color: 0x8a5a32 }, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.14, 3.4, 0.14, M.wood, TW.x + sx * 2, 1.7, TW.z + sz * 2, false);
      B(4.4, 0.14, 4.4, M.wood, TW.x, 2.0, TW.z, false);               // platform deck
      const roof = cyl(0.01, 3.0, 1.0, 4, M.blue, TW.x, Y + 3.9, TW.z, false); roof.rotation.y = PI / 4; g.add(roof);
      B(0.1, 1.2, 0.1, M.yellow, TW.x, 4.5, TW.z, false);              // little flag pole on the roof
      for (const k of [0.4, 0.9, 1.4, 1.9]) B(1.2, 0.08, 0.12, M.yellow, TW.x, k, TW.z + 2.3, false);   // ladder rungs
      for (const dx of [-0.6, 0.6]) B(0.08, 2.0, 0.08, M.metal, TW.x + dx, 1.0, TW.z + 2.3, false);     // ladder rails
      // yellow slide to the east, red slide to the west: each runs from the deck (y 2.0) down to the ground (y 0.3)
      S(5.3, 0.12, 0.8, M.yellow, 2.7, 1.15, TW.z, -0.33);
      S(5.3, 0.12, 0.8, M.red, -6.7, 1.15, TW.z, 0.33);
    });
    // swing frame: a top bar on two posts at each end, two seats hanging from chains
    const SW = { x: -7, z: 6 };
    piece({ x: SW.x, z: SW.z, hx: 3.4, hz: 0.7, kind: 'playground', brk: 8, color: 0x9aa3ab }, () => {
      B(6.4, 0.12, 0.12, M.metal, SW.x, 2.6, SW.z, false);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.1, 2.6, 0.1, M.metal, SW.x + sx * 3.2, 1.3, SW.z + sz * 0.6, false);
      for (const sx of [-1, 1]) {
        for (const dx of [-0.3, 0.3]) B(0.03, 1.4, 0.03, M.dark, SW.x + sx * 1.4 + dx, 1.9, SW.z, false);
        B(0.9, 0.08, 0.4, M.wood, SW.x + sx * 1.4, 1.2, SW.z, false);
      }
    });
    // seesaw: a pivot block and a tilted plank
    piece({ x: 3, z: 6, hx: 2.0, hz: 0.4, kind: 'playground', brk: 6, color: 0xf2c230 }, () => {
      B(0.6, 0.5, 0.6, M.blue, 3, 0.25, 6, false);
      S(4.0, 0.12, 0.6, M.yellow, 3, 0.6, 6, 0.1);
    });
    // climbing arch: a semicircle of red tube in the x-y plane (two arches, one each side), with yellow rungs across
    const AR = { x: 10, z: -6, R: 1.6, N: 8 };
    piece({ x: AR.x, z: AR.z, hx: AR.R + 0.35, hz: 0.5, kind: 'playground', brk: 6, color: 0xd8452f }, () => {
      for (const dz of [-0.4, 0.4]) for (let i = 0; i < AR.N; i++) {
        const th = Math.PI * (i + 0.5) / AR.N;
        S(0.7, 0.14, 0.14, M.red, AR.x + AR.R * Math.cos(th), 0.1 + AR.R * Math.sin(th), AR.z + dz, th + Math.PI / 2);
      }
      for (let k = 1; k < AR.N; k++) {
        const th = Math.PI * k / AR.N;
        B(0.1, 0.1, 0.9, M.yellow, AR.x + AR.R * Math.cos(th), 0.1 + AR.R * Math.sin(th), AR.z, false);
      }
    });
    // a spring rocker (a red horse on a coil) and a merry-go-round, each one a breakable piece
    piece({ x: 6, z: -10, hx: 0.7, hz: 1.0, kind: 'playground', brk: 5, color: 0xd8452f }, () => {
      B(1.2, 0.1, 1.8, M.dark, 6, 0.05, -10, false);
      CYL(0.09, 0.09, 0.8, 6, M.metal, 6, 0.45, -10, false);
      B(0.5, 0.45, 1.5, M.red, 6, 1.1, -10, false);
      B(0.4, 0.4, 0.4, M.red, 6, 1.45, -11.0, false);
      B(0.6, 0.06, 0.3, M.dark, 6, 1.4, -10, false);
      for (const dz of [-0.5, 0.5]) B(0.06, 0.6, 0.06, M.dark, 6, 1.7, -10 + dz, false);
    });
    piece({ x: -10, z: -10, hx: 1.8, hz: 1.8, kind: 'playground', brk: 6, color: 0xf2c230 }, () => {
      CYL(1.8, 1.8, 0.12, 16, M.yellow, -10, 0.55, -10, false);
      CYL(0.1, 0.1, 1.4, 6, M.metal, -10, 1.2, -10, false);
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2;
        const bar = box(1.6, 0.06, 0.06, M.metal, -10 + Math.cos(a) * 0.8, Y + 1.25, -10 + Math.sin(a) * 0.8, false);
        bar.rotation.y = -a; g.add(bar);
      }
    });
    // two benches for the parents, and a bin by the fence
    for (const bxp of [-3, 3]) {
      B(2.2, 0.1, 0.6, M.wood, bxp, 0.5, 11.5, false);
      B(2.2, 0.5, 0.08, M.wood, bxp, 0.85, 11.2, false);
      for (const lx of [-0.9, 0.9]) B(0.08, 0.5, 0.5, M.dark, bxp + lx, 0.25, 11.5, false);
    }
    CYL(0.35, 0.3, 0.9, 8, M.dark, -14, 0.45, 8, false);
    // a wooden kerb round the sand
    B(CW, 0.14, 0.3, M.wood, 0, 0.07, CD / 2 - 0.15, false); B(CW, 0.14, 0.3, M.wood, 0, 0.07, -CD / 2 + 0.15, false);
    B(0.3, 0.14, CD, M.wood, CW / 2 - 0.15, 0.07, 0, false); B(0.3, 0.14, CD, M.wood, -CW / 2 + 0.15, 0.07, 0, false);
    // sandpit with a wooden border, and grass in the corners of the ground (these stay baked into the block)
    B(6.4, 0.06, 4.4, M.wood, 10, 0.03, 8, false);
    B(6.0, 0.08, 4.0, M.sand, 10, 0.04, 8, false);
    for (const [gx, gz] of [[14.5, 11.5], [-14.5, 11.5], [-14.5, -11.5]]) B(3, 0.05, 3, M.green, gx, 0.02, gz, false);
    fence(34, 2.4, 0, 14, 'x'); fence(34, 2.4, 0, -14, 'x');
    fence(28, 2.4, 17, 0, 'z'); fence(28, 2.4, -17, 0, 'z');
  } else if (kind === 'golf') {
    // A corner of a course: a mown fairway with light stripes, a putting green with a fringe, the cup and a flagstick
    // (a breakable piece), sand bunkers with their lips, a pond with reeds and rocks, a tee box with markers, trees
    // along the far edge, and golf balls on the green and the tee.
    const gr = 5.2, gx = CW * 0.14;
    const green = mat(0x9ad46a), fringe = mat(0x7fbf55), stripe = mat(0x7ec266), sand = mat(0xe8d49a), lip = mat(0xd3bf84);
    B(CW, 0.03, CD, M.court, 0, 0.015, 0);                                       // the fairway
    for (let k = -3; k <= 3; k += 2) B(CW, 0.035, CD / 7, stripe, 0, 0.02, k * CD / 7, false);
    CYL(gr + 0.8, gr + 0.8, 0.04, 20, fringe, gx, 0.02, 0, false);              // putting green and its fringe
    CYL(gr, gr, 0.05, 20, green, gx, 0.02, 0, false);
    CYL(0.2, 0.2, 0.05, 10, mat(0x111111), gx, 0.03, 0, false);                 // the cup
    piece({ x: gx, z: 0, hx: 0.15, hz: 0.15, kind: 'flag', brk: 4, color: 0xffffff }, () => {
      CYL(0.05, 0.05, 4.2, 6, M.white, gx, 2.1, 0, false);                     // the pole
      B(1.0, 0.6, 0.04, mat(0xd7342a), gx + 0.5, 3.9, 0, false);               // the flag
    });
    for (const [bxs, bzs, rx, rz] of [[-CW * 0.2, -CD * 0.22, 3.5, 2.0], [-CW * 0.1, CD * 0.24, 2.5, 1.8]]) {
      const l = cyl(1, 1, 0.04, 20, lip, bxs, Y + 0.02, bzs, false); l.scale.set(rx + 0.4, 1, rz + 0.4); g.add(l);
      const c = cyl(1, 1, 0.06, 20, sand, bxs, Y + 0.03, bzs, false); c.scale.set(rx, 1, rz); g.add(c);
    }
    const pond = cyl(1, 1, 0.05, 20, mat(0x3aa8d8), -CW * 0.22, Y + 0.025, CD * 0.04, false);
    pond.scale.set(3.4, 1, 2.6); g.add(pond);
    for (const [rx, rz] of [[-2.9, -1.2], [2.2, 1.6], [-0.6, 2.4], [3.1, -0.4]]) {
      CYL(0.04, 0.04, 0.7, 4, mat(0x6b8f3a), -CW * 0.22 + rx, 0.35, CD * 0.04 + rz, false);
    }
    B(0.9, 0.5, 0.7, mat(0x8a8f96), -CW * 0.22 - 1.1, 0.25, CD * 0.04 + 1.0, false);   // rocks
    B(0.6, 0.4, 0.5, mat(0x8a8f96), -CW * 0.22 + 1.6, 0.2, CD * 0.04 - 1.2, false);
    B(4, 0.04, 3, green, -CW * 0.36, 0.02, 0, false);                             // tee box
    CYL(0.1, 0.1, 0.25, 8, M.red, -CW * 0.36 + 1.4, Y + 0.12, -1, false);        // tee markers
    CYL(0.1, 0.1, 0.25, 8, M.white, -CW * 0.36 + 1.4, Y + 0.12, 1, false);
    for (const [tx, tz] of [[CW * 0.3, -CD * 0.36], [-CW * 0.42, -CD * 0.36], [CW * 0.38, CD * 0.08]]) {
      CYL(0.25, 0.3, 1.4, 6, M.wood, tx, 0.7, tz, false);                         // trunk
      CYL(0, 1.6, 3.0, 8, mat(0x2f7a3a), tx, 2.9, tz, false);                    // crown
    }
    ballAt(gx + 1.5, 1.2, 'golf');                                                 // golf balls on the green and the tee
    ballAt(gx - 2.0, -1.5, 'golf');
    ballAt(-CW * 0.36 + 0.4, 0.6, 'golf');
    for (const s2 of [-1, 1]) { fence(PW, 3.6, 0, s2 * PD / 2, 'x'); fence(PD, 3.6, s2 * PW / 2, 0, 'z'); }
  }
  // four floodlight masts, one in each corner of the enclosure, with a lamp head on each
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (PW / 2 - 0.9), lz = sz * (PD / 2 - 0.9);
    CYL(0.09, 0.12, 7.0, 8, M.metal, lx, 3.5, lz, false);
    B(1.2, 0.3, 0.6, mat(0xfff3c4), lx, 7.1, lz, false);
  }
  root.scale.set(sc, 1, sc);                     // the baked geometry (surface, markings, masts) grows the same way
  return { group: root, solids, pad: [PW * sc, PD * sc], fencePieces, breakable };
}

