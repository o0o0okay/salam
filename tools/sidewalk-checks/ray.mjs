/* Cast vertical rays down through the flyover and report the topmost drawn surface, so the concrete that is
   rendered can be compared with the surface js/flyover.js hands the physics. */
import { installDom } from './dom.mjs';
installDom();
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
const world = await import('../../js/world.js');
const fly = await import('../../js/flyover.js');
const pts = [];
const R = 2;
for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) world.updateChunks(cx * 80 + 40, cz * 80 + 40, 1);
for (const ch of world.chunks.values()) {
  ch.group.updateMatrixWorld(true);
  for (const b of ch.mergeQ || []) {
    const p = b.geo.parameters || {};
    if (b.geo.type !== 'BoxGeometry' || !p.width) continue;
    const e = b.m.elements;
    // world.js uses ONE shared unit BoxGeometry and puts the real size in the matrix scale, so the half-extents
    // are half the length of the matrix's basis columns.
    const half = i => 0.5 * Math.hypot(e[i], e[i + 1], e[i + 2]);
    const s = [half(0), half(4), half(8)];
    const c = [e[12], e[13], e[14]];
    // only the interchange's own pieces: the concrete/asphalt of the structure
    const col = (Array.isArray(b.mat) ? b.mat[0] : b.mat).color; const hex = col ? col.getHex() : 0;
    if (![0xb4b8bc, 0xd3d0c8, 0x3b3f4a, 0xffcf2e, 0x1e2126, 0xb9b6ad].includes(hex)) continue;
    if (Math.abs(c[0]) > 12 || c[2] < 20 || c[2] > 145) continue;
    pts.push({ c, s, hex, rot: e, l0: Math.hypot(e[0], e[1], e[2]) ** 2, l1: Math.hypot(e[4], e[5], e[6]) ** 2, l2: Math.hypot(e[8], e[9], e[10]) ** 2 });
  }
}
console.log(`${pts.length} structure pieces`);
{
  const byCol = new Map(); const all = [];
  for (const ch of world.chunks.values()) for (const b of ch.mergeQ || []) {
    const p = b.geo.parameters || {}; if (b.geo.type !== 'BoxGeometry' || !p.width) continue;
    const e = b.m.elements; const mt = Array.isArray(b.mat) ? b.mat[0] : b.mat;
    const hex = mt.color ? mt.color.getHex().toString(16) : '?';
    if (Math.abs(e[12]) > 12 || e[14] < 20 || e[14] > 145) continue;
    byCol.set(hex, (byCol.get(hex) || 0) + 1);
    if (['b4b8bc', '3b3f4a', 'd3d0c8'].includes(hex)) all.push(`   ${hex} at ${e[12].toFixed(2)},${e[13].toFixed(2)},${e[14].toFixed(2)} scale ${Math.hypot(e[0], e[1], e[2]).toFixed(1)}x${Math.hypot(e[4], e[5], e[6]).toFixed(1)}x${Math.hypot(e[8], e[9], e[10]).toFixed(1)}`);
  }
  console.log('  colours in the corridor: ' + [...byCol].map(([k, v]) => k + '=' + v).join(' '));
  console.log(all.join('\n'));
}
// the topmost structure surface under (px, pz), sampled down a vertical ray (robust, no inverse-matrix maths)
const hitY = (px, pz) => {
  for (let s = 12; s >= -0.5; s -= 0.02) {
    for (const o of pts) {
      const e = o.rot;
      const dx = px - e[12], dy = s - e[13], dz = pz - e[14];
      // the shared geometry is a unit box, so the local test is |local| <= 0.5 in UNSCALED space: divide each
      // basis column projection by the column's squared length.
      const l0 = (dx * e[0] + dy * e[1] + dz * e[2]) / o.l0;
      const l1 = (dx * e[4] + dy * e[5] + dz * e[6]) / o.l1;
      const l2 = (dx * e[8] + dy * e[9] + dz * e[10]) / o.l2;
      if (Math.abs(l0) <= 0.5 && Math.abs(l1) <= 0.5 && Math.abs(l2) <= 0.5) return { y: s, hex: o.hex };
    }
  }
  return null;
};
for (const z of [40, 44, 46, 50, 58, 66, 68, 74, 80, 86, 92, 96, 104, 118, 124, 130]) {
  for (const x of [-5.5, -2, 0, 2, 5.5]) {
    const hit = hitY(x, z); const drawn = hit ? hit.y : -Infinity, seen = hit ? hit.hex : '--';
    const phys = fly.surfaceAt(x, z, 50);
    const want = fly.rampHeight(z - 80) + (fly.rampHeight(z - 80) > 0 ? 0.08 : 0);
    const flag = Math.abs(drawn - want) > 0.12 ? '   <-- MISMATCH' : '';
    if (x === -2 || x === 0 || x === 2) console.log(`  z ${z}  x ${x}  drawn ${drawn === -Infinity ? '   -   ' : drawn.toFixed(2)}  phys ${phys.toFixed(2)}  want ${want.toFixed(2)} top #${seen}${flag}`);
  }
}
