'use strict';
// Explicit cleanup of the original ten samples, never run during app startup.
const path=require('node:path');
const divisions=[['Chester Co','CC'],['Plymouth Meeting','PM'],['Voorhees','VH'],['Princeton','PR'],['Golf','GF']];
function cleanText(value){
 if(typeof value!=='string')return value;
 if(value==='[DEMO DATA] Fictional equipment for trying the division workflows. Not a real asset.')return '';
 if(value==='[DEMO DATA] Example inspection and service record.')return 'Inspection completed.';
 return value.replace(/\[DEMO DATA\]\s*/g,'').replace(/\bDemo:\s*/g,'').replace(/\bDemo\s+/g,'').replace(/\bDEMO-/g,'');
}
function removeDemoLabels(db,{dryRun=true}={}){
 const changes=[];
 const update=(table,row,fields)=>{const patch=Object.fromEntries(fields.map(key=>[key,cleanText(row[key])]).filter(([key,value])=>value!==row[key]));if(!Object.keys(patch).length)return;changes.push({table,id:row.id,fields:Object.keys(patch)});if(!dryRun)db.prepare(`UPDATE ${table} SET ${Object.keys(patch).map(key=>key+'=?').join(',')} WHERE id=?`).run(...Object.values(patch),row.id)};
 const run=db.transaction(()=>{
  for(const[name,code]of divisions){
   const division=db.prepare('SELECT id FROM divisions WHERE name=? COLLATE NOCASE').get(name);if(!division)continue;
   for(const[table,field,oldName]of [['crew_options','crew_assigned',`Demo ${name} Crew`],['trailer_options','trailer_assigned',`Demo ${code} Trailer 01`]]){
    const row=db.prepare(`SELECT * FROM ${table} WHERE division_id=? AND name=? COLLATE NOCASE`).get(division.id,oldName);if(!row)continue;
    const newName=cleanText(row.name),existing=db.prepare(`SELECT id FROM ${table} WHERE division_id=? AND name=? COLLATE NOCASE`).get(division.id,newName);
    changes.push({table,id:row.id,from:row.name,to:newName});
    if(!dryRun){db.prepare(`UPDATE equipment SET ${field}=? WHERE division_id=? AND ${field}=? COLLATE NOCASE`).run(newName,division.id,row.name);if(existing)db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);else db.prepare(`UPDATE ${table} SET name=? WHERE id=?`).run(newName,row.id)}
   }
   for(const kind of ['PRIMARY','UTILITY']){
    const serial=`${code}-${kind}-001`,row=db.prepare('SELECT * FROM equipment WHERE serial_number IN (?,?)').get(serial,'DEMO-'+serial);if(!row)continue;
    const collision=db.prepare('SELECT id FROM equipment WHERE serial_number=? AND id!=?').get(serial,row.id);if(collision)throw Error('A cleaned sample serial already belongs to another record: '+serial);
    update('equipment',row,['name','manufacturer','model','serial_number','location','notes']);
    for(const entry of db.prepare('SELECT * FROM maintenance WHERE equipment_id=?').all(row.id))update('maintenance',entry,['performed_by','notes']);
    for(const ticket of db.prepare('SELECT * FROM tickets WHERE equipment_id=?').all(row.id)){
     update('tickets',ticket,['description','reported_by']);
     for(const entry of db.prepare('SELECT * FROM ticket_updates WHERE ticket_id=?').all(ticket.id))update('ticket_updates',entry,['notes','actor_name']);
    }
   }
  }
 });run();return changes;
}
module.exports={removeDemoLabels};
if(require.main===module)(async()=>{
 const Database=require('better-sqlite3'),db=new Database(path.join(__dirname,'..','equiptags.db'));
 try{
  const apply=process.argv.includes('--apply'),backupIndex=process.argv.indexOf('--backup'),backup=backupIndex<0?null:process.argv[backupIndex+1];
  if(apply){if(!backup)throw Error('Use --apply --backup /absolute/path/to/new-backup.db');if(!path.isAbsolute(backup))throw Error('Backup path must be absolute.');if(require('node:fs').existsSync(backup))throw Error('Backup already exists; choose a new file.');await db.backup(backup);require('node:fs').chmodSync(backup,0o600)}
  const changes=removeDemoLabels(db,{dryRun:!apply});console.log(JSON.stringify({applied:apply,backup:apply?backup:null,changes},null,2));
 }finally{db.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
