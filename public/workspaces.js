let accessRole='', accessExpires=0, workspaceItems=[], workspaceTickets=[], workspaceCrews=[];
let workspaceRequest=0, workspaceVisible=[], workspaceSelected=new Set();
const KEEP_ASSIGNMENT='__keep_existing__';
function workspaceMode(){
 const value=localStorage.getItem('equiptags-workspace')||'crew';
 return ['crew','manager','mechanic','inventory'].includes(value)?value:'crew';
}
function allowedWorkspaces(){
 if(accessRole==='Crew')return ['crew'];
 if(accessRole==='Mechanic')return ['mechanic','crew'];
 if(accessRole==='Manager')return ['manager','inventory','mechanic','crew'];
 return ['crew','manager','mechanic','inventory'];
}
function workspaceState(mode=workspaceMode()){
 try{return JSON.parse(sessionStorage.getItem('equiptags-view-'+mode+'-'+(typeof divisionSelectionKey==='function'?divisionSelectionKey():'legacy'))||'{}')}catch{return {}}
}
function rememberWorkspace(){
 if(!$('#workspaceCrew'))return;
 const state={crew:$('#workspaceCrew').value,search:$('#workspaceSearch').value,filter:$('#workspaceFilter')?.value||'all',sort:$('#workspaceSort')?.value||'name',selected:[...workspaceSelected],scroll:window.scrollY};
 sessionStorage.setItem('equiptags-view-'+workspaceMode()+'-'+(typeof divisionSelectionKey==='function'?divisionSelectionKey():'legacy'),JSON.stringify(state));
}
function workspaceNavigation(){
 const nav=document.querySelector('#workspaceNav');if(!nav)return;const setupActive=location.pathname==='/equiptags/crews-trailers';
 nav.innerHTML=`<div class="workspace-links">${[['crew','In-use equipment'],['manager','Manager review'],['mechanic','Mechanic queue'],['inventory','Inventory']].filter(([id])=>allowedWorkspaces().includes(id)).map(([id,label])=>`<button class="${!setupActive&&workspaceMode()===id?'selected':'secondary'}" data-workspace="${id}" ${!setupActive&&workspaceMode()===id?'aria-current="page"':''}>${label}</button>`).join('')}${(accessRole==='Manager')?`<a id="setupNavLink" class="button ${setupActive?'selected':'secondary'}" href="/equiptags/crews-trailers" ${setupActive?'aria-current="page"':''}>Crews &amp; trailers</a>`:''}${!accessRole||(accessRole==='Master')?'<a class="button secondary" href="/equiptags/admin/">Admin</a>':''}</div><div id="identity"></div>`;
 nav.querySelectorAll('[data-workspace]').forEach(button=>button.onclick=()=>{rememberWorkspace();localStorage.setItem('equiptags-workspace',button.dataset.workspace);dashboard()});if($('#setupNavLink'))$('#setupNavLink').onclick=e=>{e.preventDefault();crewsTrailersPage('crews')};updateIdentity();
}
function updateIdentity(){
 const box=document.querySelector('#identity');if(!box)return;
 if(Date.now()>=accessExpires){pin='';actorName='';accessRole=''}
 box.innerHTML=pin?`<span>${esc(actorName)} · ${esc(accessRole)}</span><button id="signOut" class="secondary">Sign out</button>`:'<span>Viewing equipment</span><button id="signIn" class="secondary">Staff sign in</button>';
 if($('#signIn'))$('#signIn').onclick=async()=>{if(await requestEditAccess()){const home={Manager:'manager',Mechanic:'mechanic',Crew:'crew'}[accessRole];if(home)localStorage.setItem('equiptags-workspace',home);const detail=location.pathname.match(/^\/equiptags\/e\/([^/]+)/);if(detail)await openEquipment(decodeURIComponent(detail[1]),false);else if(location.pathname==='/equiptags/tickets')await ticketsPage();else if(location.pathname==='/equiptags/crews-trailers')await crewsTrailersPage(setupTab(),false);else await dashboard()}};
 if($('#signOut'))$('#signOut').onclick=()=>{rememberWorkspace();pin='';actorName='';accessRole='';accessExpires=0;localStorage.setItem('equiptags-workspace','crew');const detail=location.pathname.match(/^\/equiptags\/e\/([^/]+)/);if(detail)openEquipment(decodeURIComponent(detail[1]),false);else if(location.pathname==='/equiptags/tickets')ticketsPage();else if(location.pathname==='/equiptags/crews-trailers')crewsTrailersPage(setupTab(),false);else dashboard()};
}
function crewOptions(current='',allOption=false){return `${allOption?'<option value="__all__">All crews</option>':''}<option value="">Unassigned</option>${[...new Map(workspaceCrews.map(c=>[c.name,c])).values()].map(c=>`<option value="${esc(c.name)}" ${c.name===current?'selected':''}>${esc(c.name)}</option>`).join('')}`}
async function workspaceDashboard(){if(typeof requireDivisionChoice==='function'&&!requireDivisionChoice())return;
 if(!allowedWorkspaces().includes(workspaceMode()))localStorage.setItem('equiptags-workspace',allowedWorkspaces()[0]);
 const request=++workspaceRequest,mode=workspaceMode();history.replaceState(null,'','/equiptags/');workspaceNavigation();
 $('#app').innerHTML='<div class="loading">Loading workspace…</div>';
 try{
  const [items,tickets,crews]=await Promise.all([api('/equipment?sort=name_asc'),api('/tickets/open'),api('/crew-options')]);
  if(request!==workspaceRequest||location.pathname!=='/equiptags/'||workspaceMode()!==mode)return;
  workspaceItems=items;workspaceTickets=tickets;workspaceCrews=crews;renderWorkspace(mode);
 }catch(error){
  if(request!==workspaceRequest)return;
  $('#app').innerHTML=`<div class="empty"><h2>Unable to load workspace</h2><p>${esc(error.message)}</p><button id="retryWorkspace">Try again</button></div>`;$('#retryWorkspace').onclick=workspaceDashboard;
 }
}
function renderWorkspace(mode){
 const crew=mode==='crew',manager=mode==='manager',mechanic=mode==='mechanic',state=workspaceState(mode);
 const saved=localStorage.getItem('equiptags-crew-'+(typeof divisionSelectionKey==='function'?divisionSelectionKey():'legacy'))||'';
 workspaceSelected=new Set((state.selected||[]).filter(tag=>workspaceItems.some(x=>x.tag_id===tag)));
 const title=crew?'In-use equipment':mechanic?'Mechanic queue':'Manager review';
 $('#app').innerHTML=`<section class="hero"><div><h1>${title}</h1><p class="subtitle">${crew?'View equipment by crew, check availability, and report a problem.':mechanic?'Open a repair directly, record progress, and review service due.':'Change a crew or trailer directly from the list, or select machines to move together.'}</p></div><div class="actions"><button id="refreshWorkspace" class="secondary">Refresh</button>${mechanic||manager?'<button id="ticketHistory" class="secondary">All tickets &amp; history</button>':''}${mechanic?'<button id="divisionSetup" class="secondary">Division setup</button>':''}${manager?'<button id="managerAddEquipment" class="secondary">Add equipment</button><button id="managerHistory" class="secondary">History</button><button id="workspaceTrailers" class="secondary">Crews &amp; trailers</button>':''}</div></section>
 ${crew?'':`<p id="summaryScope" class="meta"></p><div class="stats">${[['ready','Ready to use'],['unassigned','Without a crew'],['repairs','Open problems'],['service','Service due']].map(([key,label])=>`<button class="stat" data-summary="${key}"><strong id="summary-${key}">0</strong><span>${label}</span></button>`).join('')}</div>`}
 <div class="workspace-filters"><label><span>${crew?'Filter by crew':'Crew'}</span><select id="workspaceCrew">${crewOptions(saved,true)}</select></label><label><span>Find equipment</span><input id="workspaceSearch" type="search" placeholder="Name, tag, trailer or model"></label>${crew?'':`<label><span>Show</span><select id="workspaceFilter"><option value="all">All equipment</option><option value="repairs">Open problems</option><option value="ready">Ready to use</option><option value="unassigned">Without a crew</option><option value="service">Service due</option><option value="Tagged Out">New tag-outs</option><option value="With Mechanic">With mechanic</option><option value="Awaiting Parts">Awaiting parts</option></select></label>`}</div>
 <div class="workspace-list-controls"><p id="workspaceCount" class="meta" role="status"></p>${!crew?`<label>Sort <select id="workspaceSort"><option value="name">Name A–Z</option><option value="tag">Tag number</option><option value="crew">Crew</option><option value="oldest">Oldest problem first</option></select></label>`:''}</div>
 ${manager?'<div class="selection-toolbar"><label><input type="checkbox" id="selectVisible"> Select visible</label><span id="selectionCount" role="status">No machines selected</span><button id="clearSelection" class="secondary" disabled>Clear</button><button id="bulkReassign" disabled>Reassign selected</button></div>':''}
 <div id="workspaceRows" class="workspace-grid compact-rows"></div>`;
 const validCrew=value=>[...$('#workspaceCrew').options].some(option=>option.value===value);
 $('#workspaceCrew').value=validCrew(state.crew)?state.crew:crew?(workspaceCrews.some(c=>c.name===saved)?saved:'__all__'):'__all__';
 $('#workspaceSearch').value=state.search||'';
 if($('#workspaceFilter'))$('#workspaceFilter').value=state.filter||(mechanic?'repairs':'all');
 if($('#workspaceSort'))$('#workspaceSort').value=state.sort||(mechanic?'oldest':'name');
 $('#workspaceCrew').onchange=()=>{if(crew)localStorage.setItem('equiptags-crew-'+(typeof divisionSelectionKey==='function'?divisionSelectionKey():'legacy'),$('#workspaceCrew').value);drawWorkspace(mode)};
 $('#workspaceSearch').oninput=()=>drawWorkspace(mode);
 ['#workspaceFilter','#workspaceSort'].forEach(id=>{if($(id))$(id).onchange=()=>drawWorkspace(mode)});
 if($('#divisionSetup'))$('#divisionSetup').onclick=divisionSetup;
 if($('#ticketHistory'))$('#ticketHistory').onclick=()=>ticketsPage();
 $('#refreshWorkspace').onclick=()=>{rememberWorkspace();workspaceDashboard()};
 document.querySelectorAll('[data-summary]').forEach(button=>button.onclick=()=>{$('#workspaceFilter').value=button.dataset.summary;drawWorkspace(mode)});
 if(manager){
  $('#bulkReassign').onclick=()=>reassignEquipment(workspaceItems.filter(x=>workspaceSelected.has(x.tag_id)));
  $('#clearSelection').onclick=()=>{workspaceSelected.clear();drawWorkspace(mode)};
  $('#selectVisible').onchange=e=>{const select=e.target.checked;for(const x of workspaceVisible){if(select&&workspaceSelected.size<100)workspaceSelected.add(x.tag_id);else if(!select)workspaceSelected.delete(x.tag_id)}drawWorkspace(mode)};
  $('#managerAddEquipment').onclick=async()=>{if(await requestEditAccess())equipmentModal()};$('#managerHistory').onclick=managerHistory;
  $('#workspaceTrailers').onclick=()=>crewsTrailersPage('crews');
 }
 drawWorkspace(mode);requestAnimationFrame(()=>window.scrollTo(0,state.scroll||0));
}
function drawWorkspace(mode){
 const crew=$('#workspaceCrew').value,query=$('#workspaceSearch').value.trim().toLowerCase(),filter=$('#workspaceFilter')?.value||'all';
 const ticketMap=new Map(workspaceTickets.map(t=>[t.tag_id,t]));
 const scoped=workspaceItems.filter(x=>(crew==='__all__'||(x.crew_assigned||'')===crew)&&(!query||[x.name,x.tag_id,x.trailer_assigned,x.model].some(v=>String(v||'').toLowerCase().includes(query))));
 const matches=(x,key)=>key==='all'||(key==='ready'?x.status==='In Service':key==='unassigned'?!x.crew_assigned&&x.status!=='Sold':key==='repairs'?ticketMap.has(x.tag_id):key==='service'?x.status!=='Sold'&&x.service_due_in_hours!==null&&x.service_due_in_hours<=0:x.status===key);
 if($('#summaryScope')){
  $('#summaryScope').textContent=`${crew==='__all__'?'All crews':crew||'Unassigned equipment'}${query?' · Matching your search':''}`;
  for(const key of ['ready','unassigned','repairs','service'])$('#summary-'+key).textContent=scoped.filter(x=>matches(x,key)).length;
 }
 const items=scoped.filter(x=>matches(x,filter)&&(mode!=='crew'||x.status!=='Sold'));
 const sort=$('#workspaceSort')?.value||'name';
 items.sort((a,b)=>sort==='tag'?a.tag_id.localeCompare(b.tag_id,undefined,{numeric:true}):sort==='crew'?(a.crew_assigned||'').localeCompare(b.crew_assigned||'')||a.name.localeCompare(b.name):sort==='oldest'?(ticketMap.get(a.tag_id)?.created_at||'9999').localeCompare(ticketMap.get(b.tag_id)?.created_at||'9999'):a.name.localeCompare(b.name));
 workspaceVisible=items;
 $('#workspaceCount').textContent=crew==='__choose__'?'Select a crew to get started.':`${items.length} machines`;
 $('#workspaceRows').classList.toggle('manager-rows',mode==='manager');
 $('#workspaceRows').classList.toggle('mechanic-rows',mode==='mechanic');
 $('#workspaceRows').innerHTML=items.length?items.map(x=>{
  const ticket=ticketMap.get(x.tag_id);
  return `<article class="panel machine-card ${workspaceSelected.has(x.tag_id)?'is-selected':''}">${mode==='manager'?`<label class="machine-select"><input type="checkbox" class="select-machine" value="${esc(x.tag_id)}" ${workspaceSelected.has(x.tag_id)?'checked':''}><span class="sr-only">Select ${esc(x.name)}</span></label>`:''}<div class="machine-title"><span class="division-badge">${esc(x.division_name||divisionName(x.division_id))}</span><span class="tag">${esc(x.tag_id)}</span><h2><a href="/equiptags/e/${encodeURIComponent(x.tag_id)}">${esc(x.name)}</a></h2></div><p class="status ${statusClass(x.status)}" title="${esc(statusLabel(x.status))}">${esc(({'In Service':'Ready','Needs Attention':'Needs attention','Tagged Out':'Tagged out','With Mechanic':'With mechanic','Awaiting Parts':'Awaiting parts','Out of Service':'Unavailable'})[x.status]||x.status)}</p><dl class="machine-facts"><div><dt>Crew</dt><dd>${mode==='manager'?`<button class="assignment-shortcut" data-field="crew_assigned" data-tag="${esc(x.tag_id)}" aria-label="Change crew for ${esc(x.name)}">${esc(x.crew_assigned||'Unassigned')} <span aria-hidden="true">✎</span></button>`:esc(x.crew_assigned||'Unassigned')}</dd></div><div><dt>Trailer</dt><dd>${mode==='manager'?`<button class="assignment-shortcut" data-field="trailer_assigned" data-tag="${esc(x.tag_id)}" aria-label="Change trailer for ${esc(x.name)}">${esc(x.trailer_assigned||'No trailer')} <span aria-hidden="true">✎</span></button>`:esc(x.trailer_assigned||'No trailer')}</dd></div></dl>${ticket?`<details class="repair-summary"><summary>${esc(ticket.ticket_number||'Problem')} · ${fmtDate(ticket.created_at.slice(0,10))} · ${esc(ticket.description)}</summary><p>${esc(ticket.description)}</p>${ticket.latest_update?`<p>Latest: ${esc(ticket.latest_update)}</p>`:''}</details>`:''}${x.service_due_in_hours!==null&&x.service_due_in_hours<=0?'<p class="due overdue">Oil service due</p>':''}<div class="actions">${mode==='mechanic'?'':`<button class="secondary view-machine" data-tag="${esc(x.tag_id)}">Details</button>`}${mode==='manager'?`<button class="secondary edit-machine" data-tag="${esc(x.tag_id)}">Edit</button><button class="reassign-machine" data-tag="${esc(x.tag_id)}">Reassign</button>`:mode==='mechanic'&&ticket?`${quickRepairButtons(ticket,x.tag_id)}<button class="secondary repair-machine" data-tag="${esc(x.tag_id)}">Update repair</button>`:x.status!=='Sold'?`<button class="report-machine" data-tag="${esc(x.tag_id)}">${ticket?'Report another issue':'Report problem'}</button>`:''}</div></article>`;
 }).join(''):`<div class="empty">${crew==='__choose__'?'Choose your crew above.':'No equipment matches these filters.'}</div>`;
 bindQuickRepairs($('#workspaceRows'),[...ticketMap.values()],workspaceDashboard);
 $('#workspaceRows').querySelectorAll('.view-machine,.machine-title a').forEach(button=>button.onclick=e=>{e.preventDefault();rememberWorkspace();openEquipment(button.dataset.tag||decodeURIComponent(button.pathname.split('/').pop()))});
 $('#workspaceRows').querySelectorAll('.reassign-machine,.assignment-shortcut').forEach(button=>button.onclick=()=>reassignEquipment([workspaceItems.find(x=>x.tag_id===button.dataset.tag)],button.dataset.field));
 $('#workspaceRows').querySelectorAll('.edit-machine').forEach(button=>button.onclick=async()=>{rememberWorkspace();if(!await requestEditAccess())return;try{equipmentModal(await api('/equipment/'+encodeURIComponent(button.dataset.tag)))}catch(error){toast(error.message)}});
 $('#workspaceRows').querySelectorAll('.report-machine').forEach(button=>button.onclick=()=>{rememberWorkspace();reportProblem(workspaceItems.find(x=>x.tag_id===button.dataset.tag))});
 $('#workspaceRows').querySelectorAll('.repair-machine').forEach(button=>button.onclick=async()=>{rememberWorkspace();if(!await requestEditAccess())return;if(!['Mechanic','Manager'].includes(accessRole)){toast('A mechanic or manager PIN is needed.');await dashboard();return}try{const item=await api('/equipment/'+encodeURIComponent(button.dataset.tag));const ticket=item.tickets.find(t=>!t.closed_at);if(!ticket){toast('This repair has already been closed.');return workspaceDashboard()}updateTicketModal(item,ticket,workspaceDashboard)}catch(error){toast(error.message)}});
 $('#workspaceRows').querySelectorAll('.select-machine').forEach(input=>input.onchange=()=>{if(input.checked){if(workspaceSelected.size>=100){input.checked=false;toast('Select up to 100 machines at a time.');return}workspaceSelected.add(input.value)}else workspaceSelected.delete(input.value);input.closest('.machine-card').classList.toggle('is-selected',input.checked);updateSelection();rememberWorkspace()});
 updateSelection();rememberWorkspace();
}
function updateSelection(){
 if(!$('#bulkReassign'))return;
 const count=workspaceSelected.size,hidden=[...workspaceSelected].filter(tag=>!workspaceVisible.some(x=>x.tag_id===tag)).length;
 $('#selectionCount').textContent=count?`${count} selected${hidden?` (${hidden} outside these filters)`:''}`:'Select machines to reassign together';
 $('#bulkReassign').disabled=!count;$('#bulkReassign').textContent=count?`Reassign ${count} selected`:'Reassign selected';$('#clearSelection').disabled=!count;
 const visibleSelected=workspaceVisible.filter(x=>workspaceSelected.has(x.tag_id)).length;
 $('#selectVisible').checked=workspaceVisible.length>0&&visibleSelected===workspaceVisible.length;$('#selectVisible').indeterminate=visibleSelected>0&&visibleSelected<workspaceVisible.length;
}
async function managerHistory(){
 if(!await requestEditAccess())return;
 modal('<div class="paneltitle"><h2>History</h2><button class="secondary close">×</button></div><div id="managerAudit" class="change-list"></div><p id="managerAuditError" role="alert"></p><button id="moreManagerAudit" class="secondary">Load changes</button>');
 let offset=0,loading=false;
 const load=async()=>{
  if(loading)return;loading=true;const button=$('#moreManagerAudit');button.disabled=true;button.textContent='Loading…';
  try{const result=await api('/audit?limit=100&offset='+offset);if(!$('#managerAudit'))return;$('#managerAudit').insertAdjacentHTML('beforeend',result.items.map(row=>`<div class="change-row"><b>${esc(row.entity_label)} · ${esc(row.action)}</b><p class="meta">${esc(row.actor_name)} · ${esc(new Date(row.created_at.replace(' ','T')+'Z').toLocaleString())}</p>${changeDetails(row.details)}</div>`).join('')||'<p>No equipment changes recorded.</p>');offset+=result.items.length;button.hidden=!result.has_more;$('#managerAuditError').textContent=''}catch(error){if($('#managerAuditError'))$('#managerAuditError').textContent=error.message}finally{loading=false;button.disabled=false;button.textContent='Load 100 more'}
 };
 $('#moreManagerAudit').onclick=load;await load();
}
async function addCrew(){return crewsTrailersPage('crews')}

