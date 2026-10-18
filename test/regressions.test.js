process.env.EQUIPTAGS_LEGACY_DIVISIONS='1';
process.env.EQUIPTAGS_EDIT_PIN='1234';process.env.EQUIPTAGS_MASTER_PIN='5678';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('oil service preserves chronology, zero readings, and unknown readings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equiptags-test-'));
  fs.copyFileSync(path.join(root, 'server.js'), path.join(dir, 'server.js'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  process.env.EQUIPTAGS_EDIT_PIN = '1234';
  process.env.EQUIPTAGS_MASTER_PIN = '5678';
  const server = require(path.join(dir, 'server.js')).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(url, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-edit-pin': '1234' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    const { data: item } = await request('/equipment', 'POST', {
      name: 'Fixture', engine_hours: 250, last_oil_change_date: '2026-09-01',
      last_oil_change_hours: 200, service_interval_hours: 100
    });
    const url = `/equipment/${item.tag_id}`;
    await request(`${url}/maintenance`, 'POST', { service_date: '2025-01-01', service_type: 'Oil Change', engine_hours: 100 });
    let { data } = await request(url);
    assert.equal(data.last_oil_change_date, '2026-09-01');
    assert.equal(data.last_oil_change_hours, 200);
    assert.equal(data.service_due_in_hours, 50);
    const zero = await request(`${url}/maintenance`, 'POST', { service_date: '2026-10-07', service_type: 'Oil Change', engine_hours: 0 });
    assert.equal(zero.data.engine_hours, 0);
    ({ data } = await request(url));
    assert.equal(data.last_oil_change_hours, 0);
    assert.equal(data.engine_hours, 250);
    await request(`${url}/maintenance`, 'POST', { service_date: '2026-10-08', service_type: 'Oil Change' });
    ({ data } = await request(url));
    assert.equal(data.last_oil_change_hours, null);
    assert.equal(data.service_due_in_hours, null);
    for (const body of [
      { service_date: '2026-02-30', engine_hours: 1 },
      { service_date: '2026-10-08', engine_hours: -1 },
      { service_date: '2026-10-08', engine_hours: 'invalid' }
    ]) assert.equal((await request(`${url}/maintenance`, 'POST', { service_type: 'Oil Change', ...body })).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
test('latest filter request wins even when older requests finish later', async () => {
  const rows = {}, more = {}, sort = { value: 'newest' }, search = { value: '' }, filter = { value: '' };
  const elements = { '#rows': rows, '#loadMore': more, '#sort': sort, '#search': search, '#filter': filter };
  const pending = [];
  const context = vm.createContext({ URLSearchParams, clearTimeout,
    $: key => elements[key], esc: String,
    dashboardState: { limit: 100, requestId: 0, loading: false }, all: [],
    api: url => new Promise(resolve => pending.push({ url, resolve })), drawRows: () => {}
  });
  vm.runInContext(source.slice(source.indexOf('async function loadEquipment(reset)'), source.indexOf('\nfunction drawRows()')), context);
  const old = context.loadEquipment(true);
  search.value = 'mower';
  const current = context.loadEquipment(true);
  assert.match(pending[1].url, /q=mower/);
  pending[1].resolve({ items: [{ name: 'Mower' }], total: 1, has_more: false });
  await current;
  pending[0].resolve({ items: [{ name: 'Old result' }], total: 1, has_more: false });
  await old;
  assert.equal(context.all.length, 1);
  assert.equal(context.all[0].name, 'Mower');
});

test('routing from browser history does not push another equipment entry', async () => {
  let pushes = 0;
  const context = vm.createContext({
    location: { pathname: '/equiptags/e/00001' }, history: { pushState: () => pushes++ },
    $: () => ({}), api: async () => ({}), renderDetail: () => {}, showServiceInterval: () => {},
    esc: String, dashboard: () => {}, trailersPage: () => {}
  });
  vm.runInContext(source.slice(source.indexOf('async function openEquipment('), source.indexOf('\nfunction renderDetail(')), context);
  vm.runInContext(source.slice(source.indexOf('function route()'), source.lastIndexOf('route();')), context);
  await context.route();
  assert.equal(pushes, 0);
  await context.openEquipment('00002');
  assert.equal(pushes, 1);
});

test('availability changes require a PIN and allow only the three statuses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equiptags-status-test-'));
  fs.copyFileSync(path.join(root, 'server.js'), path.join(dir, 'server.js'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const server = require(path.join(dir, 'server.js')).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(url, method, body, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    const { data: item } = await request('/equipment', 'POST', { name: 'Status fixture' }, { 'x-edit-pin': '1234' });
    const url = `/equipment/${item.tag_id}`;
    assert.equal(item.status, 'In Service');
    for (const status of ['Out of Service', 'In Service', 'Sold']) {
      assert.equal((await request(`${url}/status`, 'PUT', { status })).status, 401);
      const result = await request(`${url}/status`, 'PUT', { status }, { 'x-edit-pin': '1234' });
      assert.equal(result.status, 200);
      assert.equal(result.data.status, status);
      assert.equal(result.data.name, 'Status fixture');
    }
    for (const body of [{ status: 'Active' }, { status: 'Other' }, {}, { status: 'In Service', name: 'Changed' }]) {
      assert.equal((await request(`${url}/status`, 'PUT', body, { 'x-edit-pin': '1234' })).status, 400);
    }
    assert.equal((await request(url, 'PUT', { name: 'Changed' })).status, 401);
    assert.equal((await request(url, 'PUT', { status: 'In Service' }, { 'x-edit-pin': '1234' })).status, 409);
    assert.equal((await request('/equipment', 'POST', { name: 'Invalid', status: 'Other' }, { 'x-edit-pin': '1234' })).status, 400);
    assert.equal((await request('/equipment/missing/status', 'PUT', { status: 'Sold' }, { 'x-edit-pin': '1234' })).status, 404);
    // Audit schema is verified directly so this test does not depend on the admin list API.
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'equiptags.db'), { readonly: true });
    const changes = db.prepare("SELECT * FROM audit_log WHERE action = 'Updated equipment status'").all();
    assert.equal(changes.length, 3);
    assert.equal(changes[0].actor_name, 'Manager');
    db.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('public tag-out tickets require PIN updates and preserve completed history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equiptags-ticket-test-'));
  fs.copyFileSync(path.join(root, 'server.js'), path.join(dir, 'server.js'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  process.env.EQUIPTAGS_EDIT_PIN = '1234';
  process.env.EQUIPTAGS_MASTER_PIN = '5678';
  const server = require(path.join(dir, 'server.js')).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(url, method = 'GET', body, authenticated = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'x-edit-pin': '1234' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    const { data: item } = await request('/equipment', 'POST', { name: 'Ticket fixture', status: 'In Service' }, true);
    const url = `/equipment/${item.tag_id}`;
    assert.equal((await request(`${url}/tickets`, 'POST', {})).status, 400);
    const body = { description: 'Hydraulic leak', reported_by: 'Crew reporter' };
    const created = await request(`${url}/tickets`, 'POST', body);
    assert.equal(created.status, 201);
    assert.equal((await request(url)).data.status, 'Tagged Out');
    const ticketLog = (await request(url)).data.maintenance;
    assert.equal(ticketLog.length, 1);
    assert.equal(ticketLog[0].service_type, 'Mechanic ticket');
    assert.equal(ticketLog[0].ticket_id, created.data.id);
    assert.equal(ticketLog[0].performed_by, body.reported_by);
    assert.match(ticketLog[0].notes, /Hydraulic leak/);
    assert.equal((await request(url, 'DELETE', undefined, true)).status, 409);
    assert.equal((await request(`/maintenance/${ticketLog[0].id}`, 'DELETE', undefined, true)).status, 409);
    assert.equal((await request('/tickets/open')).data[0].tag_id, item.tag_id);
    assert.equal((await request(`${url}/tickets`, 'POST', body)).status, 200);
    assert.equal((await request(url)).data.maintenance.length, 1);
    assert.equal((await request(`${url}/status`, 'PUT', { status: 'In Service' }, true)).status, 409);
    assert.equal((await request(url, 'PUT', { status: 'In Service' }, true)).status, 409);
    assert.equal((await request(url, 'PUT', { location: 'Shop' }, true)).status, 200);
    const ticketUrl = `${url}/tickets/${created.data.id}`;
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Closed', notes: 'Done', machine_status: 'In Service' })).status, 401);
    assert.equal((await request(ticketUrl, 'PUT', { status: 'With Mechanic', notes: '' }, true)).status, 400);
    for (const status of ['With Mechanic', 'Awaiting Parts']) {
      assert.equal((await request(ticketUrl, 'PUT', { status, notes: 'Replace hydraulic hose' }, true)).status, 200);
      assert.equal((await request(url)).data.status, status);
      assert.equal((await request(url)).data.tickets[0].status, status);
    }
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Closed', notes: 'Fixed' }, true)).status, 400);
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Closed', notes: 'Replaced hose and tested', machine_status: 'In Service' }, true)).status, 200);
    assert.equal((await request('/tickets/open')).data.length, 0);
    const detail = (await request(url)).data;
    assert.equal(detail.status, 'In Service');
    assert.ok(detail.tickets[0].closed_at);
    assert.equal((await request(url, 'DELETE', undefined, true)).status, 409);
    assert.equal(detail.maintenance.length, 1);
    assert.equal(detail.tickets[0].updates.length, 4);
    assert.equal(detail.tickets[0].updates[3].actor_name, 'Manager');
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Tagged Out', notes: 'Again' }, true)).status, 409);
    assert.equal((await request(`${url}/tickets`, 'POST', body)).status, 201);
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dir, 'equiptags.db'), { readonly: true });
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'ticket' AND equipment_id = ?").get(item.id).n, 6);
    db.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('status panel presents one status and offers one update path', () => {
  const context = vm.createContext({ esc: String, fmtDate: String });
  vm.runInContext(source.slice(source.indexOf('const availabilityLabels='), source.indexOf('\nasync function dashboard()')), context);
  vm.runInContext(source.slice(source.indexOf('function ticketPanel(x)'), source.indexOf('\nfunction availabilityModal(')), context);
  const item = { status: 'In Service', tickets: [] };
  let html = context.ticketPanel(item);
  assert.match(html, /Ready to use/);
  assert.match(html, /id="changeAvailability"/);
  assert.doesNotMatch(html, /id="createTicket"/);
  assert.equal((html.match(/<button /g)||[]).length, 1);
  item.status = 'Awaiting Parts';
  item.tickets = [{ id: 1, status: 'Awaiting Parts', description: 'Leak', reported_by: 'Crew', created_at: '2026-10-08', updates: [] }];
  html = context.ticketPanel(item);
  assert.match(html, /Waiting for parts — do not use/);
  assert.doesNotMatch(html, /Repair progress:/);
  assert.match(html, /Update status/);
  assert.doesNotMatch(html, /id="changeAvailability"|id="createTicket"/);
  item.status = 'Needs Attention';
  item.tickets[0].status = 'Needs Attention';
  html = context.ticketPanel(item);
  assert.match(html, /Needs attention — still usable/);
  assert.doesNotMatch(html, /Repair progress:/);
  assert.doesNotMatch(html, /<p class="ticket-warning">Do not use/);
  assert.equal(context.statusClass('Needs Attention'), 'attention');
  assert.equal(context.statusLabel('Active'), context.statusLabel('In Service'));
});

test('equipment validation and problem-report routing reject invalid writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equiptags-validation-'));
  const serverPath = path.join(dir, 'server.js');
  fs.copyFileSync(path.join(root, 'server.js'), serverPath);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const server = require(serverPath).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(url, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-edit-pin': '1234' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  try {
    const { data: item } = await request('/equipment', 'POST', { name: 'Validation fixture' });
    const url = `/equipment/${item.tag_id}`;
    for (const body of [
      { engine_hours: -1 }, { last_oil_change_hours: -1 }, { purchase_price: -1 },
      { service_interval_hours: -100 }, { service_interval_hours: 0 }, { engine_hours: 'oops' },
      { engine_hours: true }, { purchase_date: '2026-02-30' }, { last_oil_change_date: 'invalid' }
    ]) {
      assert.equal((await request(url, 'PUT', body)).status, 400);
      assert.equal((await request('/equipment', 'POST', { name: 'Invalid', ...body })).status, 400);
    }
    assert.equal((await request(url, 'PUT', { engine_hours: 0, last_oil_change_hours: 0, purchase_price: 0, service_interval_hours: null, purchase_date: '2024-02-29' })).status, 200);
    for (const service_type of ['Damage Report', 'Incident Report', 'Mechanic ticket']) {
      assert.equal((await request(`${url}/maintenance`, 'POST', { service_type, service_date: '2026-10-08', notes: 'Leak' })).status, 400);
    }
    assert.equal((await request(url)).data.status, 'In Service');
    assert.equal((await request(url)).data.maintenance.length, 0);
    assert.equal((await request(`${url}/maintenance`, 'POST', { service_type: 'Inspection', service_date: '2026-10-08' })).status, 201);
    assert.equal((await request(url, 'DELETE')).status, 409);
    const { data: empty } = await request('/equipment', 'POST', { name: 'Empty fixture' });
    assert.equal((await request(`/equipment/${empty.tag_id}`, 'DELETE')).status, 204);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('equipment Save ignores repeated submits and allows retry after failure', async () => {
  let resolveRequest, calls = 0, closes = 0;
  const button = { disabled: false };
  const form = { querySelector: () => button };
  const context = vm.createContext({
    $: () => form, loadTrailerOptions: async () => {}, modal: () => {}, input: () => '',
    trailerSelect: () => '', esc: String, toast: () => {}, closeModal: () => closes++, openEquipment: () => {},
    FormData: class { *[Symbol.iterator]() { yield ['name', 'Fixture']; } },
    api: () => { calls++; return new Promise((resolve, reject) => { resolveRequest = { resolve, reject }; }); }
  });
  vm.runInContext(source.slice(source.indexOf('async function equipmentModal('), source.indexOf('\nfunction maintenanceModal(')), context);
  await context.equipmentModal();
  const event = { preventDefault() {}, target: form };
  let pending = form.onsubmit(event);
  await form.onsubmit(event);
  assert.equal(calls, 1);
  resolveRequest.reject(new Error('Failed'));
  await pending;
  assert.equal(button.disabled, false);
  pending = form.onsubmit(event);
  await form.onsubmit(event);
  assert.equal(calls, 2);
  resolveRequest.resolve({ tag_id: '00001' });
  await pending;
  assert.equal(closes, 1);
});

test('attention reports stay usable, log the issue, and require PIN resolution or escalation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equiptags-attention-'));
  fs.copyFileSync(path.join(root, 'server.js'), path.join(dir, 'server.js'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const server = require(path.join(dir, 'server.js')).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(url, method = 'GET', body, authenticated = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'x-edit-pin': '1234' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    const { data: item } = await request('/equipment', 'POST', { name: 'Flag fixture', engine_hours: 42 }, true);
    const url = `/equipment/${item.tag_id}`;
    const body = { status: 'Needs Attention', description: 'Inspect loose cover', reported_by: 'Crew' };
    assert.equal((await request(`${url}/tickets`, 'POST', { ...body, status: 'Other' })).status, 400);
    const { status, data: ticket } = await request(`${url}/tickets`, 'POST', body);
    assert.equal(status, 201);
    let detail = (await request(url)).data;
    assert.equal(detail.status, 'Needs Attention');
    assert.equal(detail.maintenance[0].ticket_id, ticket.id);
    assert.equal(detail.maintenance[0].engine_hours, 42);
    assert.match(detail.maintenance[0].notes, /still usable/);
    assert.equal((await request('/equipment?limit=100&status=Needs%20Attention')).data.total, 1);
    assert.equal((await request('/tickets/open')).data[0].status, 'Needs Attention');
    assert.equal((await request(`${url}/tickets`, 'POST', body)).status, 200);
    assert.equal((await request(`${url}/status`, 'PUT', { status: 'In Service' }, true)).status, 409);
    const ticketUrl = `${url}/tickets/${ticket.id}`;
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Closed', notes: 'Inspected', machine_status: 'In Service' })).status, 401);
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Needs Attention', notes: 'Inspection scheduled' }, true)).status, 200);
    assert.equal((await request(url)).data.status, 'Needs Attention');
    assert.equal((await request(ticketUrl, 'PUT', { status: 'With Mechanic', notes: 'Stop use for repair' }, true)).status, 200);
    assert.equal((await request(url)).data.status, 'With Mechanic');
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Needs Attention', notes: 'Downgrade' }, true)).status, 409);
    assert.equal((await request(ticketUrl, 'PUT', { status: 'Closed', notes: 'Repaired and tested', machine_status: 'In Service' }, true)).status, 200);
    const next = (await request(`${url}/tickets`, 'POST', body)).data;
    assert.equal((await request(`${url}/tickets/${next.id}`, 'PUT', { status: 'In Service', notes: 'Inspected and resolved' }, true)).status, 200);
    detail = (await request(url)).data;
    assert.equal(detail.status, 'In Service');
    assert.equal(detail.maintenance.length, 2);
    assert.equal((await request(url, 'PUT', { status: 'Needs Attention' }, true)).status, 409);
    await request(`${url}/status`, 'PUT', { status: 'Out of Service' }, true);
    assert.equal((await request(`${url}/tickets`, 'POST', body)).status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ticket editor uses one status selector and sends the selected result directly', async () => {
  let html = '', payload;
  const button = { disabled: false }, help = {};
  const form = { elements: { status: { value: 'Tagged Out' } }, querySelector: () => button };
  const context = vm.createContext({
    esc: String, modal: markup => { html = markup; }, $: id => id === '#ticketUpdateForm' ? form : help,
    FormData: class { *[Symbol.iterator]() { yield ['status', form.elements.status.value]; yield ['notes', 'Inspected and tested']; } },
    api: async (url, options) => { payload = JSON.parse(options.body); }, closeModal: () => {}, toast: () => {}, openEquipment: async () => {}
  });
  vm.runInContext(source.slice(source.indexOf('const availabilityLabels='), source.indexOf('\nasync function dashboard()')), context);
  vm.runInContext(source.slice(source.indexOf('function updateTicketModal(')), context);
  context.updateTicketModal({ tag_id: '00001', name: 'Fixture' }, { id: 1, status: 'Tagged Out' });
  assert.equal((html.match(/<select /g) || []).length, 1);
  assert.doesNotMatch(html, /name="machine_status"|Repair progress|value="Needs Attention"/);
  assert.match(html, /With mechanic — do not use/);
  form.elements.status.value = 'In Service';
  form.elements.status.onchange();
  assert.match(help.textContent, /closes the ticket/);
  await form.onsubmit({ preventDefault() {} });
  assert.deepEqual(payload, { status: 'In Service', notes: 'Inspected and tested' });
});

test('one status form routes problem choices to tickets and ordinary choices to status', async () => {
  const help = {}, fields = {}, button = { disabled: false }, calls = [];
  const form = { elements: { status: { value: 'In Service' }, reported_by: { value: 'Crew' }, description: { value: 'Inspect cover' } }, querySelector: () => button };
  const context = vm.createContext({
    esc: String, requestEditAccess: async () => true, modal: () => {}, $: id => id === '#availabilityForm' ? form : id === '#availabilityHelp' ? help : fields,
    FormData: class { *[Symbol.iterator]() { for (const [key, input] of Object.entries(form.elements)) if (!input.disabled) yield [key, input.value]; } },
    api: async (url, options) => calls.push({ url, method: options.method, body: JSON.parse(options.body) }),
    closeModal: () => {}, toast: () => {}, openEquipment: async () => {}
  });
  vm.runInContext(source.slice(source.indexOf('const availabilityLabels='), source.indexOf('\nasync function dashboard()')), context);
  vm.runInContext(source.slice(source.indexOf('function availabilityModal('), source.indexOf('\nfunction updateTicketModal(')), context);
  context.availabilityModal({ tag_id: '00001', name: 'Fixture', status: 'In Service' });
  assert.equal(fields.hidden, true);
  assert.equal(form.elements.description.required, false);
  for (const status of ['Needs Attention', 'Tagged Out', 'Sold']) {
    button.disabled = false;
    form.elements.status.value = status;
    form.elements.status.onchange();
    const problem = status !== 'Sold';
    assert.equal(fields.hidden, !problem);
    assert.equal(form.elements.description.required, problem);
    await form.onsubmit({ preventDefault() {} });
    const call = calls.at(-1);
    assert.equal(call.url, '/equipment/00001' + (problem ? '/tickets' : '/status'));
    assert.equal(call.method, problem ? 'POST' : 'PUT');
    assert.equal(call.body.status, status);
    if (problem) assert.equal(call.body.description, 'Inspect cover');
    else assert.deepEqual(call.body, { status: 'Sold' });
  }
});
