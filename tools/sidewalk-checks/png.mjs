/* Minimal PNG writer + tiny drawing canvas (no dependencies), used by plan.mjs to render sidewalk plans. */
import zlib from 'zlib';
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };

export function writePNG(w, h, rgb) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgb.copy(raw, y * stride + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}


// Tiny 3x5 bitmap font so rendered plans can label themselves without any font dependency.
export const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'], ':': ['000', '010', '000', '010', '000'], ' ': ['000', '000', '000', '000', '000'],
  '/': ['001', '001', '010', '100', '100'], '-': ['000', '000', '111', '000', '000'], '%': ['101', '001', '010', '100', '101'],
  '(': ['010', '100', '100', '100', '010'], ')': ['010', '001', '001', '001', '010'], '.': ['000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '100'], '+': ['000', '010', '111', '010', '000'],
  'A': ['111', '101', '111', '101', '101'], 'B': ['110', '101', '110', '101', '110'], 'C': ['111', '100', '100', '100', '111'],
  'D': ['110', '101', '101', '101', '110'], 'E': ['111', '100', '110', '100', '111'], 'F': ['111', '100', '110', '100', '100'],
  'G': ['111', '100', '101', '101', '111'], 'H': ['101', '101', '111', '101', '101'], 'I': ['111', '010', '010', '010', '111'],
  'J': ['001', '001', '001', '101', '111'], 'K': ['101', '101', '110', '101', '101'], 'L': ['100', '100', '100', '100', '111'],
  'M': ['101', '111', '111', '101', '101'], 'N': ['110', '101', '101', '101', '101'], 'O': ['111', '101', '101', '101', '111'],
  'P': ['111', '101', '111', '100', '100'], 'Q': ['111', '101', '101', '111', '001'], 'R': ['111', '101', '111', '110', '101'],
  'S': ['111', '100', '111', '001', '111'], 'T': ['111', '010', '010', '010', '010'], 'U': ['101', '101', '101', '101', '111'],
  'V': ['101', '101', '101', '101', '010'], 'W': ['101', '101', '111', '111', '101'], 'X': ['101', '101', '010', '101', '101'],
  'Y': ['101', '101', '010', '010', '010'], 'Z': ['111', '001', '010', '100', '111'],
};
// Draws text at (x, y) with `scale` pixels per glyph pixel; returns the x position after the last glyph.
export function drawText(cv, x, y, str, color, scale = 1, ink) {
  const col = ink || color;
  let cx = x;
  for (const raw of str.toUpperCase()) {
    const glyph = GLYPHS[raw];
    if (glyph) {
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] === '1') cv.rect(cx + gx * scale, y + gy * scale, cx + gx * scale + scale - 1, y + gy * scale + scale - 1, col);
      }
    }
    cx += 4 * scale;
  }
  return cx;
}

export function canvas(w, h, bg = [245, 246, 248]) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { buf[i * 3] = bg[0]; buf[i * 3 + 1] = bg[1]; buf[i * 3 + 2] = bg[2]; }
  const px = (x, y, c, a = 1) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    buf[i] = buf[i] * (1 - a) + c[0] * a; buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a; buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
  };
  const rect = (x0, y0, x1, y1, c, a = 1) => {
    const X0 = Math.min(x0, x1), X1 = Math.max(x0, x1), Y0 = Math.min(y0, y1), Y1 = Math.max(y0, y1);
    for (let y = Math.floor(Y0); y <= Y1; y++) for (let x = Math.floor(X0); x <= X1; x++) px(x, y, c, a);
  };
  const disc = (cx, cy, r, c, a = 1) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) px(x, y, c, a);
  };
  const vline = (x, y0, y1, c, a = 1) => rect(x, y0, x, y1, c, a);
  const hline = (x0, x1, y, c, a = 1) => rect(x0, y, x1, y, c, a);
  return { buf, px, rect, disc, vline, hline, w, h };
}