function assignmentPatch(form){
 const patch={};
 for(const key of ['crew_assigned','trailer_assigned'])if(form.elements[key].value!==KEEP_ASSIGNMENT)patch[key]=form.elements[key].value;
 return patch;
}
async function reassignEquipment(items,focusField){
 if(!items.length||items.length>100)return;
 rememberWorkspace();
 if(!await requestEditAccess())return;
 if(!(accessRole==='Manager')){toast('A manager PIN is needed to change assignments.');return}
 if(new Set(items.map(x=>x.division_id)).size!==1){
  modal(`<div class="paneltitle"><h2>Reassign ${items.length} machines</h2><button class="close secondary" aria-label="Close">×</button></div><p>These machines belong to multiple divisions. Move them to one division before assigning a crew or trailer.</p><div class="reassign-division"><button type="button" id="moveReassignmentDivision" class="secondary">Move to another division</button></div><div class="formactions"><button class="close secondary">Cancel</button></div>`);
  $('#moveReassignmentDivision').onclick=()=>{closeModal();transferDivision(items)};
  return;
 }
 try{const [crews,trailers]=await Promise.all([api('/crew-options?divisions='+items[0].division_id),api('/trailer-options?divisions='+items[0].division_id)]);workspaceCrews=crews;trailerOptions=trailers}catch(error){toast(error.message);return}
 const first=items[0];
 const destination=(name,label,options)=>`<label><span>${label}</span><select name="${name}"><option value="${KEEP_ASSIGNMENT}">Keep existing ${label.toLowerCase()}</option>${options}</select></label>`;
 modal(`<div class="paneltitle"><div><h2>${items.length===1?'Reassign '+esc(first.name):'Reassign '+items.length+' machines'}</h2><p class="subtitle">Choose only what should change. A crew can be assigned with no trailer.</p></div><button class="close secondary" aria-label="Close">×</button></div><form id="reassignForm"><div class="reassign-division"><span>Division: <b>${esc(divisionName(first.division_id))}</b></span><button type="button" id="moveReassignmentDivision" class="secondary">Move to another division</button></div><div class="formgrid assignment-destinations">${destination('crew_assigned','Crew',crewOptions())}${destination('trailer_assigned','Trailer',trailerAssignmentOptions())}</div><details class="assignment-more"><summary>Handoff note (optional)</summary><label>Handoff note (optional)<textarea name="note" maxlength="1000" rows="2"></textarea></label></details><section class="assignment-preview" aria-live="polite"><h3>Changes to save</h3><div id="assignmentPreview"></div></section><p id="reassignError" role="alert"></p><div class="formactions"><button type="button" class="close secondary">Cancel</button><button id="saveReassignment" disabled>Save reassignment</button></div></form>`);
 $('#moveReassignmentDivision').onclick=()=>{closeModal();transferDivision(items)};
 const form=$('#reassignForm');
 for(const key of ['crew_assigned','trailer_assigned'])form.elements[key].value=KEEP_ASSIGNMENT;
 const preview=()=>{
  const patch=assignmentPatch(form);let changed=0;
  $('#assignmentPreview').innerHTML=items.map(x=>{const changes=Object.entries(patch).filter(([key,value])=>(x[key]||'')!==value);if(changes.length)changed++;return `<div class="assignment-preview-row"><b>${esc(x.tag_id)} · ${esc(x.name)}</b>${changes.length?changes.map(([key,value])=>`<span>${{crew_assigned:'Crew',trailer_assigned:'Trailer'}[key]}: ${esc(x[key]||(key==='trailer_assigned'?'No trailer':'Unassigned'))} → <strong>${esc(value||(key==='trailer_assigned'?'No trailer':'Unassigned'))}</strong></span>`).join(''):'<span>No change</span>'}</div>`}).join('');
  $('#saveReassignment').disabled=!changed;$('#saveReassignment').textContent=changed?`Save ${changed===1?'reassignment':changed+' reassignments'}`:'Choose a change above';
 };
 form.oninput=preview;form.onchange=preview;preview();
 if(focusField)form.elements[focusField]?.focus();
 form.onsubmit=async e=>{
  e.preventDefault();const button=$('#saveReassignment');if(button.disabled)return;button.disabled=true;button.textContent='Saving…';$('#reassignError').textContent='';
  const data={...assignmentPatch(form),note:form.elements.note.value,items:items.map(x=>({tag_id:x.tag_id,division_id:x.division_id,crew_assigned:x.crew_assigned||'',trailer_assigned:x.trailer_assigned||'',location:x.location||''}))};
  try{const result=await api('/assignments',{method:'POST',body:JSON.stringify(data)});items.forEach(x=>workspaceSelected.delete(x.tag_id));rememberWorkspace();closeModal();if(location.pathname.includes('/e/'))await openEquipment(first.tag_id,false);else await dashboard();toast(result.updated?`${result.updated} ${result.updated===1?'machine reassigned':'machines reassigned'}`:'Assignments already up to date')}
  catch(error){$('#reassignError').textContent=error.message;preview()}
 };
}
function reportProblem(x){
 const hasOpen=Array.isArray(x.tickets)?x.tickets.some(t=>!t.closed_at):workspaceTickets.some(t=>t.tag_id===x.tag_id);
 modal(`<div class="paneltitle"><h2>${hasOpen?'Report another issue':'Report a problem'}</h2><button class="close secondary" aria-label="Close">×</button></div><p>${esc(x.tag_id)} · ${esc(x.name)}</p><form id="problemForm"><label>Your name<input name="reported_by" maxlength="80" value="${esc(actorName)}" required autocomplete="name"></label><label>What is wrong?<textarea name="description" rows="4" maxlength="3600" required></textarea></label><label>Issue location (optional)<input name="reported_location" maxlength="200" placeholder="Where the issue happened, if helpful"></label><label>Equipment availability<select name="status">${hasOpen?`<option value="">Keep current status · ${esc(statusLabel(x.status))}</option>${x.status==='Needs Attention'?'<option value="Tagged Out">Do not use — tag out</option>':''}`:`<option value="Tagged Out">Do not use — tag out</option>${x.status==='In Service'?'<option value="Needs Attention">Still usable — needs inspection</option>':''}`}</select></label><p class="meta">${hasOpen?'Adds your issue to the open repair with your name and the time reported. No PIN needed.':'This creates a repair ticket and updates availability immediately.'}</p>${photoPickerMarkup()}<p id="problemError" role="alert"></p><div class="formactions"><button type="button" class="close secondary">Cancel</button><button>Submit problem</button></div></form>`,'narrow');
 bindPhotoPicker($('#problemForm'));
 $('#problemForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button:not([type])');if(button.disabled)return;button.disabled=true;try{if(e.target.photosBusy)throw Error('Please wait for photos to finish resizing.');const data=Object.fromEntries(new FormData(e.target));data.photos=e.target.reportPhotos||[];if(data.reported_location.trim())data.description+='\nReported location: '+data.reported_location.trim();delete data.reported_location;if(data.status==='')delete data.status;await api('/equipment/'+encodeURIComponent(x.tag_id)+'/tickets',{method:'POST',body:JSON.stringify(data)});closeModal();toast(hasOpen?'Issue added to open repair':'Problem reported');await openEquipment(x.tag_id,false)}catch(error){$('#problemError').textContent=error.message;button.disabled=false}};
}
function enhanceEquipment(x){
 workspaceNavigation();if(typeof showEquipmentDivision==='function')showEquipmentDivision(x);const crew=accessRole==='Crew'||(workspaceMode()==='crew'&&!(accessRole==='Manager'));
 if(accessRole==='Mechanic'||(!accessRole&&workspaceMode()==='mechanic')){['#editInfo','#delete','#changeLog'].forEach(selector=>{if($(selector))$(selector).hidden=true})}
 if(accessRole==='Mechanic'||(!accessRole&&workspaceMode()==='mechanic')){if($('#quickEditAssignments'))$('#quickEditAssignments').hidden=true}
 if(crew){['#quickEditAssignments','#editInfo','#delete','#service','#changeLog'].forEach(selector=>{if($(selector))$(selector).hidden=true});document.querySelectorAll('.update-ticket').forEach(b=>b.hidden=true);document.querySelectorAll('.field').forEach(field=>{if(['Purchase price','Purchase date'].includes(field.querySelector('span')?.textContent))field.hidden=true})}
 const open=x.tickets.find(t=>!t.closed_at),panel=document.querySelector('.ticket-panel .actions');
 if(open){panel.insertAdjacentHTML('afterbegin','<button id="reportProblem">Report another issue</button>');$('#reportProblem').onclick=()=>reportProblem(x);if(!crew){panel.insertAdjacentHTML('beforeend','<button id="progressNote" class="secondary">Add progress note</button>');$('#progressNote').onclick=async()=>{if(!await requestEditAccess())return;modal('<div class="paneltitle"><h2>Add progress note</h2><button class="secondary close" aria-label="Close">×</button></div><p>Availability stays the same.</p><form id="progressForm"><label>Work completed / next step<textarea name="notes" rows="4" maxlength="4000" required></textarea></label><p id="progressError" role="alert"></p><div class="formactions"><button type="button" class="secondary close">Cancel</button><button>Save note</button></div></form>','narrow');$('#progressForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button:not([type])');if(button.disabled)return;button.disabled=true;try{await api('/equipment/'+encodeURIComponent(x.tag_id)+'/tickets/'+open.id,{method:'PUT',body:JSON.stringify({status:open.status,expected_revision:open.revision,notes:new FormData(e.target).get('notes')})});closeModal();await openEquipment(x.tag_id,false);toast('Progress saved')}catch(error){$('#progressError').textContent=error.message;button.disabled=false}}}}}
 else if(x.status!=='Sold'){if($('#changeAvailability')){$('#changeAvailability').hidden=crew;$('#changeAvailability').textContent='Change availability'}panel.insertAdjacentHTML('afterbegin','<button id="reportProblem">Report problem</button>');$('#reportProblem').onclick=()=>reportProblem(x)}
 if(crew){
  const details=document.querySelector('.detailgrid');
  const ticketPanel=document.querySelector('.ticket-panel'),records=[...ticketPanel.querySelectorAll('.ticket-record')];
  if(records.length){const history=document.createElement('details');history.className='crew-history';history.innerHTML=`<summary>Repair history (${records.length})</summary>`;ticketPanel.querySelector('h3')?.remove();records.forEach(record=>history.append(record));ticketPanel.append(history)}
  ticketPanel.querySelectorAll(':scope > p.meta').forEach(help=>help.hidden=true);
  [...details.children].forEach((panel,index)=>{const fold=document.createElement('details');fold.className='panel crew-fold';fold.innerHTML=`<summary>${index===0?'Equipment details':'Equipment log'}</summary>`;panel.replaceWith(fold);panel.classList.remove('panel');fold.append(panel)});
 }

}
// A session ends after 30 minutes; a revoked or reassigned PIN is checked on every write.
setInterval(()=>{if(accessExpires&&Date.now()>=accessExpires){pin='';actorName='';accessRole='';accessExpires=0;updateIdentity()}},30000);
