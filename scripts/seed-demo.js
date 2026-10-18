// Only seeds an empty database beside this checkout's server. Never points at production.
const fs=require('node:fs'),path=require('node:path');
const dbPath=path.join(__dirname,'../equiptags.db');
if(fs.existsSync(dbPath)){console.error('Refusing to overwrite an existing database.');process.exit(1)}
process.env.EQUIPTAGS_EDIT_PIN='8008';process.env.EQUIPTAGS_MASTER_PIN='9009';
const server=require('../server').listen(0,'127.0.0.1');
server.once('listening',async()=>{
 const base=`http://127.0.0.1:${server.address().port}`;
 async function post(url,body,master=false){const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',[master?'x-master-pin':'x-edit-pin']:master?'9009':'8008'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data}
 try{
  for(const [name,role,pin]of [['Demo manager','Manager','2002'],['Demo mechanic','Mechanic','3003']])await post('/admin/pins',{name,role,pin},true);
  for(const name of ['Crew A','Crew B'])await post('/crew-options',{name});
  for(const name of ['Trailer 1','Trailer 2'])await post('/trailer-options',{name});
  const specs=[['Zero-turn mower','Mower','Crew A','Trailer 1'],['Backpack blower','Blower','Crew A','Trailer 1'],['String trimmer','Weed Eater','Crew B','Trailer 2'],['Chainsaw','Chainsaw','Crew B','Trailer 2'],['Spare mower','Mower','',''],['Walk-behind mower','Mower','Crew A','Trailer 1']];
  for(let i=0;i<specs.length;i++){
   const [name,category,crew_assigned,trailer_assigned]=specs[i];
   const x=await post('/equipment',{name,category,crew_assigned,trailer_assigned,location:i===2?'Shop':'Main yard',engine_hours:250,last_oil_change_hours:i===4?100:200,service_interval_hours:100});
   if(i===1||i===2)await post('/equipment/'+x.tag_id+'/tickets',{description:i===1?'Engine stalls after starting':'Replace broken guard',reported_by:'Demo crew',status:i===1?'Needs Attention':'Tagged Out'});
  }
  console.log('Created demo-only equipment and role PINs. See DEVELOPMENT.md.');
 }catch(e){console.error(e);process.exitCode=1}finally{server.close()}
});
