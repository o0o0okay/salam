/* Tumbling debris: the loose props and whole cars that an impact launched into the air.
   Split out of update.js so the ground rule below can be tested on its own — it is what keeps a spinning
   car's nose and tail out of the asphalt on the way over. */
import { scene } from './renderer.js';
import { flying } from './state.js';

// How high a tumbling prop must ride so nothing it owns dips into the road.
//
// A launched car is parented to a pivot that sits at the body centre, so its own centre hangs `down` metres
// below the pivot, its roof rises `up` above it, and its body reaches `hz` along the length and `hx` across.
// For Euler order YXZ (yaw last, so it does not affect heights) the world height of a local point is
//     cx*sz*x + cx*cz*y - sx*z      with cx=cos(rot.x), sx=sin(rot.x), cz=cos(rot.z), sz=sin(rot.z)
// and the lowest corner of that box is exactly the reach below, so the pivot has to ride `0.2 + reach`.
// Props with no `probe` keep the old flat floor.
export function flyingFloor(rot, probe) {
  if (!probe) return 0.2;
  const { hx = 0, up = 0, down = 0, hz = 0 } = probe;
  const cx = Math.cos(rot.x), sx = Math.sin(rot.x), cz = Math.cos(rot.z), sz = Math.sin(rot.z);
  const lean = cx * cz;                                    // how much of the body's height points up
  const reach = Math.abs(cx * sz) * hx + (lean >= 0 ? down * lean : up * -lean) + Math.abs(sx) * hz;
  return 0.2 + Math.max(0, reach);
}

export function updateFlying(sdt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i]; f.life -= sdt; f.vy -= 28 * sdt; const m = f.mesh;
    m.position.x += f.vx * sdt; m.position.y += f.vy * sdt; m.position.z += f.vz * sdt; m.rotation.x += f.sx * sdt; m.rotation.z += f.sz * sdt;
    const floorY = flyingFloor(m.rotation, f.probe);
    if (m.position.y < floorY) { m.position.y = floorY; f.vy *= -0.3; f.vx *= 0.8; f.vz *= 0.8; f.sx *= 0.6; f.sz *= 0.6; }
    if (f.life <= 0) { scene.remove(m); flying.splice(i, 1); }
  }
}
