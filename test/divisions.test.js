process.env.EQUIPTAGS_LEGACY_DIVISIONS='1';
process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function temporary(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'equiptags-divisions-'));fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'));return dir}
test('division migration preserves legacy records and is safe to run again',()=>{
 const dir=temporary();
 try{
  const fixture=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'));fixture.exec(fs.readFileSync(path.join(__dirname,'fixtures/legacy-divisions.sql'),'utf8'));fixture.close();
  fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.js'));
  for(let i=0;i<2;i++)execFileSync(process.execPath,['-e',"require('./server')"],{cwd:dir});
  const db=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'),{readonly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM divisions').get().n,6);
  const item=db.prepare('SELECT * FROM equipment').get();assert.equal(item.division_id,0);assert.equal(item.crew_assigned,'Legacy crew');assert.equal(item.trailer_assigned,'Legacy trailer');assert.equal(db.prepare('SELECT division_id FROM crew_options').get().division_id,0);assert.equal(db.prepare('SELECT division_id FROM trailer_options').get().division_id,0);db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('division setups, combined review, exports, assignment isolation, and explicit transfers',async()=>{
 const dir=temporary();fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.js'));process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='0000';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 async function req(url,method='GET',body,pin='8008',master=false){const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',[master?'x-master-pin':'x-edit-pin']:pin},body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,data:res.status===204?null:await res.json()}}
 const expected=x=>({tag_id:x.tag_id,division_id:x.division_id,crew_assigned:x.crew_assigned||'',trailer_assigned:x.trailer_assigned||'',location:x.location||''});
 try{
  const divisions=(await req('/divisions')).data;assert.deepEqual(divisions.filter(d=>d.id).map(d=>d.name),['Chester Co','Plymouth Meeting','Voorhees','Princeton','Golf']);
  for(const division_id of [1,2]){assert.equal((await req('/crew-options','POST',{name:'Crew 1',division_id})).status,201);assert.equal((await req('/trailer-options','POST',{name:'Trailer 1',division_id})).status,201)}
  await req('/crew-options','POST',{name:'Chester only',division_id:1});
  const a=(await req('/equipment','POST',{name:'Chester mower',division_id:1,crew_assigned:'Crew 1',trailer_assigned:'Trailer 1',location:'Chester yard'})).data;
  const b=(await req('/equipment','POST',{name:'Plymouth mower',division_id:2,crew_assigned:'Crew 1',trailer_assigned:'Trailer 1'})).data;
  assert.equal((await req('/equipment','POST',{name:'Invalid division',division_id:99})).status,400);
  assert.equal((await req('/equipment','POST',{name:'Wrong crew',division_id:2,crew_assigned:'Chester only'})).status,400);
  assert.equal((await req('/equipment?divisions=1')).data.length,1);assert.equal((await req('/equipment?divisions=1,2')).data.length,2);assert.equal((await req('/equipment?divisions=1&limit=100')).data.total,1);
  assert.equal((await req('/equipment?divisions=999')).status,400);assert.equal((await req('/equipment?divisions=1%20OR%201=1')).status,400);
  assert.equal((await req('/crew-options?divisions=2')).data.length,1);assert.equal((await req('/trailer-options?divisions=2')).data[0].assigned_count,1);
  const trailerA=(await req('/trailer-options?divisions=1')).data[0];await req('/trailer-options/'+trailerA.id,'PUT',{name:'Renamed Chester trailer'});assert.equal((await req('/equipment/'+b.tag_id)).data.trailer_assigned,'Trailer 1');
  assert.equal((await req('/assignments','POST',{items:[expected(b)],crew_assigned:'Chester only'})).status,400);
  assert.equal((await req('/equipment/'+b.tag_id,'PUT',{division_id:1})).status,409);
  await req('/equipment/'+a.tag_id+'/maintenance','POST',{service_date:'2026-10-18',service_type:'Inspection',notes:'Checked in Chester'});
  await req('/equipment/'+b.tag_id+'/tickets','POST',{reported_by:'Crew',description:'Plymouth repair'});
  assert.equal((await req('/tickets/open?divisions=1')).data.length,0);assert.equal((await req('/tickets/open?divisions=2')).data.length,1);
  const exportRes=await fetch(base+'/equipment-export.xlsx?divisions=1');assert.equal(exportRes.status,200);const book=new(require('exceljs')).Workbook();await book.xlsx.load(Buffer.from(await exportRes.arrayBuffer()));assert.equal(book.getWorksheet('Equipment Tags').rowCount,2);assert.equal(book.getWorksheet('Equipment Tags').getRow(2).getCell(1).value,'Chester Co');assert.equal(book.getWorksheet('Equipment Log').rowCount,2);
  assert.equal((await req('/divisions/5','PUT',{service_interval_hours:50,categories:['Greens mower','Bunker rake']})).status,200);
  const golf=(await req('/equipment','POST',{name:'Golf mower',division_id:5,category:'Greens mower'})).data;assert.equal(golf.service_interval_hours,50);
  const currentA=(await req('/equipment/'+a.tag_id)).data,currentB=(await req('/equipment/'+b.tag_id)).data;
  const transfer={items:[expected(currentA),{...expected(currentB),location:'stale'}],division_id:3,clear_assignments:true};assert.equal((await req('/division-transfers','POST',transfer)).status,409);assert.equal((await req('/equipment/'+a.tag_id)).data.division_id,1);
  assert.equal((await req('/division-transfers','POST',{...transfer,items:[expected(currentA)],clear_assignments:false})).status,400);
  assert.equal((await req('/division-transfers','POST',{...transfer,items:[expected(currentA)]})).data.updated,1);
  const moved=(await req('/equipment/'+a.tag_id)).data;assert.equal(moved.division_id,3);assert.equal(moved.crew_assigned,'');assert.equal(moved.trailer_assigned,'');assert.equal(moved.location,'Chester yard');assert.equal(moved.maintenance.length,1);
  assert.ok((await req('/audit?divisions=3')).data.items.some(row=>row.action==='Transferred division'));
  const removed=(await req('/equipment','POST',{name:'Deleted Golf fixture',division_id:5})).data;assert.equal((await req('/equipment/'+removed.tag_id,'DELETE')).status,204);assert.ok((await req('/audit?divisions=5')).data.items.some(row=>row.action==='Deleted equipment'));
  assert.equal((await req('/equipment/'+a.tag_id,'PUT',{name:'Stale edit',expected_division_id:1})).status,409);
  const pin=await req('/admin/pins','POST',{name:'Mechanic',role:'Mechanic',pin:'2222'},'0000',true);assert.equal(pin.status,201);
  assert.equal((await req('/division-transfers','POST',{division_id:1,items:[expected(moved)],clear_assignments:true},'2222')).status,403);assert.equal((await req('/divisions/1','PUT',{service_interval_hours:50,categories:['Mower']},'2222')).status,403);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});

