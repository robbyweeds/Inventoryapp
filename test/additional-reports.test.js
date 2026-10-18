process.env.EQUIPTAGS_LEGACY_DIVISIONS='1';
process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('public additional issues preserve the original ticket and repair progress, support escalation and retain reporter history',async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'equiptags-extra-reports-'));fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.js'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'));process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='0000';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function request(url,method='GET',body,staff=false){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(staff?{'x-edit-pin':'8008'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()}}
 try{
  const item=(await request('/equipment','POST',{name:'Mower with several issues'},true)).data,url='/equipment/'+item.tag_id;
  const first=await request(url+'/tickets','POST',{reported_by:'Foreman One',description:'Loose cover',status:'Needs Attention'});assert.equal(first.status,201);const id=first.data.id;
  const second=await request(url+'/tickets','POST',{reported_by:'Crew Two',description:'Also vibrating at idle'});assert.equal(second.status,200);assert.equal(second.data.id,id);assert.equal(second.data.description,'Loose cover');assert.equal(second.data.reported_by,'Foreman One');assert.equal(second.data.status,'Needs Attention');assert.equal(second.data.updates[0].actor_name,'Crew Two');assert.ok(second.data.updates[0].created_at);assert.match(second.data.updates[0].notes,/Also vibrating at idle/);
  assert.equal((await request(url+'/tickets','POST',{reported_by:'',description:'Bad'})).status,400);assert.equal((await request(url+'/tickets','POST',{reported_by:'Crew',description:'Bad',status:'In Service'})).status,400);assert.equal((await request(url+'/tickets/'+id,'PUT',{status:'In Service',notes:'Unauthenticated resolution'})).status,401);
  const escalated=await request(url+'/tickets','POST',{reported_by:'Crew Three',description:'Blade guard fell off',status:'Tagged Out'});assert.equal(escalated.status,200);assert.equal(escalated.data.status,'Tagged Out');assert.equal((await request(url)).data.status,'Tagged Out');
  assert.equal((await request(url+'/tickets','POST',{reported_by:'Crew',description:'Cannot downgrade',status:'Needs Attention'})).status,409);
  for(const status of ['With Mechanic','Awaiting Parts']){
   assert.equal((await request(url+'/tickets/'+id,'PUT',{status,notes:'Repair in progress'},true)).status,200);
   for(const report of [{reported_by:'Crew Four',description:'Another issue'}, {reported_by:'Crew Five',description:'More damage',status:'Tagged Out'}]){const result=await request(url+'/tickets','POST',report);assert.equal(result.status,200);assert.equal(result.data.status,status);assert.equal((await request(url)).data.status,status)}
  }
  const detail=(await request(url)).data;assert.equal(detail.tickets.length,1);assert.equal(detail.maintenance.length,1);assert.equal(detail.tickets[0].updates.length,8);assert.equal((await request('/tickets/open')).data.length,1);assert.ok((await request('/tickets/open')).data[0].latest_update.includes('More damage'));
  const db=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'),{readonly:true});const audits=db.prepare("SELECT * FROM audit_log WHERE action='Reported additional problem'").all();assert.equal(audits.length,6);assert.ok(audits.every(row=>row.actor_role==='Public reporter'));db.close();
  await request(url+'/tickets/'+id,'PUT',{status:'In Service',notes:'All reported issues inspected and fixed'},true);assert.equal((await request(url+'/tickets','POST',{reported_by:'Crew Six',description:'New issue after resolution'})).status,201);assert.equal((await request(url)).data.tickets.length,2);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
