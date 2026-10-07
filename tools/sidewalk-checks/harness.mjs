/* Builds a runnable copy of js/world.js with tiny THREE stubs so chunk generation can be exercised in Node
   (no browser, no WebGL, no network). Writes the generated module to the OS temp dir and exports its path.
   Usage:  node tools/sidewalk-checks/run.mjs   (see run.mjs / plan.mjs and README.md) */
import fs from 'fs';
import os from 'os';
import path from 'path';
import url from 'url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

export function build() {
  // The Node stub reads the real dimension table out of js/carModels.js. If the stub guessed the numbers,
  // the suite would happily bless a "heavy" vehicle that the game treats as a shell.
  const carSrc = fs.readFileSync(path.join(repo, 'js/carModels.js'), 'utf8');
  const dimsMatch = carSrc.match(/export const CAR_DIMS = (\{[\s\S]*?\n\});/);
  if (!dimsMatch) throw new Error('harness: could not find the CAR_DIMS table in js/carModels.js');
  const REAL_DIMS = JSON.parse(JSON.stringify(eval('(' + dimsMatch[1] + ')')));

  let src = fs.readFileSync(path.join(repo, 'js/world.js'), 'utf8');
  src = src.replace(/^import .*$/gm, '').replace(/^export /gm, '');

  const stubs = `
const checked = { geom: 0, nan: 0 };
const swCapture = new Map();
class M4 { constructor(){this.s=[1,1,1];this.t=[0,0,0];} makeScale(x,y,z){this.s=[x,y,z];return this;} setPosition(x,y,z){this.t=[x,y,z];return this;} clone(){const m=new M4();m.s=this.s.slice();m.t=this.t.slice();return m;} }
function makeUV(n){const a=new Float32Array(n*2);return {array:a,needsUpdate:false,getX:i=>a[i*2],getY:i=>a[i*2+1],setXY(i,u,v){a[i*2]=u;a[i*2+1]=v;},count:n};}
function BoxGeometry(w=1,h=1,d=1){ this.attributes={uv:makeUV(24),position:{count:24}}; this.w=w;this.h=h;this.d=d;
  this.applyMatrix4=m=>{ const p=[m.s[0]*this.w/2,m.s[1]*this.h/2,m.s[2]*this.d/2];
    for (const v of p) if(!Number.isFinite(v)) checked.nan++;
    this.origin=[m.t[0],m.t[1],m.t[2]]; checked.geom++; return this; };
  this.clone=()=>{const g=new BoxGeometry(this.w,this.h,this.d);g.attributes=this.attributes;g.origin=this.origin;return g;};
  this.dispose=()=>{}; this.translate=()=>this; this.scale=()=>this; this.rotateX=()=>this; this.rotateY=()=>this; this.rotateZ=()=>this; }
class Obj3D { constructor(){this.children=[];this.userData={};this.pos=[0,0,0];this.visible=true;
    // numeric components matter: the parked-car behaviour reads .position.x/y/z and .rotation.y back
    const self=this;
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;self.pos=[x,y,z];}};
    this.rotation={x:0,y:0,z:0,order:'XYZ'};this.scale={x:1,y:1,z:1,set:()=>{},setScalar:()=>{}};this.quaternion={};this.matrixWorld=new M4();}
  add(...o){this.children.push(...o);for(const c of o)if(c)c.parent=this;return this;}
  traverse(f){f(this);for(const c of this.children)if(c.traverse)c.traverse(f);}
  updateMatrixWorld(){} remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);if(o)o.parent=null;} }
class Mesh extends Obj3D { constructor(g,m){super();this.isMesh=true;this.geometry=g;this.material=m;} }
class InstancedMesh extends Obj3D { constructor(g,m,n){super();this.geometry=g;this.material=m;this.count=n;this.instanceMatrix={needsUpdate:false};} setMatrixAt(){} dispose(){} }
const THREE={Group:Obj3D,Mesh,InstancedMesh,BoxGeometry,Matrix4:M4,
  Vector3:class{constructor(x,y,z){this.x=x;this.y=y;this.z=z;}set(){return this;}setFromAxisAngle(){return this;}multiply(){return this;}},
  Quaternion:class{setFromAxisAngle(){return this;}},Color:class{constructor(){}setRGB(){return this;}},
  MeshBasicMaterial:class{constructor(o){Object.assign(this,o||{});}},MeshLambertMaterial:class{constructor(o){Object.assign(this,o||{});}},
  CylinderGeometry:BoxGeometry,SphereGeometry:BoxGeometry,ConeGeometry:BoxGeometry,PlaneGeometry:BoxGeometry,CircleGeometry:BoxGeometry,LatheGeometry:BoxGeometry};
const scene=new THREE.Group();
function mergeGeometries(geos){ if(!geos||!geos.length) return null; for(const g of geos){ if(!g.origin||g.origin.some(v=>!Number.isFinite(v))) checked.nan++; } return {dispose(){}, geos}; }
const mat=(c,o)=>({c,o,clone(){return {...this};},dispose(){}});
const box=(w,h,d,m,x,y,z,cast)=>{const g=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);g.castShadow=cast;g.pos=[x||0,y||0,z||0];return g;};
const cyl=(rt,rb,h,s,m,x,y,z)=>{const r=((rt||1)+(rb||1))/2;const g=new THREE.Mesh(new THREE.BoxGeometry(r*2,h,r*2),m);g.castShadow=true;g.pos=[x||0,y||0,z||0];g.round=true;return g;};
const ASSET=new Proxy({windowMats:[{},{},{},{},{},{},{},{}],roofMat:{},pavingMat:{},pavePanelMat:{},paveBrickMat:{},borderMat:{},curbTopMat:{},curbPaintMat:{},curbMat:{},soilMat:{},grassMat:{},roadMat:{},snowRoadMat:{},lampMat:{},coinMat:{},burnt:{},headMat:{},tailMat:{},beamMat:{},spikeMat:{},spikeLit:{},treeMat:{}},
  {get:(t,k)=>k in t?t[k]:(String(k).endsWith('Geo')?new THREE.BoxGeometry(1,1,1):{})});
const makeBuildingGeo=()=>new THREE.BoxGeometry(1,1,1);
const KNOWN_KINDS=new Set(['player','police1','police2','police3','police4','police5','policeMoto','policeUnmarked','policeVan','civ','sedan','taxi','pickup','bus','hatchback','suv','van','sportscar','oldclassic','limo','cementtruck','fueltanker','ambulance','firetruck','firesmall']);
const REAL_DIMS=${JSON.stringify(REAL_DIMS)};
const CAR_DIMS=new Proxy({},{get:(t,k)=>KNOWN_KINDS.has(k)?(REAL_DIMS[k]||{e1:2,e2:1,mass:1,hp:40}):undefined});
// strict on purpose: buildCar(undefined) used to slip through a permissive stub and only blew up in the
// browser, where it froze the whole frame loop.
const buildCar=(kind)=>{ if(!KNOWN_KINDS.has(kind)) throw new Error('buildCar() called with an unknown kind: '+kind); const g=new THREE.Group();g.userData={inner:new THREE.Group(),lights:{}};return g;};
const PROP_DEFS=new Proxy({},{get:()=>({r:0.6,drag:0.95,color:0xffffff,make:()=>new THREE.Group()})});
const TREE_VARIANTS=[{},{},{},{},{},{}]; const setTreeMatrix=()=>{};
const buildIntersection=()=>{}; const removeIntersection=()=>{};
const CHUNK=80, VIEW_R=2, PI=Math.PI;
const env={phase:0.15,day:1,night:0,dusk:0,sx:0.5,sy:1};   // same shape as environment.js
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mulberry32=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const hash2=(x,y)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))|0;h=Math.imul(h^(h>>>13),1274126177);return(h^(h>>>16))>>>0;};
const ck=(cx,cz)=>cx*100003+cz;
`;

  src = src.replace('  bakeRing(sw.curb', '  swCapture.set(ch, sw);\n  bakeRing(sw.curb');
  const out = stubs + '\n' + src +
    '\nexport { chunks, updateChunks, nearChunks, solidAt, disposeChunk, generateChunk, addParkedCarToChunk, sidewalkPieces, treePit, SIDEWALK_SIDES, SW_STYLES, pickSidewalkStyle, CHUNK, PAVE_IN, PAVE_OUT, CURB_H, WALK_Y, BORDER_W, KERB_W, BED, BED_EDGE, PIT_IN, ck, lotCars, ambulanceTarget, RELIEF_DELAY, HEAVY_MASS, isHeavyParked, parkedShove, parkedDamage, CAR_DIMS, buildHospitalMesh, buildFireStationMesh, buildAirAmbulance, FONT3D, textBlocks };\n' +
    'export const __checked = checked;\nexport { swCapture };\n';
  const file = path.join(os.tmpdir(), 'salam-world.test.mjs');
  fs.writeFileSync(file, out);
  return file;
}

export const modulePath = build();
