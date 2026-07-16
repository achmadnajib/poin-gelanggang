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

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const now = () => Date.now();
const id = () => crypto.randomUUID();

const initialDb = () => ({
  users: [{ id: 'operator', username: 'operator', passwordHash: bcrypt.hashSync('gelanggang123', 10), role: 'operator' }],
  matches: [], audit: []
});
function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(initialDb(), null, 2));
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return initialDb(); }
}
let db = loadDb();
let saveTimer;
function save() {
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
function code() { return String(Math.floor(100000 + Math.random() * 900000)); }
function publicMatch(m) {
  if (!m) return null;
  const timer = timerValue(m);
  return { ...m, timer, serverNow: now() };
}
function timerValue(m) {
  if (m.status === 'berlangsung' && m.timerStartedAt) return Math.max(0, m.timerRemainingMs - (now() - m.timerStartedAt));
  return Math.max(0, m.timerRemainingMs || 0);
}
function emitMatch(m) { io.to(`match:${m.id}`).emit('match:update', publicMatch(m)); io.emit('matches:update', db.matches.map(publicMatch)); }
function currentMatch(matchId) { return db.matches.find(m => m.id === matchId); }
function requireOperator(req, res, next) { if (req.session?.user?.role === 'operator') return next(); res.status(401).json({ error: 'Login operator diperlukan' }); }
function addEvent(m, event) { m.events.push({ id: id(), at: now(), status: 'aktif', ...event }); save(); }

app.use(express.json({ limit: '1mb' }));
app.use(session({ secret: process.env.SESSION_SECRET || 'poin-gelanggang-lokal-ganti-ini', resave: false, saveUninitialized: false, cookie: { maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax' } }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.redirect('/operator'));
app.get('/health', (_, res) => res.json({ ok: true, service: 'poin-gelanggang' }));
app.get('/operator', (_, res) => res.sendFile(path.join(__dirname, 'public/operator.html')));
app.get('/juri', (_, res) => res.sendFile(path.join(__dirname, 'public/juri.html')));
app.get('/display', (_, res) => res.sendFile(path.join(__dirname, 'public/display.html')));

app.post('/api/login', (req, res) => {
  const u = db.users.find(x => x.username === req.body.username && x.role === 'operator');
  if (!u || !bcrypt.compareSync(req.body.password || '', u.passwordHash)) return res.status(401).json({ error: 'Nama pengguna atau password salah' });
  req.session.user = { id: u.id, username: u.username, role: u.role }; audit('LOGIN', null, {}, u.username); res.json(req.session.user);
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.get('/api/matches', requireOperator, (_, res) => res.json(db.matches.map(publicMatch)));
app.post('/api/matches', requireOperator, (req, res) => {
  const b = req.body; const m = {
    id: id(), code: code(), boutNumber: b.boutNumber || '', arena: b.arena || '1', category: b.category || 'Tanding', className: b.className || '',
    red: { name: b.redName || 'Pesilat Merah', team: b.redTeam || '', score: 0, warnings: 0, penalties: 0 },
    blue: { name: b.blueName || 'Pesilat Biru', team: b.blueTeam || '', score: 0, warnings: 0, penalties: 0 },
    round: 1, totalRounds: Number(b.totalRounds || 3), roundDurationMs: Number(b.duration || 120) * 1000,
    timerRemainingMs: Number(b.duration || 120) * 1000, timerStartedAt: null, status: 'menunggu',
    validationWindowMs: Number(b.validationWindow || 2) * 1000, enabledScores: b.enabledScores || [1,2,3],
    judges: {}, events: [], validated: [], startedAt: null, endedAt: null, winner: null, victoryReason: '', certified: false, createdAt: now()
  };
  db.matches.unshift(m); audit('BUAT_PERTANDINGAN', m.id, { code: m.code }, req.session.user.username); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/duplicate', requireOperator, (req, res) => {
  const src = currentMatch(req.params.id); if (!src) return res.status(404).json({ error: 'Tidak ditemukan' });
  const m = { ...structuredClone(src), id: id(), code: code(), status: 'menunggu', round: 1, timerRemainingMs: src.roundDurationMs, timerStartedAt: null, judges: {}, events: [], validated: [], red: {...src.red, score:0,warnings:0,penalties:0}, blue:{...src.blue,score:0,warnings:0,penalties:0}, winner:null, certified:false, createdAt:now() };
  db.matches.unshift(m); audit('DUPLIKASI', m.id, { source: src.id }, req.session.user.username); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/reset', requireOperator, (req, res) => {
  const m = currentMatch(req.params.id); const u = db.users.find(x => x.id === req.session.user.id);
  if (!bcrypt.compareSync(req.body.password || '', u.passwordHash)) return res.status(403).json({ error: 'Password salah' });
  Object.assign(m, {status:'menunggu',round:1,timerRemainingMs:m.roundDurationMs,timerStartedAt:null,events:[],validated:[],startedAt:null,endedAt:null,winner:null,certified:false}); Object.assign(m.red,{score:0,warnings:0,penalties:0}); Object.assign(m.blue,{score:0,warnings:0,penalties:0});
  audit('RESET',m.id,{},u.username); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/control', requireOperator, (req, res) => {
  const m = currentMatch(req.params.id); if (!m) return res.status(404).json({error:'Tidak ditemukan'}); const action=req.body.action;
  if (action==='start'||action==='resume') { if (!m.startedAt) m.startedAt=now(); m.status='berlangsung'; m.timerStartedAt=now(); }
  if (action==='pause') { m.timerRemainingMs=timerValue(m); m.timerStartedAt=null; m.status='jeda'; }
  if (action==='next') { m.round=Math.min(m.totalRounds,m.round+1); m.timerRemainingMs=m.roundDurationMs; m.timerStartedAt=null; m.status='jeda'; }
  if (action==='end') { m.timerRemainingMs=timerValue(m); m.timerStartedAt=null;m.status='selesai';m.endedAt=now();m.winner=m.red.score===m.blue.score?'seri':(m.red.score>m.blue.score?'red':'blue'); }
  audit(`KONTROL_${action.toUpperCase()}`,m.id,{},req.session.user.username); emitMatch(m); res.json(publicMatch(m));
});
app.post('/api/matches/:id/manual', requireOperator, (req,res)=>{
  const m=currentMatch(req.params.id); const {side,type,points}=req.body; if(!m||!['red','blue'].includes(side)) return res.status(400).json({error:'Data tidak valid'});
  if(type==='score') m[side].score=Math.max(0,m[side].score+Number(points));
  if(type==='warning') m[side].warnings=Math.max(0,m[side].warnings+Number(points||1));
  if(type==='penalty') {m[side].penalties=Math.max(0,m[side].penalties+1);m[side].score=Math.max(0,m[side].score-Number(points||1));}
  if(type==='disqualify'){m.status='selesai';m.endedAt=now();m.winner=side==='red'?'blue':'red';m.victoryReason='Diskualifikasi';}
  addEvent(m,{source:'operator',side,type,points:Number(points||0)});audit('PERUBAHAN_MANUAL',m.id,{side,type,points},req.session.user.username);emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/undo', requireOperator, (req,res)=>{
  const m=currentMatch(req.params.id); const e=[...m.events].reverse().find(x=>x.status==='aktif'); if(!e)return res.status(400).json({error:'Tidak ada keputusan'});e.status='dibatalkan';
  if(e.type==='score'&&e.source==='operator')m[e.side].score=Math.max(0,m[e.side].score-e.points);
  if(e.validatedId){const v=m.validated.find(x=>x.id===e.validatedId&&x.status==='aktif');if(v){v.status='dibatalkan';m[v.side].score=Math.max(0,m[v.side].score-v.points);}}
  audit('BATALKAN_KEPUTUSAN',m.id,{eventId:e.id},req.session.user.username);emitMatch(m);res.json(publicMatch(m));
});
app.post('/api/matches/:id/certify',requireOperator,(req,res)=>{const m=currentMatch(req.params.id);m.victoryReason=req.body.reason||'Menang angka';m.winner=req.body.winner||m.winner;m.certified=true;audit('SAHKAN_HASIL',m.id,{winner:m.winner,reason:m.victoryReason},req.session.user.username);emitMatch(m);res.json(publicMatch(m));});
app.get('/api/matches/:id/export.xlsx', requireOperator, async(req,res)=>{const m=currentMatch(req.params.id);const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Rekap');ws.addRows([['POIN GELANGGANG'],['Partai',m.boutNumber],['Gelanggang',m.arena],['Merah',m.red.name,m.red.team,m.red.score],['Biru',m.blue.name,m.blue.team,m.blue.score],['Pemenang',m.winner],['Alasan',m.victoryReason],[],['Waktu','Sumber','Juri','Sudut','Nilai','Status']]);m.events.forEach(e=>ws.addRow([new Date(e.at),e.source,e.judgeName||'',e.side,e.points||'',e.status]));ws.columns.forEach(c=>c.width=20);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename=rekap-${m.code}.xlsx`);await wb.xlsx.write(res);res.end();});
app.get('/api/matches/:id/export.pdf', requireOperator, (req,res)=>{const m=currentMatch(req.params.id);res.setHeader('Content-Disposition',`attachment; filename=rekap-${m.code}.pdf`);res.type('pdf');const d=new PDFDocument({margin:48});d.pipe(res);d.fontSize(22).text('POIN GELANGGANG',{align:'center'}).moveDown();d.fontSize(12).text(`Kode: ${m.code}   Partai: ${m.boutNumber}   Gelanggang: ${m.arena}`).moveDown();d.fontSize(18).fillColor('#c62828').text(`${m.red.name} — ${m.red.score}`).fillColor('#1565c0').text(`${m.blue.name} — ${m.blue.score}`).fillColor('black').moveDown().fontSize(12).text(`Pemenang: ${m.winner==='red'?m.red.name:m.winner==='blue'?m.blue.name:'Seri'}`).text(`Alasan: ${m.victoryReason||'-'}`).text(`Status pengesahan: ${m.certified?'DISAHKAN':'Belum disahkan'}`).moveDown().text('Riwayat Nilai');m.events.slice(-40).forEach(e=>d.fontSize(9).text(`${new Date(e.at).toLocaleString('id-ID')} | ${e.source}${e.judgeName?' '+e.judgeName:''} | ${e.side||'-'} ${e.points||''} | ${e.status}`));d.end();});

const activeJudgeSockets = new Map();
io.on('connection', socket => {
  socket.on('operator:join', ({matchId})=>{socket.join(`match:${matchId}`);const m=currentMatch(matchId);if(m)socket.emit('match:update',publicMatch(m));});
  socket.on('display:join', ({code:roomCode})=>{const m=db.matches.find(x=>x.code===roomCode);if(!m)return socket.emit('error:message','Kode tidak ditemukan');socket.join(`match:${m.id}`);socket.emit('match:update',publicMatch(m));});
  socket.on('judge:join', ({code:roomCode,slot,name,accessCode,deviceId})=>{
    const m=db.matches.find(x=>x.code===roomCode); slot=Number(slot); if(!m||![1,2,3].includes(slot))return socket.emit('judge:error','Kode/nomor juri tidak valid');
    if(accessCode!==`${roomCode}-${slot}`)return socket.emit('judge:error',`Kode akses salah. Format demo: ${roomCode}-${slot}`);
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
server.listen(PORT,'0.0.0.0',()=>console.log(`POIN GELANGGANG aktif di http://localhost:${PORT}`));
module.exports={app,server};
