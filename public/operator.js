let matches=[],current=null,tick,lastViewSignature='';
const athleteMenu=document.createElement('a');
athleteMenu.className='btn ghost';
athleteMenu.href='/atlet';
athleteMenu.target='_blank';
athleteMenu.textContent='Daftar Atlet';
$('#logout').before(athleteMenu);

async function init(){
  const me=await api('/api/me');
  if(me){
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    load();
  }
}

setInterval(async()=>{
  try{
    if(current){
      const m=await api(`/api/public/match-id/${current.id}`);
      const sig=signature(m);
      current=m;
      if(sig!==lastViewSignature)renderMatch();
    }else if(!$('#app').classList.contains('hidden'))await load();
  }catch{}
},900);

$('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    await api('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    location.reload();
  }catch(error){toast(error.message,true)}
};
$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload()};

async function load(){matches=await api('/api/matches');renderList()}

function statusText(status){return status==='jeda'?'sudut netral':status}

function renderList(){
  const query=$('#search').value.toLowerCase(),filter=$('#filter').value;
  $('#matches').innerHTML=matches.filter(m=>(!filter||m.status===filter)&&JSON.stringify(m).toLowerCase().includes(query)).map(m=>`
    <tr>
      <td><b>${esc(m.boutNumber||'-')}</b><br><small>Gelanggang ${esc(m.arena)}</small></td>
      <td><span style="color:#ff5964">${esc(m.red.name)}</span><br><span style="color:#45a7ff">${esc(m.blue.name)}</span></td>
      <td><b style="font-size:20px">${m.code}</b></td>
      <td><span class="badge ${m.status==='berlangsung'?'live':''}">${statusText(m.status)}</span></td>
      <td><div class="row"><button class="btn" onclick="openMatch('${m.id}')">Buka</button><button class="btn ghost" onclick="duplicateMatch('${m.id}')">Duplikat</button><button class="btn danger" onclick="archiveMatch('${m.id}')">Hapus</button></div></td>
    </tr>`).join('')||'<tr><td colspan="5" class="muted">Daftar bersih. Buat pertandingan baru untuk event berikutnya.</td></tr>';
}

$('#archiveOldBtn').onclick=async()=>{
  const password=prompt('Bersihkan semua pertandingan yang sudah selesai? Masukkan password operator:');
  if(!password)return;
  try{
    const result=await api('/api/matches/archive-finished',{method:'POST',body:JSON.stringify({password})});
    toast(`${result.count} pertandingan dipindahkan ke arsip`);
    load();
  }catch(error){toast(error.message,true)}
};
$('#search').oninput=renderList;
$('#filter').onchange=renderList;
$('#newBtn').onclick=()=>$('#newModal').classList.remove('hidden');
$('.close').onclick=()=>$('#newModal').classList.add('hidden');
$('#newForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const m=await api('/api/matches',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    $('#newModal').classList.add('hidden');
    matches.unshift(m);
    openMatch(m.id);
  }catch(error){toast(error.message,true)}
};

async function archiveMatch(id){
  const password=prompt('Masukkan password operator untuk menghapus pertandingan dari daftar:');
  if(!password)return;
  try{
    await api(`/api/matches/${id}/archive`,{method:'POST',body:JSON.stringify({password})});
    toast('Pertandingan dipindahkan ke arsip');
    await load();
  }catch(error){toast(error.message,true)}
}
async function duplicateMatch(id){
  try{await api(`/api/matches/${id}/duplicate`,{method:'POST'});toast('Pertandingan diduplikasi');load()}
  catch(error){toast(error.message,true)}
}
function openMatch(id){
  current=matches.find(m=>m.id===id);
  $('#listView').classList.add('hidden');
  $('#matchView').classList.remove('hidden');
  renderMatch();
  clearInterval(tick);
  tick=setInterval(()=>{if(current&&$('#timer'))$('#timer').textContent=fmt(clock(current))},100);
}
function signature(m){return JSON.stringify([m.status,m.round,m.totalRounds,m.timer,m.red,m.blue,m.judges,m.events.length,m.validated.length,m.certified,m.winner,m.victoryReason])}
function judgeBox(n){
  const judge=current.judges[n];
  return `<div class="judge-status"><span class="dot ${judge?.connected?'on':''}"></span><b>Juri ${n}</b><br><small class="muted">${judge?esc(judge.name):'Belum bergabung'} - ${judge?.connected?'Terhubung':'Terputus'}</small></div>`;
}

