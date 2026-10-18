function photoPickerMarkup(){return '<div class="report-photos"><label>Photos (optional, up to 3)<input class="photo-input" type="file" accept="image/*" multiple></label><p class="meta">Take a photo or choose from your phone. Photos are resized before uploading.</p><div class="photo-previews"></div><p class="photo-error" role="alert"></p></div>'}
function bindPhotoPicker(form){
 const input=form.querySelector('.photo-input');if(!input)return;form.reportPhotos=[];form.photosBusy=false;
 input.onchange=async()=>{form.photosBusy=true;const error=form.querySelector('.photo-error');error.textContent='';try{
 if(input.files.length+form.reportPhotos.length>3)throw Error('Choose up to three photos.');
 const added=[];for(const file of input.files){if(file.size>25000000)throw Error('Choose a photo smaller than 25 MB.');const url=URL.createObjectURL(file);try{const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('This photo could not be opened. Choose JPEG, PNG or WebP.'));image.src=url});const canvas=document.createElement('canvas');let encoded;for(const [size,quality] of [[1280,.78],[960,.65],[640,.5]]){const scale=Math.min(1,size/Math.max(img.width,img.height));canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);encoded=canvas.toDataURL('image/jpeg',quality).split(',')[1];if(encoded.length<=546132)break}if(encoded.length>546132)throw Error('Photo is too large after resizing. Choose a smaller photo.');added.push({type:'image/jpeg',data:encoded})}finally{URL.revokeObjectURL(url)}}
 form.reportPhotos.push(...added);draw();}catch(e){error.textContent=e.message}finally{input.value='';form.photosBusy=false}};
 function draw(){form.querySelector('.photo-previews').innerHTML=form.reportPhotos.map((p,i)=>`<div><img alt="Attached photo ${i+1}" src="data:${p.type};base64,${p.data}"><button type="button" class="secondary" data-remove="${i}">Remove photo ${i+1}</button></div>`).join('');form.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{form.reportPhotos.splice(Number(b.dataset.remove),1);draw()})}
}
function ticketPhotoMarkup(ticket,updateId=null){return (ticket.photos||[]).filter(p=>p.update_id===updateId).map(p=>`<a class="ticket-photo" href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" loading="lazy" alt="Problem report photo — open full size"></a>`).join('')}
function quickRepairButtons(ticket,tag,more=''){return `<span class="quick-repairs">${ticket.status!=='With Mechanic'?`<button class="secondary quick-repair" data-action="With Mechanic" data-ticket="${ticket.id}" data-tag="${esc(tag)}">Start repair</button>`:''}${ticket.status!=='Awaiting Parts'?`<button class="secondary quick-repair" data-action="Awaiting Parts" data-ticket="${ticket.id}" data-tag="${esc(tag)}">Waiting for parts</button>`:''}${more}<button class="secondary quick-repair" data-action="complete" data-ticket="${ticket.id}" data-tag="${esc(tag)}">Complete</button></span>`}
function bindQuickRepairs(container,tickets,onSaved){container.querySelectorAll('.quick-repair').forEach(button=>button.onclick=async()=>{
 if(!await requestEditAccess())return;if(!['Manager','Mechanic'].includes(accessRole)){toast('A manager or mechanic PIN is required.');return}
 const ticket=tickets.find(t=>t.id===Number(button.dataset.ticket));if(!ticket)return;
 if(button.dataset.action==='complete'){updateTicketModal({tag_id:button.dataset.tag,name:ticket.equipment_name||ticket.name||''},ticket,onSaved);const form=$('#ticketUpdateForm');form.elements.status.value='In Service';form.elements.status.dispatchEvent(new Event('change'));form.elements.notes.focus();return}
 button.disabled=true;try{await api('/equipment/'+encodeURIComponent(button.dataset.tag)+'/tickets/'+ticket.id,{method:'PUT',body:JSON.stringify({status:button.dataset.action,notes:button.dataset.action==='With Mechanic'?'Repair started.':'Waiting for parts.',expected_revision:ticket.revision})});toast('Repair updated');await onSaved()}catch(error){toast(error.message);await onSaved()}finally{button.disabled=false}
})}

function revealRepairTicket(id,updateAddress=false){
 const record=document.getElementById('repair-ticket-'+id);if(!record)return;
 for(let element=record;element;element=element.parentElement)if(element.tagName==='DETAILS')element.open=true;
 if(updateAddress)history.replaceState(null,'','#repair-ticket-'+id);
 record.querySelector('summary')?.focus({preventScroll:true});record.scrollIntoView({block:'start'});
}
function bindTicketLinks(){
 document.querySelectorAll('a[href^="#repair-ticket-"]').forEach(link=>link.onclick=event=>{event.preventDefault();const match=link.getAttribute('href').match(/^#repair-ticket-(\d+)$/);if(match)revealRepairTicket(match[1],true)});
 const match=location.hash.match(/^#repair-ticket-(\d+)$/);if(match)revealRepairTicket(match[1]);
}
