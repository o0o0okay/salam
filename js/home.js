/* Premium Home / Garage - AAA style - renders 3D car preview */
import * as THREE from 'three';
import { buildCar } from './carModels.js';
import { $ } from './utils.js';

const CARS = [
  { id:'player', label:'DRIFT KING', sub:'CROWN VIC • LV1', color:0xffc21a, kind:'player', price:0, owned:true },
  { id:'charger', label:'STREET KING', sub:'CHARGER • LV5', color:0x0b0f15, kind:'player', price:45000, owned:false },
  { id:'suv', label:'ROAD BEAST', sub:'EXPLORER • LV10', color:0x1e3a5a, kind:'player', price:85000, owned:false },
  { id:'bearcat', label:'IRON GIANT', sub:'BEARCAT • LV20', color:0x27303a, kind:'player', price:150000, owned:false },
];

let idx = 0;
let renderer, scene, camera, carMesh, raf;

function loadState(){
  try { idx = Number(localStorage.getItem('escape_road_garage_idx')||0); } catch(e){}
}
function saveState(){
  try { localStorage.setItem('escape_road_garage_idx', String(idx)); } catch(e){}
}

function updateUI(){
  const c = CARS[idx];
  $('homeCarName').textContent = c.label;
  $('homeCarModel').textContent = c.sub;
  $('homeCarDesc').textContent = c.owned ? 'READY TO DRIVE' : `BUY FOR $${c.price.toLocaleString()}`;
  $('homeCarLV').textContent = c.owned ? '20' : '—';
  $('statLV').textContent = c.owned ? '20' : '1';
  $('statPower').textContent = c.owned ? '24' : '12';
  $('homeATK').textContent = c.owned ? '48' : '28';
  // dots
  const dots = $('carDots'); dots.innerHTML = '';
  CARS.forEach((_,i)=>{
    const d = document.createElement('i'); if(i===idx) d.className='on'; dots.appendChild(d);
  });
  // buttons
  const btn = $('btnLevelUp');
  if(!c.owned){
    btn.innerHTML = `🛒 BUY $${c.price.toLocaleString()}`;
    btn.style.background = 'linear-gradient(180deg,#7dff7a,#27c93f)';
  } else {
    btn.innerHTML = `<span class="act-ico">⬆⚙</span> LEVEL UP`;
    btn.style.background = '';
  }
  // currency
  const cash = Number(localStorage.getItem('escape_road_cash')||45069);
  $('homeCash').textContent = cash.toLocaleString();
  $('botCash').textContent = cash.toLocaleString();
  $('homeGold').textContent = (74856).toLocaleString();
  $('botStar').textContent = (74856).toLocaleString();
}

function initPreview(){
  const canvas = $('homeCarCanvas');
  if(!canvas) return;
  renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, canvas.width/canvas.height, 0.1, 100);
  camera.position.set(4.2, 2.1, 6.0);
  camera.lookAt(0,0.6,0);
  const light = new THREE.DirectionalLight(0xffffff, 1.15);
  light.position.set(5,8,4); light.castShadow=true;
  scene.add(light);
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x0a1a2a, 0.85));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2,32), new THREE.MeshStandardMaterial({ color:0x0a1e3a, roughness:0.85, metalness:0.05 }));
  ground.rotation.x = -Math.PI/2; ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  function resize(){
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 640, h = rect.height || 360;
    renderer.setSize(w,h,false);
    camera.aspect = w/h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  let t=0;
  const animate = ()=>{
    raf = requestAnimationFrame(animate);
    t+=0.012;
    if(carMesh) carMesh.rotation.y = Math.sin(t*0.35)*0.18;
    renderer.render(scene, camera);
  };
  animate();
}

function setCar(i){
  idx = (i+CARS.length)%CARS.length;
  saveState(); updateUI();
  if(!scene) return;
  if(carMesh) scene.remove(carMesh);
  const c = CARS[idx];
  // build player car with chosen color
  const g = buildCar(c.kind, c.color, true);
  g.scale.setScalar(0.95);
  g.position.y = 0.05;
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }});
  carMesh = g;
  scene.add(carMesh);
}

export function initHome(){
  loadState();
  // diff buttons
  try{ const diffKey = localStorage.getItem('escape_road_diff')||'normal'; document.querySelectorAll('#diffPick button').forEach(b=>b.classList.toggle('sel', b.dataset.d===diffKey)); }catch(e){}
  updateUI();
  initPreview();
  setCar(idx);

  $('carPrev').addEventListener('click',()=>setCar(idx-1));
  $('carNext').addEventListener('click',()=>setCar(idx+1));
  // swipe
  let sx=0;
  $('heroStage').addEventListener('touchstart', e=>{ sx=e.touches[0].clientX; }, {passive:true});
  $('heroStage').addEventListener('touchend', e=>{
    const dx = e.changedTouches[0].clientX - sx;
    if(Math.abs(dx)>40) setCar(idx + (dx<0?1:-1));
  });

  $('btnLevelUp').addEventListener('click',()=>{
    const c = CARS[idx];
    if(!c.owned){
      let cash = Number(localStorage.getItem('escape_road_cash')||45069);
      if(cash >= c.price){
        cash -= c.price;
        localStorage.setItem('escape_road_cash', String(cash));
        c.owned = true;
        try{ localStorage.setItem('escape_road_owned_'+c.id,'1'); }catch(e){}
        updateUI();
        // toast
        const el=document.createElement('div'); el.className='toast'; el.textContent='PURCHASED '+c.label; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1500);
      } else {
        const el=document.createElement('div'); el.className='toast'; el.textContent='NOT ENOUGH CASH'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1500);
      }
    } else {
      const el=document.createElement('div'); el.className='toast'; el.textContent='LEVEL UP! POWER +2'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1500);
      // bump stats
      const p = Number($('statPower').textContent)||24;
      $('statPower').textContent = String(p+2);
      $('homeATK').textContent = String(Number($('homeATK').textContent)+2);
      $('statLV').textContent = String(Number($('statLV').textContent)+1);
      $('homeCarLV').textContent = String(Number($('homeCarLV').textContent)+1);
    }
  });

  // gear slots toast
  document.querySelectorAll('.gear-slot').forEach(b=>{
    b.addEventListener('click',()=>{
      const s=b.dataset.slot;
      if(b.classList.contains('lock')){
        const el=document.createElement('div'); el.className='toast'; el.textContent='LOCKED — REACH LV 10'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1400);
      } else {
        const el=document.createElement('div'); el.className='toast'; el.textContent=s.toUpperCase()+' EQUIPPED'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1400);
      }
    });
  });

  // tabs
  document.querySelectorAll('.foot-tab').forEach(t=>{
    t.addEventListener('click',()=>{
      document.querySelectorAll('.foot-tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const tab=t.dataset.tab;
      if(tab!=='garage'){
        const el=document.createElement('div'); el.className='toast'; el.textContent=tab.toUpperCase()+' COMING SOON'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1400);
      }
    });
  });

  document.addEventListener('visibilitychange',()=>{ if(document.hidden) cancelAnimationFrame(raf); });

  // load owned
  CARS.forEach(c=>{
    try{ if(localStorage.getItem('escape_road_owned_'+c.id)==='1') c.owned=true; }catch(e){}
  });
  updateUI();
}