function resultControls(m){
  if(m.status!=='selesai')return '<span class="muted">Akhiri pertandingan sebelum memilih dan mengesahkan hasil.</span>';
  if(m.certified){
    const winner=m.winner==='red'?m.red.name:m.blue.name;
    return `<div><span class="badge">DISAHKAN</span> <b>${esc(winner)}</b><br><small class="muted">${esc(m.victoryReason)}</small></div>`;
  }
  return `<label>Pemenang<select id="winner"><option value="">Pilih pemenang</option><option value="red">Sudut Merah — ${esc(m.red.name)}</option><option value="blue">Sudut Biru — ${esc(m.blue.name)}</option></select></label>
    <label>Alasan kemenangan<select id="reason"><option>Menang angka</option><option>Menang teknik</option><option>Menang mutlak</option><option>Lawan mengundurkan diri</option><option>Diskualifikasi</option><option>Keputusan wasit</option></select></label>
    <button class="btn primary" onclick="certify()">Sahkan Hasil</button>`;
}

function primaryControl(m){
  if(m.status==='berlangsung')return '<button class="btn green" onclick="control(\'pause\')">SUDUT NETRAL</button>';
  if(m.timer<=0&&m.round<m.totalRounds)return '<button class="btn green" onclick="control(\'next\')">MULAI BABAK BERIKUTNYA</button>';
  if(m.timer<=0)return '<span class="badge">WAKTU HABIS — TAMBAH BABAK ATAU AKHIRI</span>';
  return `<button class="btn green" onclick="control('${m.startedAt?'resume':'start'}')">${m.startedAt?'LANJUTKAN':'MULAI'}</button>`;
}

function renderMatch(){
  const m=current,events=[...m.events].reverse().slice(0,30);
  lastViewSignature=signature(m);
  $('#matchView').innerHTML=`
    <div class="row spread">
      <button class="btn ghost" onclick="back()">&lt; Daftar</button>
      <div class="row"><span class="badge">KODE <b style="font-size:18px;margin-left:5px">${m.code}</b></span><a class="btn ghost" href="/display?code=${m.code}" target="_blank">Layar Besar</a></div>
    </div><br>
    <div class="grid scoreboard">
      <div class="fighter red"><div class="muted">SUDUT MERAH</div><div class="fighter-name">${esc(m.red.name)}</div><div class="muted">${esc(m.red.team)}</div><div class="score">${m.red.score}</div>${penaltyTrack(m.red.penaltyState)}</div>
      <div class="card timer"><div class="round">BABAK ${m.round} / ${m.totalRounds}</div><div id="timer" class="timer-value">${fmt(clock(m))}</div><span class="badge ${m.status==='berlangsung'?'live':''}">${statusText(m.status).toUpperCase()}</span></div>
      <div class="fighter blue"><div class="muted">SUDUT BIRU</div><div class="fighter-name">${esc(m.blue.name)}</div><div class="muted">${esc(m.blue.team)}</div><div class="score">${m.blue.score}</div>${penaltyTrack(m.blue.penaltyState)}</div>
    </div><br>
    <div class="card"><div class="row spread"><div class="row">
      ${m.status!=='selesai'?`${primaryControl(m)}
      <button class="btn" ${m.round>=m.totalRounds?'disabled':''} onclick="control('next')">Babak Berikutnya</button>
      <button class="btn ghost" onclick="addRound()">+ Tambah Babak</button>
      <button class="btn ghost" onclick="resetRoundPenalties()">Reset Babak</button>
      <button class="btn danger" onclick="requestEnd()">Akhiri</button>`:`<div><div class="row"><span class="badge">${m.certified?'TAHAP 3 — HASIL DISAHKAN':'TAHAP 2 — PILIH HASIL'}</span></div><br><div class="row">${resultControls(m)}</div></div>`}
    </div><button class="btn ghost" onclick="undo()">UNDO Batalkan Keputusan</button></div></div><br>
    <div class="grid grid-3">${judgeBox(1)}${judgeBox(2)}${judgeBox(3)}</div><br>
    <div class="grid grid-2">
      <div class="card"><h3 class="section-title">Kontrol Manual</h3>${sideControls('red')}${sideControls('blue')}</div>
      <div class="card"><h3 class="section-title">Nilai Real-time</h3><div class="event-list">${events.map(eventRow).join('')||'<p class="muted">Belum ada nilai masuk.</p>'}</div></div>
    </div><br>
    <div class="card"><div class="row spread"><div><h3 class="section-title">Dokumen Pertandingan</h3><span class="muted">${m.certified?'Hasil resmi siap dicetak.':'PDF dan Excel dapat digunakan sebagai rekap sementara.'}</span></div><div class="row"><a class="btn ghost" href="/api/matches/${m.id}/export.pdf">PDF</a><a class="btn ghost" href="/api/matches/${m.id}/export.xlsx">Excel</a></div></div></div>`;
}

