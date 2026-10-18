let setupRequest=0;
const SETUP_PATH='/equiptags/crews-trailers';
function setupTab(){return new URLSearchParams(location.search).get('tab')==='trailers'?'trailers':'crews'}
async function crewsTrailersPage(tab=setupTab(),navigate=true){
 tab=tab==='trailers'?'trailers':'crews';rememberWorkspace();
 const path=SETUP_PATH+'?tab='+tab;
 if(navigate&&location.pathname!==SETUP_PATH)history.pushState(null,'',path);else history.replaceState(null,'',path);
 workspaceNavigation();const request=++setupRequest,id=activeDivisionId();
 const heading=`<section class="hero"><div><a class="setup-back" href="/equiptags/">← Manager review</a><h1>Crews &amp; trailers</h1><p class="subtitle">Create crews and trailers for equipment assignments.</p></div></section>`;
 const back=()=>{document.querySelector('.setup-back').onclick=e=>{e.preventDefault();localStorage.setItem('equiptags-workspace','manager');dashboard()}};
 if(id===null){
  $('#app').innerHTML=heading+`<section class="setup-intro"><h2>Choose one division to manage</h2><p>Crews and trailers belong to a single division.</p><label for="setupDivision">Division</label><select id="setupDivision"><option value="">Choose a division…</option>${divisionOptions(null)}</select></section>`;back();
  $('#setupDivision').onchange=async e=>{if(e.target.value==='')return;await setDivisionSelection([Number(e.target.value)],false);await crewsTrailersPage(tab,false)};return;
 }
 if(!(accessRole==='Manager')||Date.now()>=accessExpires){
  $('#app').innerHTML=heading+`<section class="setup-intro"><h2>${esc(divisionName(id))}</h2><p>A manager PIN is needed to add or manage crews and trailers.</p><button id="setupSignIn" class="secondary">${accessRole?'Switch to manager PIN':'Sign in as manager'}</button><p id="setupAccessError" role="alert"></p></section>`;back();
  $('#setupSignIn').onclick=async()=>{if(accessRole&&!(accessRole==='Manager')){pin='';actorName='';accessRole='';accessExpires=0;updateIdentity()}if(!await requestEditAccess())return;if(!(accessRole==='Manager')){$('#setupAccessError').textContent='Use a manager PIN to manage crews and trailers.';return}await crewsTrailersPage(tab,false)};return;
 }
 $('#app').innerHTML=heading+'<p class="loading">Loading crews and trailers…</p>';back();
 try{
  const [crews,trailers,equipment]=await Promise.all([api('/crew-options?divisions='+id),api('/trailer-options?divisions='+id),api('/equipment?divisions='+id)]);
  if(request!==setupRequest||location.pathname!==SETUP_PATH||activeDivisionId()!==id)return;
  const isCrew=tab==='crews',singular=isCrew?'crew':'trailer',items=isCrew?crews:trailers;
  const count=row=>isCrew?equipment.filter(x=>(x.crew_assigned||'').toLowerCase()===row.name.toLowerCase()).length:row.assigned_count;
  $('#app').innerHTML=heading+`<p class="setup-scope">Managing <strong>${esc(divisionName(id))}</strong> · Change division in the header.</p><div class="setup-tabs" aria-label="Manage crews or trailers"><button data-setup-tab="crews" class="${isCrew?'selected':'secondary'}" aria-pressed="${isCrew}">Crews (${crews.length})</button><button data-setup-tab="trailers" class="${isCrew?'secondary':'selected'}" aria-pressed="${!isCrew}">Trailers (${trailers.length})</button></div><section class="setup-add"><h2>Add a ${singular}</h2><form id="setupAddForm"><label for="setupName">${isCrew?'Crew name':'Trailer name or number'}<input id="setupName" name="name" maxlength="100" required autocomplete="off" placeholder="${isCrew?'e.g. Crew 3':'e.g. Trailer 02'}"></label><button class="secondary">Add ${singular}</button></form><p class="meta">New ${tab} are added to ${esc(divisionName(id))} and become available when assigning equipment.</p><p id="setupFormError" role="alert"></p><p id="setupSaved" role="status"></p></section><section class="setup-existing" aria-labelledby="setupListHeading"><div class="setup-list-heading"><h2 id="setupListHeading">${isCrew?'Crews':'Trailers'} in ${esc(divisionName(id))}</h2><label><span class="sr-only">Find ${singular}</span><input id="setupSearch" type="search" placeholder="Find ${singular}"></label></div><div class="setup-list-columns" aria-hidden="true"><span>Name</span><span>Equipment</span><span>Actions</span></div><ul id="setupList" class="setup-list"></ul></section>${isCrew?'':'<p><a href="/equiptags/trailers" id="setupTrailerAssignments">Review trailer assignments and exports →</a></p>'}`;
  back();document.querySelectorAll('[data-setup-tab]').forEach(button=>button.onclick=()=>crewsTrailersPage(button.dataset.setupTab,false));
  const stillHere=()=>location.pathname===SETUP_PATH&&activeDivisionId()===id&&request===setupRequest;
  const draw=()=>{
   const query=$('#setupSearch').value.trim().toLowerCase(),shown=items.filter(row=>row.name.toLowerCase().includes(query));
   $('#setupList').innerHTML=shown.length?shown.map(row=>`<li class="setup-row" data-id="${row.id}"><strong>${esc(row.name)}</strong><span>${count(row)} assigned</span><div class="actions"><button class="secondary setup-view" data-id="${row.id}">View equipment</button><button class="secondary setup-rename" data-id="${row.id}">Rename</button>${isCrew?'':`<button class="secondary setup-delete" data-id="${row.id}">Remove</button>`}</div></li>`).join(''):`<li class="setup-empty">${query?'No '+tab+' match your search.':'No '+tab+' yet. Add your first '+singular+' above.'}</li>`;
   document.querySelectorAll('.setup-view').forEach(button=>button.onclick=async()=>{
    const row=items.find(item=>item.id===Number(button.dataset.id));
    if(isCrew){localStorage.setItem('equiptags-workspace','manager');sessionStorage.setItem('equiptags-view-manager-'+divisionSelectionKey(),JSON.stringify({crew:row.name,search:'',filter:'all',sort:'name',selected:[],scroll:0}));await dashboard()}
    else{await trailersPage();if($('#trailerView')){$('#trailerView').value=row.name;updateSelectedTrailerExport();drawTrailerCards()}}
   });
   document.querySelectorAll('.setup-rename').forEach(button=>button.onclick=()=>editSetupName(items.find(item=>item.id===Number(button.dataset.id)),false));
   document.querySelectorAll('.setup-delete').forEach(button=>button.onclick=()=>editSetupName(items.find(item=>item.id===Number(button.dataset.id)),true));
  };
  const editSetupName=(row,remove)=>{
   const li=[...document.querySelectorAll('.setup-row')].find(el=>el.dataset.id===String(row.id));
   li.innerHTML=`<form class="setup-inline-form">${remove?`<p>Remove <b>${esc(row.name)}</b>? ${count(row)?count(row)+' equipment will have no trailer assignment.':'No equipment is assigned to it.'}</p>`:`<label>New ${singular} name<input name="name" value="${esc(row.name)}" maxlength="100" required></label>`}<div class="actions"><button type="button" class="secondary setup-cancel">Cancel</button><button class="${remove?'danger':'secondary'}">${remove?'Remove trailer':'Save name'}</button></div><p class="setup-row-error" role="alert"></p></form>`;
   li.querySelector('.setup-cancel').onclick=draw;li.querySelector('input')?.focus();
   li.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const form=e.target,button=form.querySelector('button:not([type])');if(button.disabled)return;button.disabled=true;
    try{if(!await requestEditAccess()){button.disabled=false;return}if(!stillHere())return;await api((isCrew?'/crew-options/':'/trailer-options/')+row.id,{method:remove?'DELETE':'PUT',...(remove?{}:{body:JSON.stringify({name:form.elements.name.value})})});if(stillHere()){if(isCrew&&!remove){for(const mode of ['crew','manager','mechanic','inventory']){const key='equiptags-view-'+mode+'-'+id;try{const state=JSON.parse(sessionStorage.getItem(key)||'null');if(state?.crew===row.name){state.crew=form.elements.name.value.trim();sessionStorage.setItem(key,JSON.stringify(state))}}catch{}}if(localStorage.getItem('equiptags-crew-'+id)===row.name)localStorage.setItem('equiptags-crew-'+id,form.elements.name.value.trim())}await crewsTrailersPage(tab,false);$('#setupSaved').textContent=remove?'Trailer removed.':(isCrew?'Crew':'Trailer')+' name updated, including equipment assignments.'}}
    catch(error){if(stillHere()){li.querySelector('.setup-row-error').textContent=error.message;button.disabled=false}}
   };
  };
  $('#setupSearch').oninput=draw;draw();
  if($('#setupTrailerAssignments'))$('#setupTrailerAssignments').onclick=e=>{e.preventDefault();trailersPage()};
  $('#setupAddForm').onsubmit=async e=>{
   e.preventDefault();const form=e.target,button=form.querySelector('button');if(button.disabled)return;const name=form.elements.name.value.trim();if(!name){$('#setupFormError').textContent='Enter a '+singular+' name.';return}button.disabled=true;$('#setupFormError').textContent='';
   try{if(!await requestEditAccess()){button.disabled=false;return}if(!(accessRole==='Manager'))throw Error('Use a manager PIN to add '+tab+'.');if(!stillHere())return;
    await api(isCrew?'/crew-options':'/trailer-options',{method:'POST',body:JSON.stringify({name,division_id:id})});if(stillHere()){await crewsTrailersPage(tab,false);$('#setupSaved').textContent=name+' added to '+divisionName(id)+'.';$('#setupName').focus()}
   }catch(error){if(stillHere()){$('#setupFormError').textContent=error.message;button.disabled=false;form.elements.name.focus()}}
  };
 }catch(error){if(request!==setupRequest||location.pathname!==SETUP_PATH)return;$('#app').innerHTML=heading+`<p role="alert">${esc(error.message)}</p><button id="setupRetry" class="secondary">Try again</button>`;back();$('#setupRetry').onclick=()=>crewsTrailersPage(tab,false)}
}
