const express = require('express');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const path = require('path');
const crypto = require('crypto');
const fs = require('node:fs');

const app = express();
const PORT = Number(process.env.PORT || 5002);
const INITIAL_EDIT_PIN = process.env.EQUIPTAGS_EDIT_PIN || '';
const INITIAL_MASTER_PIN = process.env.EQUIPTAGS_MASTER_PIN || '';
const COMPANY_NAME = (process.env.EQUIPTAGS_COMPANY_NAME || 'Equipment Inventory').trim().slice(0, 100);
// Named fixtures are opt-in for migration tests; deployments start with no company divisions.
const LEGACY_DIVISIONS = process.env.EQUIPTAGS_LEGACY_DIVISIONS === '1';
const db = new Database(path.join(__dirname, 'equiptags.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    manufacturer TEXT DEFAULT '',
    model TEXT DEFAULT '',
    serial_number TEXT DEFAULT '',
    purchase_date TEXT DEFAULT '',
    purchase_price REAL,
    status TEXT NOT NULL DEFAULT 'In Service',
    crew_assigned TEXT DEFAULT '',
    location TEXT DEFAULT '',
    engine_hours REAL,
    last_oil_change_date TEXT DEFAULT '',
    last_oil_change_hours REAL,
    service_interval_hours REAL DEFAULT 100,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL,
    service_date TEXT NOT NULL,
    service_type TEXT NOT NULL,
    engine_hours REAL,
    cost REAL,
    performed_by TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS maintenance_equipment_idx ON maintenance(equipment_id, service_date DESC);
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    reported_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Tagged Out',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_open_idx ON tickets(equipment_id) WHERE closed_at IS NULL;
  CREATE TABLE IF NOT EXISTS ticket_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    notes TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS access_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE,
    pin TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    entity_label TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity_type, entity_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS tag_sequence (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_number INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO tag_sequence (id,last_number)
    SELECT 1, COALESCE(MAX(CAST(tag_id AS INTEGER)),0) FROM equipment WHERE tag_id GLOB '[0-9]*';
  CREATE TABLE IF NOT EXISTS trailer_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
// Additive migrations preserve existing access and assignment history.
if (!db.prepare('PRAGMA table_info(access_pins)').all().some(c => c.name === 'role')) {
  db.exec("ALTER TABLE access_pins ADD COLUMN role TEXT NOT NULL DEFAULT 'Editor'");
}
db.exec('CREATE TABLE IF NOT EXISTS crew_options (name TEXT PRIMARY KEY COLLATE NOCASE)');

// Existing records retain their assignments under Unassigned division (0).
db.transaction(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS divisions (id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,service_interval_hours REAL NOT NULL DEFAULT 100,categories TEXT NOT NULL DEFAULT '["Mower","Blower","Weed Eater","Chainsaw","Misc Small Power"]');
    INSERT OR IGNORE INTO divisions (id,name) VALUES (0,'Unassigned division');`);
  if(LEGACY_DIVISIONS)db.exec("INSERT OR IGNORE INTO divisions (id,name) VALUES (1,'Chester Co'),(2,'Plymouth Meeting'),(3,'Voorhees'),(4,'Princeton'),(5,'Golf')");
  if (!db.prepare('PRAGMA table_info(equipment)').all().some(c=>c.name==='division_id')) db.exec('ALTER TABLE equipment ADD COLUMN division_id INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(crew_options)').all().some(c=>c.name==='division_id')) db.exec(`ALTER TABLE crew_options RENAME TO crew_options_legacy;
    CREATE TABLE crew_options (id INTEGER PRIMARY KEY,division_id INTEGER NOT NULL DEFAULT 0 REFERENCES divisions(id),name TEXT NOT NULL COLLATE NOCASE,UNIQUE(division_id,name));
    INSERT INTO crew_options (name) SELECT name FROM crew_options_legacy;DROP TABLE crew_options_legacy;`);
  if (!db.prepare('PRAGMA table_info(trailer_options)').all().some(c=>c.name==='division_id')) db.exec(`ALTER TABLE trailer_options RENAME TO trailer_options_legacy;
    CREATE TABLE trailer_options (id INTEGER PRIMARY KEY AUTOINCREMENT,division_id INTEGER NOT NULL DEFAULT 0 REFERENCES divisions(id),name TEXT NOT NULL COLLATE NOCASE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(division_id,name));
    INSERT INTO trailer_options (id,name,created_at,updated_at) SELECT id,name,created_at,updated_at FROM trailer_options_legacy;DROP TABLE trailer_options_legacy;`);
  db.exec(`INSERT OR IGNORE INTO crew_options (division_id,name) SELECT DISTINCT division_id,TRIM(crew_assigned) FROM equipment WHERE TRIM(COALESCE(crew_assigned,''))<>'';CREATE INDEX IF NOT EXISTS equipment_division_idx ON equipment(division_id);`);
})();

// Normalize legacy availability without changing repair tickets or their history.
db.exec("UPDATE equipment SET status = 'In Service' WHERE status = 'Active'");
db.exec(`UPDATE equipment SET status = (SELECT status FROM tickets WHERE equipment_id = equipment.id AND closed_at IS NULL)
  WHERE EXISTS (SELECT 1 FROM tickets WHERE equipment_id = equipment.id AND closed_at IS NULL)`);
if (!db.prepare('PRAGMA table_info(equipment)').all().some(column => column.name === 'trailer_assigned')) {
  db.exec("ALTER TABLE equipment ADD COLUMN trailer_assigned TEXT DEFAULT ''");
}
if (!db.prepare('PRAGMA table_info(audit_log)').all().some(column => column.name === 'equipment_id')) {
  db.exec('ALTER TABLE audit_log ADD COLUMN equipment_id INTEGER');
}
db.exec('CREATE INDEX IF NOT EXISTS audit_log_equipment_idx ON audit_log(equipment_id, created_at DESC)');
db.exec(`UPDATE audit_log SET equipment_id = CAST(entity_id AS INTEGER)
  WHERE equipment_id IS NULL AND entity_type = 'equipment';
  UPDATE audit_log SET equipment_id = (SELECT equipment_id FROM maintenance WHERE maintenance.id = CAST(audit_log.entity_id AS INTEGER))
  WHERE equipment_id IS NULL AND entity_type = 'equipment_log';`);

// Ticket-linked log entries survive edits and cannot be removed independently.
if (!db.prepare('PRAGMA table_info(maintenance)').all().some(column => column.name === 'ticket_id')) {
  db.exec('ALTER TABLE maintenance ADD COLUMN ticket_id INTEGER');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS maintenance_ticket_idx ON maintenance(ticket_id) WHERE ticket_id IS NOT NULL');
// Human-facing ticket numbers have an independent sequence per reporting division.
function nextTicketNumber(divisionId){
 const known={0:'UN1',1:'CC1',2:'PL1',3:'VH1',4:'PR1',5:'GF1'};
 const name=db.prepare('SELECT name FROM divisions WHERE id=?').get(divisionId).name;
 const words=name.toUpperCase().match(/[A-Z]+/g)||['D'];
 const letters=(words.length>1?words.map(word=>word[0]).join(''):words[0]).slice(0,3);
 const prefix=(LEGACY_DIVISIONS?known[divisionId]:divisionId===0?'UN1':null)||letters+divisionId;
 db.prepare('INSERT OR IGNORE INTO ticket_sequences (division_id,prefix,last_number) VALUES (?,?,0)').run(divisionId,prefix);
 db.prepare('UPDATE ticket_sequences SET last_number=last_number+1 WHERE division_id=?').run(divisionId);
 const sequence=db.prepare('SELECT * FROM ticket_sequences WHERE division_id=?').get(divisionId);
 return sequence.prefix+'-'+String(sequence.last_number).padStart(4,'0');
}
db.transaction(()=>{
 if(!db.prepare('PRAGMA table_info(tickets)').all().some(c=>c.name==='ticket_number'))db.exec('ALTER TABLE tickets ADD COLUMN ticket_number TEXT');
 if(!db.prepare('PRAGMA table_info(tickets)').all().some(c=>c.name==='reported_division_id'))db.exec('ALTER TABLE tickets ADD COLUMN reported_division_id INTEGER');
 db.exec('CREATE TABLE IF NOT EXISTS ticket_sequences (division_id INTEGER PRIMARY KEY REFERENCES divisions(id),prefix TEXT NOT NULL UNIQUE,last_number INTEGER NOT NULL DEFAULT 0);CREATE UNIQUE INDEX IF NOT EXISTS tickets_number_idx ON tickets(ticket_number COLLATE NOCASE) WHERE ticket_number IS NOT NULL');
 for(const ticket of db.prepare('SELECT t.*,e.division_id FROM tickets t JOIN equipment e ON e.id=t.equipment_id WHERE t.ticket_number IS NULL ORDER BY t.id').all()){
  const event=db.prepare("SELECT CASE WHEN json_valid(details) THEN json_extract(details,'$.division_id') ELSE NULL END AS division_id FROM audit_log WHERE entity_type='ticket' AND entity_id=? AND action IN ('Created attention ticket','Created tag-out ticket') ORDER BY id LIMIT 1").get(String(ticket.id));
  const origin=event&&db.prepare('SELECT id FROM divisions WHERE id=?').get(event.division_id)?event.division_id:ticket.division_id;
  const number=nextTicketNumber(origin);db.prepare('UPDATE tickets SET ticket_number=?,reported_division_id=? WHERE id=?').run(number,origin,ticket.id);
 }
 for(const log of db.prepare('SELECT m.id,m.notes,m.ticket_id,t.ticket_number FROM maintenance m JOIN tickets t ON t.id=m.ticket_id').all()){
  const old='Ticket #'+log.ticket_id;if(String(log.notes||'').startsWith(old+' ·'))db.prepare('UPDATE maintenance SET notes=? WHERE id=?').run('Ticket '+log.ticket_number+log.notes.slice(old.length),log.id);
 }
})();

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function addTicketLog(ticket, hours = null) {
  return db.prepare(`INSERT OR IGNORE INTO maintenance
    (equipment_id,service_date,service_type,engine_hours,performed_by,notes,ticket_id)
    VALUES (?,?,?,?,?,?,?)`).run(ticket.equipment_id,
      localDate(new Date(ticket.created_at.replace(' ', 'T') + 'Z')), 'Mechanic ticket', hours,
      ticket.reported_by, `Ticket ${ticket.ticket_number||'#'+ticket.id} · ${ticket.status === 'Needs Attention' ? 'Needs attention — still usable' : 'Equipment tagged out'}\n${ticket.description}`, ticket.id);
}
// Give existing tickets the same log visibility as newly reported problems.
db.transaction(() => {
  for (const ticket of db.prepare(`SELECT t.* FROM tickets t LEFT JOIN maintenance m ON m.ticket_id = t.id WHERE m.id IS NULL`).all()) addTicketLog(ticket);
})();

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`;
}
function matchesPin(pin, stored) {
  if (!pin || !stored) return false;
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(String(pin), salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function setting(key) { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value; }
function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(key, value);
}
if ((!setting('edit_pin_hash') || !setting('master_pin_hash')) &&
    (!/^\d{4}$/.test(INITIAL_EDIT_PIN) || !/^\d{4}$/.test(INITIAL_MASTER_PIN) || INITIAL_EDIT_PIN === INITIAL_MASTER_PIN)) {
  db.close();
  throw new Error('First start requires distinct four-digit EQUIPTAGS_EDIT_PIN and EQUIPTAGS_MASTER_PIN values.');
}
if (!setting('edit_pin_hash')) setSetting('edit_pin_hash', hashPin(INITIAL_EDIT_PIN));
if (!setting('master_pin_hash')) setSetting('master_pin_hash', hashPin(INITIAL_MASTER_PIN));
if (!setting('named_pins_migrated')) {
  if (!db.prepare('SELECT 1 FROM access_pins LIMIT 1').get() && matchesPin(INITIAL_EDIT_PIN, setting('edit_pin_hash'))) {
    db.prepare('INSERT OR IGNORE INTO access_pins (name,pin,role) VALUES (?,?,?)').run('Manager', INITIAL_EDIT_PIN, 'Manager');
  }
  setSetting('named_pins_migrated', '1');
}

app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '200kb' }));
app.use((req, _res, next) => { if (req.url.startsWith('/equiptags-api/')) req.url = req.url.slice('/equiptags-api'.length); next(); });

app.get('/company', (_req,res)=>res.json({name:COMPANY_NAME}));

function actorName(req) { return clean(req.get('x-actor-name') || 'Unknown user').slice(0, 80); }
function requirePin(req, res, next) {
  const pin = req.get('x-edit-pin');
  if (matchesPin(pin, setting('master_pin_hash'))) { req.actor = { name: actorName(req), role: 'Master' }; return authorizeRole(req, res, next); }
  const access = pin ? db.prepare('SELECT name,role FROM access_pins WHERE pin = ?').get(pin) : null;
  if (access) { req.actor = { name: access.name, role: access.role }; return authorizeRole(req, res, next); }
  return res.status(401).json({ error: 'A valid edit PIN is required.' });
}
function authorizeRole(req, res, next) {
  const role = req.actor.role, url = req.path, method = req.method;
  if (url === '/auth/pin') return next();
  if (['Editor','Manager'].includes(role)) return next();
  if (role === 'Master') return res.status(403).json({ error: 'Admin access is for PIN/division management and master inventory deletion. Use a manager PIN for other equipment changes.' });
  const repair = /^\/equipment\/[^/]+\/(tickets\/[^/]+|maintenance|status)$/.test(url) && ['POST','PUT'].includes(method);
  if (role === 'Mechanic' && repair) {
    if (req.body?.status === 'Sold' || req.body?.machine_status === 'Sold') return res.status(403).json({ error: 'Use a manager PIN to mark equipment Sold.' });
    return next();
  }
  return res.status(403).json({ error: 'Your role does not allow this change.' });
}
function requireMaster(req, res, next) {
  if (matchesPin(req.get('x-master-pin'), setting('master_pin_hash'))) { req.actor = { name: actorName(req), role: 'Master' }; return next(); }
  return res.status(401).json({ error: 'A valid master PIN is required.' });
}
function divisionInput(value) {
 return ['string','number'].includes(typeof value)&&/^\d+$/.test(String(value))&&db.prepare('SELECT 1 FROM divisions WHERE id=?').get(Number(value))?Number(value):null;
}
function divisionCondition(req,column='division_id') {return req.divisions===null?'1=1':`${column} IN (${req.divisions.join(',')})`;}
app.use((req,res,next)=>{
 const value=req.query.divisions;
 if(value===undefined){req.divisions=null;return next()}
 if(typeof value!=='string'||!/^\d+(,\d+)*$/.test(value))return res.status(400).json({error:'Select valid divisions.'});
 req.divisions=[...new Set(value.split(',').map(Number))];
 if(req.divisions.some(id=>divisionInput(id)===null))return res.status(400).json({error:'A selected division does not exist.'});next();
});
function assignmentSetupError(data,division,existing={}) {
 for(const [key,table,label]of [['crew_assigned','crew_options','crew'],['trailer_assigned','trailer_options','trailer']])
  if(Object.hasOwn(data,key)&&data[key]&&data[key]!==existing[key]&&!db.prepare(`SELECT 1 FROM ${table} WHERE division_id=? AND name=? COLLATE NOCASE`).get(division,data[key]))return `Choose a ${label} from this equipment's division.`;
 return null;
}
app.get('/divisions',(_req,res)=>res.json(db.prepare('SELECT * FROM divisions ORDER BY id').all().map(row=>({...row,categories:JSON.parse(row.categories),equipment_count:db.prepare('SELECT count(*) AS n FROM equipment WHERE division_id=?').get(row.id).n,crew_count:db.prepare('SELECT count(*) AS n FROM crew_options WHERE division_id=?').get(row.id).n,trailer_count:db.prepare('SELECT count(*) AS n FROM trailer_options WHERE division_id=?').get(row.id).n}))));
app.post('/admin/divisions',requireMaster,(req,res,next)=>{
 const name=typeof req.body?.name==='string'?req.body.name.trim().replace(/\s+/g,' '):'';
 if(!name||name.length>80)return res.status(400).json({error:'Enter a division name of 1–80 characters.'});
 try{
  const row=db.transaction(()=>{
   const result=db.prepare('INSERT INTO divisions (name) VALUES (?)').run(name);
   const created=db.prepare('SELECT * FROM divisions WHERE id=?').get(result.lastInsertRowid);
   audit(req,'division',created.id,created.name,'Created division',{division_id:created.id,name:created.name});return created;
  })();res.status(201).json({...row,categories:JSON.parse(row.categories),equipment_count:0});
 }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'A division with that name already exists.'});next(error)}
});
app.put('/divisions/:id',requirePin,(req,res)=>{
 const id=divisionInput(req.params.id),interval=req.body?.service_interval_hours,categories=req.body?.categories;
 if(id===null)return res.status(404).json({error:'Division not found.'});
 if(typeof interval!=='number'||!Number.isFinite(interval)||interval<=0||!Array.isArray(categories)||!categories.length||categories.length>50||categories.some(x=>typeof x!=='string'||!x.trim()||x.length>80))return res.status(400).json({error:'Enter a positive service interval and 1–50 equipment categories.'});
 const old=db.prepare('SELECT * FROM divisions WHERE id=?').get(id),values=[...new Set(categories.map(x=>x.trim()))];
 db.prepare('UPDATE divisions SET service_interval_hours=?,categories=? WHERE id=?').run(interval,JSON.stringify(values),id);
 audit(req,'division',id,old.name,'Updated division setup',{division_id:id,changes:{service_interval_hours:{from:old.service_interval_hours,to:interval},categories:{from:JSON.parse(old.categories).join(', '),to:values.join(', ')}}});res.json({ok:true});
});
app.post('/division-transfers',requirePin,(req,res)=>{
 const items=req.body?.items,target=divisionInput(req.body?.division_id),note=ticketText(req.body?.note||'',1000);
 if(target===null||!Array.isArray(items)||!items.length||items.length>100||items.some(x=>!x||typeof x.tag_id!=='string')||new Set(items.map(x=>x.tag_id.toLowerCase())).size!==items.length||req.body.clear_assignments!==true||(req.body?.note&&!note))return res.status(400).json({error:'Select 1–100 machines, a destination division, and confirm clearing crew/trailer assignments.'});
 try{
  const updated=db.transaction(()=>{
   const rows=items.map(expected=>{const row=db.prepare('SELECT * FROM equipment WHERE tag_id=? COLLATE NOCASE').get(expected.tag_id);if(!row||row.division_id!==expected.division_id||['crew_assigned','trailer_assigned','location'].some(key=>(row[key]||'')!==expected[key]))throw new Error('Equipment changed. Refresh the list before transferring.');return row});
   let count=0;
   for(const row of rows){if(row.division_id===target)continue;const from=db.prepare('SELECT name FROM divisions WHERE id=?').get(row.division_id).name,to=db.prepare('SELECT name FROM divisions WHERE id=?').get(target).name;
    db.prepare("UPDATE equipment SET division_id=?,crew_assigned='',trailer_assigned='',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(target,row.id);
    audit(req,'equipment',row.id,`${row.tag_id} · ${row.name}`,'Transferred division',{division_id:target,note,changes:{division:{from,to},crew_assigned:{from:row.crew_assigned,to:''},trailer_assigned:{from:row.trailer_assigned,to:''}}},row.id);count++;
   }return count;
  })();res.json({ok:true,updated});
 }catch(error){res.status(409).json({error:error.message})}
});

function audit(req, entityType, entityId, entityLabel, action, details = {}, equipmentId = null) {
  const actor = req.actor || { name: 'System', role: 'System' };
  if(equipmentId!==null&&details.division_id===undefined)details={...details,division_id:db.prepare('SELECT division_id FROM equipment WHERE id=?').get(equipmentId)?.division_id??0};
  db.prepare(`INSERT INTO audit_log (entity_type,entity_id,entity_label,action,actor_name,actor_role,details,equipment_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(entityType, String(entityId ?? ''), entityLabel, action, actor.name, actor.role, JSON.stringify(details), equipmentId);
}

function clean(value) { return typeof value === 'string' ? value.trim() : value; }
function payload(body = {}) {
  const allowed = ['division_id','tag_id','name','category','manufacturer','model','serial_number','purchase_date','purchase_price','status','crew_assigned','trailer_assigned','location','engine_hours','last_oil_change_date','last_oil_change_hours','service_interval_hours','notes'];
  return Object.fromEntries(allowed.filter(k => Object.hasOwn(body, k)).map(k => [k, clean(body[k])]));
}
function validCalendarDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validateEquipment(data) {
  for (const [key, label] of [['purchase_price','Purchase price'], ['engine_hours','Engine hours'], ['last_oil_change_hours','Oil change hours'], ['service_interval_hours','Service interval']]) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (value === '' || value === null) { data[key] = null; continue; }
    if (!['number','string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || (key === 'service_interval_hours' && Number(value) === 0)) {
      return `${label} must be ${key === 'service_interval_hours' ? 'a positive' : 'a nonnegative'} number, or left blank.`;
    }
    data[key] = Number(value);
  }
  for (const [key, label] of [['purchase_date','Purchase date'], ['last_oil_change_date','Last oil change date']]) {
    if (Object.hasOwn(data, key) && data[key] !== '' && data[key] !== null && !validCalendarDate(data[key])) return `${label} must be a valid calendar date.`;
  }
  if (Object.hasOwn(data, 'name') && (typeof data.name !== 'string' || !data.name)) return 'Equipment name is required.';
  return null;
}
function availabilityLabel(status) {
  return { 'In Service': 'Ready to use', 'Tagged Out': 'Tagged out — do not use', 'With Mechanic': 'With mechanic — do not use', 'Awaiting Parts': 'Waiting for parts — do not use', 'Out of Service': 'Unavailable', 'Needs Attention': 'Needs attention — still usable', 'Sold': 'Sold' }[status] || status;
}
function equipmentWithService(row) {
  if (!row) return null;
  const hoursSinceService = row.engine_hours != null && row.last_oil_change_hours != null ? row.engine_hours - row.last_oil_change_hours : null;
  const serviceDueIn = hoursSinceService != null && row.service_interval_hours != null ? row.service_interval_hours - hoursSinceService : null;
  return { ...row, division_name:db.prepare('SELECT name FROM divisions WHERE id=?').get(row.division_id)?.name||'Unassigned division', service_due_in_hours: serviceDueIn };
}

app.get('/health', (_req, res) => res.json({ ok: true, editPinRequired: true }));
app.post('/auth/pin', requirePin, (req, res) => res.json({ ok: true, name: req.actor.name, role: req.actor.role }));
app.get('/trailer-options',(req,res)=>{
 const rows=db.prepare(`SELECT t.*,d.name AS division_name FROM trailer_options t JOIN divisions d ON d.id=t.division_id WHERE ${divisionCondition(req,'t.division_id')} ORDER BY d.id,t.name COLLATE NOCASE`).all();
 res.json(rows.map(row=>{const equipment=db.prepare('SELECT id,tag_id,name,category,status,crew_assigned,location,division_id FROM equipment WHERE division_id=? AND trailer_assigned=? COLLATE NOCASE ORDER BY name').all(row.division_id,row.name);return {...row,assigned_count:equipment.length,assigned_equipment:equipment}}));
});
app.post('/trailer-options',requirePin,(req,res)=>{
 const name=ticketText(req.body?.name,100),division=divisionInput(req.body?.division_id??0);
 if(!name||division===null)return res.status(400).json({error:'Enter a trailer name and select a division.'});
 try{const result=db.prepare('INSERT INTO trailer_options (name,division_id) VALUES (?,?)').run(name,division);const row=db.prepare('SELECT * FROM trailer_options WHERE id=?').get(result.lastInsertRowid);audit(req,'trailer_option',row.id,row.name,'Created trailer option',{name,division_id:division});res.status(201).json(row)}catch(error){res.status(409).json({error:'That trailer already exists in this division.'})}
});
app.put('/trailer-options/:id',requirePin,(req,res)=>{
 const name=ticketText(req.body?.name,100),row=db.prepare('SELECT * FROM trailer_options WHERE id=?').get(req.params.id);
 if(!row)return res.status(404).json({error:'Trailer not found.'});if(!name)return res.status(400).json({error:'Enter a trailer name.'});
 try{db.transaction(()=>{db.prepare('UPDATE trailer_options SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name,row.id);db.prepare('UPDATE equipment SET trailer_assigned=?,updated_at=CURRENT_TIMESTAMP WHERE division_id=? AND trailer_assigned=? COLLATE NOCASE').run(name,row.division_id,row.name);audit(req,'trailer_option',row.id,name,'Renamed trailer option',{division_id:row.division_id,changes:{name:{from:row.name,to:name}}})})();res.json({...row,name})}catch(error){res.status(409).json({error:'That trailer name already exists in this division.'})}
});
app.delete('/trailer-options/:id',requirePin,(req,res)=>{
 const row=db.prepare('SELECT * FROM trailer_options WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'Trailer not found.'});
 db.transaction(()=>{const cleared=db.prepare("UPDATE equipment SET trailer_assigned='',updated_at=CURRENT_TIMESTAMP WHERE division_id=? AND trailer_assigned=? COLLATE NOCASE").run(row.division_id,row.name).changes;db.prepare('DELETE FROM trailer_options WHERE id=?').run(row.id);audit(req,'trailer_option',row.id,row.name,'Deleted trailer option',{division_id:row.division_id,assignments_cleared:cleared})})();res.status(204).end();
});
app.get('/equipment', (req, res) => {
  const q = `%${clean(req.query.q || '')}%`;
  const status = clean(req.query.status || '');
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 0, 0), 500);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const sort = clean(req.query.sort || 'name');
  const orderBy = {
    newest: 'id DESC',
    oldest: 'id ASC',
    tag_asc: `CASE WHEN tag_id GLOB '[0-9]*' THEN 0 ELSE 1 END ASC, CAST(tag_id AS INTEGER) ASC, tag_id COLLATE NOCASE ASC`,
    tag_desc: `CASE WHEN tag_id GLOB '[0-9]*' THEN 0 ELSE 1 END ASC, CAST(tag_id AS INTEGER) DESC, tag_id COLLATE NOCASE DESC`,
    name_asc: 'name COLLATE NOCASE ASC',
    name_desc: 'name COLLATE NOCASE DESC',
    category: 'category COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
    status: 'status COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
    updated: 'updated_at DESC'
  }[sort] || 'name COLLATE NOCASE ASC';
  const where = `(name LIKE ? OR tag_id LIKE ? OR model LIKE ? OR serial_number LIKE ? OR crew_assigned LIKE ? OR trailer_assigned LIKE ? OR category LIKE ? OR location LIKE ?)
      AND (? = '' OR status = ?) AND ${divisionCondition(req)}`;
  const params = [q,q,q,q,q,q,q,q,status,status];
  const total = db.prepare(`SELECT COUNT(*) AS count FROM equipment WHERE ${where}`).get(...params).count;
  const rows = db.prepare(`SELECT * FROM equipment
    WHERE ${where}
    ORDER BY ${orderBy}${limit ? ' LIMIT ? OFFSET ?' : ''}`).all(...params, ...(limit ? [limit, offset] : []));
  const items = rows.map(equipmentWithService);
  res.json(limit ? { items, total, has_more: offset + items.length < total } : items);
});
app.get('/equipment-export.xlsx', async (req, res, next) => {
  try {
    const tagOrder = `CASE WHEN tag_id GLOB '[0-9]*' THEN 0 ELSE 1 END ASC, CAST(tag_id AS INTEGER) ASC, tag_id COLLATE NOCASE ASC`;
    const rows = db.prepare(`SELECT * FROM equipment WHERE ${divisionCondition(req)} ORDER BY ${tagOrder}`).all().map(equipmentWithService);
    const maintenance = db.prepare(`SELECT e.tag_id, e.name AS equipment_name, d.name AS division_name, m.*
      FROM maintenance m JOIN equipment e ON e.id = m.equipment_id JOIN divisions d ON d.id=e.division_id WHERE ${divisionCondition(req,'e.division_id')}
      ORDER BY ${tagOrder}, m.service_date DESC, m.id DESC`).all();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = COMPANY_NAME + ' Inventory';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Equipment Tags', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      ['Division','division_name',22], ['Tag Number','tag_id',14], ['Equipment Name','name',28], ['Equipment Type','category',20],
      ['Manufacturer','manufacturer',18], ['Model','model',18], ['Serial Number','serial_number',20],
      ['Availability','status',28], ['Crew Assigned','crew_assigned',20], ['Trailer Assigned','trailer_assigned',20], ['Location','location',20],
      ['Purchase Date','purchase_date',15], ['Purchase Price','purchase_price',15], ['Engine Hours','engine_hours',14],
      ['Last Oil Change','last_oil_change_date',17], ['Oil Change Hours','last_oil_change_hours',17],
      ['Service Interval Hours','service_interval_hours',20], ['Service Due In Hours','service_due_in_hours',19],
      ['Notes','notes',38], ['NFC Address','nfc_address',48], ['Created','created_at',20], ['Last Updated','updated_at',20]
    ].map(([header,key,width]) => ({ header, key, width }));
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    rows.forEach(row => sheet.addRow({ ...row, status: availabilityLabel(row.status), nfc_address: `${baseUrl}/equiptags/e/${encodeURIComponent(row.tag_id)}` }));
    sheet.autoFilter = { from: 'A1', to: 'V1' };
    sheet.getColumn('purchase_price').numFmt = '$#,##0.00';
    ['engine_hours','last_oil_change_hours','service_interval_hours','service_due_in_hours'].forEach(key => { sheet.getColumn(key).numFmt = '0.0'; });
    const history = workbook.addWorksheet('Equipment Log', { views: [{ state: 'frozen', ySplit: 1 }] });
    history.columns = [
      ['Division','division_name',22], ['Tag Number','tag_id',14], ['Equipment Name','equipment_name',28], ['Entry Date','service_date',15],
      ['Entry Type','service_type',20], ['Equipment Hours','engine_hours',20],
      ['Reported / Performed By','performed_by',24], ['Notes / Details','notes',40], ['Recorded','created_at',20]
    ].map(([header,key,width]) => ({ header, key, width }));
    maintenance.forEach(row => history.addRow(row));
    history.autoFilter = { from: 'A1', to: 'I1' };
    [sheet, history].forEach(ws => {
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F35' } };
      ws.getRow(1).alignment = { vertical: 'middle' };
      ws.getRow(1).height = 24;
      ws.eachRow((row, number) => { if (number > 1 && number % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F4' } }; });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="equiptags-${new Date().toISOString().slice(0,10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) { next(error); }
});
function styleExportSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F35' } };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 24;
  sheet.eachRow((row, number) => {
    if (number > 1 && number % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F4' } };
  });
}
async function sendTrailerAssignmentsWorkbook(res, rows, filename) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY_NAME + ' Inventory';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Trailer Assignments', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    ['Division','division_name',22], ['Trailer Assignment','trailer_assignment',22], ['Division','division_name',22], ['Tag Number','tag_id',14], ['Equipment Name','name',28],
    ['Equipment Type','category',20], ['Manufacturer','manufacturer',18], ['Model','model',18],
    ['Serial Number','serial_number',20], ['Availability','status',28], ['Crew Assigned','crew_assigned',20],
    ['Location','location',20], ['Engine Hours','engine_hours',14], ['Notes','notes',38]
  ].map(([header, key, width]) => ({ header, key, width }));
  rows.forEach(row => sheet.addRow({ ...equipmentWithService(row), status: availabilityLabel(row.status), trailer_assignment: row.trailer_assigned || 'Unassigned' }));
  sheet.autoFilter = { from: 'A1', to: 'M1' };
  sheet.getColumn('engine_hours').numFmt = '0.0';
  styleExportSheet(sheet);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}
app.get('/trailer-assignments-export.xlsx', async (req, res, next) => {
  try {
    const rows = db.prepare(`SELECT * FROM equipment WHERE ${divisionCondition(req)}
      ORDER BY CASE WHEN COALESCE(trailer_assigned, '') = '' THEN 1 ELSE 0 END,
        trailer_assigned COLLATE NOCASE, name COLLATE NOCASE, tag_id COLLATE NOCASE`).all();
    await sendTrailerAssignmentsWorkbook(res, rows, `trailer-assignments-${new Date().toISOString().slice(0,10)}.xlsx`);
  } catch (error) { next(error); }
});
app.get('/trailer-assignment-export.xlsx', async (req, res, next) => {
  try {
    if (!Object.hasOwn(req.query, 'trailer')) return res.status(400).json({ error: 'A trailer selection is required.' });
    const trailer = clean(req.query.trailer || '').slice(0, 100);
    const rows = db.prepare(`SELECT * FROM equipment
      WHERE COALESCE(trailer_assigned, '') = ? COLLATE NOCASE AND ${divisionCondition(req)}
      ORDER BY name COLLATE NOCASE, tag_id COLLATE NOCASE`).all(trailer);
    await sendTrailerAssignmentsWorkbook(res, rows, `selected-trailer-assignment-${new Date().toISOString().slice(0,10)}.xlsx`);
  } catch (error) { next(error); }
});
const OPEN_TICKET_STATUSES = ['Needs Attention', 'Tagged Out', 'With Mechanic', 'Awaiting Parts'];
function openTicket(equipmentId) {
  return db.prepare('SELECT * FROM tickets WHERE equipment_id = ? AND closed_at IS NULL').get(equipmentId);
}
function equipmentTickets(equipmentId) {
  return db.prepare('SELECT * FROM tickets WHERE equipment_id = ? ORDER BY id DESC').all(equipmentId).map(ticket => ({
    ...ticket, updates: db.prepare('SELECT * FROM ticket_updates WHERE ticket_id = ? ORDER BY id').all(ticket.id)
  }));
}
function ticketText(value, max) { return typeof value === 'string' && value.trim().length <= max ? value.trim() : ''; }
app.get('/tickets',(req,res)=>{
 const status=req.query.status||'all',q=ticketText(req.query.q||'',200),limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),250),offset=Math.max(parseInt(req.query.offset,10)||0,0);
 if(!['all','open','completed',...OPEN_TICKET_STATUSES].includes(status))return res.status(400).json({error:'Choose a valid ticket status.'});
 const terms=[divisionCondition(req,'e.division_id')],params=[];
 if(status==='open')terms.push('t.closed_at IS NULL');else if(status==='completed')terms.push('t.closed_at IS NOT NULL');else if(status!=='all'){terms.push('t.closed_at IS NULL AND t.status=?');params.push(status)}
 if(q){terms.push('(t.ticket_number LIKE ? OR t.description LIKE ? OR e.tag_id LIKE ? OR e.name LIKE ? OR EXISTS (SELECT 1 FROM ticket_updates u WHERE u.ticket_id=t.id AND u.notes LIKE ?))');params.push(...Array(5).fill('%'+q+'%'))}
 const where='WHERE '+terms.join(' AND '),total=db.prepare('SELECT count(*) n FROM tickets t JOIN equipment e ON e.id=t.equipment_id '+where).get(...params).n;
 const items=db.prepare(`SELECT t.*,e.tag_id,e.name AS equipment_name,e.status AS equipment_status,e.division_id,d.name AS division_name,
  (SELECT notes FROM ticket_updates WHERE ticket_id=t.id ORDER BY id DESC LIMIT 1) AS latest_update
  FROM tickets t JOIN equipment e ON e.id=t.equipment_id JOIN divisions d ON d.id=e.division_id ${where} ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`).all(...params,limit,offset);
 res.json({items,total,has_more:offset+items.length<total});
});
app.get('/tickets/open', (req, res) => {
  res.json(db.prepare(`SELECT t.*, e.tag_id, e.name, e.crew_assigned, e.trailer_assigned, e.division_id,
    (SELECT notes FROM ticket_updates WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) AS latest_update
    FROM tickets t JOIN equipment e ON e.id = t.equipment_id WHERE t.closed_at IS NULL AND ${divisionCondition(req,'e.division_id')} ORDER BY t.created_at, t.id`).all());
});
app.post('/equipment/:tag/tickets', (req, res) => {
  const item = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
  if (!item) return res.status(404).json({ error: 'Equipment not found.' });
  const description = ticketText(req.body?.description, 4000), reportedBy = ticketText(req.body?.reported_by, 80);
  if (!description || !reportedBy) return res.status(400).json({ error: 'Enter your name (up to 80 characters) and the problem (up to 4000 characters).' });
  const existing = openTicket(item.id);
  if (item.status === 'Sold') return res.status(409).json({ error: 'Sold equipment cannot be tagged out.' });
  const reportStatus = req.body.status ?? existing?.status ?? 'Tagged Out';
  if (req.body.status !== undefined && !['Needs Attention', 'Tagged Out'].includes(req.body.status)) return res.status(400).json({ error: 'Choose Needs attention — still usable or Tag out — do not use.' });
  if (reportStatus === 'Needs Attention' && item.status !== 'In Service' && !(existing && item.status === 'Needs Attention')) return res.status(409).json({ error: 'Only ready-to-use equipment can be flagged as still usable. Tag out this equipment to report a problem.' });
  if (existing) {
    const status = existing.status === 'Needs Attention' && reportStatus === 'Tagged Out' ? 'Tagged Out' : existing.status;
    db.transaction(() => {
      db.prepare('INSERT INTO ticket_updates (ticket_id,status,notes,actor_name) VALUES (?,?,?,?)').run(existing.id, status, `Additional problem reported:\n${description}`, reportedBy);
      db.prepare('UPDATE tickets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, existing.id);
      db.prepare('UPDATE equipment SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, item.id);
      req.actor = { name: reportedBy, role: 'Public reporter' };
      audit(req, 'ticket', existing.id, `${item.tag_id} · ${item.name}`, 'Reported additional problem', { description, changes: { status: { from: item.status, to: status } } }, item.id);
    })();
    return res.json(equipmentTickets(item.id).find(ticket => ticket.id === existing.id));
  }
  const ticket = db.transaction(() => {
    const number=nextTicketNumber(item.division_id);
    const result = db.prepare('INSERT INTO tickets (equipment_id,description,reported_by,status,ticket_number,reported_division_id) VALUES (?,?,?,?,?,?)').run(item.id, description, reportedBy, reportStatus,number,item.division_id);
    db.prepare('UPDATE equipment SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(reportStatus, item.id);
    req.actor = { name: reportedBy, role: 'Public reporter' };
    audit(req, 'ticket', result.lastInsertRowid, `${item.tag_id} · ${item.name}`, reportStatus === 'Needs Attention' ? 'Created attention ticket' : 'Created tag-out ticket', { description, changes: { status: { from: item.status, to: reportStatus } } }, item.id);
    const created = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);
    const log = addTicketLog(created, item.engine_hours);
    audit(req, 'equipment_log', log.lastInsertRowid, `${item.tag_id} · ${item.name}`, 'Created log entry', { entry_type: 'Mechanic ticket', ticket_id: created.id }, item.id);
    return created;
  })();
  res.status(201).json(ticket);
});
app.put('/equipment/:tag/tickets/:id', requirePin, (req, res) => {
  const item = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
  if (!item) return res.status(404).json({ error: 'Equipment not found.' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ? AND equipment_id = ?').get(req.params.id, item.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  if (ticket.closed_at) return res.status(409).json({ error: 'This ticket is already closed.' });
  const requestedStatus = req.body?.status;
  const finalStatuses = ['In Service', 'Out of Service', 'Sold'];
  const status = finalStatuses.includes(requestedStatus) ? 'Closed' : requestedStatus;
  const notes = ticketText(req.body?.notes, 4000);
  if (![...OPEN_TICKET_STATUSES, 'Closed'].includes(status) || !notes) return res.status(400).json({ error: 'Choose a ticket status and describe the next step or completed work (up to 4000 characters).' });
  if (status === 'Needs Attention' && (ticket.status !== 'Needs Attention' || item.status !== 'Needs Attention')) return res.status(409).json({ error: 'Tagged-out equipment cannot be marked still usable. Close the ticket with work notes and choose its final availability.' });
  const machineStatus = status === 'Closed' ? (finalStatuses.includes(requestedStatus) ? requestedStatus : req.body.machine_status) : status;
  if (status === 'Closed' && !['In Service', 'Out of Service', 'Sold'].includes(machineStatus)) return res.status(400).json({ error: 'Choose the final machine status.' });
  db.transaction(() => {
    db.prepare("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP, closed_at = CASE WHEN ? = 'Closed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?").run(status, status, ticket.id);
    db.prepare('INSERT INTO ticket_updates (ticket_id,status,notes,actor_name) VALUES (?,?,?,?)').run(ticket.id, status, notes, req.actor.name);
    db.prepare('UPDATE equipment SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(machineStatus, item.id);
    audit(req, 'ticket', ticket.id, `${item.tag_id} · ${item.name}`, status === 'Closed' ? 'Closed ticket' : 'Updated ticket', { notes, changes: { ticket_status: { from: ticket.status, to: status }, status: { from: item.status, to: machineStatus } } }, item.id);
  })();
  res.json(equipmentTickets(item.id).find(t => t.id === ticket.id));
});
app.get('/crew-options',(req,res)=>res.json(db.prepare(`SELECT c.*,d.name AS division_name FROM crew_options c JOIN divisions d ON d.id=c.division_id WHERE ${divisionCondition(req,'c.division_id')} ORDER BY d.id,c.name COLLATE NOCASE`).all()));
app.post('/crew-options',requirePin,(req,res)=>{
 const name=ticketText(req.body?.name,100),division=divisionInput(req.body?.division_id??0);
 if(!name||division===null)return res.status(400).json({error:'Enter a crew name and select its division.'});
 try{const row=db.prepare('INSERT INTO crew_options (division_id,name) VALUES (?,?)').run(division,name);audit(req,'crew',row.lastInsertRowid,name,'Added crew',{name,division_id:division});res.status(201).json({name,division_id:division})}catch(error){res.status(409).json({error:'That crew already exists in this division.'})}
});
app.put('/crew-options/:id',requirePin,(req,res,next)=>{
 const name=ticketText(req.body?.name,100),row=db.prepare('SELECT * FROM crew_options WHERE id=?').get(req.params.id);
 if(!row)return res.status(404).json({error:'Crew not found.'});
 if(!name)return res.status(400).json({error:'Enter a crew name (up to 100 characters).'});
 try{
  db.transaction(()=>{
   db.prepare('UPDATE crew_options SET name=? WHERE id=?').run(name,row.id);
   const assigned=db.prepare('UPDATE equipment SET crew_assigned=?,updated_at=CURRENT_TIMESTAMP WHERE division_id=? AND crew_assigned=? COLLATE NOCASE').run(name,row.division_id,row.name).changes;
   audit(req,'crew',row.id,name,'Renamed crew',{division_id:row.division_id,assignments_updated:assigned,changes:{name:{from:row.name,to:name}}});
  })();res.json({...row,name});
 }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That crew name already exists in this division.'});next(error)}
});
app.post('/assignments', requirePin, (req, res) => {
  const items = req.body?.items;
  const fields = ['crew_assigned','trailer_assigned','location'];
  const patch = Object.fromEntries(fields.filter(key => Object.hasOwn(req.body || {}, key)).map(key => [key, req.body[key]]));
  const note = ticketText(req.body?.note || '', 1000);
  if (!Array.isArray(items) || !items.length || items.length > 100 ||
      items.some(item => !item || typeof item.tag_id !== 'string') ||
      new Set(items.map(item => item.tag_id.toLowerCase())).size !== items.length ||
      !Object.keys(patch).length || Object.entries(patch).some(([key,value]) => typeof value !== 'string' || value.length > (key === 'location' ? 200 : 100)) ||
      (req.body?.note && !note)) return res.status(400).json({ error: 'Select 1–100 different machines and at least one assignment to change.' });
  try {
    const updated = db.transaction(() => {
      const rows = items.map(expected => {
        const row = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(expected.tag_id);
        if (!row || (Object.hasOwn(expected,'division_id')&&row.division_id!==expected.division_id) || !fields.every(key => (row[key] || '') === expected[key])) throw new Error('Assignments changed since you opened this screen. Close this form, refresh the list, and try again.');
        const setupError=assignmentSetupError(patch,row.division_id);if(setupError)throw Object.assign(new Error(setupError),{status:400});
        return row;
      });
      let count = 0;
      for (const row of rows) {
        const changes = Object.fromEntries(Object.entries(patch).filter(([key,value]) => (row[key] || '') !== value).map(([key,value]) => [key,{from:row[key],to:value}]));
        if (!Object.keys(changes).length) continue;
        const keys = Object.keys(patch);
        db.prepare(`UPDATE equipment SET ${keys.map(key => key + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...keys.map(key => patch[key]), row.id);
        audit(req,'equipment',row.id,`${row.tag_id} · ${row.name}`,'Reassigned equipment',{ changes, note },row.id);
        count++;
      }
      return count;
    })();
    res.json({ ok: true, updated });
  } catch (error) { res.status(error.status||409).json({ error: error.message }); }
});
app.put('/admin/pins/:id/role', requireMaster, (req,res) => {
  const role = req.body?.role;
  if (!['Manager','Mechanic','Crew','Editor'].includes(role)) return res.status(400).json({ error: 'Choose a valid role.' });
  const row = db.prepare('SELECT * FROM access_pins WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'PIN not found.' });
  db.prepare('UPDATE access_pins SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role,row.id);
  audit(req,'security',row.id,row.name,'Changed access role',{ changes: { role: { from: row.role,to: role } } });
  res.json({ ok: true });
});

app.get('/equipment/:tag', (req, res) => {
  const row = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
  if (!row) return res.status(404).json({ error: 'Equipment not found.' });
  const maintenance = db.prepare('SELECT * FROM maintenance WHERE equipment_id = ? ORDER BY service_date DESC, id DESC').all(row.id);
  res.json({ ...equipmentWithService(row), maintenance, tickets: equipmentTickets(row.id) });
});
const createEquipment = db.transaction((data) => {
  const sequence = db.prepare('SELECT last_number FROM tag_sequence WHERE id = 1').get();
  const nextNumber = sequence.last_number + 1;
  const tagId = String(nextNumber).padStart(5, '0');
  db.prepare('UPDATE tag_sequence SET last_number = ? WHERE id = 1').run(nextNumber);
  const values = { status: 'In Service', ...data, tag_id: tagId };
  const cols = Object.keys(values); const marks = cols.map(() => '?').join(',');
  const result = db.prepare(`INSERT INTO equipment (${cols.join(',')}) VALUES (${marks})`).run(...cols.map(k => values[k] === '' ? null : values[k]));
  return db.prepare('SELECT * FROM equipment WHERE id = ?').get(result.lastInsertRowid);
});
app.post('/equipment', requirePin, (req, res) => {
  try {
    const data = payload(req.body);
    delete data.tag_id;
    data.division_id=divisionInput(data.division_id??0);
    if(data.division_id===null)return res.status(400).json({error:'Select a valid division.'});
    if(!Object.hasOwn(data,'service_interval_hours'))data.service_interval_hours=db.prepare('SELECT service_interval_hours FROM divisions WHERE id=?').get(data.division_id).service_interval_hours;
    const validationError = validateEquipment(data);
    if (validationError) return res.status(400).json({ error: validationError });
    if (!data.name) return res.status(400).json({ error: 'Equipment name is required.' });
    if (Object.hasOwn(data, 'status') && !['In Service', 'Out of Service', 'Sold'].includes(data.status)) return res.status(400).json({ error: 'Choose a valid equipment availability. Create a repair ticket to tag out equipment.' });
    const setupError=data.division_id===0?null:assignmentSetupError(data,data.division_id);if(setupError)return res.status(400).json({error:setupError});
    const created = createEquipment(data);
    audit(req, 'equipment', created.id, `${created.tag_id} · ${created.name}`, 'Created equipment', { fields: data }, created.id);
    res.status(201).json(equipmentWithService(created));
  } catch (e) { res.status(e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 400).json({ error: e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That Tag ID is already in use.' : e.message }); }
});
app.put('/equipment/:tag/status', requirePin, (req, res) => {
  if (!req.body || Object.keys(req.body).length !== 1 || !['Out of Service', 'In Service', 'Sold'].includes(req.body.status)) {
    return res.status(400).json({ error: 'Select Out of Service, In Service, or Sold. Only status can be changed here.' });
  }
  const existing = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
  if (!existing) return res.status(404).json({ error: 'Equipment not found.' });
  if (openTicket(existing.id)) return res.status(409).json({ error: 'Update or close the open ticket with a PIN to change this machine status.' });
  db.transaction(() => {
    if (existing.status === req.body.status) return;
    db.prepare('UPDATE equipment SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.body.status, existing.id);
    audit(req, 'equipment', existing.id, `${existing.tag_id} · ${existing.name}`, 'Updated equipment status', {
      changes: { status: { from: existing.status, to: req.body.status } }
    }, existing.id);
  })();
  res.json(equipmentWithService(db.prepare('SELECT * FROM equipment WHERE id = ?').get(existing.id)));
});
app.put('/equipment/:tag', requirePin, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
    if (!existing) return res.status(404).json({ error: 'Equipment not found.' });
    if(Object.hasOwn(req.body||{},'expected_division_id')&&Number(req.body.expected_division_id)!==existing.division_id)return res.status(409).json({error:'Equipment moved to another division. Reopen its details before editing.'});
    const data = payload(req.body);
    delete data.tag_id;
    if(Object.hasOwn(data,'division_id')&&Number(data.division_id)!==existing.division_id)return res.status(409).json({error:'Use Transfer division to move equipment between divisions.'});
    delete data.division_id;
    const setupError=assignmentSetupError(data,existing.division_id,existing);if(setupError)return res.status(400).json({error:setupError});
    const validationError = validateEquipment(data);
    if (validationError) return res.status(400).json({ error: validationError });
    if (Object.hasOwn(data, 'status')) return res.status(409).json({ error: 'Change availability in the Equipment status panel. Edit Info only changes equipment details.' });
    if (data.name === '') return res.status(400).json({ error: 'Equipment name is required.' });
    const cols = Object.keys(data);
    if (cols.length) db.prepare(`UPDATE equipment SET ${cols.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...cols.map(k => data[k] === '' ? null : data[k]), existing.id);
    const updated = db.prepare('SELECT * FROM equipment WHERE id = ?').get(existing.id);
    const changes = Object.fromEntries(cols.filter(k => String(existing[k] ?? '') !== String(updated[k] ?? '')).map(k => [k, { from: existing[k], to: updated[k] }]));
    if (Object.keys(changes).length) audit(req, 'equipment', updated.id, `${updated.tag_id} · ${updated.name}`, 'Updated equipment', { changes }, updated.id);
    res.json(equipmentWithService(updated));
  } catch (e) { res.status(e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 400).json({ error: e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That Tag ID is already in use.' : e.message }); }
});
app.delete('/equipment/:tag', requirePin, (req, res) => {
  const existing = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
  if (!existing) return res.status(404).json({ error: 'Equipment not found.' });
  if (db.prepare('SELECT 1 FROM tickets WHERE equipment_id = ? LIMIT 1').get(existing.id) || db.prepare('SELECT 1 FROM maintenance WHERE equipment_id = ? LIMIT 1').get(existing.id)) {
    return res.status(409).json({ error: 'Equipment with repair tickets or log entries cannot be deleted. Mark it Sold or Unavailable to preserve its history.' });
  }
  const result = db.prepare('DELETE FROM equipment WHERE tag_id = ? COLLATE NOCASE').run(req.params.tag);
  if (!result.changes) return res.status(404).json({ error: 'Equipment not found.' });
  audit(req, 'equipment', existing.id, `${existing.tag_id} · ${existing.name}`, 'Deleted equipment', {division_id:existing.division_id}, existing.id);
  res.status(204).end();
});
app.post('/equipment/:tag/maintenance', requirePin, (req, res) => {
  const item = db.prepare('SELECT * FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
  if (!item) return res.status(404).json({ error: 'Equipment not found.' });
  const { service_date, service_type, engine_hours, performed_by, notes } = req.body;
  if (['Damage Report', 'Incident Report'].includes(clean(service_type))) return res.status(400).json({ error: 'Use Report a problem to report damage or an incident. This creates a mechanic ticket and an equipment log entry.' });
  if (clean(service_type) === 'Mechanic ticket') return res.status(400).json({ error: 'Mechanic ticket entries are created automatically when reporting a problem.' });
  if (!service_date || !clean(service_type)) return res.status(400).json({ error: 'Entry date and type are required.' });
  if (typeof service_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(service_date) ||
      !Number.isFinite(Date.parse(service_date)) || new Date(service_date).toISOString().slice(0, 10) !== service_date) {
    return res.status(400).json({ error: 'Entry date must be a valid calendar date.' });
  }
  const hours = engine_hours == null || engine_hours === '' ? null : Number(engine_hours);
  if (hours !== null && (!['number', 'string'].includes(typeof engine_hours) || !Number.isFinite(hours) || hours < 0)) {
    return res.status(400).json({ error: 'Equipment hours must be a nonnegative number.' });
  }
  const created = db.transaction(() => {
    const result = db.prepare('INSERT INTO maintenance (equipment_id,service_date,service_type,engine_hours,performed_by,notes) VALUES (?,?,?,?,?,?)')
      .run(item.id, service_date, clean(service_type), hours, clean(performed_by || ''), clean(notes || ''));
    // Historical entries remain in the log without replacing a newer service baseline.
    // A new service without a reading has unknown hours, rather than the old service's reading.
    if (/oil/i.test(service_type) && (!item.last_oil_change_date || service_date >= item.last_oil_change_date)) {
      db.prepare(`UPDATE equipment SET last_oil_change_date = ?, last_oil_change_hours = ?,
        engine_hours = CASE WHEN ? IS NULL THEN engine_hours ELSE MAX(COALESCE(engine_hours,0), ?) END,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(service_date, hours, hours, hours, item.id);
    }
    return db.prepare('SELECT * FROM maintenance WHERE id = ?').get(result.lastInsertRowid);
  })();
  audit(req, 'equipment_log', created.id, `${item.tag_id} · ${item.name}`, 'Created log entry', { entry_type: created.service_type, entry_date: created.service_date }, item.id);
  res.status(201).json(created);
});
app.delete('/maintenance/:id', requirePin, (req, res) => {
  const existing = db.prepare(`SELECT m.*, e.tag_id, e.name AS equipment_name FROM maintenance m
    JOIN equipment e ON e.id = m.equipment_id WHERE m.id = ?`).get(req.params.id);
  if (existing?.ticket_id) return res.status(409).json({ error: 'Mechanic ticket log entries are part of the repair history and cannot be deleted.' });
  const result = db.prepare('DELETE FROM maintenance WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Equipment log entry not found.' });
  audit(req, 'equipment_log', existing.id, `${existing.tag_id} · ${existing.equipment_name}`, 'Deleted log entry', { entry_type: existing.service_type, entry_date: existing.service_date }, existing.equipment_id);
  res.status(204).end();
});

app.get('/audit', requirePin, (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const entityType = clean(req.query.entity_type || '');
  const sort = clean(req.query.sort || 'recent');
  const orderBy = {
    recent: 'a.created_at DESC, a.id DESC',
    oldest: 'a.created_at ASC, a.id ASC',
    equipment_type: `COALESCE(e.category, '') COLLATE NOCASE ASC, a.created_at DESC, a.id DESC`,
    equipment: 'a.entity_label COLLATE NOCASE ASC, a.created_at DESC, a.id DESC',
    action: 'a.action COLLATE NOCASE ASC, a.created_at DESC, a.id DESC',
    actor: 'a.actor_name COLLATE NOCASE ASC, a.created_at DESC, a.id DESC'
  }[sort] || 'a.created_at DESC, a.id DESC';
  const where = `a.entity_type != 'security' AND (? = '' OR a.entity_type = ?) AND ${divisionCondition(req,"COALESCE((SELECT division_id FROM equipment WHERE id=a.equipment_id),json_extract(a.details,'$.division_id'),0)")}`;
  const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_log a WHERE ${where}`).get(entityType, entityType).count;
  const rows = db.prepare(`SELECT a.*, COALESCE(e.category, '') AS equipment_type
    FROM audit_log a LEFT JOIN equipment e ON e.id = a.equipment_id
    WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(entityType, entityType, limit, offset)
    .map(row => ({ ...row, details: JSON.parse(row.details || '{}') }));
  res.json({ items: rows, total, has_more: offset + rows.length < total });
});

function masterDeleteSnapshot(tag){
 const equipment=db.prepare('SELECT * FROM equipment WHERE tag_id=? COLLATE NOCASE').get(tag);if(!equipment)return null;
 const tickets=db.prepare('SELECT * FROM tickets WHERE equipment_id=? ORDER BY id').all(equipment.id);
 const logs=db.prepare('SELECT * FROM maintenance WHERE equipment_id=? ORDER BY id').all(equipment.id);
 const updates=db.prepare('SELECT u.* FROM ticket_updates u JOIN tickets t ON t.id=u.ticket_id WHERE t.equipment_id=? ORDER BY u.id').all(equipment.id);
 return {equipment,tickets,logs,updates,revision:crypto.createHash('sha256').update(JSON.stringify([equipment,tickets,logs,updates])).digest('hex')};
}
app.get('/admin/equipment',requireMaster,(req,res)=>{
 const limit=Math.min(Math.max(parseInt(req.query.limit,10)||100,1),250),offset=Math.max(parseInt(req.query.offset,10)||0,0),q=ticketText(req.query.q||'',200),division=req.query.division_id;
 if(division!==undefined&&division!==''&&divisionInput(division)===null)return res.status(400).json({error:'Choose a valid division.'});
 const terms=[],params=[];if(q){terms.push('(e.tag_id LIKE ? OR e.name LIKE ? OR e.serial_number LIKE ?)');params.push(...Array(3).fill('%'+q+'%'))}if(division!==undefined&&division!==''){terms.push('e.division_id=?');params.push(Number(division))}
 const where=terms.length?'WHERE '+terms.join(' AND '):'';
 const total=db.prepare('SELECT count(*) n FROM equipment e '+where).get(...params).n;
 const items=db.prepare(`SELECT e.id,e.tag_id,e.name,e.category,e.status,e.division_id,e.crew_assigned,e.trailer_assigned,d.name AS division_name,
  (SELECT count(*) FROM tickets WHERE equipment_id=e.id) AS ticket_count,
  (SELECT count(*) FROM maintenance WHERE equipment_id=e.id) AS log_count
  FROM equipment e JOIN divisions d ON d.id=e.division_id ${where}
  ORDER BY CASE WHEN e.tag_id NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END,CAST(e.tag_id AS INTEGER),e.tag_id COLLATE NOCASE,e.id LIMIT ? OFFSET ?`).all(...params,limit,offset);
 res.json({items,total,has_more:offset+items.length<total});
});
app.get('/admin/equipment/:tag',requireMaster,(req,res)=>{
 const snapshot=masterDeleteSnapshot(req.params.tag);if(!snapshot)return res.status(404).json({error:'Equipment not found.'});
 const x=snapshot.equipment;res.json({tag_id:x.tag_id,name:x.name,division_name:db.prepare('SELECT name FROM divisions WHERE id=?').get(x.division_id).name,ticket_count:snapshot.tickets.length,log_count:snapshot.logs.length,update_count:snapshot.updates.length,revision:snapshot.revision});
});
app.delete('/admin/equipment/:tag',requireMaster,async(req,res)=>{
 const snapshot=masterDeleteSnapshot(req.params.tag);if(!snapshot)return res.status(404).json({error:'Equipment not found.'});
 if(clean(req.body?.confirm_tag)!==snapshot.equipment.tag_id)return res.status(400).json({error:'Type the equipment number to confirm master deletion.'});
 if(req.body?.revision!==snapshot.revision)return res.status(409).json({error:'Equipment or repair history changed. Review the deletion again.'});
 const backupDir=path.join(__dirname,'backups','master-deletions'),backupName=`equipment-${snapshot.equipment.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`;
 try{await fs.promises.mkdir(backupDir,{recursive:true,mode:0o700});await db.backup(path.join(backupDir,backupName));await fs.promises.chmod(path.join(backupDir,backupName),0o600)}catch(error){console.error(error);return res.status(500).json({error:'Could not save a backup. Nothing was deleted.'})}
 try{
  db.transaction(()=>{
   if(!matchesPin(req.get('x-master-pin'),setting('master_pin_hash')))throw Object.assign(new Error('Master PIN changed. Sign in again.'),{status:401});
   const latest=masterDeleteSnapshot(req.params.tag);if(!latest||latest.revision!==snapshot.revision)throw Object.assign(new Error('Equipment or repair history changed. Review the deletion again.'),{status:409});
   const item=latest.equipment;db.prepare('DELETE FROM equipment WHERE id=?').run(item.id);
   audit(req,'equipment',item.id,`${item.tag_id} · ${item.name}`,'Master deleted equipment',{division_id:item.division_id,deleted_tickets:latest.tickets.length,deleted_logs:latest.logs.length,deleted_updates:latest.updates.length,backup_file:backupName},item.id);
  })();res.json({deleted:true,tag_id:snapshot.equipment.tag_id,backup_saved:true});
 }catch(error){res.status(error.status||500).json({error:error.status?error.message:'Deletion failed. Nothing was deleted.'})}
});

app.get('/admin/pins', requireMaster, (_req, res) => {
  res.json(db.prepare('SELECT id,name,pin,role,created_at,updated_at FROM access_pins ORDER BY name COLLATE NOCASE, id').all());
});

app.get('/equipment/:tag/audit', requirePin, (req, res) => {
  const item = db.prepare('SELECT id FROM equipment WHERE tag_id = ? COLLATE NOCASE').get(req.params.tag);
  if (!item) return res.status(404).json({ error: 'Equipment not found.' });
  const rows = db.prepare(`SELECT * FROM audit_log WHERE equipment_id = ?
    ORDER BY created_at DESC, id DESC`).all(item.id)
    .map(row => ({ ...row, details: JSON.parse(row.details || '{}') }));
  res.json(rows);
});

app.post('/admin/pins', requireMaster, (req, res) => {
  const name = clean(req.body.name || '');
  const pin = clean(req.body.pin || '');
  const role = req.body.role || 'Manager';
  if (!['Manager','Mechanic','Crew','Editor'].includes(role)) return res.status(400).json({ error: 'Choose a valid role.' });
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'The PIN must contain exactly 4 digits.' });
  if (matchesPin(pin, setting('master_pin_hash'))) return res.status(409).json({ error: 'That PIN is reserved for master access.' });
  try {
    const result = db.prepare('INSERT INTO access_pins (name,pin,role) VALUES (?,?,?)').run(name.slice(0, 80), pin, role);
    audit(req, 'security', result.lastInsertRowid, name, 'Created access PIN', { name, role });
    res.status(201).json(db.prepare('SELECT id,name,pin,role,created_at,updated_at FROM access_pins WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    res.status(e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 400).json({ error: e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That PIN is already in use.' : e.message });
  }
});