function sideControls(side){
  const fighter=current[side];
  return `<div class="penalty-panel"><div class="row spread"><b style="color:var(--${side})">SUDUT ${side==='red'?'MERAH':'BIRU'} — ${esc(fighter.name)}</b><button class="btn ghost" onclick="undoPenalty('${side}')">Undo Hukuman</button></div>${penaltyTrack(fighter.penaltyState)}<div class="penalty-actions"><button class="btn" onclick="applyPenalty('${side}','light')">Pelanggaran Ringan</button><button class="btn" onclick="applyPenalty('${side}','medium')">Pelanggaran Sedang</button><button class="btn danger" onclick="chooseHeavy('${side}')">Pelanggaran Berat</button><button class="btn danger" onclick="applyPenalty('${side}','disqualify')">Diskualifikasi</button></div><div class="row" style="margin-top:10px"><button class="btn ghost" onclick="manual('${side}','score',1)">Nilai +1</button><button class="btn ghost" onclick="manual('${side}','score',-1)">Nilai -1</button></div></div>`;
}
function eventRow(e){
  return `<div class="event ${e.status==='dibatalkan'?'cancelled':''}"><span>${new Date(e.at).toLocaleTimeString('id-ID',{hour12:false})}</span><span>${e.source==='judge'?`Juri ${e.judge}`:'Operator'} - ${e.side==='red'?'Merah':'Biru'} ${esc(e.penaltyLabel||e.type||'')}</span><b>${e.points>0?'+':''}${e.points||''}${e.validatedId?' OK':''}</b></div>`;
}

