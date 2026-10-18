process.env.EQUIPTAGS_LEGACY_DIVISIONS='1';
process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('sample label cleanup preserves assignments, equipment identity, history, unrelated data and seed idempotence',async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'equiptags-labels-'));fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.js'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'));process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='0000';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const baseUrl='http://127.0.0.1:'+server.address().port;
 async function request(url,body){const response=await fetch(baseUrl+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-edit-pin':'8008'},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,await response.clone().text());return response.json()}
 let db;
 try{
  for(const name of ['Demo Chester Co Crew','Chester Co Crew'])await request('/crew-options',{name,division_id:1});
  for(const name of ['Demo CC Trailer 01','CC Trailer 01'])await request('/trailer-options',{name,division_id:1});
  const item=await request('/equipment',{name:'Demo Chester Co Mower',serial_number:'DEMO-CC-PRIMARY-001',division_id:1,crew_assigned:'Demo Chester Co Crew',trailer_assigned:'Demo CC Trailer 01',location:'Demo Chester Co yard',engine_hours:123});
  const other=await request('/equipment',{name:'Demo named by user',serial_number:'CUSTOM',division_id:1});
  await request('/equipment/'+item.tag_id+'/maintenance',{service_date:'2026-10-18',service_type:'Inspection',performed_by:'Demo mechanic',notes:'[DEMO DATA] Example inspection and service record.'});
  await request('/equipment/'+item.tag_id+'/tickets',{reported_by:'Demo Chester Co crew',description:'Demo: guard loose',status:'Tagged Out'});
  const before=await request('/equipment/'+item.tag_id),otherBefore=await request('/equipment/'+other.tag_id);
  db=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'));const{removeDemoLabels}=require('../scripts/remove-demo-labels');const auditBefore=db.prepare('SELECT * FROM audit_log ORDER BY id').all();
  assert.ok(removeDemoLabels(db).length>0);assert.deepEqual(await request('/equipment/'+item.tag_id),before);
  removeDemoLabels(db,{dryRun:false});const after=await request('/equipment/'+item.tag_id);
  assert.equal(after.name,'Chester Co Mower');assert.equal(after.serial_number,'CC-PRIMARY-001');assert.equal(after.crew_assigned,'Chester Co Crew');assert.equal(after.trailer_assigned,'CC Trailer 01');assert.equal(after.location,'Chester Co yard');
  for(const key of ['id','tag_id','division_id','status','engine_hours','created_at','updated_at'])assert.equal(after[key],before[key]);
  assert.equal(after.tickets.length,before.tickets.length);assert.equal(after.maintenance.length,before.maintenance.length);assert.equal(after.tickets[0].id,before.tickets[0].id);assert.equal(after.maintenance[0].id,before.maintenance[0].id);assert.ok(!/Demo|DEMO/.test(JSON.stringify(after)));
  assert.deepEqual(await request('/equipment/'+other.tag_id),otherBefore);assert.deepEqual(db.prepare('SELECT * FROM audit_log ORDER BY id').all(),auditBefore);assert.equal(removeDemoLabels(db,{dryRun:false}).length,0);
  assert.equal((await request('/crew-options?divisions=1')).length,1);assert.equal((await request('/trailer-options?divisions=1')).length,1);
  const{seedDivisionDemo}=require('../scripts/seed-division-demo');assert.equal((await seedDivisionDemo({baseUrl,pin:'8008'})).equipmentCreated,9);assert.equal((await seedDivisionDemo({baseUrl,pin:'8008'})).equipmentCreated,0);
 }finally{db?.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
