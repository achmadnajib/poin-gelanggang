let match,tick,poll;
const q=new URLSearchParams(location.search).get('code');
if(q)$('#code').value=q;

$('#displayForm').onsubmit=e=>{
  e.preventDefault();
  start($('#code').value);
  document.documentElement.requestFullscreen?.().catch(()=>{});
};
if(q)start(q);

function leaveDisplay(message){
  clearInterval(tick);
  clearInterval(poll);
  match=null;
  $('#screen').classList.add('hidden');
  $('#enter').classList.remove('hidden');
  toast(message||'Pertandingan tidak tersedia',true);
}

async function start(code){
  try{
    match=await api(`/api/public/match/${code}`);
    $('#enter').classList.add('hidden');
    $('#screen').classList.remove('hidden');
    render();
    clearInterval(tick);
    tick=setInterval(()=>{if(match)$('#displayTimer').textContent=fmt(clock(match))},100);
    clearInterval(poll);
    poll=setInterval(async()=>{
      try{
        match=await api(`/api/public/match/${code}`);
        render();
      }catch(error){
        leaveDisplay(error.message);
      }
    },700);
  }catch(error){
    leaveDisplay(error.message);
  }
}

function render(){
  const m=match;
  const winner=m.certified?(m.winner==='red'?m.red.name:m.winner==='blue'?m.blue.name:'SERI'):'';
  $('#screen').innerHTML=`<header class="display-head"><div class="display-brand">POIN <span style="color:var(--gold)">GELANGGANG</span></div><div style="text-align:center"><div class="round">BABAK ${m.round} / ${m.totalRounds}</div><div id="displayTimer" class="display-timer">${fmt(clock(m))}</div></div><div style="text-align:right"><b>GELANGGANG ${esc(m.arena)}</b><br><span class="badge ${m.status==='berlangsung'?'live':''}">${m.status.toUpperCase()}</span></div></header><main class="display-score"><section class="display-fighter red"><div class="name">${esc(m.red.name)}</div><div class="team">${esc(m.red.team)}</div><div class="bigscore">${m.red.score}</div><div>Teguran ${m.red.warnings} · Peringatan ${m.red.penalties}</div></section><section class="display-fighter blue"><div class="name">${esc(m.blue.name)}</div><div class="team">${esc(m.blue.team)}</div><div class="bigscore">${m.blue.score}</div><div>Teguran ${m.blue.warnings} · Peringatan ${m.blue.penalties}</div></section></main><footer class="display-foot">${winner?`PEMENANG · ${esc(winner)} · ${esc(m.victoryReason)}`:`PARTAI ${esc(m.boutNumber)} · ${esc(m.category)} · ${esc(m.className)}`}</footer>`;
}
