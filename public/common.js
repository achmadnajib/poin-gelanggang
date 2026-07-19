const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
const api=async(url,opt={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt});const data=r.headers.get('content-type')?.includes('json')?await r.json():null;if(!r.ok)throw new Error(data?.error||'Terjadi kesalahan');return data};
const fmt=ms=>{ms=Math.max(0,ms||0);const s=Math.ceil(ms/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};
const clock=m=>m.status==='berlangsung'&&m.timerStartedAt?Math.max(0,m.timer-(Date.now()-m.serverNow)):m.timer;
const toast=(text,bad=false)=>{const n=document.createElement('div');n.className='toast';n.style.background=bad?'#a52231':'';n.textContent=text;document.body.append(n);setTimeout(()=>n.remove(),1800)};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
if(!window.io)window.io=()=>({on(){},emit(){},close(){}});
const penaltyStyles=document.createElement('link');penaltyStyles.rel='stylesheet';penaltyStyles.href='/penalties.css';document.head.append(penaltyStyles);
const penaltyTrack=state=>{state=state||{binaan:0,teguran:0,peringatan:0,disqualified:false};const items=[['BI',state.binaan>=1,'binaan'],['BII',state.binaan>=2,'binaan'],['TI',state.teguran>=1,'teguran'],['TII',state.teguran>=2,'teguran'],['PI',state.peringatan>=1,'peringatan'],['PII',state.peringatan>=2,'peringatan'],['DQ',state.disqualified,'dq']];return `<div class="penalty-track">${items.map(([label,on,kind])=>`<span class="penalty-step ${on?`active ${kind}`:''}"><i></i>${label}</span>`).join('<b>→</b>')}</div>`};
let soundContext;
function enableSound(){try{soundContext=soundContext||new (window.AudioContext||window.webkitAudioContext)();soundContext.resume()}catch{}}
function penaltySound(urgent=false){try{enableSound();const oscillator=soundContext.createOscillator(),gain=soundContext.createGain();oscillator.frequency.value=urgent?220:660;gain.gain.value=.08;oscillator.connect(gain);gain.connect(soundContext.destination);oscillator.start();oscillator.stop(soundContext.currentTime+(urgent ? 0.35 : 0.14))}catch{}}
