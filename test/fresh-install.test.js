const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function temporary(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inventoryapp-fresh-'));fs.copyFileSync(root+'/server.js',dir+'/server.js');fs.symlinkSync(root+'/node_modules',dir+'/node_modules');fs.symlinkSync(root+'/public',dir+'/public');return dir}
test('fresh company requires distinct PINs, starts empty, and restarts without reinitializing access',()=>{
 const dir=temporary(),env={...process.env,EQUIPTAGS_LEGACY_DIVISIONS:'',EQUIPTAGS_EDIT_PIN:'',EQUIPTAGS_MASTER_PIN:''};
 try{
  let run=spawnSync(process.execPath,['-e',"require('./server')"],{cwd:dir,env,encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/distinct four-digit/);
  run=spawnSync(process.execPath,['-e',"require('./server')"],{cwd:dir,env:{...env,EQUIPTAGS_EDIT_PIN:'1234',EQUIPTAGS_MASTER_PIN:'1234'},encoding:'utf8'});assert.notEqual(run.status,0);
  execFileSync(process.execPath,['-e',"require('./server')"],{cwd:dir,env:{...env,EQUIPTAGS_EDIT_PIN:'1234',EQUIPTAGS_MASTER_PIN:'5678'}});
  const DB=require('better-sqlite3');let db=new DB(dir+'/equiptags.db');assert.deepEqual(db.prepare('SELECT id,name FROM divisions').all(),[{id:0,name:'Unassigned division'}]);for(const table of ['equipment','crew_options','trailer_options','tickets','maintenance'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);assert.deepEqual(db.prepare('SELECT name,role,pin FROM access_pins').all(),[{name:'Manager',role:'Manager',pin:'1234'}]);const settings=db.prepare('SELECT * FROM app_settings ORDER BY key').all();db.close();
  execFileSync(process.execPath,['-e',"require('./server')"],{cwd:dir,env});db=new DB(dir+'/equiptags.db');assert.deepEqual(db.prepare('SELECT * FROM app_settings ORDER BY key').all(),settings);db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('new company setup, branding, independent crew assignment, and name-derived ticket numbering',async()=>{
 const dir=temporary();process.env.EQUIPTAGS_LEGACY_DIVISIONS='';process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';process.env.EQUIPTAGS_COMPANY_NAME='North & South Landscaping';const server=require(dir+'/server.js').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function api(url,body,master=false){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',[master?'x-master-pin':'x-edit-pin']:master?'5678':'1234'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.json()}
 try{
  assert.deepEqual(await api('/equiptags-api/company'),{name:'North & South Landscaping'});const division=await api('/admin/divisions',{name:'North Yard'},true);await api('/crew-options',{name:'Crew 1',division_id:division.id});const equipment=await api('/equipment',{name:'Mower',division_id:division.id,crew_assigned:'Crew 1',trailer_assigned:''});assert.equal(equipment.crew_assigned,'Crew 1');assert.equal(equipment.trailer_assigned||'','');const ticket=await api('/equipment/'+equipment.tag_id+'/tickets',{reported_by:'Foreman',description:'Check belt',status:'Needs Attention'});assert.equal(ticket.ticket_number,'NY1-0001');
  for(const url of ['/equiptags/','/equiptags/admin/','/equiptags/admin/inventory/','/equiptags/tickets','/equiptags/crews-trailers','/equiptags/e/'+equipment.tag_id]){const r=await fetch(base+url);assert.equal(r.status,200);assert.match(await r.text(),/company.js/)}
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
