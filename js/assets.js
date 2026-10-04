/* Shared materials, geometries and textures */
import * as THREE from 'three';
import { CHUNK, PI, mulberry32, hash2 } from './utils.js';

const matCache = new Map();

export function mat(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  let m = matCache.get(key);

  if (!m) {
    m = new THREE.MeshLambertMaterial(
      Object.assign({ color, flatShading: true }, opts || {})
    );
    matCache.set(key, m);
  }

  return m;
}

const UNIT = new THREE.BoxGeometry(1, 1, 1);

export function box(w, h, d, material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(UNIT, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

const geoCache = new Map();

export function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0, cast = true) {
  const key = [rt, rb, h, seg].join('_');
  let g = geoCache.get(key);

  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(key, g);
  }

  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export const ASSET = {};

(function buildAssets() {
  // Road texture (shared across every chunk). Lines are drawn half-width on edges so neighbours join seamlessly.
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');

  g.fillStyle = '#3b3f4a';
  g.fillRect(0, 0, 512, 512);

  const rr = mulberry32(7);

  for (let i = 0; i < 2200; i++) {
    g.fillStyle = rr() < 0.5
      ? 'rgba(255,255,255,0.035)'
      : 'rgba(0,0,0,0.07)';
    g.fillRect(rr() * 512, rr() * 512, 3, 3);
  }

  g.fillStyle = '#ffcf2e';
  for (let y = 70; y < 450; y += 40) {
    g.fillRect(0, y, 2.5, 22);
    g.fillRect(509.5, y, 2.5, 22);
  }
  for (let x = 70; x < 450; x += 40) {
    g.fillRect(x, 0, 22, 2.5);
    g.fillRect(x, 509.5, 22, 2.5);
  }

  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let x = 2; x < 50; x += 10) {
    for (const yy of [53, 451]) {
      g.fillRect(x, yy, 6, 8);
      g.fillRect(506 - x, yy, 6, 8);
    }
    for (const yy of [53, 451]) {
      g.fillRect(yy, x, 8, 6);
      g.fillRect(yy, 506 - x, 8, 6);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  // Phong material lets wet weather add a visible dark tint and specular sheen.
  ASSET.roadMat = new THREE.MeshPhongMaterial({
    map: tex,
    specular: 0x101419,
    shininess: 5,
  });

  // One soft, irregular alpha stamp is reused for shallow road puddles. Its opacity is driven by rain.
  const puddleCanvas = document.createElement('canvas');
  puddleCanvas.width = puddleCanvas.height = 128;
  const puddleCtx = puddleCanvas.getContext('2d');
  const puddleRng = mulberry32(0x7134);
  const puddlePoints = 28;
  puddleCtx.beginPath();
  for (let i = 0; i < puddlePoints; i++) {
    const a = i / puddlePoints * PI * 2;
    const wobble = 0.78 + puddleRng() * 0.22;
    const x = 64 + Math.cos(a) * 57 * wobble;
    const y = 64 + Math.sin(a) * 48 * wobble;
    if (i === 0) puddleCtx.moveTo(x, y);
    else puddleCtx.lineTo(x, y);
  }
  puddleCtx.closePath();
  const puddleGradient = puddleCtx.createRadialGradient(58, 55, 8, 64, 64, 68);
  puddleGradient.addColorStop(0, 'rgba(255,255,255,0.92)');
  puddleGradient.addColorStop(0.68, 'rgba(255,255,255,0.76)');
  puddleGradient.addColorStop(1, 'rgba(255,255,255,0)');
  puddleCtx.fillStyle = puddleGradient;
  puddleCtx.fill();
  puddleCtx.save();
  puddleCtx.clip();
  puddleCtx.strokeStyle = 'rgba(255,255,255,0.42)';
  puddleCtx.lineWidth = 2;
  puddleCtx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const x = 28 + puddleRng() * 68;
    const y = 30 + puddleRng() * 64;
    puddleCtx.beginPath();
    puddleCtx.moveTo(x - 10, y);
    puddleCtx.quadraticCurveTo(x, y - 2, x + 12, y + 1);
    puddleCtx.stroke();
  }
  puddleCtx.restore();
  const puddleTexture = new THREE.CanvasTexture(puddleCanvas);
  puddleTexture.colorSpace = THREE.SRGBColorSpace;
  puddleTexture.anisotropy = 4;
  ASSET.puddleGeo = new THREE.PlaneGeometry(1, 1);
  ASSET.puddleGeo.rotateX(-PI / 2);
  ASSET.puddleMat = new THREE.MeshPhongMaterial({
    map: puddleTexture,
    color: 0xa8c0cb,
    specular: 0xe4f4fb,
    shininess: 96,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  // Snow is a thin, patchy translucent overlay shared by roofs, bus shelters, signals, and parked cars.
  const snowCanvas = document.createElement('canvas');
  snowCanvas.width = snowCanvas.height = 128;
  const snowCtx = snowCanvas.getContext('2d');
  const snowRng = mulberry32(0x5A0F);
  for (let i = 0; i < 13; i++) {
    const cx = 8 + snowRng() * 112;
    const cy = 8 + snowRng() * 112;
    const rx = 8 + snowRng() * 16;
    const ry = 5 + snowRng() * 12;
    const points = 10;
    const rotation = snowRng() * PI * 2;
    snowCtx.beginPath();
    for (let j = 0; j < points; j++) {
      const a = rotation + j / points * PI * 2;
      const wobble = 0.76 + snowRng() * 0.24;
      const x = cx + Math.cos(a) * rx * wobble;
      const y = cy + Math.sin(a) * ry * wobble;
      if (j === 0) snowCtx.moveTo(x, y);
      else snowCtx.lineTo(x, y);
    }
    snowCtx.closePath();
    snowCtx.fillStyle = `rgba(255,255,255,${0.62 + snowRng() * 0.34})`;
    snowCtx.fill();
  }
  // Fine specks soften the edges so the overlay reads as a light dusting, not a solid white plate.
  for (let i = 0; i < 90; i++) {
    snowCtx.fillStyle = `rgba(255,255,255,${0.12 + snowRng() * 0.24})`;
    snowCtx.beginPath();
    snowCtx.arc(snowRng() * 128, snowRng() * 128, 0.5 + snowRng() * 1.3, 0, PI * 2);
    snowCtx.fill();
  }
  const snowTexture = new THREE.CanvasTexture(snowCanvas);
  snowTexture.colorSpace = THREE.SRGBColorSpace;
  snowTexture.anisotropy = 4;
  ASSET.snowPlaneGeo = new THREE.PlaneGeometry(1, 1);
  ASSET.snowPlaneGeo.rotateX(-PI / 2);
  ASSET.snowSurfaceMat = new THREE.MeshLambertMaterial({
    map: snowTexture,
    color: 0xf4f8ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  ASSET.groundGeo = new THREE.PlaneGeometry(CHUNK, CHUNK);
  ASSET.groundGeo.rotateX(-PI / 2);

  // Seamless procedural paving patterns shared by all streamed city chunks.
  const PAVE_SIZE = 256;
  const paveStyles = [
    {
      kind: 'running',
      grout: '#5f6662',
      palette: ['#b9bbb5', '#aeb3af', '#c4c1b8', '#a5ada9', '#c2c3bd'],
    },
    {
      kind: 'slabs',
      grout: '#626966',
      palette: ['#c5c5bd', '#b3b9b5', '#d0cbbf', '#aeb6b2', '#c0c1bb'],
    },
    {
      kind: 'diamond',
      grout: '#5d6561',
      palette: ['#adb5b1', '#c0c2bc', '#a4aeaa', '#c9c5ba', '#b3bbb6'],
    },
    {
      kind: 'cobble',
      grout: '#555e5a',
      palette: ['#929a96', '#a9ada6', '#858f8a', '#b4b2a8', '#969f9a'],
    },
  ];

  const mod = (n, m) => ((n % m) + m) % m;

  function paintPaver(ctx, x, y, w, h, color, rounded = false, fleck = 0) {
    const inset = rounded ? 3.2 : 2.6;
    const px = x + inset, py = y + inset;
    const pw = w - inset * 2, ph = h - inset * 2;

    ctx.fillStyle = color;

    if (rounded) {
      const r = Math.min(4, pw / 4, ph / 4);
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.lineTo(px + pw - r, py);
      ctx.quadraticCurveTo(px + pw, py, px + pw, py + r);
      ctx.lineTo(px + pw, py + ph - r);
      ctx.quadraticCurveTo(px + pw, py + ph, px + pw - r, py + ph);
      ctx.lineTo(px + r, py + ph);
      ctx.quadraticCurveTo(px, py + ph, px, py + ph - r);
      ctx.lineTo(px, py + r);
      ctx.quadraticCurveTo(px, py, px + r, py);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(px, py, pw, ph);
    }

    // A fine light edge and a darker lower edge give each stone a subtle bevel.
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(px + 1, py + 1, Math.max(1, pw - 2), 1);
    ctx.fillRect(px + 1, py + 1, 1, Math.max(1, ph - 2));

    ctx.fillStyle = 'rgba(35,40,38,0.16)';
    ctx.fillRect(px + 1, py + ph - 2, Math.max(1, pw - 2), 1);
    ctx.fillRect(px + pw - 2, py + 1, 1, Math.max(1, ph - 2));

    // Deterministic marks add surface variation without a visible texture seam.
    ctx.fillStyle = 'rgba(45,48,45,0.09)';
    ctx.fillRect(
      px + 5 + (fleck % Math.max(1, Math.floor(pw - 12))),
      py + 5 + ((fleck >>> 5) % Math.max(1, Math.floor(ph - 12))),
      2,
      1
    );
  }

  function makePavingTexture(style, styleIndex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PAVE_SIZE;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = style.grout;
    ctx.fillRect(0, 0, PAVE_SIZE, PAVE_SIZE);

    const tile = (x, y, w, h, row, col, rounded = false) => {
      const rows = Math.round(PAVE_SIZE / h);
      const cols = Math.round(PAVE_SIZE / w);
      const rr = mod(row, rows);
      const cc = mod(col, cols);
      const seed = hash2(cc + styleIndex * 31, rr + styleIndex * 73);

      paintPaver(
        ctx, x, y, w, h,
        style.palette[seed % style.palette.length],
        rounded,
        seed
      );
    };

    if (style.kind === 'running') {
      const w = 64, h = 32;

      for (let row = -1; row <= PAVE_SIZE / h; row++) {
        const offset = row % 2 ? w / 2 : 0;

        for (let col = -2; col <= PAVE_SIZE / w + 1; col++) {
          tile(col * w + offset, row * h, w, h, row, col);
        }
      }
    } else if (style.kind === 'slabs') {
      const w = 64, h = 64;

      for (let row = -1; row <= PAVE_SIZE / h; row++) {
        for (let col = -1; col <= PAVE_SIZE / w; col++) {
          tile(col * w, row * h, w, h, row, col);
        }
      }
    } else if (style.kind === 'cobble') {
      const w = 32, h = 32;

      for (let row = -1; row <= PAVE_SIZE / h; row++) {
        const offset = row % 2 ? w / 2 : 0;

        for (let col = -2; col <= PAVE_SIZE / w + 1; col++) {
          tile(col * w + offset, row * h, w, h, row, col, true);
        }
      }
    } else {
      // Two periodic diagonal joint families create diamond pavers.
      const d = 32;

      for (let row = -10; row <= 10; row++) {
        for (let col = -2; col <= 18; col++) {
          const i = row, j = col;
          const x1 = (i + j) * d / 2, y1 = (j - i) * d / 2;
          const x2 = (i + j + 1) * d / 2, y2 = (j - i + 1) * d / 2;
          const x3 = (i + j + 2) * d / 2, y3 = (j - i) * d / 2;
          const x4 = (i + j + 1) * d / 2, y4 = (j - i - 1) * d / 2;
          const seed = hash2(
            mod(col, 8) + styleIndex * 31,
            mod(row, 8) + styleIndex * 73
          );

          ctx.fillStyle = style.palette[seed % style.palette.length];
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x3, y3);
          ctx.lineTo(x4, y4);
          ctx.closePath();
          ctx.fill();
        }
      }

      ctx.strokeStyle = 'rgba(43,49,46,0.42)';
      ctx.lineWidth = 2;

      for (let k = -16; k <= 16; k++) {
        const p = k * d;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p + PAVE_SIZE, PAVE_SIZE);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p - PAVE_SIZE, PAVE_SIZE);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(16, 16);
    texture.anisotropy = 4;
    return texture;
  }

  ASSET.sidewalkGeo = new THREE.PlaneGeometry(CHUNK - 16, CHUNK - 16);
  ASSET.sidewalkGeo.rotateX(-PI / 2);
  ASSET.sidewalkMats = paveStyles.map((style, i) =>
    new THREE.MeshPhongMaterial({
      map: makePavingTexture(style, i),
      specular: 0x101419,
      shininess: 3,
    })
  );

  // Window texture (4x4 windows) + emissive map (lit windows at night).
  const w = document.createElement('canvas');
  w.width = w.height = 128;
  const wg = w.getContext('2d');

  wg.fillStyle = '#ffffff';
  wg.fillRect(0, 0, 128, 128);

  const wr = mulberry32(99);

  for (let r = 0; r < 4; r++) {
    for (let q = 0; q < 4; q++) {
      const k = wr();
      wg.fillStyle = k < 0.2 ? '#ffe08a' :
        k < 0.65 ? '#2d4261' : '#4f7fb5';
      wg.fillRect(q * 32 + 5, r * 32 + 7, 22, 18);
    }
  }

  const wt = new THREE.CanvasTexture(w);
  wt.colorSpace = THREE.SRGBColorSpace;
  wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
  wt.anisotropy = 4;

  const e = document.createElement('canvas');
  e.width = e.height = 128;
  const eg = e.getContext('2d');

  eg.fillStyle = '#000000';
  eg.fillRect(0, 0, 128, 128);

  const er = mulberry32(99);

  for (let r = 0; r < 4; r++) {
    for (let q = 0; q < 4; q++) {
      const k = er();

      if (k < 0.38) {
        eg.fillStyle = k < 0.2 ? '#ffd98a' : '#ffc46a';
        eg.fillRect(q * 32 + 5, r * 32 + 7, 22, 18);
      }
    }
  }

  const et = new THREE.CanvasTexture(e);
  et.colorSpace = THREE.SRGBColorSpace;
  et.wrapS = et.wrapT = THREE.RepeatWrapping;

  const pal = [
    0xe9ecef, 0xf8c8a0, 0xa8d5ff, 0xc9b6ff,
    0xffd6a5, 0xb9f0c1, 0xffb3b3,
  ];

  ASSET.windowMats = pal.map(col =>
    new THREE.MeshLambertMaterial({
      color: col,
      map: wt,
      flatShading: true,
      emissive: 0xffffff,
      emissiveMap: et,
      emissiveIntensity: 0,
    })
  );

  ASSET.roofMat = mat(0x8b9099);
  ASSET.lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
  ASSET.coinGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.22, 12).rotateX(PI / 2);
  ASSET.coinMat = new THREE.MeshLambertMaterial({
    color: 0xffc928,
    emissive: 0x7a5200,
    flatShading: true,
  });
  ASSET.roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(PI / 4);
  ASSET.wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 12).rotateZ(PI / 2);

  // Cement-mixer drum: bulbous lathe-profile barrel.
  const mixerPts = [
    [1.18, -2.60], [1.00, -2.28], [0.88, -1.90], [1.00, -1.35],
    [1.20, -0.65], [1.30, 0.10], [1.22, 0.80], [1.00, 1.45],
    [0.72, 1.95], [0.30, 2.35], [0.00, 2.55],
  ].map(p => new THREE.Vector2(p[0], p[1]));

  ASSET.mixerDrumGeo = new THREE.LatheGeometry(mixerPts, 12).rotateX(PI / 2);
  ASSET.mixerCollarGeo = new THREE.CylinderGeometry(1.2, 1.42, 0.5, 12).rotateX(PI / 2);
  ASSET.mixerCapGeo = new THREE.CircleGeometry(1.1, 12);

  // Diagonal “helical fin” rib texture for the mixer drum surface.
  const mc = document.createElement('canvas');
  mc.width = 64;
  mc.height = 128;
  const mg = mc.getContext('2d');

  mg.fillStyle = '#ffffff';
  mg.fillRect(0, 0, 64, 128);
  mg.strokeStyle = 'rgba(0,0,0,0.16)';
  mg.lineWidth = 7;

  for (let i = -128; i < 128; i += 22) {
    mg.beginPath();
    mg.moveTo(i, 128);
    mg.lineTo(i + 128, 0);
    mg.stroke();
  }

  mg.strokeStyle = 'rgba(255,255,255,0.4)';
  mg.lineWidth = 3;

  for (let i = -117; i < 128; i += 22) {
    mg.beginPath();
    mg.moveTo(i, 128);
    mg.lineTo(i + 128, 0);
    mg.stroke();
  }

  const mixerTex = new THREE.CanvasTexture(mc);
  mixerTex.wrapS = mixerTex.wrapT = THREE.RepeatWrapping;
  mixerTex.repeat.set(4, 1);
  mixerTex.anisotropy = 4;
  ASSET.mixerTex = mixerTex;

  // Fuel-tanker tank.
  ASSET.tankGeo = new THREE.CylinderGeometry(1.15, 1.15, 6.6, 18).rotateX(PI / 2);
  ASSET.tankCapGeo = new THREE.SphereGeometry(
    1.15, 18, 10, 0, PI * 2, 0, PI / 2
  ).rotateX(PI / 2);

  ASSET.burnt = mat(0x2a2a2d);
  ASSET.headMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  ASSET.tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

  // Headlight beam on the ground (one shared geometry/material).
  const bg = new THREE.BufferGeometry();
  bg.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-1.4, 0, 2.0, 1.4, 0, 2.0, 5.5, 0, 26, -5.5, 0, 26]),
      3
    )
  );
  bg.setAttribute(
    'color',
    new THREE.BufferAttribute(
      new Float32Array([1, .95, .7, .6, 1, .95, .7, .6, 1, .95, .7, 0, 1, .95, .7, 0]),
      4
    )
  );
  bg.setIndex([0, 1, 2, 0, 2, 3]);

  ASSET.beamGeo = bg;
  ASSET.beamMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // Spike strip parts.
  ASSET.spikeGeo = new THREE.ConeGeometry(0.16, 0.7, 4);
  ASSET.spikeMat = mat(0xdfe3e8);
  ASSET.spikeLit = new THREE.MeshBasicMaterial({ color: 0xff2020 });
})();

const mixerMatCache = new Map();

export function mixerMat(color) {
  let m = mixerMatCache.get(color);

  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      map: ASSET.mixerTex,
      flatShading: true,
    });
    mixerMatCache.set(color, m);
  }

  return m;
}

export function makeBuildingGeo(w, h, d, cell = 16) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;

  for (let f = 0; f < 6; f++) {
    let su, sv;

    if (f < 2) {
      su = d;
      sv = h;
    } else if (f < 4) {
      su = w;
      sv = d;
    } else {
      su = w;
      sv = h;
    }

    su = Math.max(1, Math.round(su / cell));
    sv = Math.max(1, Math.round(sv / cell));

    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }

  uv.needsUpdate = true;
  return g;
}