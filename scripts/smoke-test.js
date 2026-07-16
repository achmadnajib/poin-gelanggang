const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
async function request(path, { method='GET', cookie, body }={}) {
  const r=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  const type=r.headers.get('content-type')||'';const data=type.includes('json')?await r.json():await r.arrayBuffer();return {r,data};
}
(async()=>{
  let x=await request('/health');assert.equal(x.r.status,200);
  x=await request('/api/matches');assert.equal(x.r.status,401);
  x=await request('/api/login',{method:'POST',body:{username:'operator',password:'salah'}});assert.equal(x.r.status,401);
  x=await request('/api/login',{method:'POST',body:{username:'operator',password:'gelanggang123'}});assert.equal(x.r.status,200);const cookie=x.r.headers.get('set-cookie').split(';')[0];
  x=await request('/api/matches',{method:'POST',cookie,body:{boutNumber:'SMOKE-'+Date.now(),arena:'1',category:'Tanding',className:'A',redName:'Merah Audit',blueName:'Biru Audit',duration:30,validationWindow:2}});assert.equal(x.r.status,200);const m=x.data;
  x=await request(`/api/public/match/${m.code}`);assert.equal(x.data.id,m.id);
  x=await request(`/api/matches/${m.id}/certify`,{method:'POST',cookie,body:{reason:'Menang angka'}});assert.equal(x.r.status,409);
  x=await request('/api/judge/join',{method:'POST',body:{code:m.code,slot:1,name:'J1',accessCode:'salah',deviceId:'d1'}});assert.equal(x.r.status,403);
  for(const slot of [1,2,3]){x=await request('/api/judge/join',{method:'POST',body:{code:m.code,slot,name:'J'+slot,accessCode:`${m.code}-${slot}`,deviceId:'d'+slot}});assert.equal(x.r.status,200)}
  x=await request('/api/judge/join',{method:'POST',body:{code:m.code,slot:1,name:'Palsu',accessCode:`${m.code}-1`,deviceId:'lain'}});assert.equal(x.r.status,409);
  x=await request(`/api/matches/${m.id}/control`,{method:'POST',cookie,body:{action:'start'}});assert.equal(x.data.status,'berlangsung');
  x=await request('/api/judge/score',{method:'POST',body:{matchId:m.id,slot:1,deviceId:'d1',side:'red',points:2}});assert.equal(x.data.match.red.score,0);
  x=await request('/api/judge/score',{method:'POST',body:{matchId:m.id,slot:2,deviceId:'d2',side:'red',points:2}});assert.equal(x.data.match.red.score,2);assert.equal(x.data.match.validated.length,1);
  x=await request('/api/judge/undo',{method:'POST',body:{matchId:m.id,slot:2,deviceId:'d2'}});assert.equal(x.data.red.score,0);
  x=await request(`/api/matches/${m.id}/manual`,{method:'POST',cookie,body:{side:'blue',type:'score',points:3}});assert.equal(x.data.blue.score,3);
  x=await request(`/api/matches/${m.id}/undo`,{method:'POST',cookie});assert.equal(x.data.blue.score,0);
  x=await request(`/api/matches/${m.id}/control`,{method:'POST',cookie,body:{action:'pause'}});assert.equal(x.data.status,'jeda');
  x=await request('/api/judge/score',{method:'POST',body:{matchId:m.id,slot:1,deviceId:'d1',side:'blue',points:1}});assert.equal(x.r.status,400);
  x=await request(`/api/matches/${m.id}/control`,{method:'POST',cookie,body:{action:'end'}});assert.equal(x.data.status,'selesai');
  x=await request(`/api/matches/${m.id}/certify`,{method:'POST',cookie,body:{reason:'Menang angka',winner:'seri'}});assert.equal(x.data.certified,true);
  x=await request(`/api/matches/${m.id}/manual`,{method:'POST',cookie,body:{side:'red',type:'score',points:1}});assert.equal(x.r.status,409);
  x=await request(`/api/matches/${m.id}/export.pdf`,{cookie});assert.equal(x.r.status,200);assert.ok(x.data.byteLength>500);
  x=await request(`/api/matches/${m.id}/export.xlsx`,{cookie});assert.equal(x.r.status,200);assert.ok(x.data.byteLength>1000);
  x=await request(`/api/matches/${m.id}/duplicate`,{method:'POST',cookie});assert.equal(x.r.status,200);assert.notEqual(x.data.code,m.code);
  console.log(JSON.stringify({ok:true,base,matchCode:m.code,checks:23}));
})().catch(e=>{console.error(e);process.exit(1)});
