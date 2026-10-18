process.env.EQUIPTAGS_LEGACY_DIVISIONS='1';
process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
test('role permissions, atomic reassignment, stale edits, and progress history',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'equiptags-roles-'));
 fs.copyFileSync(path.join(__dirname,'../server.js'),path.join(dir,'server.js'));
 fs.symlinkSync(path.join(__dirname,'../node_modules'),path.join(dir,'node_modules'));
 fs.symlinkSync(path.join(__dirname,'../public'),path.join(dir,'public'));
 process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 async function req(url,method='GET',body,pin,master=false){const res=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'Content-Type':'application/json',...(pin?{[master?'x-master-pin':'x-edit-pin']:pin}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:res.status===204?null:await res.json()}}
 try{
  for(const [role,pin] of [['Manager','2002'],['Mechanic','3003'],['Crew','1001']])assert.equal((await req('/admin/pins','POST',{name:role,role,pin},'5678',true)).status,201);
  assert.equal((await req('/auth/pin','POST',{},'2002')).data.role,'Manager');
  assert.equal((await req('/equipment','POST',{name:'Manager-created fixture'},'2002')).status,201);
  assert.equal((await req('/equipment','POST',{name:'Admin cannot edit equipment'},'5678')).status,403);
  const one=(await req('/equipment','POST',{name:'Mower',crew_assigned:'Old crew'},'1234')).data;
  const two=(await req('/equipment','POST',{name:'Blower'},'1234')).data;
  assert.equal((await req('/crew-options','POST',{name:'Crew A'},'3003')).status,403);
  assert.equal((await req('/crew-options','POST',{name:'Crew A'},'2002')).status,201);
  assert.equal((await req('/trailer-options','POST',{name:'Trailer 1'},'2002')).status,201);
  const expected=x=>({tag_id:x.tag_id,crew_assigned:x.crew_assigned||'',trailer_assigned:x.trailer_assigned||'',location:x.location||''});
  const body={items:[expected(one),expected(two)],crew_assigned:'Crew A',trailer_assigned:'Trailer 1',location:'Yard',note:'Monday handoff'};
  for(const pin of [undefined,'1001','3003'])assert.equal((await req('/assignments','POST',body,pin)).status,pin?403:401);
  const stale=structuredClone(body);stale.items[1].location='Unexpected';
  assert.equal((await req('/assignments','POST',stale,'2002')).status,409);
  assert.equal((await req('/equipment/'+one.tag_id)).data.crew_assigned,'Old crew');
  assert.equal((await req('/assignments','POST',body,'2002')).status,200);
  assert.equal((await req('/assignments','POST',body,'2002')).status,409);
  assert.equal((await req('/equipment/'+two.tag_id)).data.location,'Yard');
  assert.equal((await req('/equipment/'+one.tag_id,'PUT',{name:'Unauthorized'},'3003')).status,403);
  assert.equal((await req('/equipment/'+one.tag_id+'/status','PUT',{status:'Sold'},'2002')).status,200);
  assert.equal((await req('/equipment/'+one.tag_id+'/status','PUT',{status:'In Service'},'2002')).status,200);
  assert.equal((await req('/equipment/'+one.tag_id+'/status','PUT',{status:'In Service'},'1001')).status,403);
  const ticket=(await req('/equipment/'+one.tag_id+'/tickets','POST',{reported_by:'Crew member',description:'Broken belt'})).data;
  const ticketURL='/equipment/'+one.tag_id+'/tickets/'+ticket.id;
  assert.equal((await req(ticketURL,'PUT',{status:'With Mechanic',notes:'Inspecting'},'3003')).status,200);
  assert.equal((await req(ticketURL,'PUT',{status:'With Mechanic',notes:'Belt ordered'},'3003')).status,200);
  let item=(await req('/equipment/'+one.tag_id)).data;
  assert.equal(item.status,'With Mechanic');assert.equal(item.tickets[0].updates.length,2);
  assert.equal((await req(ticketURL,'PUT',{status:'In Service',notes:'Belt replaced and tested'},'3003')).status,200);
  assert.equal((await req('/equipment/'+one.tag_id)).data.status,'In Service');
  const pins=(await req('/admin/pins','GET',undefined,'5678',true)).data;
  const mechanic=pins.find(p=>p.role==='Mechanic');
  assert.equal((await req('/admin/pins/'+mechanic.id+'/role','PUT',{role:'Crew'},'5678',true)).status,200);
  assert.equal((await req('/equipment/'+two.tag_id+'/status','PUT',{status:'Out of Service'},'3003')).status,403);
  const db=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'),{readonly:true});
  const logs=db.prepare("SELECT * FROM audit_log WHERE action='Reassigned equipment'").all();assert.equal(logs.length,2);assert.equal(JSON.parse(logs[0].details).note,'Monday handoff');assert.equal(logs[0].actor_name,'Manager');db.close();
  const page=await fetch(`http://127.0.0.1:${server.address().port}/equiptags/`);assert.equal(page.status,200);assert.match(await page.text(),/workspaces.js/);
  assert.equal((await req('/equiptags-api/health')).data.ok,true);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});

