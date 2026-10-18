# Inventoryapp

Equipment inventory, crew/trailer assignments, problem reports, and maintenance history with NFC links to individual machines. The frontend is plain HTML/CSS/JavaScript; Express serves the API, and SQLite stores the data.

- [Part A — Daily workflows](#part-a--daily-workflows)
- [Part B — Application logic and database](#part-b--application-logic-and-database)
- [Part C — Deploy to AWS with a new database](#part-c--deploy-to-aws-with-a-new-database)

Independent deployment repository: <https://github.com/robbyweeds/Inventoryapp>. Each company runs its own instance and SQLite database. This repository includes no company inventory or runtime PINs.

Quick start with Node.js 24: `npm ci`, copy `.env.example` to `.env`, replace the company name and both PIN placeholders, then run `node --env-file=.env server.js`. Open `http://127.0.0.1:5002/equiptags/admin/` to create divisions, then open `/equiptags/` and sign in as Manager. See Part C for production hosting. No frontend build is required.

## Part A — Daily workflows

### Choose the division first

Select one of your company’s admin-created divisions at the top of the page. A fresh installation has only **Unassigned division**; admin creates the named divisions before staff add inventory. Choose **Select multiple divisions** or **All divisions** to review together; rows identify their division. Equipment, counts, repair queues, crew/trailer choices, exports, and manager history follow that selection. Individual NFC links open the machine directly.

Use short equipment and crew names within a division, such as **Mower**, **Blower**, and **Crew**; the header and row labels already identify the division. Existing custom names are retained. Each crew and trailer belongs to one division. Existing records from before divisions were introduced are under **Unassigned division**. Division selection organizes the view; it does not restrict a person's access to another division.

Equipment is presented in compact, full-width rows. Crew and trailer names on manager rows open reassignment directly. Expand a problem summary to read its description and latest update, or open **Details** for the complete record. Filters, sort, selection, and scroll position are remembered per workspace and division selection in the browser tab.

A fresh installation creates master/admin access and one named Manager PIN. Foremen/crews can view and report without a PIN; mechanics can open the Mechanic workspace using Manager access. Dedicated Mechanic/Crew roles remain supported for future configuration.

### Foreman / crew

There is no separate Foreman permission role. Foremen can view and report without a PIN; an optional **Crew** PIN identifies a restricted crew session.

1. Select the division and open **In-use equipment**. Filter by crew and search by equipment name, tag, trailer, or model.
2. Check the status before using a machine. **Ready** is available; **Needs attention** is still usable. **Tagged out**, **With mechanic**, and **Awaiting parts** mean do not use. **Unavailable** is out of service. Sold machines are omitted from this workspace.
3. Open **Details** or scan an NFC tag/QR code containing the machine’s direct URL (`/equiptags/e/00001`). No sign-in or division choice is needed to view it. The phone page shows the machine name/tag and status, followed by **Where it belongs**: division, crew, and trailer. Equipment details, repair history, and service logs are below; crew views keep the longer history/details collapsed. **Copy NFC Address** stays visible in the bottom bar, outside all sections, for every viewer without signing in.
4. Use **Report problem**, enter your name, describe the problem (and optionally where it happened), and choose an attention flag or tag-out. Public visitors can also report without a PIN. If a repair is already open, use **Report another issue**: your issue is added with your name and the time reported. Keep the current status, or escalate Needs attention to **Do not use** when necessary. Existing mechanic/parts statuses stay in place.
5. Follow the repair updates on that record. A mechanic or manager must resolve the problem and return the equipment to service.

Crew access cannot edit equipment details, reassign machines, or clear a tag-out. A foreman who also needs those duties needs Manager access.

### Manager

1. Select a division, use **Staff sign in**, and enter your Manager PIN. The app opens **Manager review**. Signing in from a scanned equipment page keeps that machine open instead.
2. Search or filter the compact list. Click a summary count to show available equipment, unassigned equipment, open problems, or service due. Click **Details** for a full record or **Edit** to change equipment information.
3. For one assignment change, click the machine's crew/trailer name or **Reassign**. For several, check individual rows or **Select visible**, then **Reassign selected**. Selections remain when filters change; the toolbar identifies selected machines outside the current filters.
4. Each field starts with **Keep existing**. Choose only what should change; choose **Unassigned** to clear a crew or **No trailer** to clear a trailer. Review the preview and save. A concurrent assignment change rejects the batch without partially applying it; review the error and retry.
5. Open **Crews & trailers** from Manager review or Inventory. Choose the **Crews** or **Trailers** tab, enter a name, and add it directly on the page. The page clearly names the division being changed; changing the header division keeps you on this page. Existing rows show assigned-equipment counts, a name search, and **View equipment**. Duplicate-name/save errors stay next to the form without clearing the name. Both crew and trailer **Rename** actions use inline forms and update matching equipment assignments within that division. Duplicate names are rejected without partially changing assignments. Trailer **Remove** also uses an inline form; removing a trailer clears its equipment assignments after inline confirmation. In combined review, choose one division on the page first. Use **Division setup** separately for categories and the default oil-service interval; those defaults apply to new equipment, while existing equipment keeps its values.
6. To move machines between divisions, open **Edit assignments** on an equipment page or **Reassign** on a manager row, then choose **Move to another division** in the popup. For multiple machines, select them and open **Reassign selected**; the move option is inside that popup too. Choose the destination and save; the machines enter its **Unassigned** group with their crew/trailer assignments cleared. Maintenance history and service settings remain. By default the app opens that division’s Unassigned group. Assign crews/trailers there afterward.
7. Use **Mechanic queue** for repairs or record maintenance from the equipment detail. Resolve tickets with work notes, change availability, and mark retired equipment **Sold** when appropriate.
8. Use **History** for audited equipment changes, **Inventory** for the complete equipment list and spreadsheet export, and trailer exports for assignment reviews.

Crew and trailer assignments are independent: select a crew and **No trailer** to assign equipment directly to that crew. In Reassign, **Keep existing trailer** preserves the current trailer, while **No trailer** clears it. Both use the existing assignment fields and API; no database or deployment changes are needed.

Division categories and service defaults are configured from **Mechanic queue → Division setup**, using manager access.

Tags are generated automatically. New equipment starts Ready to use. Managers cannot delete equipment with repair or maintenance history; mark it Sold or Unavailable instead. The admin Master inventory page has a separate confirmed master-delete workflow. Manager access does not manage PINs or create divisions.

### Mechanic

1. Select the division and sign in with Manager access (or a dedicated Mechanic PIN if configured), then open **Mechanic queue**. Its equipment queue initially shows open problems. Select **All tickets & history** to review individual tickets, including completed work, in compact rows. Choose All tickets, Open only, Completed, or a specific open status; search by ticket number, equipment tag/name, or problem/work-note text. Filters are saved separately for each division selection.
2. Each repair has a ticket number such as **CC1-0001**, distinct from equipment tag **00001**. Use **View history** for the original report and progress/completion notes. Open **Update repair** directly from an open-ticket row or the equipment queue; completed tickets are read-only. Record progress and work notes; choose Tagged out, With mechanic, or Awaiting parts as appropriate.
3. Review the original problem and all additional reports in repair history. When all issues are addressed, choose **Ready to use** or **Unavailable** and enter the required resolution notes. That closes the ticket. Closed tickets and their updates remain in the record.
4. From **Details**, add equipment-log entries for inspections, maintenance, repairs, and oil changes, including the date, hours, person performing the work, and notes. Record damage/incidents through **Report problem** instead.
5. Review the **Service due** filter and current service baseline. A missing hour reading means the remaining service interval may be unknown.

Mechanics can update repairs, add maintenance, and change ordinary availability. They cannot change equipment identity, assignments, division setup, PINs, or mark equipment Sold. Deleting ordinary log entries requires a manager; ticket-linked entries cannot be deleted separately.

### Admin

1. Open `/equiptags/admin/` and unlock with the master/admin PIN. Staff sign-in also redirects an admin PIN to that page.
2. Create named staff PINs with **Manager**, **Mechanic**, or **Crew** roles. Change roles or remove access when duties change. A legacy **Editor** role also has equipment-management access.
3. Rotate the master PIN through the admin controls. Keep it distinct from staff PINs.
4. Under **Divisions**, enter a name and choose **Create division**. Names are unique regardless of case. A new division starts with empty equipment, crews, and trailers, standard categories, and a 100-hour service interval.
5. Use **Open division** to review it. A manager then configures the division and adds its equipment/crews/trailers.
6. Open **Master inventory** to review all divisions’ equipment, including Unassigned and Sold items, in equipment-number order. Search by number/name/serial or filter by division. **Master delete** previews the equipment and repair/log counts. Type its exact equipment number to confirm. This removes the equipment, tickets, ticket updates, and maintenance logs, while retaining audit history. A private database backup is saved automatically first. If the record/history changed since preview, cancel and review again.
7. Use **Sign out** when finished, especially on a shared device.

Admin/master access manages PINs, creates divisions, and can master-delete inventory through its separate protected page. Ordinary equipment edits, assignment changes, and status updates still use a Manager PIN. PINs work across all divisions. New installations start with one master/admin PIN and one named Manager PIN. Additional roles are optional.

## Part B — Application logic and database

### Code and request flow

| File | Responsibility |
| --- | --- |
| `server.js` | Express routes, schema initialization/migrations, validation, authorization, SQLite queries, auditing, Excel exports, and static serving. |
| `public/index.html` | Shared app shell and script/style loading. |
| `public/divisions.js` | Header selection, combined review, division setup and transfers. |
| `public/workspaces.js` | Crew, manager, and mechanic lists, filters, selection, quick reassignment, and staff identity. |
| `public/tickets.js` | All/open/completed ticket history, number/problem search, per-division filters, and direct repair updates. |
| `public/setup.js` | Dedicated division-scoped crew/trailer page, inline creation, equipment counts/search, and inline crew/trailer rename plus trailer removal. |
| `public/app.js` | Shared API helper, routing, inventory, equipment details/forms, trailers, reports, ticket updates, and maintenance. |
| `public/admin.html` | Separate admin interface for staff PINs, master PIN rotation, new divisions, and a Master inventory link. |
| `public/admin/inventory/index.html`, `public/admin-inventory.js` | Master-only number-ordered inventory, search/filtering, deletion preview, and typed confirmation. |
| `public/styles.css`, `list.css`, `maintenance.css`, `workspaces.css`, `compact.css` | Base styles and views; `compact.css` supplies the shared dense rows and full-width app layout. |
| `test/` | Node test runner suites using temporary databases, including migration, permissions, tickets, service calculations, and assignments. |
| `scripts/seed-division-demo.js` | Explicit, optional demo setup through the API. |

The `/equiptags/crews-trailers?tab=crews` and `?tab=trailers` routes open the dedicated management page. It requires a Manager/Editor PIN for its controls, uses the existing crew/trailer/equipment API endpoints, and keeps the selected tab while changing divisions. Division IDs are captured explicitly on saves so a name is added to the division shown when submitted. Direct links and reloads preserve the page; an expired/missing PIN shows manager sign-in. The older `/equiptags/trailers` page remains available for grouped assignments and exports. The page uses existing tables; crew-name editing uses `PUT /crew-options/:id`. Crew/trailer renames keep the option ID and update assigned equipment only in that option’s division.

The browser calls `/equiptags-api/…` using `fetch`. The reverse proxy forwards to Express on localhost. Express validates the request and role, runs prepared SQLite statements/transactions through `better-sqlite3`, and returns JSON or an Excel workbook. The browser renders the response. No frontend build step, ORM, external database server, attachment storage, or background job queue is required. `npm start` runs the server; `npm test` runs regression tests.

`GET /equiptags/e/:tag` serves the app shell, whose browser router loads that specific equipment record. This supports direct NFC/QR/bookmarked links. The mobile equipment page prioritizes status and division/crew/trailer rows, with a public **Report another issue** action available even while a repair is open. Public viewers get the Crew-style view. Staff sign-in/sign-out from a direct equipment page keeps that machine open. The Copy NFC Address control is a fixed equipment-page footer outside the collapsible sections, available to public viewers and all staff roles; bottom spacing keeps page content clear of it. It uses the existing clipboard/manual-copy dialog and does not change permissions or database writes. The app does not read the NFC tag itself: the phone opens the URL stored on the tag, and QR codes use the same URL. Division, crew, and trailer define placement in the UI. The legacy `equipment.location` field remains in the database/API and concurrency snapshots for compatibility, but is no longer displayed, searched, or edited in the equipment UI. Reports can optionally describe where an issue happened; this is report text, not an equipment assignment. No database schema change or QR/NFC-specific server service is needed.

The server also serves static assets under `/equiptags/`. It accepts API routes directly (for example `/health`) and strips an incoming `/equiptags-api/` prefix when present.

### Database location and initialization

The database is **`equiptags.db` beside `server.js`**. Its path is fixed in the code; there is no `DATABASE_URL` or `DB_PATH` setting. SQLite WAL journaling and foreign keys are enabled. The process needs write access to the directory for the database and `equiptags.db-wal` / `equiptags.db-shm` sidecars.

Startup creates missing tables/indexes, adds supported missing columns, migrates legacy crew/trailer options into divisions, normalizes legacy `Active` status, synchronizes equipment with open tickets, and backfills ticket-linked log entries. The migration preserves existing equipment under division 0. Named division IDs are allocated when admin creates them; new installs have only division 0. Startup initializes PIN settings only when absent. A fresh checkout without a database therefore creates an independent, empty equipment database automatically.

Startup also adds stable `ticket_number` and `reported_division_id` columns and the `ticket_sequences` table when absent. Existing tickets, including completed ones, are numbered in ID order using their original division audit snapshot when available, otherwise the equipment’s current division. Linked log headings are updated to show the ticket number; ticket/update IDs, descriptions, reporters, and completion records are retained. Repeated startup does not renumber tickets.

Startup does **not** insert demo equipment. Schema upgrades are automatic rather than a separate migration command: take a consistent database backup before starting a new version. Older source may require restoring its matching database backup.

### Tables and relationships

| Table | Contents and links |
| --- | --- |
| `divisions` | Division ID and unique name, default service interval, categories serialized as JSON. ID 0 represents legacy/unassigned data. |
| `equipment` | Unique case-insensitive tag, identity/purchase fields, status, division ID, crew/trailer names, location, hours, oil-service baseline, interval, notes, timestamps. |
| `crew_options` | Crew ID, division ID, and name; names unique within a division. |
| `trailer_options` | Trailer ID, division ID, name and timestamps; names unique within a division. |
| `tickets` | Equipment ID, unique display `ticket_number`, reporting-division snapshot `reported_division_id`, description, reporter, status, timestamps, and `closed_at`. A partial unique index permits only one open ticket per machine. |
| `ticket_updates` | Ticket ID, status, notes, staff name, timestamp; preserves progress history. |
| `maintenance` | Equipment ID, service date/type/hours, performed-by, notes and timestamp; optional unique `ticket_id` links the automatically created ticket log. A cost column exists in the schema but the current entry form/insert does not collect cost. |
| `audit_log` | Entity/action, equipment reference, actor name/role, timestamp, JSON change details, and division snapshot. Equipment references here intentionally survive record deletion. |
| `access_pins` | Staff name, PIN, role, timestamps. Named staff PINs are currently stored in readable form for admin management. |
| `app_settings` | Salted scrypt hashes for master/initial editor PIN settings and migration flags. |
| `ticket_sequences` | Stable prefix and last ticket counter per reporting division; independent of equipment tag numbering and retained after ticket deletion. |
| `tag_sequence` | Single sequence counter for automatic five-digit tags, starting at `00001`. |

Equipment-to-ticket/log and ticket-to-update relationships use equipment/ticket IDs and foreign keys. Crew/trailer assignments are stored as **names plus equipment division**, not option IDs; application validation checks the selected division's options. Renaming/removing trailers updates or clears related assignment names through the API. Crew/trailer names can repeat across divisions as distinct setups.

### Roles, authentication, and browser state

Protected staff calls send `x-edit-pin`; admin routes send `x-master-pin`. `/auth/pin` returns the staff name and role. The backend rechecks the PIN and permitted role on each protected request. Named staff identities come from the database; admin audit identity can use `x-actor-name`. Signing in does not create a server session or bearer token.

| Operation | Public / Crew | Mechanic | Manager / legacy Editor | Admin / Master |
| --- | --- | --- | --- | --- |
| View equipment, maintenance, repairs, divisions, exports | Yes | Yes | Yes | Yes |
| Report a problem | Yes | Yes | Yes | Yes |
| Update repairs, add maintenance, ordinary availability | No | Yes | Yes | No |
| Equipment details, assignments, transfers, Sold, deletion, setup | No | No | Yes | No |
| Protected equipment audit history | No | No | Yes | No |
| Master delete equipment including repair/maintenance history | No | No | No | Yes |
| Staff PIN/role administration, master PIN, new divisions | No | No | No | Yes |

Public reports do not require a PIN, including if the visitor also has admin access. The staff PIN is kept in browser memory for 30 minutes and is lost on full reload; saved filters do not sign a person back in. The separate admin page persists its unlock state in browser storage until sign-out. Admin sign-out clears that stored state.

Only master/bootstrap settings are hashed; **named staff PINs are not hashed**. Protect database files and backups accordingly. This app currently uses four-digit PINs, public read/report endpoints, and division filters rather than per-user division authorization. It does not implement account passwords, MFA, PIN-attempt throttling, or private division access. Internet deployment should retain HTTPS; broader identity/access requirements need an application change.

On a new database, `EQUIPTAGS_EDIT_PIN` and `EQUIPTAGS_MASTER_PIN` must be distinct four-digit values; missing, invalid, or matching values stop startup. These create a named **Manager** staff PIN and a separate master PIN. There are no default access codes. Later changes to these environment variables do not rotate saved PINs; use admin controls. Removing a named editor PIN revokes that named access.

### Equipment and assignment rules

- Equipment creation validates dates, nonnegative numeric values, and division/assignment choices. Its tag sequence and insert share a transaction, so a failed insert does not consume a tag. New equipment starts `In Service`.
- Detail editing does not change status or move equipment between divisions. Availability and ticket workflows control status. A stale division guard prevents editing a machine that has moved since the form loaded.
- `/assignments` changes up to 100 machines atomically. Omitted fields preserve values; empty values clear them. Expected assignment/location/division snapshots detect concurrent edits. Every destination crew/trailer is checked against that machine's division. Unchanged rows generate no reassignment audit noise. The UI restricts mixed-division batch reassignment.
- `/division-transfers` is the explicit cross-division operation. The move explicitly clears old crew/trailer assignments and rejects stale snapshots. The form previews the destination’s Unassigned group; its default follow-up opens Manager review with that division selected, the Unassigned crew filter, and search cleared so the moved equipment is visible. History, location, hours, and service settings stay with the machine.
- A new machine uses the division's configured category choices and default interval. Categories are UI choices rather than a strict database enum. Updating division defaults does not rewrite existing equipment.
- The ordinary manager deletion endpoint rejects equipment with repair or maintenance history; audit history alone does not block it. Use Sold or Unavailable to retain service history. The separate master-only deletion endpoint can remove equipment with history after a fresh preview and typed number confirmation. It does not remove crews, trailers, divisions, or existing audit entries.

### Problem reports, status, and service calculations

| Stored status | Display meaning | Ticket behavior |
| --- | --- | --- |
| `In Service` | Ready to use / Ready | Resolution closes an open ticket. |
| `Needs Attention` | Needs attention, still usable | Open problem flag; allowed as a new report on ready equipment. |
| `Tagged Out` | Do not use | Open problem. |
| `With Mechanic` | Do not use | Open problem being worked on. |
| `Awaiting Parts` | Do not use | Open problem waiting on parts. |
| `Out of Service` | Unavailable | Resolution closes an open ticket. |
| `Sold` | Sold | Manager-only resolution/availability; closes an open ticket. |

Ticket display numbers use a stable division prefix plus a four-digit minimum counter. Unassigned uses **UN1-0001**. Named divisions use uppercase initials (or the first three letters of a single-word name) plus the division ID: for example, North Yard with ID 1 uses **NY1-0001**. Each reporting division counts independently. Numbers are allocated inside ticket creation transactions, do not change when a machine moves divisions, and are not reused after deletion. Additional reports retain the open ticket’s number; a new ticket after closure gets the next number in the equipment’s current division. Internal integer IDs and existing ticket-update URLs remain unchanged. The ticket list follows the equipment’s current division even when its number records a different reporting division.

A first public report requires reporter and description and creates a ticket plus a linked **Mechanic ticket** equipment log. The optional issue-location input starts blank and is included in the description; it does not read or change the legacy equipment location column. One open ticket is allowed per machine, but it can contain multiple issue reports. A subsequent public `POST /equipment/:tag/tickets` appends an “Additional problem reported” entry to `ticket_updates`, preserving the original ticket description/reporter and its linked log. It returns 200 for an addition and 201 for a new ticket. Each addition records reporter, timestamp, description/location text, and an audit event with the Public reporter role. Omitting status keeps the current repair status; selecting Tagged Out escalates Needs Attention. Additional reports never reset With Mechanic/Awaiting Parts to an earlier step, clear a tag-out, or close a ticket. Equipment and open ticket share a status. A tag-out cannot become a usable attention flag without resolution. Ticket updates record actor, status, notes, and time. Closing requires work notes; closed ticket updates are rejected. Ticket-linked log entries cannot be deleted on their own.

Without an open ticket, **Update status** routes attention/tag-out choices into a problem report and ordinary availability changes into the protected status endpoint. With an open ticket it opens the protected repair editor. Damage and incident log types are rejected in favor of the report workflow.

Service remaining is `service_interval_hours - (engine_hours - last_oil_change_hours)`. A value at or below zero is due; missing required readings produces unknown rather than zero. A log type containing “oil” updates the service baseline only if its date is at least as recent as the existing baseline. Zero-hour readings are valid. A newer oil entry without hours clears the baseline reading instead of borrowing the old one; known engine hours never decrease from an oil log. Historical entries remain in the log without replacing a newer baseline. Removing an ordinary log does not recalculate the equipment's saved oil baseline.

### API map

Paths below are relative to `/equiptags-api` in the browser. List endpoints use the selected `?divisions=1,2` scope; absent scope means all. Direct equipment URLs identify the record independently of that filter. Invalid division IDs are rejected.

| Routes | Purpose |
| --- | --- |
| `GET /health`, `POST /auth/pin` | Process health and PIN identity. Health does not perform a complete database integrity check. |
| `GET /divisions`, `PUT /divisions/:id` | Read divisions; manager updates categories and default interval. |
| `GET /equipment`, `GET /equipment/:tag` | Filtered list/service calculations; detail with maintenance and tickets. |
| `POST /equipment`, `PUT /equipment/:tag`, `DELETE /equipment/:tag` | Manager equipment lifecycle. |
| `POST /assignments`, `POST /division-transfers` | Atomic reassignment and explicit division moves. |
| `GET /crew-options`, `POST /crew-options`, `PUT /crew-options/:id` | Read/add/rename crews in division context. Manager renaming updates equipment assignment names atomically and records an audit entry. |
| `GET/POST /trailer-options`, `PUT/DELETE /trailer-options/:id` | Trailer setup and assignment-name maintenance. |
| `GET /tickets` | Paginated all/open/completed or specific-status ticket history, scoped to selected divisions; supports ticket/problem/work-note search. |
| `GET /tickets/open`, `POST /equipment/:tag/tickets` | Repair queue and public problem report, including additional issues on the existing open ticket. |
| `PUT /equipment/:tag/tickets/:id`, `PUT /equipment/:tag/status` | Authorized repair updates and availability. |
| `POST /equipment/:tag/maintenance`, `DELETE /maintenance/:id` | Add log; manager removes eligible ordinary log. |
| `GET /audit`, `GET /equipment/:tag/audit` | Manager equipment history; PIN security events are excluded. |
| `GET /equipment-export.xlsx` | Scoped equipment and maintenance workbook. |
| `GET /trailer-assignments-export.xlsx`, `GET /trailer-assignment-export.xlsx` | Scoped trailer assignment exports. |
| `GET /admin/equipment`, `GET /admin/equipment/:tag`, `DELETE /admin/equipment/:tag` | Master-only paginated inventory in numeric tag order, deletion preview/revision, and confirmed master deletion with backup. |
| `GET/POST /admin/pins`, `DELETE /admin/pins/:id`, `PUT /admin/pins/:id/role` | Master-only staff PIN management. |
| `POST /admin/master-pin`, `POST /admin/divisions` | Master PIN rotation and new divisions. |

Master deletion uses `x-master-pin`, not staff access. The preview revision is a SHA-256 digest of the equipment and its ticket/update/log records. DELETE requires both `confirm_tag` and that revision. The server saves a consistent SQLite backup under `backups/master-deletions/` beside `server.js` (directory mode 700, backup mode 600), then rechecks authorization and revision before deleting inside a transaction. Foreign-key cascades remove linked tickets, updates, and logs; a Master audit entry records counts, division, equipment identity, and backup filename. Failure to save a backup aborts removal, and audit/deletion failures roll back together. The tag sequence is not reset. Backups are private, excluded from Git, and not served by the web app. No schema migration is required.

Exports are generated in memory with ExcelJS. Host/protocol forwarded by the reverse proxy are used for equipment URLs. JSON bodies are limited to 200 KB. Validation failures normally return 400, invalid PINs 401, denied roles 403, missing records 404, and conflicts/stale edits 409. Transactions protect the multi-record operations; audit entries capture the successful changes. There is no separate audit database.

### Sample data and development

The scripts under `scripts/seed*` and `scripts/remove-demo-labels.js` are optional legacy sample/migration utilities, not production onboarding. They assume historical fixture names and a deliberately selected target API. Do not run them for a new company. Normal startup never creates sample inventory or changes existing assignments.

`scripts/remove-demo-labels.js` is an explicit one-time cleanup for the original samples. Running it without arguments previews changes. Applying it requires `--apply --backup /absolute/path/to/new-backup.db`; it makes a consistent SQLite backup first and cleans the known sample equipment, setup names, and associated service/report text in a transaction. IDs, tags, statuses, assignment memberships, timestamps, and history relationships remain; duplicate destination crew/trailer names are merged safely. Existing audit records retain the historical text. It does not run on startup and is not required for a fresh AWS install.

This repository has no host-specific deployment switch. Use source commits for code rollback and matching consistent database backups for data/schema rollback. See [DEVELOPMENT.md](DEVELOPMENT.md).

### Company configuration and clean initialization

`EQUIPTAGS_COMPANY_NAME` supplies the header name, browser-title prefix, and workbook creator. `/company` (externally `/equiptags-api/company`) returns the public company name; PINs are never included. The shared `public/company.js` applies the name to every app/admin page using text content.

Startup creates only Unassigned division and empty inventory. Admin creates named divisions. No seed script runs automatically. `EQUIPTAGS_LEGACY_DIVISIONS=1` enables historical division fixtures for migration testing only; leave it unset in company deployments. Existing division/ticket sequence records are preserved on restart. Every instance uses its own `equiptags.db` beside `server.js`; use a separate installation directory, service, port, hostname, and backups for each company. This is separate-instance hosting, not a shared multi-company database.

## Part C — Deploy to AWS with a new database

### 1. Deployment model and AWS resources

This path installs **one Ubuntu 24.04 EC2 instance, Node.js, Nginx, systemd, and a new SQLite database on persistent EBS storage**. It does not use the existing server or copy its database. An x86_64 instance with 2 GB RAM is a reasonable starting point for a small team; measure usage before sizing further. EC2, EBS, snapshots, and public IPv4 have ongoing costs.

1. Launch an Ubuntu 24.04 LTS **x86_64** instance in a public subnet with an internet route, SSH key, and an encrypted gp3 EBS volume with room for the app, database, logs, and backups.
2. For the EBS volume holding `/srv/equiptags`, disable **Delete on termination** if it must survive instance termination. Stopping an instance preserves EBS data, but root volumes are otherwise normally deleted on termination. Retention is not a substitute for backups. See [AWS EBS persistence](https://docs.aws.amazon.com/ebs/latest/userguide/EBSFeatures.html).
3. Configure the security group: TCP 22 from your administrator IP only; TCP 80 and 443 for the intended audience. Do not expose Node port 5002. See [EC2 security groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html).
4. Associate an Elastic IP and point a DNS A record such as `equipment.example.com` to it. Elastic IPs are static and incur public IPv4 charges; see [AWS Elastic IP documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html).
5. SSH in as `ubuntu`. All following commands are for this **new AWS host**, not the current Apache server. Replace the example domain and repository credentials with your own.

Keep one application process on one host using the local SQLite file. This implementation cannot be pointed at RDS using an environment variable: PostgreSQL/MySQL would require changing the driver, schema, migrations, and queries. Do not share this SQLite file between autoscaled hosts or put it on an NFS/EFS mount.

### 2. Install the runtime and source

```bash
sudo apt update
sudo apt install -y git curl ca-certificates xz-utils build-essential python3 sqlite3 nginx certbot python3-certbot-nginx
```

Install a supported Node.js **24 LTS** release using the [official Node download instructions](https://nodejs.org/en/download). Use the Linux x64 archive for the architecture above; verify its published SHA-256 checksum, then extract it under `/usr/local` with `--strip-components=1`. The service below expects `/usr/local/bin/node`. For a different installation location, update `ExecStart` accordingly. Consult the [Node release schedule](https://nodejs.org/en/about/previous-releases) when updating the runtime.

```bash
/usr/local/bin/node --version
/usr/local/bin/npm --version
sudo useradd --system --home /srv/equiptags --shell /usr/sbin/nologin equiptags
sudo install -d -o ubuntu -g ubuntu /srv/equiptags
# Authenticate to GitHub first if the repository is private. Never embed a token in this URL.
git clone --branch main https://github.com/robbyweeds/Inventoryapp.git /srv/equiptags
cd /srv/equiptags
npm ci --omit=dev
sudo chown -R equiptags:equiptags /srv/equiptags
sudo chmod 750 /srv/equiptags
```

Do not copy `equiptags.db`, its sidecars, local `node_modules`, or the current server's PM2 state. Use the supplied `deploy/equiptags.service` and `deploy/nginx.conf` templates, which match the configuration below. Replace paths, domain, and Node executable for your host.

### 3. Configure first-start PINs and create its own database

Create a root-only environment file:

```bash
sudo install -m 600 /dev/null /etc/equiptags.env
sudoedit /etc/equiptags.env
```

Enter these settings, replacing both placeholders with **different four-digit PINs** before starting. Preserve leading zeros; do not put secrets in Git.

```ini
NODE_ENV=production
EQUIPTAGS_COMPANY_NAME=Your Company
PORT=5002
EQUIPTAGS_EDIT_PIN=REPLACE_WITH_FOUR_DIGITS
EQUIPTAGS_MASTER_PIN=REPLACE_WITH_DIFFERENT_FOUR_DIGITS
```

Create `/etc/systemd/system/equiptags.service` using `sudoedit`:

```ini
[Unit]
Description=EquipTags equipment tracker
After=network.target

[Service]
Type=simple
User=equiptags
Group=equiptags
WorkingDirectory=/srv/equiptags
EnvironmentFile=/etc/equiptags.env
ExecStart=/usr/local/bin/node /srv/equiptags/server.js
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now equiptags
sudo systemctl status equiptags --no-pager
curl --fail http://127.0.0.1:5002/health
sudo -u equiptags sqlite3 /srv/equiptags/equiptags.db 'PRAGMA integrity_check; SELECT id,name FROM divisions; SELECT count(*) FROM equipment;'
```

First startup creates **`/srv/equiptags/equiptags.db`** with its own schema, PIN settings, only Unassigned division, and zero equipment, crews, trailers, tickets, and maintenance logs. No separate database server or SQL import is needed. An unexpected nonzero equipment count means an existing database was supplied; investigate before going live. Use `sudo journalctl -u equiptags -n 100 --no-pager` if startup fails.

### 4. Configure Nginx and HTTPS

Create `/etc/nginx/sites-available/equiptags` with the following, replacing `equipment.example.com`:

```nginx
server {
    listen 80;
    server_name equipment.example.com;
    client_max_body_size 256k;

    location = / { return 302 /equiptags/; }
    location = /equiptags { return 301 /equiptags/; }

    location /equiptags-api/ {
        proxy_pass http://127.0.0.1:5002/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /equiptags/ {
        proxy_pass http://127.0.0.1:5002;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

The API `proxy_pass` trailing slash removes the external API prefix; the app location preserves `/equiptags/`. See [Nginx proxy_pass behavior](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass). Node binds to localhost; Nginx is the public entry point. Set forwarded headers only through the trusted proxy because Express trusts forwarded headers only from a loopback proxy.

```bash
sudo ln -s /etc/nginx/sites-available/equiptags /etc/nginx/sites-enabled/equiptags
sudo nginx -t
sudo systemctl reload nginx
# DNS must already resolve to this instance, with inbound ports 80/443 allowed.
sudo certbot --nginx -d equipment.example.com
sudo certbot renew --dry-run
curl --fail https://equipment.example.com/equiptags-api/health
```

Open `https://equipment.example.com/equiptags/` and `/equiptags/admin/`. Configure a real certificate and use HTTPS before staff enter PINs. The default Nginx site may still answer requests by raw IP; use the configured hostname.

### 5. Initialize the team's setup and verify

1. Unlock admin using the chosen master PIN. Confirm the named Manager access created from the initial edit PIN works. The initial setup has exactly these two access paths: master/admin plus manager. Public viewing/reporting needs no PIN; Manager access can use the Mechanic workspace. Add role-specific access only if deliberately needed later.
2. Create the company’s named divisions as admin. Sign out and sign in as manager. Open **Crews & trailers** to add each division’s crews/trailers using the inline forms, then add equipment and configure categories/service defaults under **Mechanic queue → Division setup**. Rename a test crew and trailer and verify their assigned equipment follows the new names. Verify a direct reload of `/equiptags/crews-trailers?tab=trailers` works through the proxy. Deploy both frontend and backend for crew rename; no schema migration is needed. This page uses the existing database/API and adds no AWS service or deployment setting.
3. Confirm each division shows its own rows and the combined view includes their division labels. From Mechanic queue, open **All tickets & history**, check All/Open/Completed and ticket-number search, and open a completed ticket’s work notes. Test `/equiptags/tickets` directly through the proxy. Existing installs automatically backfill ticket numbers on first start of this version; take a consistent database/source backup beforehand and verify existing ticket IDs and history after migration. Verify a crew view cannot edit equipment, a mechanic can update repair progress, and admin cannot edit equipment with the master PIN.
4. Create a clearly labeled test machine. Reassign it, report a problem, add another issue from a signed-out phone while the ticket is open, confirm both reports remain on one ticket with their reporter/time and current status, resolve it with notes, add a service entry, and verify its history and export. Additional reports use existing tables and need no separate migration, AWS service, or deployment setting. Because that test now has history, retain it as a labeled test record or mark it Sold.
5. Open `/equiptags/admin/inventory/` and verify master sign-in, numeric ordering, search, division filters, and the deletion preview. Test deletion only on an intentionally disposable test record. Verify the service can write `/srv/equiptags/backups/master-deletions/`; no extra AWS service or database migration is required. Keep these private backups on persistent storage and include them in your backup/retention process.
6. For each physical machine, use the always-visible **Copy NFC Address** button at the bottom of its detail page to obtain `https://equipment.example.com/equiptags/e/TAG-ID` for that machine’s actual tag. Write that full HTTPS URL to its NFC/NTAG as a URL record, and encode the same URL in its QR code. Keep the hostname stable so labels remain useful after equipment moves between divisions. Creating/printing QR artwork or programming tags is done with your chosen label/tag tool; the app provides the destination link. Scan the physical NFC tag and QR code from a signed-out phone, confirm the right machine, status, division, crew, and trailer appear without a PIN, and check `journalctl` for errors. The existing hostname's NFC tags continue to point at the old deployment until reprogrammed or redirected deliberately.

### 6. Backups, updates, and reverting

Use a consistent SQLite backup, not a copy of the live `.db` alone: committed data can still be in its WAL sidecar. SQLite's online backup mechanism supports a consistent live copy; see [SQLite backup documentation](https://sqlite.org/backup.html).

Example timestamped backup on the new AWS host:

```bash
sudo install -d -o equiptags -g equiptags -m 700 /srv/equiptags-backups
equiptags_backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo -u equiptags sqlite3 /srv/equiptags/equiptags.db ".backup '/srv/equiptags-backups/equiptags-${equiptags_backup_stamp}.db'"
sudo -u equiptags sqlite3 "/srv/equiptags-backups/equiptags-${equiptags_backup_stamp}.db" 'PRAGMA integrity_check;'
```

Automatic master-delete backups are full SQLite database snapshots, not single-record undo files. To recover a deleted record without replacing newer data, restore its backup into an isolated installation and selectively recover the equipment and related records with matching ID/link checks. A full database restore also reverts other changes, including access changes, since that snapshot. Never restore over the running database.

Schedule backups (for example with a systemd timer), choose a retention period, and keep encrypted off-instance copies such as an access-restricted S3 bucket. Grant an EC2 instance role only the required backup access rather than saving AWS keys in the app. Store `/etc/equiptags.env`, proxy/service configuration, and the deployed Git commit securely with the recovery instructions. Backups contain readable staff PINs. Test restoring a backup into an isolated installation. EBS snapshots supplement these database backups; coordinate snapshots with application writes for a consistent recovery point.

For an update, record `git rev-parse HEAD` and take the backup above **before** starting newer code. Stop the service, update the existing checkout as its owner, install locked dependencies with `npm ci --omit=dev`, and start it again. Keep the existing database, sidecars, and `backups/` directory; never use a deployment cleanup that deletes untracked database or backup files. Run `npm test` in a separate checkout before production rollout. Check health, division lists, a detail link, and staff workflows after starting. There is no frontend build step.

To revert, stop the service and restore the recorded source commit and its matching dependencies. If the update changed the schema, restore the matching pre-update database too: first preserve the current database **and any WAL/SHM files** in a recovery directory while stopped, then put the consistent backup at `/srv/equiptags/equiptags.db`, owned by `equiptags` with mode `600`, without leaving old WAL/SHM sidecars beside it. Restart and verify. Restoring an older backup discards changes made since that backup, so retain the stopped current files for recovery.

No external deployment-switch script is needed. Git commits provide code rollback; consistent database backups provide data/schema rollback. Each company’s hostname and data stay independent.
