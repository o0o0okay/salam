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
  // The interchange's numbers live in their own module (js/flyover.js, no three.js in it) and js/world.js imports
  // them: the stitched module needs its source in front of world.js, the same way the browser gets it.
  let flySrc = fs.readFileSync(path.join(repo, 'js/flyover.js'), 'utf8');
  flySrc = flySrc.replace(/^import .*$/gm, '').replace(/^export /gm, '');
  src = flySrc + '\n' + src;
  // ... and so do the traffic lights: the placement of a junction's signal poles depends on the lane beside a
  // flyover, so the suite has to run the real thing. A stub here used to hide a pole standing in the at-grade
  // lane (it was only a no-op, so nothing could ever notice).
  let lightSrc = fs.readFileSync(path.join(repo, 'js/trafficLights.js'), 'utf8');
  lightSrc = lightSrc.replace(/^import .*$/gm, '').replace(/^export /gm, '');
  src = lightSrc + '\n' + src;

  const stubs = `
// geom counts merged pieces, geosCreated/geosDisposed count BufferGeometry objects: one block must not leave
// its geometries behind when it streams out (see the ownership check in run.mjs).
const checked = { geom: 0, nan: 0, geosCreated: 0, geosDisposed: 0 };
const swCapture = new Map();
class M4 { constructor(){this.s=[1,1,1];this.t=[0,0,0];this.r=0;} makeScale(x,y,z){this.s=[x,y,z];return this;}
  // A Y rotation about the piece's own centre: the chamfered pavement corners turn 45°, and the audit has to
  // see the footprint they really cover, so applyMatrix4 folds the rotation into the box's own extents.
  makeRotationY(a){this.r=a;return this;} premultiply(m){this.r+=m.r||0;return this;}
  setPosition(x,y,z){this.t=[x,y,z];return this;} clone(){const m=new M4();m.s=this.s.slice();m.t=this.t.slice();m.r=this.r;return m;} }
function makeUV(n){const a=new Float32Array(n*2);return {array:a,needsUpdate:false,getX:i=>a[i*2],getY:i=>a[i*2+1],setXY(i,u,v){a[i*2]=u;a[i*2+1]=v;},count:n};}
function BoxGeometry(w=1,h=1,d=1){ checked.geosCreated++; this.attributes={uv:makeUV(24),position:{count:24}}; this.w=w;this.h=h;this.d=d;
  // The matrix carries the box's own size when the caller scaled a unit box (that is how the sidewalk rings are
  // baked), so the geometry's extents have to take the scale with it: the audit reads w/h/d as the piece's real
  // footprint, and a piece that kept 1x1x1 would look like it could sit anywhere.
  this.applyMatrix4=m=>{ this.w*=m.s[0]; this.h*=m.s[1]; this.d*=m.s[2];
    // A rotated piece (a chamfered corner) keeps its own extents and reports its angle: the audits have to test
    // the box it really is, and a bounding box would claim it covers the lane beside the structure.
    if (m.r) this.rot=m.r;
    const p=[this.w/2,this.h/2,this.d/2];
    for (const v of p) if(!Number.isFinite(v)) checked.nan++;
    this.origin=[m.t[0],m.t[1],m.t[2]]; checked.geom++; return this; };
  this.clone=()=>{const g=new BoxGeometry(this.w,this.h,this.d);g.attributes=this.attributes;g.origin=this.origin;return g;};
  this.dispose=()=>{ checked.geosDisposed++; this.__disposed = true; }; this.translate=()=>this; this.scale=()=>this; this.rotateX=()=>this; this.rotateY=()=>this; this.rotateZ=()=>this; }
class Obj3D { constructor(){this.children=[];this.userData={};this.pos=[0,0,0];this.visible=true;
    // numeric components matter: the parked-car behaviour reads .position.x/y/z and .rotation.y back
    const self=this;
    // A mesh's own position goes into its world matrix: bake() reads matrixWorld back, so without this every
    // baked piece would claim to stand at the block's own origin.
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;self.pos=[x,y,z];self.matrixWorld.t=[x,y,z];}};
    this.rotation={x:0,y:0,z:0,order:'XYZ'};this.scale={x:1,y:1,z:1,set:()=>{},setScalar:()=>{}};this.quaternion={};this.matrixWorld=new M4();}
  add(...o){this.children.push(...o);for(const c of o)if(c)c.parent=this;return this;}
  traverse(f){f(this);for(const c of this.children)if(c.traverse)c.traverse(f);}
  updateMatrixWorld(){ const p=[0,0,0]; for(let o=this;o;o=o.parent){ const q=o.pos||[0,0,0]; p[0]+=q[0];p[1]+=q[1];p[2]+=q[2]; } this.matrixWorld.t=p; for(const c of this.children) if(c.updateMatrixWorld) c.updateMatrixWorld(); }
  remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);if(o)o.parent=null;} }
class Mesh extends Obj3D { constructor(g,m){super();this.isMesh=true;this.geometry=g;this.material=m;} }
class InstancedMesh extends Obj3D { constructor(g,m,n){super();this.geometry=g;this.material=m;this.count=n;this.instanceMatrix={needsUpdate:false};} setMatrixAt(){} dispose(){} }
const THREE={Group:Obj3D,Mesh,InstancedMesh,BoxGeometry,Matrix4:M4,
  Vector3:class{constructor(x,y,z){this.x=x;this.y=y;this.z=z;}set(){return this;}setFromAxisAngle(){return this;}multiply(){return this;}},
  Quaternion:class{setFromAxisAngle(){return this;}},
  Color:class{constructor(c){this.h=c|0;}setHex(v){this.h=v;return this;}getHex(){return this.h;}setRGB(){return this;}},
  MeshBasicMaterial:class{constructor(o){const c=(o&&o.color);Object.assign(this,o||{});if(c!==undefined)this.color=new THREE.Color(c);}dispose(){}},
  MeshLambertMaterial:class{constructor(o){const c=(o&&o.color);Object.assign(this,o||{});if(c!==undefined)this.color=new THREE.Color(c);}dispose(){}},
  CylinderGeometry:BoxGeometry,SphereGeometry:BoxGeometry,ConeGeometry:BoxGeometry,PlaneGeometry:BoxGeometry,CircleGeometry:BoxGeometry,LatheGeometry:BoxGeometry};
const scene=new THREE.Group();
// the merged result has to behave like a BufferGeometry: js/world.js shares merged text geometries between
// signs and the chunk/prop mergers clone them, exactly as three.js would
const __merge = { geos: 0, calls: 0 };
function mergeGeometries(geos){ if(!geos||!geos.length) return null; __merge.geos += geos.length; __merge.calls++; for(const g of geos){ if(!g.origin||g.origin.some(v=>!Number.isFinite(v))) checked.nan++; }
  const out = { dispose(){ checked.geosDisposed++; this.__disposed = true; }, geos, origin:[0,0,0] };
  out.clone = () => { const c = { dispose(){ checked.geosDisposed++; this.__disposed = true; }, geos: out.geos, origin: out.origin.slice() }; c.clone = out.clone; c.applyMatrix4 = m => { c.origin = [m.t[0], m.t[1], m.t[2]]; return c; }; c.translate = () => c; return c; };
  out.applyMatrix4 = m => { out.origin = [m.t[0], m.t[1], m.t[2]]; return out; };
  return out; }
const mat=(c,o)=>({c,o,clone(){return {...this};},dispose(){}});
const box=(w,h,d,m,x,y,z,cast)=>{const g=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);g.castShadow=cast;g.pos=[x||0,y||0,z||0];return g;};
const cyl=(rt,rb,h,s,m,x,y,z)=>{const r=((rt||1)+(rb||1))/2;const g=new THREE.Mesh(new THREE.BoxGeometry(r*2,h,r*2),m);g.castShadow=true;g.pos=[x||0,y||0,z||0];g.round=true;return g;};
const ASSET=new Proxy({windowMats:[{},{},{},{},{},{},{},{}],roofMat:{},pavingMat:{},pavePanelMat:{},paveBrickMat:{},borderMat:{},curbTopMat:{},curbPaintMat:{},curbMat:{},soilMat:{},grassMat:{},roadMat:{},snowRoadMat:{},lampMat:{},coinMat:{},burnt:{},headMat:{},tailMat:{},beamMat:{},spikeMat:{},spikeLit:{},treeMat:{}},
  {get:(t,k)=>k in t?t[k]:(String(k).endsWith('Geo')?new THREE.BoxGeometry(1,1,1):{})});
const makeBuildingGeo=()=>new THREE.BoxGeometry(1,1,1);
const facadeMat=(c,windows)=>({c,o:{windows},clone(){return {...this};},dispose(){}});
const KNOWN_KINDS=new Set(['player','police1','police2','police3','police4','police5','policeMoto','policeUnmarked','policeVan','civ','sedan','taxi','pickup','bus','schoolbus','hatchback','suv','van','sportscar','oldclassic','limo','cementtruck','fueltanker','ambulance','firetruck','firesmall']);
const REAL_DIMS=${JSON.stringify(REAL_DIMS)};
const CAR_DIMS=new Proxy({},{get:(t,k)=>KNOWN_KINDS.has(k)?(REAL_DIMS[k]||{e1:2,e2:1,mass:1,hp:40}):undefined});
// strict on purpose: buildCar(undefined) used to slip through a permissive stub and only blew up in the
// browser, where it froze the whole frame loop.
const buildCar=(kind)=>{ if(!KNOWN_KINDS.has(kind)) throw new Error('buildCar() called with an unknown kind: '+kind); const g=new THREE.Group();g.userData={inner:new THREE.Group(),lights:{}};return g;};
// Street props: the real defs live in js/props.js, which this harness replaces. Give the stand-in a body of
// two boxes so a prop behaves like the real thing for the merge/ownership checks (an empty group produced no
// geometry at all, which hid half the chunk-ownership story).
const PROP_DEFS=new Proxy({},{get:()=>({r:0.6,drag:0.95,color:0xffffff,make:()=>{const g=new THREE.Group();g.add(box(0.5,1,0.5,mat(0xffffff),0,0.5,0));g.add(box(0.6,0.2,0.6,mat(0x808080),0,1.05,0));return g;}})});
const TREE_VARIANTS=[{},{},{},{},{},{}]; const setTreeMatrix=()=>{};
const CHUNK=80, VIEW_R=2, PI=Math.PI;
const env={phase:0.15,day:1,night:0,dusk:0,sx:0.5,sy:1};   // same shape as environment.js
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const mulberry32=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const hash2=(x,y)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))|0;h=Math.imul(h^(h>>>13),1274126177);return(h^(h>>>16))>>>0;};
const ck=(cx,cz)=>cx*100003+cz;
`;

  src = src.replace('  bakeRing(sw.curb', '  swCapture.set(ch, sw);\n  bakeRing(sw.curb');
  const out = stubs + '\n' + src +
    '\nexport { buildIntersection, removeIntersection, updateTrafficLights, lightGo, chunks, updateChunks, flushChunk, warmTextCache, nearChunks, solidAt, disposeChunk, generateChunk, addParkedCarToChunk, sidewalkPieces, treePit, SIDEWALK_SIDES, SW_STYLES, pickSidewalkStyle, CHUNK, PAVE_IN, PAVE_OUT, PAD_IN, CURB_H, WALK_Y, BORDER_W, KERB_W, BED, BED_EDGE, PIT_IN, ck, lotCars, ambulanceTarget, RELIEF_DELAY, HEAVY_MASS, isHeavyParked, parkedShove, parkedDamage, CAR_DIMS, buildFuelStationMesh, FUEL_BRANDS, SHOP_TYPES, buildShopFrontMesh, buildShopParadeMesh, PARADE_TITLES, buildHospitalMesh, buildFireStationMesh, buildSchoolMesh, buildAirAmbulance, FONT3D, textBlocks, FLY, RAMP_RUN, RAMP_SLOPE, rampHeight, surfaceAt, insideFootprint, flyoverQuadrants, flyoverNear, nodeAt, nearestNode, nodeBlock, alongOf, latOf, isFlyoverNode, besideFlyover, stripStops, parapetPush, roadEdge, atGradeSide, onAtGradeLane, laneOffsetOn, laneOffset, rampApproach, rampExit, laneAim };\n' +
    'export const __checked = checked;\nexport { __merge };\nexport { swCapture };\n';
  const file = path.join(os.tmpdir(), 'salam-world.test.mjs');
  fs.writeFileSync(file, out);
  return file;
}

export const modulePath = build();