test('partial reassignment preserves mixed assignments, clears explicitly, and skips no-op audit entries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'equiptags-partial-'));
 fs.copyFileSync(path.join(__dirname,'../server.js'),path.join(dir,'server.js'));
 fs.symlinkSync(path.join(__dirname,'../node_modules'),path.join(dir,'node_modules'));
 process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 async function req(url,method='GET',body){const response=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'Content-Type':'application/json','x-edit-pin':'1234'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()}}
 const expected=x=>({tag_id:x.tag_id,crew_assigned:x.crew_assigned||'',trailer_assigned:x.trailer_assigned||'',location:x.location||''});
 try{
  await req('/crew-options','POST',{name:'New crew'});
  await req('/trailer-options','POST',{name:'Trailer A'});await req('/trailer-options','POST',{name:'Trailer B'});
  const one=(await req('/equipment','POST',{name:'One',crew_assigned:'Old A',trailer_assigned:'Trailer A',location:'Yard A'})).data;
  const two=(await req('/equipment','POST',{name:'Two',crew_assigned:'Old B',trailer_assigned:'Trailer B',location:'Yard B'})).data;
  const original=[expected(one),expected(two)];
  assert.equal((await req('/assignments','POST',{items:original})).status,400);
  assert.equal((await req('/assignments','POST',{items:original,crew_assigned:null})).status,400);
  assert.equal((await req('/assignments','POST',{items:original,crew_assigned:'Unknown'})).status,400);
  assert.equal((await req('/assignments','POST',{items:[original[0],original[0]],crew_assigned:'New crew'})).status,400);
  assert.equal((await req('/assignments','POST',{items:original,crew_assigned:'New crew'})).data.updated,2);
  let after=[(await req('/equipment/'+one.tag_id)).data,(await req('/equipment/'+two.tag_id)).data];
  assert.deepEqual(after.map(x=>x.crew_assigned),['New crew','New crew']);
  assert.deepEqual(after.map(x=>x.trailer_assigned),['Trailer A','Trailer B']);
  assert.deepEqual(after.map(x=>x.location),['Yard A','Yard B']);
  assert.equal((await req('/assignments','POST',{items:after.map(expected),crew_assigned:'New crew'})).data.updated,0);
  const db=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'),{readonly:true});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='Reassigned equipment'").get().n,2);db.close();
  assert.equal((await req('/assignments','POST',{items:original,trailer_assigned:''})).status,409);
  assert.equal((await req('/equipment/'+one.tag_id)).data.trailer_assigned,'Trailer A');
  assert.equal((await req('/assignments','POST',{items:after.map(expected),trailer_assigned:''})).data.updated,2);
  after=[(await req('/equipment/'+one.tag_id)).data,(await req('/equipment/'+two.tag_id)).data];
  assert.deepEqual(after.map(x=>x.trailer_assigned),['','']);assert.deepEqual(after.map(x=>x.location),['Yard A','Yard B']);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});

test('admin manages access while managers manage equipment and equipment history',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'equiptags-manager-scope-'));
 fs.copyFileSync(path.join(__dirname,'../server.js'),path.join(dir,'server.js'));fs.symlinkSync(path.join(__dirname,'../node_modules'),path.join(dir,'node_modules'));
 process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='0000';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 async function req(url,method='GET',body,pin='1111',master=false){const response=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{'Content-Type':'application/json',[master?'x-master-pin':'x-edit-pin']:pin},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:response.status===204?null:await response.json()}}
 try{
  assert.equal((await req('/admin/pins','POST',{name:'Manager',role:'Manager',pin:'1111'},'0000',true)).status,201);
  assert.equal((await req('/admin/pins','POST',{name:'Mechanic',role:'Mechanic',pin:'2222'},'0000',true)).status,201);
  assert.equal((await req('/equipment','POST',{name:'Admin forbidden'},'0000')).status,403);
  const created=await req('/equipment','POST',{name:'Manager fixture',manufacturer:'Original'});assert.equal(created.status,201);
  const url='/equipment/'+created.data.tag_id;
  assert.equal((await req(url,'PUT',{name:'Updated machine',manufacturer:'Updated',model:'Test model',serial_number:'SN-1',engine_hours:25,location:'Shop',notes:'Manager update'})).status,200);
  const item=(await req(url)).data;assert.equal(item.name,'Updated machine');assert.equal(item.serial_number,'SN-1');assert.equal(item.engine_hours,25);
  assert.equal((await req(url,'PUT',{notes:'Admin forbidden'},'0000')).status,403);
  assert.equal((await req(url+'/status','PUT',{status:'Sold'},'0000')).status,403);
  assert.equal((await req(url,'DELETE',undefined,'0000')).status,403);
  assert.equal((await req(url+'/status','PUT',{status:'Sold'})).status,200);
  assert.equal((await req(url+'/status','PUT',{status:'In Service'})).status,200);
  assert.equal((await req(url+'/audit')).status,200);
  assert.equal((await req(url+'/audit','GET',undefined,'0000')).status,403);
  assert.equal((await req(url+'/audit','GET',undefined,'2222')).status,403);
  const history=await req('/audit');assert.equal(history.status,200);assert.ok(history.data.items.length>0);assert.ok(history.data.items.every(row=>row.entity_type!=='security'));
  assert.equal((await req('/audit','GET',undefined,'0000')).status,403);
  assert.equal((await req('/admin/pins','GET',undefined,'1111',true)).status,401);
  assert.equal((await req('/admin/master-pin','POST',{master_pin:'9999'},'1111',true)).status,401);
  assert.equal((await req('/admin/pins','GET',undefined,'0000',true)).status,200);
  assert.equal((await req('/admin/pins','POST',{name:'Crew',role:'Crew',pin:'3333'},'0000',true)).status,201);
  const log=await req(url+'/maintenance','POST',{service_date:'2026-10-18',service_type:'Inspection',notes:'Checked'});assert.equal(log.status,201);
  assert.equal((await req(url,'DELETE')).status,409);
  assert.equal((await req('/maintenance/'+log.data.id,'DELETE')).status,204);
  assert.equal((await req(url,'DELETE')).status,204);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
