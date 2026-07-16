const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
const api=async(url,opt={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt});const data=r.headers.get('content-type')?.includes('json')?await r.json():null;if(!r.ok)throw new Error(data?.error||'Terjadi kesalahan');return data};
const fmt=ms=>{ms=Math.max(0,ms||0);const s=Math.ceil(ms/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};
const clock=m=>m.status==='berlangsung'&&m.timerStartedAt?Math.max(0,m.timerRemainingMs-(Date.now()-m.serverNow)):m.timer;
const toast=(text,bad=false)=>{const n=document.createElement('div');n.className='toast';n.style.background=bad?'#a52231':'';n.textContent=text;document.body.append(n);setTimeout(()=>n.remove(),1800)};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
if(!window.io)window.io=()=>({on(){},emit(){},close(){}});
