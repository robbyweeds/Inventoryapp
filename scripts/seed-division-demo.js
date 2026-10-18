'use strict';
// Explicit, rerunnable demo seeding. It never changes existing equipment or PINs.
const divisionSamples=[
 {name:'Chester Co',code:'CC',state:'Needs Attention',problem:'Blower cover is loose and needs inspection.',which:1},
 {name:'Plymouth Meeting',code:'PM',state:'Awaiting Parts',problem:'Mower drive belt needs replacement.',which:0},
 {name:'Voorhees',code:'VH',state:'With Mechanic',problem:'Inspect a hydraulic leak before returning to use.',which:0},
 {name:'Princeton',code:'PR'},
 {name:'Golf',code:'GF',overdue:true}
];
async function seedDivisionDemo({baseUrl,pin}){
 if(!baseUrl||!pin)throw Error('Provide the app URL and a manager PIN.');
 async function request(path,method='GET',body){
  const response=await fetch(baseUrl.replace(/\/$/,'')+path,{method,headers:{'Content-Type':'application/json','x-edit-pin':pin,'x-actor-name':'Division setup'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Error(`${path}: ${data.error||'Request failed'}`);return data;
 }
 const access=await request('/auth/pin','POST',{});if(!['Manager','Editor'].includes(access.role))throw Error('Demo equipment must be added using a manager PIN.');
 const divisions=await request('/divisions');const equipment=await request('/equipment');
 const summary={divisions:0,equipmentCreated:0,equipmentAlreadyPresent:0,crewsCreated:0,trailersCreated:0,repairExamplesCreated:0};
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York'}).format(new Date());
 for(const sample of divisionSamples){
  const division=divisions.find(row=>row.name===sample.name);if(!division)throw Error(`Missing division: ${sample.name}`);summary.divisions++;
  const sampleSerials=['PRIMARY','UTILITY'].flatMap(kind=>[`${sample.code}-${kind}-001`,`DEMO-${sample.code}-${kind}-001`]);
  const existingSamples=equipment.filter(row=>sampleSerials.includes(row.serial_number));
  if(['PRIMARY','UTILITY'].every(kind=>existingSamples.some(row=>[`${sample.code}-${kind}-001`,`DEMO-${sample.code}-${kind}-001`].includes(row.serial_number)))){summary.equipmentAlreadyPresent+=2;continue}
  let crew='Crew',trailer=`${sample.code} Trailer 01`;
  const crews=await request('/crew-options?divisions='+division.id),trailers=await request('/trailer-options?divisions='+division.id);
  const assigned=existingSamples.find(row=>row.division_id===division.id&&crews.some(c=>c.name===row.crew_assigned))?.crew_assigned;
  if(assigned)crew=assigned;
  else if(!crews.some(row=>row.name===crew)){const previous=crews.find(row=>[`${sample.name} Crew`,`Demo ${sample.name} Crew`].includes(row.name));if(previous)crew=previous.name}
  if(!trailers.some(row=>row.name===trailer)&&trailers.some(row=>row.name==='Demo '+trailer))trailer='Demo '+trailer;
  if(!crews.some(row=>row.name===crew)){await request('/crew-options','POST',{name:crew,division_id:division.id});summary.crewsCreated++}
  if(!trailers.some(row=>row.name===trailer)){await request('/trailer-options','POST',{name:trailer,division_id:division.id});summary.trailersCreated++}
  const categories=division.categories;
  const types=[categories.find(name=>/mower/i.test(name))||categories[0],categories.find(name=>/blower/i.test(name))||categories[1]||categories[0]];
  for(let index=0;index<2;index++){
   const serial=`${sample.code}-${index===0?'PRIMARY':'UTILITY'}-001`;
   if(equipment.some(row=>[serial,'DEMO-'+serial].includes(row.serial_number))){summary.equipmentAlreadyPresent++;continue}
   const item=await request('/equipment','POST',{
    division_id:division.id,name:types[index],category:types[index],manufacturer:'Equipment',model:index===0?'Model 60':'Model 25',serial_number:serial,
    crew_assigned:crew,trailer_assigned:trailer,purchase_price:index===0?10000:500,
    engine_hours:index===0?(sample.overdue?100+division.service_interval_hours+25:150):25,last_oil_change_hours:index===0?100:10,last_oil_change_date:date,
    service_interval_hours:division.service_interval_hours,notes:''
   });equipment.push(item);summary.equipmentCreated++;
   if(index===0)await request('/equipment/'+item.tag_id+'/maintenance','POST',{service_date:date,service_type:'Inspection',engine_hours:item.engine_hours,performed_by:'Mechanic',notes:'Inspection completed.'});
   if(sample.state&&sample.which===index){
    const ticket=await request('/equipment/'+item.tag_id+'/tickets','POST',{reported_by:`${sample.name} crew`,description:sample.problem,status:sample.state==='Needs Attention'?'Needs Attention':'Tagged Out'});
    if(sample.state!=='Needs Attention')await request('/equipment/'+item.tag_id+'/tickets/'+ticket.id,'PUT',{status:sample.state,notes:sample.state==='Awaiting Parts'?'Replacement belt requested; waiting for delivery.':'Mechanic inspection started; equipment remains unavailable.'});
    summary.repairExamplesCreated++;
   }
  }
 }
 return summary;
}
module.exports={seedDivisionDemo};
if(require.main===module&&!process.env.EQUIPTAGS_API_URL){console.error('Set EQUIPTAGS_API_URL explicitly to an isolated sample installation.');process.exit(1)}
if(require.main===module)seedDivisionDemo({baseUrl:process.env.EQUIPTAGS_API_URL,pin:process.env.EQUIPTAGS_MANAGER_PIN}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1});