async function control(action){
  try{
    current=await api(`/api/matches/${current.id}/control`,{method:'POST',body:JSON.stringify({action})});
    renderMatch();
    toast(action==='end'?'Pertandingan diakhiri. Silakan pilih dan sahkan hasil.':'Kontrol pertandingan diperbarui');
  }catch(error){toast(error.message,true)}
}
function requestEnd(){
  if($('#endConfirm'))return;
  const modal=document.createElement('div');
  modal.id='endConfirm';
  modal.className='modal';
  modal.innerHTML=`<div class="card" style="max-width:460px"><span class="badge">TAHAP 1 — KONFIRMASI</span><h2>Akhiri pertandingan?</h2><p class="muted">Timer akan dihentikan dan Juri tidak dapat mengirim nilai lagi. Pemenang belum ditentukan sampai hasil disahkan.</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="cancelEnd()">Batal</button><button class="btn danger" onclick="confirmEnd()">Akhiri Pertandingan</button></div></div>`;
  document.body.append(modal);
}
function cancelEnd(){$('#endConfirm')?.remove()}
async function confirmEnd(){
  cancelEnd();
  await control('end');
}
async function addRound(){
  const value=prompt('Masukkan durasi untuk babak tambahan (detik):',String(Math.round(current.roundDurationMs/1000)||120));
  if(value===null)return;
  const duration=Number(value);
  if(!Number.isFinite(duration)||duration<1)return toast('Durasi minimal 1 detik',true);
  try{
    current=await api(`/api/matches/${current.id}/add-round`,{method:'POST',body:JSON.stringify({duration})});
    renderMatch();
    toast(`Babak ${current.round} ditambahkan dengan waktu ${duration} detik`);
  }catch(error){toast(error.message,true)}
}
function chooseHeavy(side){
  const modal=document.createElement('div');
  modal.id='heavyChoice';
  modal.className='modal';
  modal.innerHTML=`<div class="card" style="max-width:470px"><h2>Pelanggaran Berat</h2><p class="muted">Apakah lawan mengalami cedera akibat pelanggaran?</p><div class="grid grid-2"><button class="btn" onclick="closeHeavy();applyPenalty('${side}','heavy','none')">Tanpa Cedera</button><button class="btn danger" onclick="closeHeavy();applyPenalty('${side}','heavy','injury')">Dengan Cedera</button></div><br><button class="btn ghost" style="width:100%" onclick="closeHeavy()">Batal</button></div>`;
  document.body.append(modal);
}
function closeHeavy(){$('#heavyChoice')?.remove()}
function penaltyWillDisqualify(side,type){
  const state=current[side].penaltyState||{};
  return type==='disqualify'||Number(state.peringatan)>=2;
}
async function applyPenalty(side,type,injury){
  const fighter=current[side],willDisqualify=penaltyWillDisqualify(side,type);
  if(willDisqualify&&!confirm(`Hukuman berikutnya akan mendiskualifikasi ${fighter.name}. Lanjutkan?`))return;
  try{
    current=await api(`/api/matches/${current.id}/penalty`,{method:'POST',body:JSON.stringify({side,type,injury,confirmDisqualification:willDisqualify})});
    renderMatch();penaltySound(willDisqualify);
    const state=current[side].penaltyState;
    toast(state.disqualified?`${fighter.name} didiskualifikasi`:'Status hukuman diperbarui');
  }catch(error){toast(error.message,true)}
}
async function undoPenalty(side){
  try{
    current=await api(`/api/matches/${current.id}/penalty-undo`,{method:'POST',body:JSON.stringify({side})});
    renderMatch();penaltySound();toast('Hukuman terakhir dibatalkan');
  }catch(error){toast(error.message,true)}
}
async function resetRoundPenalties(){
  if(!confirm('Reset Binaan dan Teguran untuk babak ini? Peringatan tetap berlaku.'))return;
  try{
    current=await api(`/api/matches/${current.id}/reset-round-penalties`,{method:'POST'});
    renderMatch();toast('Binaan dan Teguran babak telah direset');
  }catch(error){toast(error.message,true)}
}
async function manual(side,type,points){
  try{current=await api(`/api/matches/${current.id}/manual`,{method:'POST',body:JSON.stringify({side,type,points})});renderMatch()}
  catch(error){toast(error.message,true)}
}
async function undo(){
  try{current=await api(`/api/matches/${current.id}/undo`,{method:'POST'});renderMatch();toast('Keputusan dibatalkan')}
  catch(error){toast(error.message,true)}
}
async function certify(){
  const winner=$('#winner').value,reason=$('#reason').value;
  if(!winner)return toast('Pilih Sudut Merah atau Sudut Biru sebagai pemenang',true);
  const winnerName=winner==='red'?current.red.name:current.blue.name;
  const loserName=winner==='red'?current.blue.name:current.red.name;
  const detail=reason==='Diskualifikasi'?`${loserName} akan dinyatakan didiskualifikasi.`:reason==='Lawan mengundurkan diri'?`${loserName} akan dinyatakan mengundurkan diri.`:'';
  if(!confirm(`Sahkan ${winnerName} sebagai pemenang karena ${reason}?${detail?`\n${detail}`:''}`))return;
  try{
    current=await api(`/api/matches/${current.id}/certify`,{method:'POST',body:JSON.stringify({reason,winner})});
    renderMatch();
    toast('Hasil resmi disahkan');
  }catch(error){toast(error.message,true)}
}
function back(){current=null;clearInterval(tick);$('#matchView').classList.add('hidden');$('#listView').classList.remove('hidden');load()}
init();
