const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const now = () => Date.now();
const id = () => crypto.randomUUID();

const initialDb = () => ({
  users: [{ id: 'operator', username: process.env.OPERATOR_USERNAME || 'operator', passwordHash: bcrypt.hashSync(process.env.OPERATOR_PASSWORD || crypto.randomBytes(24).toString('hex'), 10), role: 'operator' }],
  matches: [], audit: []
});
function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(initialDb(), null, 2));
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return initialDb(); }
}
let db = loadDb();
const cloud = Boolean(process.env.VERCEL && process.env.POSTGRES_URL);
function postgresConnection(){if(!process.env.POSTGRES_URL)return '';const u=new URL(process.env.POSTGRES_URL);u.searchParams.delete('sslmode');return u.toString()}
const pool = cloud ? new Pool({ connectionString: postgresConnection(), ssl: { rejectUnauthorized: false }, max: 2 }) : null;
let cloudReady;
async function initCloud() {
  if (!cloud) return;
  if (!cloudReady) cloudReady = (async()=>{
    await pool.query('create table if not exists poin_gelanggang_state (id integer primary key, data jsonb not null, updated_at timestamptz default now())');
    await pool.query('insert into poin_gelanggang_state(id,data) values(1,$1::jsonb) on conflict(id) do nothing',[JSON.stringify(initialDb())]);
  })();
  return cloudReady;
}
async function cloudLoad(){await initCloud();const r=await pool.query('select data from poin_gelanggang_state where id=1');db=r.rows[0].data;}
async function cloudSave(){await pool.query('update poin_gelanggang_state set data=$1::jsonb,updated_at=now() where id=1',[JSON.stringify(db)]);}
let saveTimer;
function save() {
  if (cloud) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const temp = DB_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(db, null, 2));
    fs.renameSync(temp, DB_FILE);
  }, 80);
}
function audit(action, matchId, detail = {}, actor = 'sistem') {
  db.audit.push({ id: id(), action, matchId, detail, actor, at: now() }); save();
}
function code() {
  for (let i=0;i<10000;i++) {
    const candidate=String(crypto.randomInt(1000,10000));
    if (!db.matches.some(m=>m.code===candidate&&!m.archived)) return candidate;
  }
  throw new Error('Semua kode pertandingan sedang digunakan');
}
function publicMatch(m) {
  if (!m) return null;
  ensurePenaltyState(m);
  const timer = timerValue(m);
  const judges=Object.fromEntries(Object.entries(m.judges||{}).map(([k,j])=>[k,{...j,connected:Boolean(j.connected&&now()-(j.lastSeen||0)<3500)}]));
  const status=m.status==='berlangsung'&&timer<=0?'jeda':m.status;
  return { ...m, status, judges, timer, serverNow: now(), displayKey: matchDisplayKey(m) };
}
function timerValue(m) {
  if (m.status === 'berlangsung' && m.timerStartedAt) return Math.max(0, m.timerRemainingMs - (now() - m.timerStartedAt));
  return Math.max(0, m.timerRemainingMs || 0);
}
function emitMatch(m) { io.to(`match:${m.id}`).emit('match:update', publicMatch(m)); io.emit('matches:update', db.matches.map(publicMatch)); }
function currentMatch(matchId) { return db.matches.find(m => m.id === matchId); }
const authSecret=()=>process.env.SESSION_SECRET||'poin-gelanggang-lokal-ganti-ini';
function matchDisplayKey(m){return crypto.createHmac('sha256',authSecret()).update(`display:${m.id}`).digest('base64url').slice(0,18)}
function authToken(user){const p=Buffer.from(JSON.stringify({id:user.id,username:user.username,role:user.role,exp:now()+43200000})).toString('base64url');return `${p}.${crypto.createHmac('sha256',authSecret()).update(p).digest('base64url')}`}
function tokenUser(req){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pg_auth='))?.slice(8);if(!raw)return null;const [p,s]=raw.split('.');const good=crypto.createHmac('sha256',authSecret()).update(p).digest('base64url');if(s!==good)return null;try{const u=JSON.parse(Buffer.from(p,'base64url'));return u.exp>now()?u:null}catch{return null}}
function requireOperator(req, res, next) { const u=tokenUser(req)||req.session?.user;if(u?.role==='operator'){req.operator=u;return next()}res.status(401).json({ error: 'Login operator diperlukan' }); }
function addEvent(m, event) { m.events.push({ id: id(), at: now(), status: 'aktif', ...event }); save(); }
function ensurePenaltyState(m){
  for(const side of ['red','blue']){
    const fighter=m[side];
    if(!fighter.penaltyState)fighter.penaltyState={
      binaan:0,
      teguran:Math.min(2,Math.max(0,Number(fighter.warnings)||0)),
      peringatan:Math.min(2,Math.max(0,Number(fighter.penalties)||0)),
      disqualified:false
    };
    fighter.warnings=fighter.penaltyState.teguran;
    fighter.penalties=fighter.penaltyState.peringatan;
  }
}
function penaltySnapshot(m,side){ensurePenaltyState(m);return structuredClone(m[side].penaltyState)}
function penaltyLabel(state){
  if(state.disqualified)return 'Diskualifikasi';
  if(state.peringatan)return `Peringatan ${state.peringatan===1?'I':'II'}`;
  if(state.teguran)return `Teguran ${state.teguran===1?'I':'II'}`;
  if(state.binaan)return `Binaan ${state.binaan===1?'I':'II'}`;
  return 'Belum ada hukuman';
}
function resetRoundPenalties(m,actor='sistem'){
  ensurePenaltyState(m);
  for(const side of ['red','blue']){
    const state=m[side].penaltyState;
    if(!state.binaan&&!state.teguran)continue;
    const before=structuredClone(state);
    state.binaan=0;state.teguran=0;m[side].warnings=0;
    addEvent(m,{source:'operator',side,type:'penalty_reset',penaltyLabel:'Reset hukuman babak',before,after:structuredClone(state),points:0});
  }
  audit('RESET_HUKUMAN_BABAK',m.id,{round:m.round},actor);
}

app.use(express.json({ limit: '1mb' }));
app.use(session({ secret: process.env.SESSION_SECRET || 'poin-gelanggang-lokal-ganti-ini', resave: false, saveUninitialized: false, cookie: { maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax' } }));
app.use('/api', async (req,res,next)=>{
  if(!cloud) return next();
  try {
    if(req.method!=='GET'){
      const client=await pool.connect();req.cloudClient=client;await client.query('begin');await client.query('select pg_advisory_xact_lock(741852)');
      const state=await client.query('select data from poin_gelanggang_state where id=1');db=state.rows[0].data;
      const original=res.json.bind(res);
      res.json=async body=>{try{await client.query('update poin_gelanggang_state set data=$1::jsonb,updated_at=now() where id=1',[JSON.stringify(db)]);await client.query('commit');client.release();original(body)}catch(e){await client.query('rollback').catch(()=>{});client.release();res.status(500);original({error:'Gagal menyimpan database'})}};
    } else await cloudLoad();
    next();
  } catch(e){console.error('Database error:',e.message);res.status(503).json({error:'Database belum siap'});}
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.redirect('/operator'));
app.get('/health', (_, res) => res.json({ ok: true, service: 'poin-gelanggang' }));
app.get('/operator', (_, res) => res.sendFile(path.join(__dirname, 'public/operator.html')));
app.get('/juri', (_, res) => res.sendFile(path.join(__dirname, 'public/juri.html')));
app.get('/display', (_, res) => res.sendFile(path.join(__dirname, 'public/display.html')));
app.get('/atlet', (_, res) => res.sendFile(path.join(__dirname, 'public/atlet.html')));

app.post('/api/login', (req, res) => {
  const u = db.users.find(x => x.username === req.body.username && x.role === 'operator');
  if (!u || !bcrypt.compareSync(req.body.password || '', u.passwordHash)) return res.status(401).json({ error: 'Nama pengguna atau password salah' });
  req.session.user = { id: u.id, username: u.username, role: u.role };res.setHeader('Set-Cookie',`pg_auth=${authToken(req.session.user)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`); audit('LOGIN', null, {}, u.username); res.json(req.session.user);
});
app.post('/api/logout', (req, res) => {res.setHeader('Set-Cookie','pg_auth=; Path=/; Max-Age=0');req.session.destroy(() => res.json({ ok: true }))});
app.get('/api/me', (req, res) => res.json(tokenUser(req)||req.session.user||null));
app.get('/api/matches', requireOperator, (req, res) => res.json(db.matches.filter(m=>req.query.archived==='1'?m.archived:!m.archived).map(publicMatch)));
app.get('/api/public/matches', (req,res)=>res.json(db.matches.filter(m=>!m.archived).map(m=>{const p=publicMatch(m);return {id:p.id,code:p.code,boutNumber:p.boutNumber,arena:p.arena,category:p.category,className:p.className,red:p.red,blue:p.blue,round:p.round,totalRounds:p.totalRounds,status:p.status,startedAt:p.startedAt,endedAt:p.endedAt,winner:p.winner,victoryReason:p.victoryReason,certified:p.certified,createdAt:p.createdAt}})));
app.get('/api/public/match/:code', (req,res)=>{const m=db.matches.find(x=>x.code===req.params.code&&!x.archived);if(!m)return res.status(404).json({error:'Pertandingan tidak ada dalam daftar aktif'});if(m.status==='selesai'&&req.query.key!==matchDisplayKey(m))return res.status(409).json({error:'Pertandingan telah berakhir. Lihat hasil di Daftar Atlet'});res.json(publicMatch(m));});
app.get('/api/public/match-id/:id', (req,res)=>{const m=db.matches.find(x=>x.id===req.params.id&&!x.archived);if(!m)return res.status(404).json({error:'Pertandingan tidak ada dalam daftar aktif'});res.json(publicMatch(m));});
function validJudge(m,slot,deviceId){return Boolean(m&&!m.archived&&m.judges?.[slot]?.deviceId===deviceId)}
app.post('/api/judge/join',(req,res)=>{const {code:roomCode,slot,name,deviceId}=req.body;const m=db.matches.find(x=>x.code===roomCode&&!x.archived);const n=Number(slot);if(!m||![1,2,3].includes(n)||!deviceId)return res.status(400).json({error:'Pertandingan tidak ada atau nomor juri tidak valid'});const old=m.judges[n];if(old?.deviceId!==deviceId&&now()-(old?.lastSeen||0)<3500)return res.status(409).json({error:`Juri ${n} sedang aktif di perangkat lain`});m.judges[n]={name:name||`Juri ${n}`,connected:true,lastSeen:now(),deviceId};audit('JURI_TERHUBUNG',m.id,{slot:n,name},`juri-${n}`);res.json(publicMatch(m));});
app.post('/api/judge/heartbeat',(req,res)=>{const m=currentMatch(req.body.matchId),n=Number(req.body.slot);if(!m||m.archived)return res.status(404).json({error:'Pertandingan tidak ada dalam daftar aktif'});if(!validJudge(m,n,req.body.deviceId))return res.status(403).json({error:'Sesi juri digunakan perangkat lain'});m.judges[n].connected=true;m.judges[n].lastSeen=now();res.json(publicMatch(m));});
app.post('/api/judge/score',(req,res)=>{const m=currentMatch(req.body.matchId),slot=Number(req.body.slot),side=req.body.side;const points=Number(req.body.points);if(!validJudge(m,slot,req.body.deviceId))return res.status(403).json({error:'Sesi juri tidak sah'});if(!m||m.certified||m.status!=='berlangsung'||timerValue(m)<=0||!['red','blue'].includes(side)||!m.enabledScores.includes(points))return res.status(400).json({error:'Nilai tidak dapat dikirim saat ini'});const e={id:id(),at:now(),clientAt:Number(req.body.clientAt||now()),source:'judge',judge:slot,judgeName:m.judges[slot]?.name||`Juri ${slot}`,side,points,status:'aktif'};m.events.push(e);const candidates=m.events.filter(x=>x.source==='judge'&&x.status==='aktif'&&!x.validatedId&&x.side===side&&x.points===points&&Math.abs(x.at-e.at)<=m.validationWindowMs);const unique=[...new Map(candidates.map(x=>[x.judge,x])).values()];if(unique.length>=2){const group=unique.slice(0,3),v={id:id(),side,points,at:now(),judgeEvents:group.map(x=>x.id),status:'aktif'};m.validated.push(v);group.forEach(x=>x.validatedId=v.id);m[side].score+=points;}res.json({match:publicMatch(m),event:e});});
app.post('/api/judge/undo',(req,res)=>{const m=currentMatch(req.body.matchId),slot=Number(req.body.slot);if(!validJudge(m,slot,req.body.deviceId))return res.status(403).json({error:'Sesi juri tidak sah'});if(m.certified)return res.status(409).json({error:'Hasil sudah disahkan'});const e=[...(m?.events||[])].reverse().find(x=>x.judge===slot&&x.status==='aktif');if(!e)return res.status(400).json({error:'Tidak ada nilai'});e.status='dibatalkan';if(e.validatedId){const v=m.validated.find(x=>x.id===e.validatedId&&x.status==='aktif');if(v){v.status='dibatalkan';m[v.side].score=Math.max(0,m[v.side].score-v.points)}}audit('JURI_UNDO',m.id,{slot,eventId:e.id},`juri-${slot}`);res.json(publicMatch(m));});
app.post('/api/matches', requireOperator, (req, res) => {
  const b = req.body;
  const duration=Math.min(3600,Math.max(1,Number(b.duration)||120));
  const totalRounds=Math.min(20,Math.max(1,Number(b.totalRounds)||3));
  const validationWindow=Math.min(3,Math.max(1,Number(b.validationWindow)||2));
  const m = {
    id: id(), code: code(), boutNumber: b.boutNumber || '', arena: b.arena || '1', category: b.category || 'Tanding', className: b.className || '',
    red: { name: b.redName || 'Pesilat Merah', team: b.redTeam || '', score: 0, warnings: 0, penalties: 0 },
    blue: { name: b.blueName || 'Pesilat Biru', team: b.blueTeam || '', score: 0, warnings: 0, penalties: 0 },
    round: 1, totalRounds, roundDurationMs: duration * 1000,
    timerRemainingMs: duration * 1000, timerStartedAt: null, status: 'menunggu',
    validationWindowMs: validationWindow * 1000, enabledScores: b.enabledScores || [1,2,3],
    judges: {}, events: [], validated: [], startedAt: null, endedAt: null, winner: null, victoryReason: '', certified: false, createdAt: now()
  };
  db.matches.unshift(m); audit('BUAT_PERTANDINGAN', m.id, { code: m.code }, (req.operator?.username||'operator')); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/duplicate', requireOperator, (req, res) => {
  const src = currentMatch(req.params.id); if (!src) return res.status(404).json({ error: 'Tidak ditemukan' });
  const emptyPenalty={binaan:0,teguran:0,peringatan:0,disqualified:false};
  const m = { ...structuredClone(src), id: id(), code: code(), status: 'menunggu', round: 1, timerRemainingMs: src.roundDurationMs, timerStartedAt: null, judges: {}, events: [], validated: [], red: {...src.red, score:0,warnings:0,penalties:0,penaltyState:structuredClone(emptyPenalty)}, blue:{...src.blue,score:0,warnings:0,penalties:0,penaltyState:structuredClone(emptyPenalty)}, startedAt:null,endedAt:null,winner:null,loser:null,victoryReason:'',decision:null,suggestedLoser:null,certified:false,createdAt:now() };
  db.matches.unshift(m); audit('DUPLIKASI', m.id, { source: src.id }, (req.operator?.username||'operator')); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/reset', requireOperator, (req, res) => {
  const m = currentMatch(req.params.id); const u = db.users.find(x => x.id === (req.operator?.id||'operator'));
  if (!bcrypt.compareSync(req.body.password || '', u.passwordHash)) return res.status(403).json({ error: 'Password salah' });
  Object.assign(m, {status:'menunggu',round:1,timerRemainingMs:m.roundDurationMs,timerStartedAt:null,events:[],validated:[],startedAt:null,endedAt:null,winner:null,loser:null,victoryReason:'',decision:null,suggestedLoser:null,certified:false}); Object.assign(m.red,{score:0,warnings:0,penalties:0,penaltyState:{binaan:0,teguran:0,peringatan:0,disqualified:false}}); Object.assign(m.blue,{score:0,warnings:0,penalties:0,penaltyState:{binaan:0,teguran:0,peringatan:0,disqualified:false}});
  audit('RESET',m.id,{},u.username); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/archive',requireOperator,(req,res)=>{const m=currentMatch(req.params.id),u=db.users.find(x=>x.id===(req.operator?.id||'operator'));if(!m)return res.status(404).json({error:'Tidak ditemukan'});if(m.status==='berlangsung')return res.status(409).json({error:'Akhiri pertandingan sebelum menghapus'});if(!bcrypt.compareSync(req.body.password||'',u.passwordHash))return res.status(403).json({error:'Password operator salah'});m.archived=true;m.archivedAt=now();audit('ARSIPKAN_PERTANDINGAN',m.id,{code:m.code},u.username);res.json({ok:true});});
app.post('/api/matches/archive-finished',requireOperator,(req,res)=>{const u=db.users.find(x=>x.id===(req.operator?.id||'operator'));if(!bcrypt.compareSync(req.body.password||'',u.passwordHash))return res.status(403).json({error:'Password operator salah'});let count=0;for(const m of db.matches){if(!m.archived&&['selesai','dibatalkan'].includes(m.status)){m.archived=true;m.archivedAt=now();count++}}audit('ARSIPKAN_EVENT_LAMA',null,{count},u.username);res.json({ok:true,count});});
app.post('/api/matches/:id/control', requireOperator, (req, res) => {
  const m = currentMatch(req.params.id); if (!m) return res.status(404).json({error:'Tidak ditemukan'}); const action=req.body.action;
  if(m.certified)return res.status(409).json({error:'Hasil sudah disahkan dan dikunci'});
  if (!['start','resume','pause','next','end'].includes(action)) return res.status(400).json({error:'Kontrol tidak valid'});
  if (action==='start'||action==='resume') {
    if(timerValue(m)<=0)return res.status(409).json({error:m.round<m.totalRounds?'Waktu habis. Tekan Babak Berikutnya.':'Waktu babak terakhir habis. Akhiri pertandingan.'});
    if (!m.startedAt) m.startedAt=now(); m.status='berlangsung'; m.timerStartedAt=now();
  }
  if (action==='pause') { m.timerRemainingMs=timerValue(m); m.timerStartedAt=null; m.status='jeda'; }
  if (action==='next') {
    if(m.round>=m.totalRounds)return res.status(409).json({error:'Sudah berada di babak terakhir'});
    resetRoundPenalties(m,(req.operator?.username||'operator'));m.round+=1; m.timerRemainingMs=m.roundDurationMs; m.timerStartedAt=null; m.status='jeda';
  }
  if (action==='end') { m.timerRemainingMs=timerValue(m); m.timerStartedAt=null;m.status='selesai';m.endedAt=now();m.winner=null;m.victoryReason=''; }
  audit(`KONTROL_${action.toUpperCase()}`,m.id,{},(req.operator?.username||'operator')); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/add-round',requireOperator,(req,res)=>{
  const m=currentMatch(req.params.id);if(!m)return res.status(404).json({error:'Pertandingan tidak ditemukan'});
  if(m.certified||m.status==='selesai')return res.status(409).json({error:'Babak tidak dapat ditambah setelah pertandingan diakhiri'});
  if(m.status==='berlangsung')return res.status(409).json({error:'Pilih Sudut Netral sebelum menambah babak'});
  if(m.round!==m.totalRounds)return res.status(409).json({error:'Selesaikan babak yang sudah tersedia terlebih dahulu'});
  const duration=Math.min(3600,Math.max(1,Number(req.body.duration)||0));
  if(!Number.isFinite(Number(req.body.duration))||Number(req.body.duration)<1)return res.status(400).json({error:'Durasi babak wajib diisi minimal 1 detik'});
  resetRoundPenalties(m,(req.operator?.username||'operator'));m.totalRounds+=1;m.round=m.totalRounds;m.roundDurationMs=duration*1000;m.timerRemainingMs=duration*1000;m.timerStartedAt=null;m.status='jeda';
  audit('TAMBAH_BABAK',m.id,{round:m.round,duration},(req.operator?.username||'operator'));emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/manual', requireOperator, (req,res)=>{
  const m=currentMatch(req.params.id); const {side,type,points}=req.body; if(!m||!['red','blue'].includes(side)) return res.status(400).json({error:'Data tidak valid'});
  if(m.certified)return res.status(409).json({error:'Hasil sudah disahkan dan dikunci'});
  if(type==='score') m[side].score=Math.max(0,m[side].score+Number(points));
  if(type==='warning') m[side].warnings=Math.max(0,m[side].warnings+Number(points||1));
  if(type==='penalty') {m[side].penalties=Math.max(0,m[side].penalties+1);m[side].score=Math.max(0,m[side].score-Number(points||1));}
  if(type==='disqualify'){m.status='selesai';m.endedAt=now();m.timerRemainingMs=timerValue(m);m.timerStartedAt=null;m.winner=null;m.victoryReason='';m.suggestedLoser=side;}
  addEvent(m,{source:'operator',side,type,points:Number(points||0)});audit('PERUBAHAN_MANUAL',m.id,{side,type,points},(req.operator?.username||'operator'));emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/penalty',requireOperator,(req,res)=>{
  const m=currentMatch(req.params.id),side=req.body.side,type=req.body.type,injury=req.body.injury;
  if(!m||!['red','blue'].includes(side))return res.status(400).json({error:'Pesilat tidak valid'});
  if(m.certified||m.status==='selesai')return res.status(409).json({error:'Hukuman tidak dapat diubah setelah pertandingan diakhiri'});
  if(!['light','medium','heavy','disqualify'].includes(type))return res.status(400).json({error:'Jenis pelanggaran tidak valid'});
  if(type==='heavy'&&!['none','injury'].includes(injury))return res.status(400).json({error:'Pilih pelanggaran berat tanpa cedera atau dengan cedera'});
  ensurePenaltyState(m);const state=m[side].penaltyState;
  if(state.disqualified)return res.status(409).json({error:'Pesilat sudah didiskualifikasi'});
  const before=structuredClone(state);let deduction=0;
  const warning=()=>{if(state.peringatan===0){state.peringatan=1;deduction=5}else if(state.peringatan===1){state.peringatan=2;deduction=10}else state.disqualified=true};
  const reprimand=()=>{if(state.teguran===0){state.teguran=1;deduction=1}else if(state.teguran===1){state.teguran=2;deduction=2}else warning()};
  if(type==='light'){
    if(state.peringatan>0)warning();
    else if(state.teguran>=2)warning();
    else if(state.binaan<2)state.binaan+=1;
    else reprimand();
  }
  if(type==='medium'||(type==='heavy'&&injury==='none')){
    if(state.peringatan>0)warning();else reprimand();
  }
  if(type==='heavy'&&injury==='injury')warning();
  if(type==='disqualify')state.disqualified=true;
  if(state.disqualified&&!req.body.confirmDisqualification){m[side].penaltyState=before;return res.status(409).json({error:'Konfirmasi diskualifikasi diperlukan'})}
  m[side].score-=deduction;m[side].warnings=state.teguran;m[side].penalties=state.peringatan;
  const after=structuredClone(state),label=penaltyLabel(state);
  addEvent(m,{source:'operator',side,type:'penalty_state',violationType:type,injury:injury||null,penaltyLabel:label,before,after,points:-deduction});
  if(state.disqualified){m.timerRemainingMs=timerValue(m);m.timerStartedAt=null;m.status='selesai';m.endedAt=now();m.winner=null;m.victoryReason='';m.suggestedLoser=side}
  audit('HUKUMAN_OTOMATIS',m.id,{side,type,injury,before,after,deduction},(req.operator?.username||'operator'));emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/penalty-undo',requireOperator,(req,res)=>{
  const m=currentMatch(req.params.id),side=req.body.side;if(!m||!['red','blue'].includes(side))return res.status(400).json({error:'Pesilat tidak valid'});
  if(m.certified)return res.status(409).json({error:'Hasil sudah disahkan dan dikunci'});
  const e=[...m.events].reverse().find(x=>x.side===side&&x.type==='penalty_state'&&x.status==='aktif');
  if(!e)return res.status(400).json({error:'Belum ada hukuman yang dapat dibatalkan'});
  ensurePenaltyState(m);m[side].penaltyState=structuredClone(e.before);m[side].warnings=e.before.teguran;m[side].penalties=e.before.peringatan;m[side].score-=Number(e.points||0);e.status='dibatalkan';
  if(e.after?.disqualified){m.status='jeda';m.endedAt=null;m.winner=null;m.loser=null;m.victoryReason='';m.decision=null;m.suggestedLoser=null}
  audit('UNDO_HUKUMAN',m.id,{side,eventId:e.id},(req.operator?.username||'operator'));emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/reset-round-penalties',requireOperator,(req,res)=>{
  const m=currentMatch(req.params.id);if(!m)return res.status(404).json({error:'Pertandingan tidak ditemukan'});if(m.certified||m.status==='selesai')return res.status(409).json({error:'Hukuman tidak dapat direset saat ini'});
  resetRoundPenalties(m,(req.operator?.username||'operator'));emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/undo', requireOperator, (req,res)=>{
  const m=currentMatch(req.params.id);if(!m)return res.status(404).json({error:'Tidak ditemukan'});if(m.certified)return res.status(409).json({error:'Hasil sudah disahkan dan dikunci'}); const e=[...m.events].reverse().find(x=>x.status==='aktif'); if(!e)return res.status(400).json({error:'Tidak ada keputusan'});e.status='dibatalkan';
  if(e.source==='operator'&&e.type==='score')m[e.side].score=Math.max(0,m[e.side].score-e.points);
  if(e.source==='operator'&&e.type==='warning')m[e.side].warnings=Math.max(0,m[e.side].warnings-Number(e.points||1));
  if(e.source==='operator'&&e.type==='penalty'){m[e.side].penalties=Math.max(0,m[e.side].penalties-1);m[e.side].score+=Number(e.points||1);}
  if(e.validatedId){const v=m.validated.find(x=>x.id===e.validatedId&&x.status==='aktif');if(v){v.status='dibatalkan';m[v.side].score=Math.max(0,m[v.side].score-v.points);}}
  audit('BATALKAN_KEPUTUSAN',m.id,{eventId:e.id},(req.operator?.username||'operator'));emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/certify',requireOperator,(req,res)=>{
  const m=currentMatch(req.params.id);if(!m||m.status!=='selesai')return res.status(409).json({error:'Pertandingan harus diakhiri terlebih dahulu'});if(m.certified)return res.status(409).json({error:'Hasil sudah disahkan'});
  const winner=req.body.winner,reason=req.body.reason;
  const reasons=['Menang angka','Menang teknik','Menang mutlak','Lawan mengundurkan diri','Diskualifikasi','Keputusan wasit'];
  if(!['red','blue'].includes(winner))return res.status(400).json({error:'Pilih pemenang Sudut Merah atau Sudut Biru'});
  if(!reasons.includes(reason))return res.status(400).json({error:'Alasan kemenangan tidak valid'});
  const loser=winner==='red'?'blue':'red',winnerLabel=winner==='red'?'Sudut Merah':'Sudut Biru',loserLabel=loser==='red'?'Sudut Merah':'Sudut Biru';
  let detail=reason;
  if(reason==='Diskualifikasi')detail=`${winnerLabel} menang diskualifikasi — ${loserLabel} didiskualifikasi`;
  if(reason==='Lawan mengundurkan diri')detail=`${winnerLabel} menang — ${loserLabel} mengundurkan diri`;
  m.winner=winner;m.loser=loser;m.victoryReason=detail;m.decision={winner,loser,reason,detail};m.certified=true;
  audit('SAHKAN_HASIL',m.id,m.decision,(req.operator?.username||'operator'));emitMatch(m);res.json(publicMatch(m));
});
app.get('/api/matches/:id/export.xlsx', requireOperator, async(req,res)=>{const m=currentMatch(req.params.id);const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Rekap');ws.addRows([['POIN GELANGGANG'],['Partai',m.boutNumber],['Gelanggang',m.arena],['Merah',m.red.name,m.red.team,m.red.score],['Biru',m.blue.name,m.blue.team,m.blue.score],['Pemenang',m.winner],['Alasan',m.victoryReason],[],['Waktu','Sumber','Juri','Sudut','Nilai','Status']]);m.events.forEach(e=>ws.addRow([new Date(e.at),e.source,e.judgeName||'',e.side,e.points||'',e.status]));ws.columns.forEach(c=>c.width=20);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename=rekap-${m.code}.xlsx`);await wb.xlsx.write(res);res.end();});
app.get('/api/matches/:id/export.pdf', requireOperator, (req,res)=>{const m=currentMatch(req.params.id);res.setHeader('Content-Disposition',`attachment; filename=rekap-${m.code}.pdf`);res.type('pdf');const d=new PDFDocument({margin:48});d.pipe(res);d.fontSize(22).text('POIN GELANGGANG',{align:'center'}).moveDown();d.fontSize(12).text(`Kode: ${m.code}   Partai: ${m.boutNumber}   Gelanggang: ${m.arena}`).moveDown();d.fontSize(18).fillColor('#c62828').text(`${m.red.name} — ${m.red.score}`).fillColor('#1565c0').text(`${m.blue.name} — ${m.blue.score}`).fillColor('black').moveDown().fontSize(12).text(`Pemenang: ${m.winner==='red'?m.red.name:m.winner==='blue'?m.blue.name:'Seri'}`).text(`Alasan: ${m.victoryReason||'-'}`).text(`Status pengesahan: ${m.certified?'DISAHKAN':'Belum disahkan'}`).moveDown().text('Riwayat Nilai');m.events.slice(-40).forEach(e=>d.fontSize(9).text(`${new Date(e.at).toLocaleString('id-ID')} | ${e.source}${e.judgeName?' '+e.judgeName:''} | ${e.side||'-'} ${e.points||''} | ${e.status}`));d.end();});

const activeJudgeSockets = new Map();
io.on('connection', socket => {
  socket.on('operator:join', ({matchId})=>{socket.join(`match:${matchId}`);const m=currentMatch(matchId);if(m)socket.emit('match:update',publicMatch(m));});
  socket.on('display:join', ({code:roomCode})=>{const m=db.matches.find(x=>x.code===roomCode);if(!m)return socket.emit('error:message','Kode tidak ditemukan');socket.join(`match:${m.id}`);socket.emit('match:update',publicMatch(m));});
  socket.on('judge:join', ({code:roomCode,slot,name,deviceId})=>{
    const m=db.matches.find(x=>x.code===roomCode); slot=Number(slot); if(!m||![1,2,3].includes(slot))return socket.emit('judge:error','Kode/nomor juri tidak valid');
    const key=`${m.id}:${slot}`;const old=activeJudgeSockets.get(key);if(old&&old!==socket.id)return socket.emit('judge:error','Akun juri sedang aktif di perangkat lain');
    activeJudgeSockets.set(key,socket.id);socket.data={...socket.data,matchId:m.id,slot,deviceId};socket.join(`match:${m.id}`);m.judges[slot]={name:name||`Juri ${slot}`,connected:true,lastSeen:now(),deviceId};audit('JURI_TERHUBUNG',m.id,{slot,name:m.judges[slot].name},`juri-${slot}`);emitMatch(m);socket.emit('judge:joined',publicMatch(m));
  });
  socket.on('judge:score', ({side,points,clientAt})=>{
    const {matchId,slot}=socket.data||{};const m=currentMatch(matchId);points=Number(points);if(!m||m.status!=='berlangsung'||!['red','blue'].includes(side)||!m.enabledScores.includes(points))return socket.emit('judge:error','Nilai tidak dapat dikirim saat ini');
    const e={id:id(),at:now(),clientAt:Number(clientAt||now()),source:'judge',judge:slot,judgeName:m.judges[slot]?.name||`Juri ${slot}`,side,points,status:'aktif'};m.events.push(e);
    const candidates=m.events.filter(x=>x.source==='judge'&&x.status==='aktif'&&!x.validatedId&&x.side===side&&x.points===points&&Math.abs(x.at-e.at)<=m.validationWindowMs);
    const unique=[...new Map(candidates.map(x=>[x.judge,x])).values()];
    if(unique.length>=2){const group=unique.slice(0,3);const v={id:id(),side,points,at:now(),judgeEvents:group.map(x=>x.id),status:'aktif'};m.validated.push(v);group.forEach(x=>{x.validatedId=v.id});m[side].score+=points;group.forEach(x=>{const ev=m.events.find(y=>y.id===x.id);if(ev)ev.validatedId=v.id});e.validatedId=v.id;io.to(`match:${m.id}`).emit('score:validated',v);}
    save();emitMatch(m);socket.emit('judge:ack',{event:e});
  });
  socket.on('judge:undo',()=>{const {matchId,slot}=socket.data||{};const m=currentMatch(matchId);const e=[...m.events].reverse().find(x=>x.judge===slot&&x.status==='aktif');if(!e)return; e.status='dibatalkan';if(e.validatedId){const v=m.validated.find(x=>x.id===e.validatedId&&x.status==='aktif');if(v){v.status='dibatalkan';m[v.side].score=Math.max(0,m[v.side].score-v.points);}}audit('JURI_UNDO',m.id,{slot,eventId:e.id},`juri-${slot}`);emitMatch(m);});
  socket.on('disconnect',()=>{const {matchId,slot}=socket.data||{};if(!matchId)return;const key=`${matchId}:${slot}`;if(activeJudgeSockets.get(key)===socket.id)activeJudgeSockets.delete(key);const m=currentMatch(matchId);if(m?.judges?.[slot]){m.judges[slot].connected=false;m.judges[slot].lastSeen=now();save();emitMatch(m);}});
});

setInterval(()=>{db.matches.filter(m=>m.status==='berlangsung').forEach(m=>{if(timerValue(m)<=0){m.timerRemainingMs=0;m.timerStartedAt=null;m.status='jeda';audit('WAKTU_HABIS',m.id);emitMatch(m);}})},250);
if (!process.env.VERCEL) server.listen(PORT,'0.0.0.0',()=>console.log(`POIN GELANGGANG aktif di http://localhost:${PORT}`));
module.exports = app;
module.exports.app = app;
module.exports.server = server;
