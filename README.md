# Inventoryapp

Equipment inventory, crew/trailer assignments, problem reports, and maintenance history with NFC links to individual machines. The frontend is plain HTML/CSS/JavaScript; Express serves the API, and SQLite stores the data.

- [Part A — Daily workflows](#part-a--daily-workflows)
- [Part B — Application logic and database](#part-b--application-logic-and-database)
- [Part C — Complete AWS server deployment](#part-c--deploy-everything-on-aws-including-the-server)

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

## Part C — Deploy everything on AWS, including the server

This is the complete path from an AWS account to a working company installation. No existing server is required. Follow it in order; AWS Console steps run in your browser, local-terminal steps run on your computer, and server-terminal steps run inside your new EC2 instance.

### 1. What you will create

| Component | Purpose |
| --- | --- |
| EC2 Ubuntu server | Runs Node.js, Nginx, and the application service. |
| Encrypted EBS storage | Holds the application and its own SQLite database. |
| Elastic IP | Keeps the server's public IPv4 address stable. |
| Route 53 DNS | Connects a company hostname to the server. |
| HTTPS certificate | Encrypts browser traffic; Certbot manages it on the server. |
| Private S3 bucket | Stores consistent off-server database backups. |
| EC2 IAM role | Allows backup uploads without storing AWS access keys. |

One company uses one installation and database. Use a single app process on one server with local EBS storage; this SQLite implementation does not use RDS, EFS, shared database files, or an autoscaling group. You do not need an application load balancer for this setup. Creating another company means creating another independent instance and configuration.

EC2, EBS, S3, Route 53, domain registration, and public IPv4 can incur charges. This guide does not assume free-tier eligibility. The app permits public equipment viewing/problem reporting; staff changes require PINs. Private inventory access or SSO requires further application work.

### 2. Before starting — AWS Console

1. Sign in to your AWS account with an administrator identity capable of creating EC2, VPC, IAM, S3, and Route 53 resources. Keep account-root access for account tasks; use an administrative identity for deployment.
2. Choose one AWS Region near the company's users, for example **US East (N. Virginia), us-east-1**. Keep EC2, networking, EBS, and the backup bucket in that Region throughout this guide. Route 53 and IAM have global consoles.
3. Open **Billing and Cost Management → Budgets** and create a monthly cost budget with email alerts appropriate to your account. An alert does not automatically stop spending.
4. Decide the company name and hostname. This guide uses `Example Landscaping` and `equipment.example.com` as placeholders. Replace every hostname example with your own.
5. Have a registered domain. You can register a new domain through **Route 53 → Registered domains → Register domain**, or use a domain you already own.

### 3. Create a public network — AWS Console

If your Region already has a default VPC with a public subnet and an attached internet gateway, you can use it. Verify the subnet's route table has `0.0.0.0/0` pointing to the internet gateway. If there is no suitable VPC, create one:

1. Open **VPC → Your VPCs → Create VPC**. Choose **VPC only**, name `inventory-vpc`, IPv4 CIDR `10.20.0.0/16`, and create it. This range must not overlap networks you intend to connect later.
2. Select the VPC, open **Actions → Edit VPC settings**, and enable DNS resolution and DNS hostnames.
3. Open **Subnets → Create subnet**. Select `inventory-vpc`, name `inventory-public`, choose an Availability Zone, and use subnet CIDR `10.20.1.0/24`.
4. Open **Internet gateways → Create internet gateway**. Name it `inventory-igw`, create it, then use **Actions → Attach to a VPC** to attach it to `inventory-vpc`.
5. Open **Route tables → Create route table**. Name it `inventory-public-routes` and select `inventory-vpc`.
6. Select that table, open **Routes → Edit routes → Add route**, set destination `0.0.0.0/0` and target the new internet gateway, then save.
7. Open **Subnet associations → Edit subnet associations**, select `inventory-public`, and save.

The instance will use an Elastic IP for public connectivity. No NAT gateway is needed for this public-subnet design. See [AWS networking and instance parameters](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-launch-parameters.html).

### 4. Create the server — AWS Console

Open **EC2 → Instances → Launch instances** and configure:

| Setting | Choose |
| --- | --- |
| Name | `inventory-example-company` |
| Application/OS image | Ubuntu Server **24.04 LTS**, published by Canonical |
| Architecture | **64-bit x86**; these installation commands target x86_64 |
| Instance type | Start with **t3.small** (2 GiB memory), if available in the Region; review its price and monitor resource use |
| Key pair | Create a new RSA key pair, PEM format, named `inventory-example-company`; download and securely retain the private key |
| VPC and subnet | The public VPC/subnet from step 3 |
| Auto-assign public IP | Disable; an Elastic IP is attached in step 5 |
| Storage | For example **30 GiB gp3**, encrypted; adjust for expected usage and retention |

In **Network settings**, create security group `inventory-web` with these inbound rules:

| Type | Port | Source |
| --- | --- | --- |
| SSH | TCP 22 | **My IP**, your current administrator public IP `/32` |
| HTTP | TCP 80 | `0.0.0.0/0` for the public website and certificate validation |
| HTTPS | TCP 443 | `0.0.0.0/0` for the public website |

Keep the default outbound rule for this initial deployment. Do not add public rules for 5002 or database ports. If your administrator IP changes, update only the SSH source rule.

Expand the storage settings and clear **Delete on termination** for the EBS volume containing the database if it should survive instance termination. Under **Advanced details**, enable termination protection, require **IMDSv2** for instance metadata, and leave User data blank. An IAM role is attached during backup setup below. Click **Launch instance** and wait for it to run and pass its status checks.

Retaining an EBS volume does not replace backups and continues to incur storage charges. See [AWS instance termination behavior](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-termination-works.html).

### 5. Give the server a stable public IP — AWS Console

1. In the same Region, open **EC2 → Network & Security → Elastic IP addresses**.
2. Choose **Allocate Elastic IP address**, use Amazon's pool, and allocate it.
3. Select the address, choose **Actions → Associate Elastic IP address**, select your instance and its private IP, and associate it.
4. Record the Elastic IP and instance ID. This public address replaces `YOUR_ELASTIC_IP` below.

Keep this IP while the installation is in use. If you later retire it, remove/update any DNS records pointing at it before releasing it. See [AWS Elastic IP addresses](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html).

### 6. Set up the domain — AWS Console / domain registrar

For DNS entirely in AWS:

1. Open **Route 53 → Hosted zones** and select your domain's **public** hosted zone. If it does not exist, create a public hosted zone for the domain, for example `example.com`.
2. If you created the zone for a domain registered elsewhere, copy the zone's four NS nameservers into that domain's nameserver settings at its registrar. Creating a zone alone does not change the domain's authoritative DNS. If the domain already serves other systems, reproduce the existing DNS records in Route 53 before changing nameservers.
3. Choose **Create record** with record name `equipment`, type **A**, value your Elastic IP, simple routing, and TTL `300`. Leave Alias off for this IPv4-address record.
4. Create the record and allow time for DNS delegation/caches to update. Do not add an AAAA record unless you also configure working IPv6 networking.

If the domain's DNS is staying with another provider, create the same A record there instead of changing nameservers. See [AWS Route 53 → EC2 instructions](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-ec2-instance.html).

### 7. Connect to the server — your computer's terminal

Move the downloaded PEM file into a private location. In macOS/Linux, or a suitable SSH terminal, run:

```bash
chmod 400 /path/to/inventory-example-company.pem
ssh -i /path/to/inventory-example-company.pem ubuntu@YOUR_ELASTIC_IP
```

Windows users can run `ssh -i C:\path\inventory-example-company.pem ubuntu@YOUR_ELASTIC_IP` from PowerShell with OpenSSH installed; restrict the key's Windows file permissions if SSH reports it is accessible to other users. The Ubuntu AMI username is `ubuntu`.

Check the SSH host fingerprint against the instance's host key information when prompted. After connection, all commands through step 15 run on the new server, as `ubuntu`, using `sudo` where shown. See [AWS connecting with SSH](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect-to-linux-instance.html).

### 8. Install the operating-system tools — server terminal

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl ca-certificates xz-utils unzip \
  build-essential python3 sqlite3 nginx certbot python3-certbot-nginx dnsutils
```

If an upgrade requires reboot, run `sudo reboot`, wait for status checks, and reconnect using the same Elastic IP and key.

Install the tested Node.js 24.22.0 Linux x64 release from the official archive. A later maintained Node 24 release can be substituted after validation; update both download filenames consistently.

```bash
mkdir -p /tmp/inventory-node
cd /tmp/inventory-node
curl -fsSLO https://nodejs.org/dist/v24.22.0/node-v24.22.0-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/dist/v24.22.0/SHASUMS256.txt
sha256sum --check --ignore-missing SHASUMS256.txt
```

Stop if the archive does not report **OK**. Then:

```bash
sudo tar -xJf node-v24.22.0-linux-x64.tar.xz -C /usr/local --strip-components=1
/usr/local/bin/node --version
/usr/local/bin/npm --version
```

The service template expects `/usr/local/bin/node`. See [official Node downloads](https://nodejs.org/en/download).

### 9. Download the application — server terminal

```bash
sudo useradd --system --home /srv/equiptags --shell /usr/sbin/nologin equiptags
sudo install -d -o ubuntu -g ubuntu /srv/equiptags
git clone --branch main https://github.com/robbyweeds/Inventoryapp.git /srv/equiptags
cd /srv/equiptags
/usr/local/bin/npm ci
/usr/local/bin/npm test
```

Proceed after tests pass. If the repository is private, authenticate with a suitable GitHub identity/read-only deploy key before cloning. Never put a token in the clone URL or `.env`. Later automated pulls run as the `equiptags` account, so configure its read access separately if required.

There is no frontend build. Do not copy an existing company's database, its `node_modules`, PM2 settings, or deployment-switch scripts. Do not run sample seed scripts for a new company.

### 10. Configure company name and initial access — server terminal

```bash
sudo install -m 600 /dev/null /etc/equiptags.env
sudo nano /etc/equiptags.env
```

Enter the following, replacing the company and both PIN placeholders. In nano use Ctrl+O, Enter, then Ctrl+X to save and exit.

```ini
NODE_ENV=production
PORT=5002
EQUIPTAGS_COMPANY_NAME=Example Landscaping
EQUIPTAGS_EDIT_PIN=REPLACE_WITH_FOUR_DIGITS
EQUIPTAGS_MASTER_PIN=REPLACE_WITH_DIFFERENT_FOUR_DIGITS
```

Use distinct four-digit PINs, preserving leading zeroes. The edit PIN creates one named **Manager** account; the master PIN unlocks **Admin**. Startup refuses missing, invalid, or identical initial PINs. After initialization, rotate saved PINs through Admin; changing environment variables does not rotate database access records. Leave `EQUIPTAGS_LEGACY_DIVISIONS` unset.

### 11. Start the server application and create its database — server terminal

```bash
sudo cp /srv/equiptags/deploy/equiptags.service /etc/systemd/system/equiptags.service
sudo chown -R equiptags:equiptags /srv/equiptags
sudo chmod 750 /srv/equiptags
sudo systemctl daemon-reload
sudo systemctl enable --now equiptags
sudo systemctl status equiptags --no-pager
curl --fail http://127.0.0.1:5002/health
sudo -u equiptags sqlite3 /srv/equiptags/equiptags.db \
  'PRAGMA integrity_check; SELECT id,name FROM divisions; SELECT count(*) FROM equipment;'
```

Expect an active service, a successful health response, integrity `ok`, only Unassigned division, and zero equipment. SQLite creates `/srv/equiptags/equiptags.db` automatically on the instance's EBS volume. No RDS instance, database credentials, SQL import, or external database server is needed. The service starts at boot and restarts after failures. Node listens only on `127.0.0.1:5002`.

If startup fails, run `sudo journalctl -u equiptags -n 100 --no-pager`. Avoid starting a second `npm start` process while systemd is running. After ownership changes, use `sudo` or `sudo -u equiptags` for protected installation files.

### 12. Publish the website and enable HTTPS — server terminal

```bash
sudo cp /srv/equiptags/deploy/nginx.conf /etc/nginx/sites-available/equiptags
sudo nano /etc/nginx/sites-available/equiptags
```

Replace `equipment.example.com` with your hostname. Keep the existing API/app proxy paths and their intentional trailing-slash difference. Then:

```bash
sudo ln -s /etc/nginx/sites-available/equiptags /etc/nginx/sites-enabled/equiptags
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
dig +short equipment.example.com A
curl --fail http://equipment.example.com/equiptags-api/health
```

Replace the hostname in these and subsequent commands. DNS should show your Elastic IP. Do not proceed with certificate issuance until public HTTP works on the intended hostname. Check for an incorrect AAAA record if validation reaches a different server.

```bash
sudo certbot --nginx -d equipment.example.com
sudo certbot renew --dry-run
curl --fail https://equipment.example.com/equiptags-api/health
```

Follow the email/terms prompts and enable HTTP-to-HTTPS redirection if offered. Confirm certificate renewal is scheduled with `systemctl list-timers --all` and the renewal dry run succeeds. Nginx is the public entry point; Express trusts forwarded headers from loopback. See [Certbot Nginx instructions](https://certbot.eff.org/instructions?ws=nginx&os=ubuntufocal).

Open `https://equipment.example.com/equiptags/` from your phone using cellular data. Use HTTPS before entering PINs. The default Nginx page may still answer the raw IP; use the hostname.

### 13. Set up this company's divisions and equipment — web browser

1. Open `https://equipment.example.com/equiptags/admin/` and enter the master PIN chosen in step 10.
2. Create the company's named divisions. No other company's division names or inventory are preloaded.
3. Sign out of Admin, open the main app, select a division, and choose **Staff sign in** with the manager PIN.
4. Open **Crews & trailers** and add that division's crews/trailers. They can be renamed inline later.
5. Open **Mechanic queue → Division setup** with manager access to set categories and default service intervals, then add equipment through Manager review.
6. Assign equipment to a crew and optionally a trailer. **No trailer** keeps a crew assignment without a trailer. **Keep existing trailer** preserves an existing assignment.
7. Moves to other divisions are inside **Edit assignments / Reassign** only; a move clears crew/trailer assignments and places the equipment in the destination division's Unassigned group.
8. Review **History**, **All tickets & history**, and combined division views. Use a disposable test record to exercise assignment, issue reporting, additional reports, repair completion, and logs.
9. Confirm the master inventory page `/equiptags/admin/inventory/` loads directly and its deletion preview works. Master deletion makes a private backup first; do not test it against real inventory unintentionally.
10. On each real machine's phone page, use **Copy NFC Address** in the bottom bar for its actual URL. Encode that HTTPS URL in its QR label and NFC tag. Scan both while signed out. Keep the hostname stable so labels remain valid.

Public users can view/report without a PIN. Manager handles equipment/assignments/repairs; master manages access/divisions and confirmed master deletions. Dedicated Mechanic/Crew access is optional. Inventory, PINs, ticket history, and backups stay in this company's instance.

### 14. Create private off-server backup storage — AWS Console

1. Open **S3 → Create bucket**. Use a globally unique general-purpose bucket name, for example `example-company-inventory-backups-ACCOUNTID`. Select the same Region as EC2.
2. Leave **Block all public access** enabled and ACLs disabled. Keep default **SSE-S3** encryption for the policy/script below and enable bucket versioning. Do not enable static website hosting.
3. Create the bucket. The daily database files use the prefix `inventory/`.
4. Open **IAM → Roles → Create role**. Select trusted entity **AWS service**, use case **EC2**, then create a role named `inventory-backup-writer`.
5. On that role, use **Add permissions → Create inline policy → JSON**. Replace the bucket name in this policy, review it, and save as `WriteInventoryBackups`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
    "Resource": "arn:aws:s3:::YOUR_BACKUP_BUCKET/inventory/*"
  }]
}
```

6. Open **EC2 → Instances**, select your instance, then **Actions → Security → Modify IAM role**. Attach `inventory-backup-writer`. Keep IMDSv2 required. No AWS keys are stored in application settings or source.
7. A separate recovery administrator needs permission to list/download backup objects. The server's role deliberately grants upload only. Custom KMS encryption or restrictive existing bucket policies require matching additional configuration; this guide uses standard SSE-S3.

See [EC2 IAM roles](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/attach-iam-role.html) and [S3 access controls](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).

### 15. Enable daily verified S3 database backups — server terminal

Install AWS CLI v2 for the x86_64 instance:

```bash
mkdir -p /tmp/inventory-awscli
cd /tmp/inventory-awscli
curl -fsS https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscliv2.zip
unzip -q awscliv2.zip
sudo ./aws/install
/usr/local/bin/aws --version
```

The [official AWS CLI instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) also describe PGP verification of the installer. Do not run `aws configure` with permanent access keys; CLI uploads use the EC2 role.

Install the supplied script, service, and daily timer:

```bash
sudo install -d -o equiptags -g equiptags -m 700 /srv/equiptags-backups
sudo install -m 755 /srv/equiptags/deploy/equiptags-backup.sh /usr/local/bin/equiptags-backup
sudo cp /srv/equiptags/deploy/equiptags-backup.service /etc/systemd/system/
sudo cp /srv/equiptags/deploy/equiptags-backup.timer /etc/systemd/system/
sudo install -m 600 /dev/null /etc/equiptags-backup.env
sudo nano /etc/equiptags-backup.env
```

Enter your actual bucket and Region:

```ini
BACKUP_S3_URI=s3://YOUR_BACKUP_BUCKET/inventory
AWS_DEFAULT_REGION=us-east-1
```

Test a real backup before enabling the schedule:

```bash
sudo systemctl daemon-reload
sudo systemctl start equiptags-backup.service
sudo journalctl -u equiptags-backup.service -n 50 --no-pager
```

The log should say **Verified backup uploaded**. In the AWS S3 console, open your bucket's `inventory/` prefix and confirm the timestamped `.db` file exists. A successful oneshot service normally returns to inactive after completing; check its exit status/log rather than expecting it to stay running.

```bash
sudo systemctl enable --now equiptags-backup.timer
sudo systemctl list-timers equiptags-backup.timer --all
```

The timer runs daily at 02:00 UTC with up to five minutes of random delay and catches up after downtime. It creates a consistent SQLite backup, checks integrity, and uploads it; failure stops the operation and is visible in the service journal. This setup has no automatic email alert for failed backups: monitor the journal/S3 timestamps and add your chosen alerting service if required.

Local copies remain under `/srv/equiptags-backups`; automatic master-delete backups remain under `/srv/equiptags/backups/master-deletions`. Configure a retention policy and monitor disk use; this script does not delete either location automatically. Use an S3 lifecycle policy appropriate to the company, including noncurrent versions, when setting storage retention. The daily full database backup is the routine S3 recovery copy; deletion-specific snapshots stay local unless separately copied.

Securely retain the configuration files, deployed Git commit, and backup recovery access. Backups contain staff access records. EBS snapshots/AWS Backup can supplement these database copies; do not rely solely on copying an active WAL database file.

### 16. Verify the complete AWS deployment

| Check | Expected result |
| --- | --- |
| EC2 status checks | Passed; Elastic IP associated |
| Hostname from an external connection | Opens correct company over HTTPS |
| `/equiptags-api/health` | Successful response |
| Fresh install before onboarding | Only Unassigned division; zero equipment |
| Admin / manager PINs | Separate duties; chosen credentials work |
| Phone equipment URL | Right equipment, division, crew, trailer, and status |
| Crew-only assignment | Crew remains while trailer shows No trailer |
| Ticket completion/history | Work notes retained; completed filter works |
| Reboot | App and Nginx start again; inventory remains |
| S3 backup | Timestamped database present; timer scheduled |

To test reboot, run `sudo reboot`, reconnect, check `sudo systemctl status equiptags nginx --no-pager`, and verify the HTTPS page again. Record the server's instance ID, Elastic IP, Region, domain, S3 bucket, source commit, and recovery administrator in your company handover notes. Do not put PINs or private keys into Git.

### 17. Updates and rollback — server terminal

Before updating, trigger and verify the backup service, record the current source commit, and check the new revision passed GitHub verification. The backup role/CLI must already be configured from steps 14–15.

```bash
sudo systemctl start equiptags-backup.service
sudo journalctl -u equiptags-backup.service -n 20 --no-pager
sudo -u equiptags git -C /srv/equiptags rev-parse HEAD
sudo systemctl stop equiptags
sudo -u equiptags git -C /srv/equiptags pull --ff-only origin main
sudo -u equiptags /usr/local/bin/npm --prefix /srv/equiptags ci --omit=dev
sudo systemctl start equiptags
curl --fail http://127.0.0.1:5002/health
```

Proceed only if the backup command succeeded. If source/dependency installation fails, keep the app stopped while fixing it or restoring the recorded source/dependencies. A private repository requires suitable read credentials for the `equiptags` account. Avoid `git clean`, database deletion, or replacing the installation directory with an empty folder during updates.

For a code-only rollback, stop the service, check out the recorded commit, reinstall its locked dependencies, and restart. For a schema/data rollback, restore a matching database backup too. A full database restore also reverses inventory, ticket, and PIN changes made after the backup; preserve the stopped current database and WAL/SHM files first. Never restore over a running service, and never leave old WAL/SHM files beside a restored database. See the recovery procedure below.

### 18. Recover after losing the server

1. Preserve the failed instance/volume if available. Do not terminate it or release the Elastic IP as a troubleshooting shortcut.
2. Provision a replacement server using steps 3–12, initially leaving `equiptags` stopped before restoring production data. Recreate protected config files using the company's saved values.
3. Using a recovery administrator's S3 access, download the required backup from the private bucket and transfer it to a private temporary path on the replacement server. Do not grant the website public access to the bucket. Confirm `PRAGMA integrity_check` on the downloaded copy reports `ok`.
4. Install the source commit that matches that backup, and stop both `equiptags.service` and its backup timer/service. Preserve any database and `equiptags.db-wal`/`equiptags.db-shm` files already created on the replacement in a private recovery directory. Ensure those old sidecars are absent from the database's final destination.
5. Install the backup as `/srv/equiptags/equiptags.db`, owner/group `equiptags:equiptags`, mode `600`. Do not start with an empty database after restoring configurations. Saved PINs are in the restored database; environment bootstrap PINs do not override them.
6. Start the service, verify health and representative inventory/tickets/PIN access, then reassociate the original Elastic IP with the replacement instance. This preserves the domain and physical NFC/QR links.
7. Attach the backup IAM role, reinstall/configure the backup service and timer, verify a new S3 backup, and recheck HTTPS. If not preserving the Elastic IP, update DNS instead and allow caches to expire.
8. Keep the old stopped data for investigation until the company confirms recovery is complete. Then retire old resources deliberately; retained volumes, snapshots, public IPs, and backups can continue incurring charges.

### 19. Troubleshooting

| Symptom | Check |
| --- | --- |
| SSH times out | Correct Region/Elastic IP; running instance; public-subnet association and internet route; security-group SSH source matches your current public IP |
| SSH permission denied | Correct PEM key and `ubuntu` username; private-key file permissions |
| Site times out | Elastic IP association, A record, public route, ports 80/443, `sudo systemctl status nginx` |
| Nginx 502 | `sudo systemctl status equiptags`; `sudo journalctl -u equiptags -n 100`; local `/health` |
| Wrong company/site | Correct hostname, Nginx server_name, A/AAAA records, and `/etc/equiptags.env` |
| Certbot fails | Domain resolves publicly to this instance, port 80 reachable, no stale AAAA record, Nginx config valid |
| App refuses first start | Both initial PINs are distinct four-digit values; service can write its database directory |
| Manager cannot create divisions | Use Admin with master PIN; manager handles equipment/setup |
| S3 upload denied | Right bucket/prefix in config and inline policy; role attached to this EC2 instance; default SSE-S3; no conflicting bucket policy |
| Backup file missing | Backup service journal, timer schedule, free disk space, AWS CLI path, IAM role/Region |
| Filesystem full | `df -h`; inspect database, local backup/log usage; adjust retention or expand EBS/filesystem |

The project has one `main` branch. The supplied templates need no PM2, Apache, local developer checkout, or host-specific switching utility. AWS infrastructure is created in your account by following this guide; the repository and CI do not create it automatically.
