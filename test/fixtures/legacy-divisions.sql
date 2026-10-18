CREATE TABLE equipment (
 id INTEGER PRIMARY KEY AUTOINCREMENT, tag_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL,category TEXT DEFAULT '',manufacturer TEXT DEFAULT '',model TEXT DEFAULT '',
 serial_number TEXT DEFAULT '',purchase_date TEXT DEFAULT '',purchase_price REAL,
 status TEXT NOT NULL DEFAULT 'In Service',crew_assigned TEXT DEFAULT '',location TEXT DEFAULT '',
 engine_hours REAL,last_oil_change_date TEXT DEFAULT '',last_oil_change_hours REAL,
 service_interval_hours REAL DEFAULT 100,notes TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 trailer_assigned TEXT DEFAULT ''
);
CREATE TABLE crew_options (name TEXT PRIMARY KEY COLLATE NOCASE);
CREATE TABLE trailer_options (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE COLLATE NOCASE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO equipment (tag_id,name,crew_assigned,trailer_assigned) VALUES ('00001','Legacy mower','Legacy crew','Legacy trailer');
INSERT INTO crew_options (name) VALUES ('Legacy crew');
INSERT INTO trailer_options (name) VALUES ('Legacy trailer');
