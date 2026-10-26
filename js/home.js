/* Cartoon Home — like reference photo, NOT game low-poly */
import { $ } from './utils.js';

const CARS = [
  { id:'muscle', label:'STREET KING', sub:'MUSCLE • LV1', img:'images/mockup-home-cartoon.png', filter:'none', price:0, owned:true },
  { id:'crown', label:'INTERCEPTOR', sub:'CROWN VIC • LV5', img:'images/mockup-home-cartoon.png', filter:'hue-rotate(180deg) brightness(0.95)', price:35000, owned:false },
  { id:'charger', label:'ROAD BEAST', sub:'CHARGER • LV10', img:'images/mockup-home-cartoon.png', filter:'hue-rotate(90deg) saturate(1.3)', price:75000, owned:false },
  { id:'suv', label:'IRON GIANT', sub:'BEARCAT • LV20', img:'images/mockup-home-cartoon.png', filter:'hue-rotate(260deg) brightness(0.9)', price:150000, owned:false },
];

let idx = 0;

function loadState(){
  try { idx = Number(localStorage.getItem('escape_road_garage_idx')||0); } catch(e){}
  CARS.forEach(c=>{ try{ if(localStorage.getItem('escape_road_owned_'+c.id)==='1') c.owned=true; }catch(e){} });
}
function saveState(){
  try { localStorage.setItem('escape_road_garage_idx', String(idx)); } catch(e){}
}

function updateUI(){
  const c = CARS[idx];
  // dots
  const dots = $('carDots'); if(dots){ dots.innerHTML=''; CARS.forEach((_,i)=>{ const d=document.createElement('i'); if(i===idx) d.className='on'; dots.appendChild(d); }); }
  const btn = $('btnLevelUp');
  if(btn){
    if(!c.owned) btn.textContent = `🛒 BUY $${c.price.toLocaleString()}`;
    else btn.textContent = `⬆ LEVEL UP`;
  }
  const cash = Number(localStorage.getItem('escape_road_cash')||12450);
  const elCash = $('homeCash'); if(elCash) elCash.textContent = cash.toLocaleString();
  const bot = $('botCash'); if(bot) bot.textContent = cash.toLocaleString();
  const gc = $('homeGem'); if(gc) gc.textContent = '320';
}

function setCar(i){
  idx = (i+CARS.length)%CARS.length;
  saveState(); updateUI();
  const c = CARS[idx];
  const canvas = $('homeCarCanvas');
  const img = $('homeCarImg');
  // Use cartoon image via canvas draw (crop center car)
  if(canvas){
    const ctx = canvas.getContext('2d');
    const carImg = new Image();
    carImg.src = c.img;
    carImg.onload = ()=>{
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0,0,w,h);
      // draw full mockup centered and zoomed to show car
      // mockup is 1024x576 approx, car is center
      ctx.save();
      ctx.filter = c.filter;
      // crop: show center 70% of mockup
      const iw = carImg.width, ih = carImg.height;
      const scale = Math.min(w/iw, h/ih) * 1.55;
      const dw = iw*scale, dh = ih*scale;
      ctx.drawImage(carImg, (w-dw)/2, (h-dh)/2 + 10, dw, dh);
      ctx.restore();
      // sparkle overlay
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(w*0.72, h*0.28, 4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(w*0.18, h*0.72, 3, 0, Math.PI*2); ctx.fill();
    };
  }
  if(img){ img.src = c.img; img.style.filter = c.filter; }
}

export function initHome(){
  loadState();
  try{ const diffKey = localStorage.getItem('escape_road_diff')||'normal'; document.querySelectorAll('#diffPick button').forEach(b=>b.classList.toggle('sel', b.dataset.d===diffKey)); }catch(e){}
  updateUI();
  setCar(idx);

  $('carPrev')?.addEventListener('click',()=>setCar(idx-1));
  $('carNext')?.addEventListener('click',()=>setCar(idx+1));

  let sx=0;
  const stage = $('heroStage') || document.querySelector('.cartoon-stage');
  stage?.addEventListener('touchstart', e=>{ sx=e.touches[0].clientX; }, {passive:true});
  stage?.addEventListener('touchend', e=>{
    const dx = e.changedTouches[0].clientX - sx;
    if(Math.abs(dx)>40) setCar(idx + (dx<0?1:-1));
  });

  $('btnLevelUp')?.addEventListener('click',()=>{
    const c = CARS[idx];
    if(!c.owned){
      let cash = Number(localStorage.getItem('escape_road_cash')||12450);
      if(cash >= c.price){
        cash -= c.price;
        localStorage.setItem('escape_road_cash', String(cash));
        c.owned = true;
        try{ localStorage.setItem('escape_road_owned_'+c.id,'1'); }catch(e){}
        updateUI();
        const el=document.createElement('div'); el.className='toast'; el.textContent='PURCHASED '+c.label; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1500);
      } else {
        const el=document.createElement('div'); el.className='toast'; el.textContent='NOT ENOUGH CASH 💰'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1500);
      }
    } else {
      const el=document.createElement('div'); el.className='toast'; el.textContent='LEVEL UP! +POWER'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1500);
    }
  });

  document.querySelectorAll('.lock-slot').forEach(b=>{
    b.addEventListener('click',()=>{
      const s=b.dataset.slot;
      const el=document.createElement('div'); el.className='toast'; el.textContent=s.toUpperCase()+' LOCKED — REACH LV 10 🔒'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1400);
    });
  });

  document.querySelectorAll('.cartoon-tab').forEach(t=>{
    t.addEventListener('click',()=>{
      document.querySelectorAll('.cartoon-tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const tab=t.dataset.tab;
      if(tab!=='garage'){
        const el=document.createElement('div'); el.className='toast'; el.textContent=tab.toUpperCase()+' COMING SOON ✨'; $('toasts')?.appendChild(el); setTimeout(()=>el.remove(),1400);
      }
    });
  });
}
