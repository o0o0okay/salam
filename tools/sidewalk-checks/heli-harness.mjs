/* Builds a runnable copy of js/helicopter.js (with js/heliLight.js inlined) against tiny THREE stubs, so the
   air unit's real per-frame update can be driven in Node: which way the searchlight ends up pointing, what
   colour it is, and whether anything goes non-finite.
   Usage: node tools/sidewalk-checks/run.mjs   (see the "police air unit" section) */
import fs from 'fs';
import os from 'os';
import path from 'path';
import url from 'url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

export function build() {
  // the lightweight module goes in first: helicopter.js uses AIM_Y in its own top-level code
  const light = fs.readFileSync(path.join(repo, 'js/heliLight.js'), 'utf8').replace(/^export /gm, '');
  const heli = fs.readFileSync(path.join(repo, 'js/helicopter.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '');

  const stubs = `
const probe = { nan: 0 };
class Vec3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setFromUnitVectors(a,b){this.x=b.x;this.y=b.y;this.z=b.z;return this;} }
class Color { constructor(hex){this.hex=hex;this.r=0;this.g=0;this.b=0;}
  setHex(hex){ if(!Number.isFinite(hex)) probe.nan++; this.hex=hex; this.r=(hex>>16)&255; this.g=(hex>>8)&255; this.b=hex&255; return this; } }
class Obj3D { constructor(){ this.children=[]; this.userData={}; this.position=new Vec3(); this.rotation=new Vec3(); this.scale=new Vec3(1,1,1); this.quaternion=new Vec3(); this.visible=true; }
  add(...o){ this.children.push(...o); return this; }
  traverse(f){ f(this); for(const c of this.children) if(c.traverse) c.traverse(f); } }
class Mesh extends Obj3D { constructor(g,m){ super(); this.isMesh=true; this.geometry=g; this.material=m; } }
class SpotLight extends Obj3D { constructor(color,intensity,distance,angle,penumbra,decay){ super();
  this.color=new Color(color); this.intensity=intensity; this.distance=distance; this.angle=angle; this.penumbra=penumbra; this.decay=decay; this.target=null; this.castShadow=false; } }
class MeshBasicMaterial { constructor(o={}){ Object.assign(this,o); if(!(this.color instanceof Color)) this.color=new Color(this.color||0xffffff); } }
const THREE={ Group:Obj3D, Object3D:Obj3D, Mesh, SpotLight, ConeGeometry:class{constructor(...a){this.args=a;}},
  MeshBasicMaterial, Vector3:Vec3, Color };
const scene={ add(){}, };
const mat=(c)=>({ color:c, clone(){return this;}, dispose(){} });
const box=(w,h,d,m,x,y,z)=>{ const g=new Mesh(null,m); g.pos=[x||0,y||0,z||0]; g.castShadow=!!m; return g; };
const cyl=(rt,rb,h,s,m,x,y,z)=>box(rt*2,h,rb*2,m,x,y,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const game={ t:0 };
const player={ x:0, z:0, h:0, vx:0, vz:0, speed:0 };
const sight={ x:0, z:0, vx:0, vz:0, t:-99, heliLock:0, heliOn:false, lostFlag:false };
const reportSighting=()=>{ sight.x=player.x; sight.z=player.z; sight.vx=player.vx; sight.vz=player.vz; sight.t=game.t; };
const DIFF={ aggr:1 };
const HELI_V=52;
const env={ phase:0.15, day:1, night:1 };
const toast=()=>{};
`;

  const out = stubs + '\n' + light + '\n' + heli +
    '\nexport { ensureHelicopter, setHelicopterVisible, updateHelicopter, helicopter, game, player, sight, env, probe };\n';
  const file = path.join(os.tmpdir(), 'salam-heli.test.mjs');
  fs.writeFileSync(file, out);
  return file;
}

export const heliModulePath = build();
