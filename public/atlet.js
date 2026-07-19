let parties=[];
const statusLabel={menunggu:'BELUM DIMULAI',berlangsung:'BERLANGSUNG',jeda:'SUDUT NETRAL',selesai:'SELESAI'};

async function loadParties(){
  try{
    parties=await api('/api/public/matches');
    renderParties();
  }catch(error){
    $('#parties').innerHTML='<div class="empty-state">Daftar belum dapat dimuat. Silakan perbarui halaman.</div>';
  }
}

function athleteName(side){
  return `<div class="athlete ${side}"><b>${side==='red'?'MERAH':'BIRU'}</b><strong>${esc(this[side].name)}</strong><span>${esc(this[side].team||'-')}</span><em>${this.status==='selesai'?this[side].score:'-'}</em></div>`;
}

function resultText(m){
  if(m.status!=='selesai')return '';
  if(!m.certified)return `<div class="match-result"><b>Skor akhir sementara: ${m.red.score} - ${m.blue.score}</b><span>Menunggu pengesahan hasil.</span></div>`;
  const winner=m.winner==='red'?m.red.name:m.winner==='blue'?m.blue.name:'Seri';
  return `<div class="match-result">Hasil: <b>${esc(m.red.name)} ${m.red.score} - ${m.blue.score} ${esc(m.blue.name)}</b><span>Pemenang: ${esc(winner)}${m.victoryReason?` (${esc(m.victoryReason)})`:''}</span></div>`;
}

function renderParties(){
  const query=$('#search').value.trim().toLowerCase();
  const status=$('#status').value;
  const list=parties.filter(m=>(!status||m.status===status)&&(!query||JSON.stringify(m).toLowerCase().includes(query)));
  $('#parties').innerHTML=list.map(m=>{
    const monitor=['berlangsung','jeda'].includes(m.status)&&Boolean(m.startedAt);
    return `<article class="party-card">
      <div class="party-meta">
        <div><span>PARTAI</span><b>${esc(m.boutNumber||'-')}</b></div>
        <div><span>GELANGGANG</span><b>${esc(m.arena||'-')}</b></div>
        <div><span>KELAS</span><b>${esc(m.className||m.category||'-')}</b></div>
        <span class="badge ${m.status==='berlangsung'?'live':''}">${statusLabel[m.status]||m.status}</span>
      </div>
      <div class="athlete-versus">${athleteName.call(m,'red')}<div class="versus">VS</div>${athleteName.call(m,'blue')}</div>
      ${resultText(m)}
      <div class="party-action">${monitor?`<a class="btn blue" href="/display?code=${m.code}">Buka Monitor</a>`:'<span class="muted">Monitor tersedia setelah pertandingan dimulai.</span>'}</div>
    </article>`;
  }).join('')||'<div class="empty-state">Tidak ada partai yang sesuai.</div>';
}

$('#search').oninput=renderParties;
$('#status').onchange=renderParties;
$('#refresh').onclick=loadParties;
loadParties();
setInterval(loadParties,3000);
