(async()=>{
 try{
  const response=await fetch('/equiptags-api/company');if(!response.ok)return;
  const {name}=await response.json();if(!name)return;
  const label=document.querySelector('.brand small');if(label)label.textContent=name;
  document.title=name+' | '+document.title;
 }catch{} // Static generic branding remains usable if metadata is temporarily unavailable.
})();