test('only admin can create divisions, with duplicate protection and independent empty setup',async()=>{
 const dir=temporary();fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.js'));process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='0000';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 async function req(body,pin){const res=await fetch(base+'/admin/divisions',{method:'POST',headers:{'Content-Type':'application/json',...(pin?{'x-master-pin':pin}:{})},body:JSON.stringify(body)});return{status:res.status,data:await res.json()}}
 try{
  assert.equal((await req({name:'North'})).status,401);assert.equal((await req({name:'North'},'8008')).status,401);
  for(const name of ['', ' '.repeat(5),'X'.repeat(81),null,123])assert.equal((await req({name},'0000')).status,400);
  const created=await req({name:'  North   Division  '},'0000');assert.equal(created.status,201);assert.equal(created.data.name,'North Division');assert.equal(created.data.service_interval_hours,100);assert.ok(created.data.id>5);assert.equal(created.data.equipment_count,0);
  assert.equal((await req({name:'north division'},'0000')).status,409);
  const rows=await(await fetch(base+'/divisions')).json();assert.equal(rows.filter(row=>row.name==='North Division').length,1);
  assert.deepEqual(await(await fetch(base+'/equipment?divisions='+created.data.id)).json(),[]);assert.deepEqual(await(await fetch(base+'/crew-options?divisions='+created.data.id)).json(),[]);
  const db=new(require('better-sqlite3'))(path.join(dir,'equiptags.db'),{readonly:true});assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='Created division'").get().n,1);db.close();
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
test('demo seeding fills all five divisions and can be repeated without overwriting equipment',async()=>{
 const dir=temporary();fs.copyFileSync(path.join(root,'server.js'),path.join(dir,'server.js'));process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='0000';
 const server=require(path.join(dir,'server.js')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const baseUrl=`http://127.0.0.1:${server.address().port}`;
 try{
  const{seedDivisionDemo}=require('../scripts/seed-division-demo');const first=await seedDivisionDemo({baseUrl,pin:'8008'});assert.equal(first.divisions,5);assert.equal(first.equipmentCreated,10);assert.equal(first.crewsCreated,5);assert.equal(first.trailersCreated,5);assert.equal(first.repairExamplesCreated,3);
  const rows=await(await fetch(baseUrl+'/equipment')).json();assert.equal(rows.length,10);for(const id of[1,2,3,4,5])assert.equal(rows.filter(row=>row.division_id===id).length,2);for(const row of rows){assert.ok(['Mower','Blower'].includes(row.name));assert.equal(row.crew_assigned,'Crew')}
  const firstCrew=(await(await fetch(baseUrl+'/crew-options?divisions=1')).json())[0];await fetch(baseUrl+'/crew-options/'+firstCrew.id,{method:'PUT',headers:{'Content-Type':'application/json','x-edit-pin':'8008'},body:JSON.stringify({name:'Custom crew'})});
  const firstItem=rows[0];await fetch(baseUrl+'/equipment/'+firstItem.tag_id,{method:'PUT',headers:{'Content-Type':'application/json','x-edit-pin':'8008'},body:JSON.stringify({notes:'User changed this demo record'})});
  const second=await seedDivisionDemo({baseUrl,pin:'8008'});assert.equal(second.equipmentCreated,0);assert.equal(second.equipmentAlreadyPresent,10);assert.equal(second.repairExamplesCreated,0);assert.equal(second.crewsCreated,0);assert.equal(second.trailersCreated,0);
  assert.equal((await(await fetch(baseUrl+'/equipment/'+firstItem.tag_id)).json()).notes,'User changed this demo record');assert.equal((await(await fetch(baseUrl+'/tickets/open')).json()).length,3);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
