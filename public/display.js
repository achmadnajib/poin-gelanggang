let match,tick,poll,lastPenaltySignature='',displayKey='';
const displayParams=new URLSearchParams(location.search),q=displayParams.get('code'),initialDisplayKey=displayParams.get('key')||'';
if(q)$('#code').value=q;

$('#displayForm').onsubmit=e=>{
  e.preventDefault();
  enableSound();
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
    match=await api(`/api/public/match/${code}${initialDisplayKey?`?key=${encodeURIComponent(initialDisplayKey)}`:''}`);
    displayKey=match.displayKey;
    $('#enter').classList.add('hidden');
    $('#screen').classList.remove('hidden');
    render();
    clearInterval(tick);
    tick=setInterval(()=>{if(match)$('#displayTimer').textContent=fmt(clock(match))},100);
    clearInterval(poll);
    poll=setInterval(async()=>{
      try{
        match=await api(`/api/public/match/${code}?key=${encodeURIComponent(displayKey)}`);
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
  const penaltySignature=JSON.stringify([m.red.penaltyState,m.blue.penaltyState]);
  if(lastPenaltySignature&&lastPenaltySignature!==penaltySignature)penaltySound(Boolean(m.red.penaltyState?.disqualified||m.blue.penaltyState?.disqualified));
  lastPenaltySignature=penaltySignature;
  const winner=m.certified?(m.winner==='red'?m.red.name:m.winner==='blue'?m.blue.name:'SERI'):'';
  const status=m.status==='jeda'?'SUDUT NETRAL':m.status.toUpperCase();
  $('#screen').innerHTML=`<header class="display-head"><div class="display-brand">POIN <span style="color:var(--gold)">GELANGGANG</span></div><div style="text-align:center"><div class="round">BABAK ${m.round} / ${m.totalRounds}</div><div id="displayTimer" class="display-timer">${fmt(clock(m))}</div></div><div style="text-align:right"><b>GELANGGANG ${esc(m.arena)}</b><br><span class="badge ${m.status==='berlangsung'?'live':''}">${status}</span></div></header><main class="display-score"><section class="display-fighter red"><div class="name">${esc(m.red.name)}</div><div class="team">${esc(m.red.team)}</div><div class="bigscore">${m.red.score}</div>${gesturePanel(m.red.penaltyState,'red')}</section><section class="display-fighter blue"><div class="name">${esc(m.blue.name)}</div><div class="team">${esc(m.blue.team)}</div><div class="bigscore">${m.blue.score}</div>${gesturePanel(m.blue.penaltyState,'blue')}</section></main><footer class="display-foot">${winner?`PEMENANG · ${esc(winner)} · ${esc(m.victoryReason)}`:`PARTAI ${esc(m.boutNumber)} · ${esc(m.category)} · ${esc(m.className)}`}</footer>`;
}
