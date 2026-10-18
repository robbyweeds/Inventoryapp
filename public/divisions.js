let divisionsReady=false,divisionLoad=null,divisionData=[],divisionSelection=null,formDivisionId=null;
function divisionSelectionKey(){return divisionSelection===null?'choose':divisionSelection.join('-')}
function activeDivisionId(){return divisionSelection?.length===1?divisionSelection[0]:null}
function divisionName(id){return divisionData.find(d=>d.id===Number(id))?.name||'Unassigned division'}
function divisionOptions(selected,placeholder=false){return `${placeholder?'<option value="">Choose a division…</option>':''}${divisionData.filter(d=>d.id!==0).concat(divisionData.filter(d=>d.id===0)).map(d=>`<option value="${d.id}" ${Number(selected)===d.id&&selected!==null&&selected!==''?'selected':''}>${esc(d.name)}</option>`).join('')}`}
function scopedDivisionUrl(path){
 const [route,query='']=path.split('?');
 if(!['/equipment','/tickets','/tickets/open','/crew-options','/trailer-options','/audit','/equipment-export.xlsx','/trailer-assignments-export.xlsx','/trailer-assignment-export.xlsx'].includes(route)||!divisionSelection?.length)return path;
 const params=new URLSearchParams(query);if(!params.has('divisions'))params.set('divisions',divisionSelection.join(','));return route+'?'+params;
}
async function initializeDivisionView(){
 if(divisionLoad)return divisionLoad;
 divisionLoad=(async()=>{
  divisionData=await api('/divisions');
  try{const saved=JSON.parse(localStorage.getItem('equiptags-divisions')||'null');if(saved==='all')divisionSelection=divisionData.map(d=>d.id);else if(Array.isArray(saved)){const ids=saved.filter(id=>divisionData.some(d=>d.id===id));if(ids.length)divisionSelection=ids}}catch{}
  const requested=new URLSearchParams(location.search).get('division');if(requested!==null&&/^\d+$/.test(requested)&&divisionData.some(d=>d.id===Number(requested))){divisionSelection=[Number(requested)];localStorage.setItem('equiptags-divisions',JSON.stringify(divisionSelection))}
  divisionsReady=true;renderDivisionHeader();
 })().catch(error=>{divisionLoad=null;throw error});return divisionLoad;
}
function renderDivisionHeader(){
 const header=document.querySelector('#divisionHeader');if(!header)return;
 const selected=activeDivisionId(),all=divisionSelection?.length===divisionData.length;
 header.innerHTML=`<label for="divisionSelect">Division</label><select id="divisionSelect"><option value="__choose__">Choose a division…</option>${divisionOptions(null)}<option value="__all__">All divisions · Combined review</option><option value="__multiple__">${divisionSelection?.length>1&&!all?divisionSelection.length+' divisions selected':'Select multiple divisions…'}</option></select>`;
 $('#divisionSelect').value=selected!==null?String(selected):all?'__all__':divisionSelection?.length?'__multiple__':'__choose__';
 $('#divisionSelect').onchange=async e=>{
  const value=e.target.value;
  if(value==='__multiple__'){renderDivisionHeader();return chooseDivisionReview()}
  if(value==='__choose__'){renderDivisionHeader();return}
  await setDivisionSelection(value==='__all__'?divisionData.map(d=>d.id):[Number(value)]);
 };
}
async function setDivisionSelection(ids,navigate=true){
 if(typeof rememberWorkspace==='function')rememberWorkspace();
 divisionSelection=ids;localStorage.setItem('equiptags-divisions',JSON.stringify(ids.length===divisionData.length?'all':ids));renderDivisionHeader();
 if(navigate){workspaceRequest++;if(location.pathname==='/equiptags/tickets')await ticketsPage();else if(location.pathname==='/equiptags/crews-trailers')await crewsTrailersPage(setupTab(),false);else await dashboard()}
}
function requireDivisionChoice(){
 if(divisionSelection?.length)return true;
 if(typeof workspaceNavigation==='function')workspaceNavigation();
 $('#app').innerHTML='<section class="division-welcome panel"><h1>Choose your division</h1><p>New company? <a href="/equiptags/admin/">Open Admin</a> with your master PIN to create your divisions, then sign in as manager to add crews, trailers, and equipment.</p><p>Select a division in the header to see its equipment, crews, trailers, and repair queue.</p><div class="division-launches">'+divisionData.filter(d=>d.id!==0).map(d=>`<button class="secondary" data-launch-division="${d.id}">${esc(d.name)}</button>`).join('')+'</div><p class="meta">Use All divisions or Select multiple divisions in the header for combined review. Existing records are under Unassigned division until a manager assigns them.</p></section>';
 document.querySelectorAll('[data-launch-division]').forEach(button=>button.onclick=()=>setDivisionSelection([Number(button.dataset.launchDivision)]));return false;
}
function chooseDivisionReview(){
 modal(`<div class="paneltitle"><h2>Review divisions together</h2><button class="secondary close">×</button></div><form id="divisionReviewForm"><p>Choose which divisions to include.</p><div class="division-checks">${divisionData.map(d=>`<label><input type="checkbox" name="division" value="${d.id}" ${divisionSelection?.includes(d.id)?'checked':''}>${esc(d.name)}</label>`).join('')}</div><p id="divisionReviewError" role="alert"></p><div class="formactions"><button type="button" class="secondary close">Cancel</button><button>Review selected</button></div></form>`,'narrow');
 $('#divisionReviewForm').onsubmit=async e=>{e.preventDefault();const ids=new FormData(e.target).getAll('division').map(Number);if(!ids.length){$('#divisionReviewError').textContent='Choose at least one division.';return}closeModal();await setDivisionSelection(ids)};
}
async function selectOneDivision(reason){
 if(activeDivisionId()!==null)return activeDivisionId();
 return new Promise(resolve=>{
  modal(`<div class="paneltitle"><h2>Choose a division</h2><button class="secondary close">×</button></div><p>${esc(reason)}</p><form id="singleDivisionForm"><label>Division<select name="division" required>${divisionOptions(null,true)}</select></label><div class="formactions"><button type="button" class="secondary close">Cancel</button><button>Continue</button></div></form>`,'narrow');
  const dialog=document.querySelector('.modal');dialog.onClose=()=>resolve(null);
  $('#singleDivisionForm').onsubmit=async e=>{e.preventDefault();const id=Number(new FormData(e.target).get('division'));dialog.onClose=null;closeModal();await setDivisionSelection([id]);resolve(id)};
 });
}
function divisionCreationBody(path,opt){
 if(opt.method!=='POST'||!['/crew-options','/trailer-options'].includes(path))return;
 const body=JSON.parse(opt.body||'{}');if(body.division_id===undefined){if(activeDivisionId()===null)throw Error('Choose one division before adding crews or trailers.');body.division_id=activeDivisionId()}opt.body=JSON.stringify(body);
}
function prepareEquipmentDivision(x){formDivisionId=x.division_id??activeDivisionId()}
function divisionDefaultInterval(){return divisionData.find(d=>d.id===formDivisionId)?.service_interval_hours??100}
function divisionCategoryOptions(){return divisionData.find(d=>d.id===formDivisionId)?.categories||['Mower','Blower','Weed Eater','Chainsaw','Misc Small Power']}
function divisionEquipmentFields(x){return x.id?`<input type="hidden" name="expected_division_id" value="${x.division_id}"><label class="wide"><span>Division</span><input readonly value="${esc(divisionName(x.division_id))}"></label>`:`<label class="wide"><span>Division</span><select name="division_id" required>${divisionOptions(formDivisionId,true)}</select></label>`}
function wireEquipmentDivisionForm(x){
 if(x.id)return;
 const form=$('#eqform'),choice=form.elements.division_id;
 choice.value=formDivisionId===null?'':String(formDivisionId);
 choice.onchange=async()=>{
  formDivisionId=choice.value===''?null:Number(choice.value);
  const submit=form.querySelector('button:not([type])');submit.disabled=true;
  try{if(formDivisionId!==null){await loadTrailerOptions(formDivisionId);form.elements.crew_assigned.innerHTML=crewOptions();form.elements.trailer_assigned.innerHTML=trailerAssignmentOptions();form.elements.category.innerHTML=divisionCategoryOptions().map(name=>`<option>${esc(name)}</option>`).join('');form.elements.service_interval_hours.value=divisionDefaultInterval()}}
  catch(error){toast(error.message)}finally{submit.disabled=false}
 };
}
async function divisionSetup(){
 if(!await requestEditAccess())return;
 const id=await selectOneDivision('Each division has its own equipment categories, service defaults, crews, and trailers.');if(id===null)return;
 const division=divisionData.find(d=>d.id===id);
 modal(`<div class="paneltitle"><h2>${esc(division.name)} setup</h2><button class="secondary close">×</button></div><form id="divisionSetupForm"><label>Default oil service interval (hours)<input type="number" name="interval" min="0.1" step="0.1" value="${division.service_interval_hours}" required></label><label>Equipment categories (one per line)<textarea name="categories" rows="7" required>${esc(division.categories.join('\n'))}</textarea></label><p class="meta">Defaults apply to newly added equipment. Existing equipment keeps its service settings. Add crews and manage trailers within this division.</p><p id="divisionSetupError" role="alert"></p><div class="formactions"><button type="button" class="secondary close">Cancel</button><button>Save setup</button></div></form>`,'narrow');
 $('#divisionSetupForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button:not([type])');button.disabled=true;try{const data=new FormData(e.target);await api('/divisions/'+id,{method:'PUT',body:JSON.stringify({service_interval_hours:Number(data.get('interval')),categories:data.get('categories').split('\n').map(s=>s.trim()).filter(Boolean)})});divisionData=await api('/divisions');closeModal();await dashboard();toast('Division setup saved')}catch(error){$('#divisionSetupError').textContent=error.message;button.disabled=false}};
}
async function transferDivision(items){
 if(!items.length||items.length>100)return;
 rememberWorkspace();if(!await requestEditAccess())return;
 if(!['Manager','Editor'].includes(accessRole)){toast('Use a manager PIN to move equipment.');return}
 const destinations=divisionData.filter(d=>!items.every(x=>x.division_id===d.id));
 modal(`<div class="paneltitle"><h2>Move to division</h2><button class="secondary close" aria-label="Close">×</button></div><form id="divisionTransferForm"><p>${items.length===1?`<b>${esc(items[0].tag_id)} · ${esc(items[0].name)}</b>`:items.length+' selected machines'}</p><label>New division<select name="division_id" required><option value="">Choose a division…</option>${destinations.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label><p id="divisionTransferPreview" class="meta" aria-live="polite">Choose a division. Equipment will be placed in its Unassigned group, with no crew or trailer.</p><p class="meta">History, status, and service settings stay with the equipment.</p><details class="assignment-more"><summary>Handoff note (optional)</summary><textarea name="note" maxlength="1000" rows="2" aria-label="Handoff note"></textarea></details><label class="location-toggle"><input type="checkbox" name="open_destination" checked> Open the new division’s Unassigned group</label><p id="divisionTransferError" role="alert"></p><div class="formactions"><button type="button" class="secondary close">Cancel</button><button disabled>Move equipment</button></div></form>`,'narrow');
 const form=$('#divisionTransferForm'),button=form.querySelector('button:not([type])');
 form.elements.division_id.onchange=()=>{const value=form.elements.division_id.value;button.disabled=value==='';$('#divisionTransferPreview').textContent=value===''?'Choose a division. Equipment will be placed in its Unassigned group, with no crew or trailer.':`${items.length===1?'This machine':items.length+' machines'} → ${divisionName(Number(value))} → Unassigned. Crew and trailer assignments will be cleared for machines changing division.`};
 form.onsubmit=async e=>{
  e.preventDefault();if(button.disabled||form.elements.division_id.value==='')return;button.disabled=true;button.textContent='Moving…';$('#divisionTransferError').textContent='';
  try{
   const data=new FormData(form),id=Number(data.get('division_id'));
   const result=await api('/division-transfers',{method:'POST',body:JSON.stringify({division_id:id,clear_assignments:true,note:data.get('note'),items:items.map(x=>({tag_id:x.tag_id,division_id:x.division_id,crew_assigned:x.crew_assigned||'',trailer_assigned:x.trailer_assigned||'',location:x.location||''}))})});
   workspaceSelected.clear();rememberWorkspace();divisionData=await api('/divisions');closeModal();
   if(data.get('open_destination')){await setDivisionSelection([id],false);localStorage.setItem('equiptags-workspace','manager');sessionStorage.setItem('equiptags-view-manager-'+divisionSelectionKey(),JSON.stringify({crew:'',search:'',filter:'all',sort:'name',selected:[],scroll:0}))}
   await dashboard();toast(`${result.updated} ${result.updated===1?'machine moved':'machines moved'} to ${divisionName(id)} · Unassigned`);
  }catch(error){$('#divisionTransferError').textContent=error.message;button.disabled=false;button.textContent='Move equipment'}
 };
}
function showEquipmentDivision(x){
 if(!divisionSelection?.includes(x.division_id)){divisionSelection=[x.division_id];localStorage.setItem('equiptags-divisions',JSON.stringify(divisionSelection));renderDivisionHeader()}
 const identifiers=document.querySelector('.detail-identifiers');if(identifiers)identifiers.insertAdjacentHTML('afterbegin',`<div class="detail-assignment"><span>Division</span><strong>${esc(divisionName(x.division_id))}</strong></div>`);
}
