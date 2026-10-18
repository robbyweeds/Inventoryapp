const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),DB=require('better-sqlite3');
test('scheduled backup preserves live SQLite data, verifies integrity, and propagates S3 failure',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inventoryapp-backup-')),bin=path.join(dir,'bin'),dbPath=path.join(dir,'source.db'),backupDir=path.join(dir,'backups'),log=path.join(dir,'aws-call.json');fs.mkdirSync(bin);
 try{
  const db=new DB(dbPath);db.pragma('journal_mode=WAL');db.exec('CREATE TABLE inventory(name TEXT)');db.prepare('INSERT INTO inventory VALUES (?)').run('Live equipment');
  const script=fs.readFileSync(path.join(__dirname,'../deploy/equiptags-backup.sh'),'utf8').replaceAll('/srv/equiptags/equiptags.db',dbPath).replaceAll('/srv/equiptags-backups',backupDir);const file=path.join(dir,'backup.sh');fs.writeFileSync(file,script);
  fs.writeFileSync(path.join(bin,'aws'),`#!/usr/bin/env node\nrequire('fs').writeFileSync(process.env.TEST_AWS_LOG,JSON.stringify(process.argv.slice(2)));process.exit(process.env.TEST_AWS_FAIL==='1'?1:0);\n`,{mode:0o755});
  const env={...process.env,PATH:bin+':'+process.env.PATH,BACKUP_S3_URI:'s3://test-private-bucket/inventory',TEST_AWS_LOG:log};let run=spawnSync('bash',[file],{env,encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Verified backup uploaded/);const args=JSON.parse(fs.readFileSync(log));assert.equal(args[0],'s3');assert.equal(args[1],'cp');assert.match(args[3],/^s3:\/\/test-private-bucket\/inventory\/equiptags-.*\.db$/);assert.ok(args.includes('AES256'));assert.equal(fs.statSync(args[2]).mode&0o777,0o600);const backup=new DB(args[2],{readonly:true});assert.equal(backup.prepare('SELECT name FROM inventory').get().name,'Live equipment');backup.close();
  run=spawnSync('bash',[file],{env:{...env,TEST_AWS_FAIL:'1'},encoding:'utf8'});assert.notEqual(run.status,0);assert.doesNotMatch(run.stdout,/Verified backup uploaded/);
  fs.unlinkSync(log);fs.writeFileSync(path.join(bin,'sqlite3'),'#!/bin/sh\necho corrupt\n',{mode:0o755});run=spawnSync('bash',[file],{env,encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/integrity check failed/);assert.equal(fs.existsSync(log),false);db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
