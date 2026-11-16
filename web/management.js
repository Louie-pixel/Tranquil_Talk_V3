"use strict";
const managed={epoch:0,next:{clinics:null,events:null}};
const manageConfig={clinics:{form:"managed-clinic-form",list:"managed-clinics",status:"managed-clinic-status",more:"more-managed-clinics"},events:{form:"managed-event-form",list:"managed-events",status:"managed-event-status",more:"more-managed-events"}};
function canManage(kind){return !!account && (account.role==="admin" || (kind==="clinics" && account.role==="expert"));}
function resetManagedEditor(kind){const form=$(manageConfig[kind].form);form.reset();form.elements.id.value="";form.elements.revision.value="0";status(manageConfig[kind].status,"");}
function editManaged(kind,item){
    const form=$(manageConfig[kind].form);resetManagedEditor(kind);form.elements.id.value=item.id;form.elements.revision.value=item.revision;
    if(kind==="clinics"){
        for(const key of ["name","address","suburb","city","country","phone","website"])form.elements[key].value=item[key] || "";
        form.elements.lat.value=item.location?.coordinates?.[1] ?? "";form.elements.lng.value=item.location?.coordinates?.[0] ?? "";
    }else{
        for(const key of ["title","description","location"])form.elements[key].value=item[key] || "";
        const date=new Date(item.startsAt);if(!Number.isNaN(date.getTime()))form.elements.start.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
    }
    status(manageConfig[kind].status,item.archived ? "Save this record to restore its public listing. Events need a future date." : "Editing the selected record. Save to publish the update.");
    form.scrollIntoView({block:"start",behavior:"smooth"});form.querySelector('input:not([type="hidden"])').focus();
}
async function archiveManaged(kind,item){
    if(!window.confirm("Archive this "+(kind==="clinics" ? "clinic listing" : "event")+"? It will be hidden publicly. You can restore it from this workspace."))return;
    await api("/manage/"+kind+"/"+item.id,{method:"DELETE",authenticated:true,body:{revision:item.revision}});await loadManaged(kind);
    if(kind==="events")loadEvents();
}
function managedCard(kind,item){
    const card=make("article",undefined,"managed-card");card.append(make("span",item.archived ? "Archived" : "Published","status-pill"),make("h4",kind==="clinics" ? item.name : item.title));
    card.append(make("p",kind==="clinics" ? [item.address,item.city].filter(Boolean).join(", ") : dateLabel(item.startsAt)+" / "+item.location,"fine"));
    const actions=make("div",undefined,"actions");const edit=make("button",item.archived ? "Edit and restore" : "Edit","secondary small");edit.type="button";edit.addEventListener("click",()=>editManaged(kind,item));actions.append(edit);
    if(!item.archived){const archive=make("button","Archive","secondary small");archive.type="button";archive.addEventListener("click",async()=>{archive.disabled=true;try{await archiveManaged(kind,item);}catch(error){status(manageConfig[kind].status,error.message,true);}finally{archive.disabled=false;}});actions.append(archive);}
    card.append(actions);return card;
}
async function loadManaged(kind,append=false){
    if(!canManage(kind))return;
    const epoch=managed.epoch,id=account.id,config=manageConfig[kind];
    if(append && managed.next[kind]===null)return;
    status(config.status,"Loading "+kind+"...");
    try{
        const data=await api("/manage/"+kind+(append ? "?offset="+managed.next[kind] : ""),{authenticated:true});
        if(epoch!==managed.epoch || id!==account?.id)return;
        if(!Array.isArray(data.items))throw new Error("Records could not be loaded.");
        if(!append)$(config.list).replaceChildren();for(const item of data.items)$(config.list).append(managedCard(kind,item));
        managed.next[kind]=Number.isInteger(data.nextOffset) ? data.nextOffset : null;$(config.more).hidden=managed.next[kind]===null;
        status(config.status,$(config.list).childElementCount ? "" : "No records yet. Add accurate details using the form above.");
    }catch(error){if(epoch===managed.epoch)status(config.status,error.message,true);}
}
function managementAccountChanged(){
    ++managed.epoch;
    $("clinic-management").hidden=!canManage("clinics");$("event-management").hidden=!canManage("events");
    $("local-mail-notice").hidden=!(account?.developmentMailbox && ["localhost","127.0.0.1"].includes(location.hostname));
    for(const kind of ["clinics","events"]){resetManagedEditor(kind);$(manageConfig[kind].list).replaceChildren();managed.next[kind]=null;$(manageConfig[kind].more).hidden=true;if(canManage(kind))loadManaged(kind);}
}
for(const kind of ["clinics","events"]){
    const config=manageConfig[kind];
    $(config.form).addEventListener("submit",event=>formAction(event,config.status,async(values,form)=>{
        const editing=values.id;const payload={...values,revision:Number(values.revision),archived:false};delete payload.id;
        if(kind==="clinics"){payload.lat=Number(values.lat);payload.lng=Number(values.lng);}else{payload.startAt=new Date(values.start).getTime()/1000;delete payload.start;}
        await api("/manage/"+kind+(editing ? "/"+editing : ""),{method:editing ? "PUT" : "POST",authenticated:true,body:payload});
        resetManagedEditor(kind);await loadManaged(kind);status(config.status,kind==="clinics" ? "Clinic listing saved." : "Community event saved.");if(kind==="events")loadEvents();
    }));
    $(config.more).addEventListener("click",()=>loadManaged(kind,true));
}
$("refresh-managed-clinics").addEventListener("click",()=>loadManaged("clinics"));$("refresh-managed-events").addEventListener("click",()=>loadManaged("events"));
$("reset-clinic-editor").addEventListener("click",()=>resetManagedEditor("clinics"));$("reset-event-editor").addEventListener("click",()=>resetManagedEditor("events"));
window.addEventListener("tranquil-account",managementAccountChanged);window.addEventListener("pagehide",()=>{++managed.epoch;});managementAccountChanged();