app.delete('/admin/pins/:id', requireMaster, (req, res) => {
  const existing = db.prepare('SELECT * FROM access_pins WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'PIN not found.' });
  db.prepare('DELETE FROM access_pins WHERE id = ?').run(existing.id);
  audit(req, 'security', existing.id, existing.name, 'Deleted access PIN', { name: existing.name });
  res.status(204).end();
});

app.post('/admin/master-pin', requireMaster, (req, res) => {
  const masterPin = clean(req.body.master_pin || '');
  if (!/^\d{4}$/.test(masterPin)) return res.status(400).json({ error: 'The master PIN must contain exactly 4 digits.' });
  if (db.prepare('SELECT 1 FROM access_pins WHERE pin = ?').get(masterPin)) return res.status(409).json({ error: 'That PIN is already assigned to a user.' });
  setSetting('master_pin_hash', hashPin(masterPin));
  audit(req, 'security', 'master', 'Master PIN', 'Changed master PIN');
  res.json({ ok: true });
});

app.use('/equiptags', express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/equiptags/admin/inventory', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'inventory', 'index.html')));
app.get('/equiptags/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get(/^\/equiptags(?:\/.*)?$/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error.' }); });

if (require.main === module) app.listen(PORT, '127.0.0.1', () => console.log(`EquipTags listening on http://127.0.0.1:${PORT}`));
module.exports = app;
