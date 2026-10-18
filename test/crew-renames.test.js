process.env.EQUIPTAGS_LEGACY_DIVISIONS='1';
process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('manager crew rename preserves equipment assignments and history, isolates divisions, and rolls back duplicate names',async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'equiptags-crew-rename-'));fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.js'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'));process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='0000';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function req(url,method='GET',body,pin='2002',master=false){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(pin?{[master?'x-master-pin':'x-edit-pin']:pin}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()}}
 try{
  for(const[name,role,pin]of[['Manager','Manager','2002'],['Mechanic','Mechanic','3003'],['Crew','Crew','1001']])assert.equal((await req('/admin/pins','POST',{name,role,pin},'0000',true)).status,201);
  for(const division_id of[1,2])assert.equal((await req('/crew-options','POST',{name:'Crew 1',division_id})).status,201);
  await req('/crew-options','POST',{name:'Crew 2',division_id:1});const crews=(await req('/crew-options?divisions=1')).data,crew=crews.find(row=>row.name==='Crew 1');
  const a=(await req('/equipment','POST',{name:'Chester mower',division_id:1,crew_assigned:'crew 1',engine_hours:45,notes:'Keep me'})).data,b=(await req('/equipment','POST',{name:'Plymouth mower',division_id:2,crew_assigned:'Crew 1'})).data;
  await req('/equipment/'+a.tag_id+'/tickets','POST',{description:'Loose cover',reported_by:'Foreman',status:'Needs Attention'},null);const before=(await req('/equipment/'+a.tag_id)).data,otherBefore=(await req('/equipment/'+b.tag_id)).data;
  const url='/crew-options/'+crew.id;
  for(const pin of[null,'1001','3003','0000'])assert.equal((await req(url,'PUT',{name:'Forbidden'},pin)).status,pin?403:401);
  for(const name of['','   ',null,42,'X'.repeat(101)])assert.equal((await req(url,'PUT',{name})).status,400);
  assert.equal((await req('/crew-options/99999','PUT',{name:'Missing'})).status,404);
  assert.equal((await req(url,'PUT',{name:'crew 2'})).status,409);assert.deepEqual((await req('/equipment/'+a.tag_id)).data,before);assert.equal((await req('/crew-options?divisions=1')).data.find(row=>row.id===crew.id).name,'Crew 1');
  const changed=await req(url,'PUT',{name:'  North Crew  '});assert.equal(changed.status,200);assert.equal(changed.data.id,crew.id);assert.equal(changed.data.name,'North Crew');const after=(await req('/equipment/'+a.tag_id)).data;assert.equal(after.crew_assigned,'North Crew');for(const key of['id','tag_id','division_id','status','engine_hours','trailer_assigned','notes'])assert.equal(after[key],before[key]);assert.deepEqual(after.tickets,before.tickets);assert.deepEqual(after.maintenance,before.maintenance);assert.deepEqual((await req('/equipment/'+b.tag_id)).data,otherBefore);
  assert.equal((await req('/equipment?divisions=1')).data.filter(row=>row.crew_assigned==='North Crew').length,1);assert.equal((await req('/crew-options?divisions=2')).data[0].name,'Crew 1');
  assert.equal((await req(url,'PUT',{name:'NORTH CREW'})).status,200);assert.equal((await req('/equipment/'+a.tag_id)).data.crew_assigned,'NORTH CREW');
  const db=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'),{readonly:true}),audits=db.prepare("SELECT * FROM audit_log WHERE action='Renamed crew'").all();assert.equal(audits.length,2);assert.equal(audits[0].actor_role,'Manager');assert.equal(JSON.parse(audits[0].details).division_id,1);assert.equal(JSON.parse(audits[0].details).assignments_updated,1);db.close();
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
