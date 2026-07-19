const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const base = 'http://127.0.0.1:3000';
async function operatorSession() {
  const login = await fetch(base + '/api/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username:process.env.TEST_OPERATOR_USERNAME,password:process.env.TEST_OPERATOR_PASSWORD}) });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie').split(';')[0];
}
test('dua dari tiga juri mengesahkan satu nilai', async () => {
  const cookie = await operatorSession();
  const create = await fetch(base + '/api/matches', { method:'POST', headers:{'content-type':'application/json',cookie}, body:JSON.stringify({boutNumber:'TEST',redName:'Merah Test',blueName:'Biru Test',duration:30,validationWindow:2}) });
  const match = await create.json(); assert.ok(match.code);
  await fetch(`${base}/api/matches/${match.id}/control`, {method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({action:'start'})});
  const judges = [1,2].map(slot => io(base,{forceNew:true}));
  await Promise.all(judges.map((s,i)=>new Promise((resolve,reject)=>{s.on('connect',()=>s.emit('judge:join',{code:match.code,slot:i+1,name:`Juri ${i+1}`,accessCode:`${match.code}-${i+1}`,deviceId:`test-${i}`}));s.on('judge:joined',resolve);s.on('judge:error',reject)})));
  judges[0].emit('judge:score',{side:'red',points:2,clientAt:Date.now()});
  await new Promise(r=>setTimeout(r,100));
  judges[1].emit('judge:score',{side:'red',points:2,clientAt:Date.now()});
  await new Promise(r=>setTimeout(r,250));
  const list = await fetch(base + '/api/matches',{headers:{cookie}}).then(r=>r.json());
  const actual=list.find(x=>x.id===match.id);assert.equal(actual.red.score,2);assert.equal(actual.validated.length,1);assert.equal(actual.events.filter(x=>x.source==='judge').length,2);
  judges.forEach(s=>s.close());
  const xlsx=await fetch(`${base}/api/matches/${match.id}/export.xlsx`,{headers:{cookie}});assert.equal(xlsx.status,200);assert.match(xlsx.headers.get('content-type'),/spreadsheet/);
});
