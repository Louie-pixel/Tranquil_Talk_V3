"use strict";
const workspace={booking:null,slots:[],bookingEpoch:0,bookingDay:null,appointmentsEpoch:0,items:[],filter:"upcoming",day:null,clockOffset:0,appointment:null,rtc:null,ws:null,ticket:null,config:null,rtcEpoch:0,timer:null,actionToken:null,action:null,audioContext:null,meterFrame:null};
let timeZone=careTime.zone(),lastScreen=null;
const timeLabel=seconds=>careTime.label(seconds);
const serverNow=()=>Date.now()/1000+workspace.clockOffset;
function appRoute(){
    const raw=location.hash.slice(1);let page=raw.startsWith("expert/") ? "experts" : raw.startsWith("account/") ? "account" : raw.split("?")[0] || (account ? "home" : "signin");
    if(page==="register")page="signup";
    if(!["signin","signup","home","experts","care","connect","professional","verification","appointments","stories","events","account"].includes(page))page=account ? "home" : "signin";
    if(page==="home" && !account && !previewExploring)page="signin";if(account && ["signin","signup"].includes(page))page="home";if(page==="verification" && account?.role!=="admin")page="account";
    const entry=["signin","signup"].includes(page);document.body.dataset.screen=page;
    $("app-menu").hidden=entry;$("account-button").hidden=entry;$("logout").hidden=entry || !account;$("auth-navigation").hidden=!entry;$("route-label").hidden=entry;
    document.querySelector("footer").hidden=entry;document.querySelector(".support-note").hidden=entry;
    for(const section of document.querySelectorAll("main > section"))section.hidden=section.id!==page;document.querySelector(".intro-strip").hidden=page!=="home";
    for(const link of document.querySelectorAll("nav a")){if(link.hash==="#"+page)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");}
    const labels={signin:"Sign in",signup:"Create account",home:"Home",experts:"Find an expert",care:"Nearby clinics",connect:"Conversations",professional:"Professional profile",verification:"Verification",appointments:"Appointments",stories:"Resources",events:"Community",account:"Account"};
    $("route-label").textContent="YOUR SPACE / "+labels[page].toUpperCase();document.title=labels[page]+" | Tranquil Talk";
    if(page==="appointments")loadAppointments();if(page==="account"){renderAccountPage();readActionLink();}
    if(lastScreen!==page){$("navigation-announcement").textContent=labels[page]+" page";if(lastScreen && !document.querySelector("dialog[open]")){const heading=$(page).querySelector("h1,h2");if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}window.scrollTo({top:0,behavior:"instant"});}
    if(page!=="appointments" && $("consultation-dialog").open)closeConsultation();lastScreen=page;window.dispatchEvent(new CustomEvent("tranquil-route",{detail:page}));
}
window.addEventListener("hashchange",appRoute);
function renderAccountPage(){
    $("email-state").textContent=!account ? "Sign in to manage your account." : account.emailVerified ? "Your email is verified. You can book and manage appointments." : "Verify your email before booking or managing availability.";
    $("request-verification").disabled=!account || account.emailVerified;$("moderation-workspace").hidden=account?.role!=="admin";if(account?.role==="admin")loadReports();
}
window.addEventListener("tranquil-account",()=>{
    timeZone=careTime.zone();++workspace.bookingEpoch;++workspace.appointmentsEpoch;workspace.items=[];workspace.day=null;workspace.clockOffset=0;
    $("appointment-list").replaceChildren();$("own-slots").replaceChildren();$("moderation-list").replaceChildren();$("report-form").reset();$("delete-account-form").reset();$("booking-form").reset();$("appointment-query").value="";appointmentCalendar.setDates([]);$("next-appointment").hidden=true;for(const id of ["upcoming-count","response-count"])$(id).textContent="—";
    closeConsultation();if($("booking-dialog").open)$("booking-dialog").close();if($("appointment-confirmation").open)$("appointment-confirmation").close("back");renderAccountPage();
    $("availability-workspace").hidden=account?.role!=="expert";queueMicrotask(appRoute);
});
window.reportItem=(type,id)=>{if($("expert-dialog").open)$("expert-dialog").close();$("report-form").elements.targetType.value=type;$("report-form").elements.targetId.value=id;location.hash="account";requestAnimationFrame(()=>$("report-form").elements.reason.focus());};
const bookingCalendar=new TranquilCalendar($("booking-calendar"),{label:"Available appointment dates",onSelect:key=>{workspace.bookingDay=key;$("booking-slot").value="";renderBookingTimes();}});
const appointmentCalendar=new TranquilCalendar($("appointment-calendar"),{label:"Your appointment dates",onSelect:key=>{workspace.day=key;renderAppointments();}});
window.openBooking=async profile=>{
    if(!account){$("expert-dialog").close();openAuth();return;}if(account.role!=="patient"){status("expert-detail-status","Use a patient account to request support.",true);return;}if(!account.emailVerified){$("expert-dialog").close();location.hash="account";return;}
    workspace.booking=profile;workspace.slots=[];workspace.bookingDay=null;$("expert-dialog").close();$("booking-dialog").showModal();$("booking-form").reset();$("booking-mode").replaceChildren();
    $("booking-expert").textContent=profile.name+" · 30-minute consultations";$("booking-zone").textContent=careTime.zone();
    for(const method of profile.methods || []){const option=make("option",methodNames[method]);option.value=method;$("booking-mode").append(option);}await refreshBookingSlots();
};
async function refreshBookingSlots(){
    if(!workspace.booking || !$("booking-dialog").open)return;const epoch=++workspace.bookingEpoch,owner=account?.id;$("booking-submit").disabled=true;$("refresh-booking").disabled=true;$("booking-calendar").setAttribute("aria-busy","true");status("booking-status","Loading available times...");
    try{const data=await api("/availability/"+encodeURIComponent(workspace.booking.id));if(epoch!==workspace.bookingEpoch || owner!==account?.id)return;if(!Array.isArray(data.items))throw new Error("Available times could not be loaded.");workspace.slots=data.items.filter(s=>typeof s.id==="string" && Number.isFinite(s.startAt)).sort((a,b)=>a.startAt-b.startAt);fillBookingSlots();}
    catch(error){if(epoch===workspace.bookingEpoch){workspace.slots=[];fillBookingSlots();status("booking-status",error.message+" Use refresh to try again.",true);}}
    finally{if(epoch===workspace.bookingEpoch){$("refresh-booking").disabled=false;$("booking-calendar").removeAttribute("aria-busy");}}
}
function filteredSlots(){return workspace.slots.filter(s=>s.startAt>serverNow()+300 && ($("booking-mode").value!=="in_person" || s.location));}
function fillBookingSlots(){
    const slots=filteredSlots(),keys=slots.map(s=>careTime.dateKey(s.startAt));if(!keys.includes(workspace.bookingDay))workspace.bookingDay=keys[0] || null;
    bookingCalendar.setDates(slots.map(s=>s.startAt),{selected:workspace.bookingDay});$("booking-zone").textContent=careTime.zone();renderBookingTimes();
    status("booking-status",slots.length ? "Select an available day, then a time. The professional will review your request." : "No available times for this method. Try another method or refresh later.");
}
function renderBookingTimes(){
    const root=$("booking-times"),selected=$("booking-slot").value;root.replaceChildren();const slots=filteredSlots().filter(s=>careTime.dateKey(s.startAt)===workspace.bookingDay);
    if(!slots.some(s=>s.id===selected))$("booking-slot").value="";
    for(const [index,slot] of slots.entries()){
        const button=make("button",careTime.label(slot.startAt,{hour:"numeric",minute:"2-digit",timeZoneName:"shortOffset"}),"time-button");button.type="button";button.setAttribute("role","radio");button.setAttribute("aria-checked",String(slot.id===$("booking-slot").value));button.tabIndex=slot.id===$("booking-slot").value || (!$("booking-slot").value && index===0) ? 0 : -1;
        button.addEventListener("click",()=>{$("booking-slot").value=slot.id;renderBookingTimes();root.children[index]?.focus();});
        button.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;event.preventDefault();const next=(index+(["ArrowRight","ArrowDown"].includes(event.key) ? 1 : slots.length-1))%slots.length;$("booking-slot").value=slots[next].id;renderBookingTimes();root.children[next]?.focus();});root.append(button);
    }
    $("booking-time-heading").textContent=slots.length ? "Available times · "+careTime.label(slots[0].startAt,{weekday:"short",month:"short",day:"numeric"}) : "Available times";
    if(!slots.length)root.append(make("p","Choose a marked day to see its available times.","fine"));showBookingLocation();
}
function showBookingLocation(){const slot=workspace.slots.find(s=>s.id===$("booking-slot").value);$("booking-location").textContent=slot ? $("booking-mode").value==="in_person" ? slot.location : "Online consultation" : "";$("booking-summary").textContent=slot ? timeLabel(slot.startAt)+" · "+careTime.zone() : "Choose a day and time.";$("booking-submit").disabled=!slot;}
$("booking-mode").addEventListener("change",()=>{$("booking-slot").value="";fillBookingSlots();});$("refresh-booking").addEventListener("click",refreshBookingSlots);
function closeBooking(){++workspace.bookingEpoch;workspace.booking=null;$("booking-dialog").close();}
$("close-booking").addEventListener("click",closeBooking);$("booking-dialog").addEventListener("cancel",()=>{++workspace.bookingEpoch;workspace.booking=null;});
async function formAction(event,statusId,fn){event.preventDefault();const form=event.currentTarget,button=event.submitter || form.querySelector('[type="submit"]');if(button?.disabled)return;if(button)button.disabled=true;form.setAttribute("aria-busy","true");status(statusId,"Working...");try{await fn(Object.fromEntries(new FormData(form)),form);}catch(error){status(statusId,error.message,true);}finally{if(button)button.disabled=false;if(button?.id==="booking-submit")showBookingLocation();form.removeAttribute("aria-busy");}}
$("booking-form").addEventListener("submit",event=>formAction(event,"booking-status",async values=>{
    const owner=account?.id;if(!workspace.booking || !filteredSlots().some(s=>s.id===values.slotId))throw new Error("Choose an available time before sending your request.");
    try{await api("/appointments",{method:"POST",authenticated:true,body:{...values,expertId:workspace.booking.id}});}catch(error){if(error.status===409){await refreshBookingSlots();throw new Error("That time is no longer available. Choose another time from the refreshed calendar.");}throw error;}
    if(account?.id!==owner)return;closeBooking();location.hash="appointments";await loadAppointments();
}));
function actionButton(label,fn,secondary=true){const owner=account?.id,button=make("button",label,secondary ? "secondary small" : "small");button.type="button";button.addEventListener("click",async()=>{if(account?.id!==owner)return;button.disabled=true;try{await fn();}catch(error){status("appointments-status",error.message,true);}finally{button.disabled=false;}});return button;}
async function confirmAppointment(a,action){
    const dialog=$("appointment-confirmation");if(dialog.open)return false;dialog.returnValue="";$("appointment-confirm-title").textContent=action==="cancel" ? "Cancel this appointment?" : "Decline this time?";$("appointment-confirm-description").textContent=timeLabel(a.startAt)+" · "+methodNames[a.mode]+". This releases the reserved time. A new booking will need a new request.";$("appointment-confirm-proceed").textContent=action==="cancel" ? "Cancel appointment" : "Decline time";
    return new Promise(resolve=>{dialog.addEventListener("close",()=>resolve(dialog.returnValue==="proceed"),{once:true});dialog.showModal();});
}
async function decideAppointment(a,action,slotId){
    const owner=account?.id;if(["cancel","decline"].includes(action) && !await confirmAppointment(a,action))return;if(account?.id!==owner)return;
    try{await api("/appointments/"+encodeURIComponent(a.id)+"/"+action,{method:"POST",authenticated:true,body:{revision:a.revision,...(slotId ? {slotId} : {})}});}catch(error){if(error.status===409){await loadAppointments();throw new Error("This appointment changed. The list has been refreshed; review it before deciding again.");}throw error;}
    if(account?.id===owner){await loadAppointments();status("appointments-status",action==="propose" ? "Alternative time sent. The patient needs to accept it." : "Appointment updated.");}
}
async function proposeAppointment(a,card){
    const old=card.querySelector(".proposal");if(old){old.remove();return;}const owner=account?.id,response=await api("/availability/"+encodeURIComponent(a.expertId));if(account?.id!==owner || !card.isConnected)return;
    const form=make("form",undefined,"proposal"),label=make("label","Choose an alternative · "+careTime.zone()),select=make("select");select.required=true;
    for(const s of response.items || []){if(a.mode==="in_person" && !s.location)continue;const option=make("option",timeLabel(s.startAt));option.value=s.id;select.append(option);}label.append(select);
    const button=make("button","Send alternative","secondary small"),back=make("button","Keep current time","text-link small");button.type="submit";back.type="button";button.disabled=!select.options.length;back.addEventListener("click",()=>form.remove());form.append(label,make("p","The new time is reserved as a proposal and needs the patient's acceptance.","fine"),button,back);
    if(!select.options.length)form.append(make("p","Add another available slot in your availability workspace first.","fine"));
    form.addEventListener("submit",event=>formAction(event,"appointments-status",async()=>decideAppointment(a,"propose",select.value)));card.append(form);select.focus();
}
function needsResponse(a){return a.startAt>serverNow() && ((account?.id===a.expertId && a.status==="requested") || (account?.id!==a.expertId && a.status==="proposed"));}
function activeAppointment(a){return ["requested","proposed","accepted"].includes(a.status) && a.startAt+1800>serverNow();}
function appointmentCard(a){
    const expert=account.id===a.expertId,card=make("article",undefined,"panel appointment-card"),state=make("span",a.status.replaceAll("_"," "),"status-pill");state.dataset.state=a.status;card.dataset.appointment=a.id;
    const day=make("div",undefined,"appointment-date"),date=new Date(a.startAt*1000);day.append(make("strong",new Intl.DateTimeFormat(undefined,{day:"numeric",timeZone:careTime.zone()}).format(date)),make("span",new Intl.DateTimeFormat(undefined,{month:"short",timeZone:careTime.zone()}).format(date)));
    const heading=make("div",undefined,"appointment-card-head"),identity=make("div");identity.append(state,make("h3",expert ? a.alias : a.expertName));heading.append(identity,day);card.append(heading,make("p",timeLabel(a.startAt),"appointment-time"),make("p",methodNames[a.mode]+" · 30 minutes · "+careTime.zone(),"fine"));
    const explanations={requested:expert ? "A patient is waiting for your response." : "Request sent. Your professional needs to accept this time.",proposed:expert ? "Your alternative is waiting for the patient's response." : "Your professional suggested this time. Review and accept or decline it.",accepted:"Confirmed. This time is reserved for your appointment.",cancelled:"Cancelled. This time is no longer reserved.",declined:"Declined. You can request another available time."};
    card.append(make("p",explanations[a.status] || "Review the current appointment status.","appointment-note"));if(a.mode==="in_person")card.append(make("p",a.location,"venue"));
    const timeline=make("ol",undefined,"appointment-progress");timeline.setAttribute("aria-label","Appointment progress");for(const [label,current] of [["Requested",true],["Review",["proposed","accepted"].includes(a.status)],["Confirmed",a.status==="accepted"]]){const step=make("li",label);step.classList.toggle("complete",current);timeline.append(step);}if(["cancelled","declined"].includes(a.status))timeline.hidden=true;card.append(timeline);
    const actions=make("div",undefined,"actions"),future=a.startAt>serverNow();
    if(needsResponse(a))actions.append(actionButton(expert ? "Accept request" : "Accept new time",()=>decideAppointment(a,"accept"),false),actionButton("Decline",()=>decideAppointment(a,"decline")));
    if(expert && future && ["requested","accepted"].includes(a.status))actions.append(actionButton("Propose another time",()=>proposeAppointment(a,card)));
    if(a.status==="accepted" && a.mode!=="in_person" && a.startAt+1800>serverNow())actions.append(actionButton("Open waiting room",()=>openConsultation(a),false));
    if(a.status==="accepted" && a.mode==="in_person" && a.location){const link=make("a","Directions","button secondary small");link.href="https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(a.location);link.target="_blank";link.rel="noopener noreferrer";actions.append(link);}
    if(future && ["requested","proposed","accepted"].includes(a.status))actions.append(actionButton("Cancel appointment",()=>decideAppointment(a,"cancel")));
    if(a.status==="accepted")actions.append(actionButton("Add to calendar",()=>downloadAppointment(a)));
    const more=make("details",undefined,"appointment-more"),summary=make("summary","Appointment details");more.append(summary,make("p","Reference: "+a.id,"fine"),actionButton("Report concern",()=>window.reportItem("appointment",a.id)));card.append(actions,more);return card;
}
function renderAppointments(){
    if(!account)return;const query=$("appointment-query").value.trim().toLocaleLowerCase(),items=workspace.items;
    $("upcoming-count").textContent=String(items.filter(activeAppointment).length);$("response-count").textContent=String(items.filter(needsResponse).length);$("appointments-zone").textContent=careTime.zone();
    const next=items.filter(a=>a.status==="accepted" && a.startAt+1800>serverNow()).sort((a,b)=>a.startAt-b.startAt)[0];$("next-appointment").replaceChildren();$("next-appointment").hidden=!next;
    if(next){const text=make("div");text.append(make("p","YOUR NEXT CONFIRMED APPOINTMENT","eyebrow"),make("h3",account.id===next.expertId ? next.alias : next.expertName),make("p",timeLabel(next.startAt)+" · "+methodNames[next.mode]));$("next-appointment").append(text);if(next.mode!=="in_person")$("next-appointment").append(actionButton("Get ready",()=>openConsultation(next),false));}
    const shown=items.filter(a=>(workspace.filter==="all" || (workspace.filter==="upcoming" ? activeAppointment(a) : workspace.filter==="response" ? needsResponse(a) : !activeAppointment(a))) && (!workspace.day || careTime.dateKey(a.startAt)===workspace.day) && (!query || [a.alias,a.expertName].some(v=>String(v || "").toLocaleLowerCase().includes(query)))).sort((a,b)=>workspace.filter==="past" ? b.startAt-a.startAt : a.startAt-b.startAt);
    $("appointment-list").replaceChildren(...shown.map(appointmentCard));if(!shown.length){const empty=make("div",undefined,"clinic-empty");empty.append(make("h3",items.length ? "A little more room here." : "Your first conversation starts here."),make("p",items.length ? "No appointments match this view. Try another filter or show all dates." : "Find a professional and choose a time that works for you."));$("appointment-list").append(empty);}
    $("clear-appointment-day").hidden=!workspace.day;$("clear-appointment-day").textContent=workspace.day ? "Clear date: "+workspace.day : "Show all dates";
    document.querySelectorAll("#appointment-filters button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.filter===workspace.filter)));
    status("appointments-status",shown.length+" appointment"+(shown.length===1 ? "" : "s")+" shown"+(workspace.day ? " on "+workspace.day : "")+". Times in "+careTime.zone()+".");
}
async function loadAppointments(){
    const epoch=++workspace.appointmentsEpoch;$("availability-workspace").hidden=account?.role!=="expert";
    if(!account){$("appointment-list").replaceChildren();status("appointments-status","Sign in to see your appointments.");return;}
    const owner=account.id;$("appointment-list").setAttribute("aria-busy","true");status("appointments-status","Loading your appointments...");
    try{const data=await api("/appointments",{authenticated:true});if(epoch!==workspace.appointmentsEpoch || owner!==account?.id)return;if(!Array.isArray(data.items))throw new Error("Appointments could not be loaded.");
        workspace.items=data.items.filter(a=>a && typeof a.id==="string" && Number.isFinite(a.startAt));if(Number.isFinite(data.serverNow))workspace.clockOffset=data.serverNow-Date.now()/1000;
        appointmentCalendar.setDates(workspace.items.map(a=>a.startAt),{selected:workspace.day,preserveMonth:workspace.items.length>0 && !!workspace.day});renderAppointments();if(account.role==="expert")loadOwnSlots();
    }catch(error){if(epoch===workspace.appointmentsEpoch)status("appointments-status",error.message+" Refresh to try again.",true);}finally{if(epoch===workspace.appointmentsEpoch)$("appointment-list").removeAttribute("aria-busy");}
}
$("refresh-appointments").addEventListener("click",loadAppointments);$("appointment-query").addEventListener("input",renderAppointments);
document.querySelectorAll("#appointment-filters button").forEach(button=>button.addEventListener("click",()=>{workspace.filter=button.dataset.filter;renderAppointments();}));
$("clear-appointment-day").addEventListener("click",()=>{workspace.day=null;appointmentCalendar.setDates(workspace.items.map(a=>a.startAt),{preserveMonth:true});renderAppointments();});
async function loadOwnSlots(){const id=account?.id;if(!id)return;try{const data=await api("/availability/"+encodeURIComponent(id));if(account?.id!==id)return;$("own-slots").replaceChildren();
    for(const s of data.items || []){const row=make("div",undefined,"slot-row");row.append(make("span",timeLabel(s.startAt)+(s.location ? " · "+s.location : "")),actionButton("Remove",async()=>{await api("/availability/"+id,{method:"POST",authenticated:true,body:{startAt:s.startAt,remove:true}});await loadOwnSlots();}));$("own-slots").append(row);}if(!data.items?.length)$("own-slots").append(make("p","No unreserved availability yet.","fine"));
}catch(error){status("availability-status",error.message,true);}}
$("availability-form").addEventListener("submit",event=>formAction(event,"availability-status",async(values,form)=>{const id=account?.id;if(!id)throw new Error("Sign in first.");await api("/availability/"+id,{method:"POST",authenticated:true,body:{localStart:values.start,timeZone:values.timeZone,occurrence:values.occurrence,location:values.location}});if(account?.id!==id)return;form.elements.start.value="";status("availability-status","Available time added in "+values.timeZone+".");await loadOwnSlots();}));
function downloadAppointment(a){
    const stamp=seconds=>new Date(seconds*1000).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z"),escape=value=>String(value).replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
    const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//TranquilTalk//Appointments//EN","CALSCALE:GREGORIAN","BEGIN:VEVENT","UID:"+escape(a.id)+"@tranquil.local","DTSTAMP:"+stamp(Date.now()/1000),"DTSTART:"+stamp(a.startAt),"DTEND:"+stamp(a.startAt+1800),"SUMMARY:Private appointment","DESCRIPTION:Sign in to Tranquil Talk to review the current appointment status.","END:VEVENT","END:VCALENDAR"];
    const folded=lines.map(line=>line.match(/.{1,73}/g).join("\r\n ")).join("\r\n");
    const blob=new Blob([folded+"\r\n"],{type:"text/calendar;charset=utf-8"}),url=URL.createObjectURL(blob),link=make("a");link.href=url;link.download="private-appointment.ics";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status("appointments-status","Calendar file downloaded. Future changes are not automatically synced to your external calendar.");
}

$("request-verification").addEventListener("click",async()=>{
    $("request-verification").disabled=true;try{const r=await api("/account/request-verification",{method:"POST",authenticated:true,body:{}});status("verification-email-status",r.message);}
    catch(error){status("verification-email-status",error.message,true);}finally{$("request-verification").disabled=!account || account.emailVerified;}
});
$("refresh-account").addEventListener("click",async()=>{try{await refreshAccount();renderAccountPage();}catch(error){status("verification-email-status",error.message,true);}});
$("recovery-form").addEventListener("submit",event=>formAction(event,"recovery-status",async values=>{
    const r=await api("/account/request-reset",{method:"POST",body:values});status("recovery-status",r.message);
}));
function readActionLink() {
    const match=location.hash.match(/^#account\/(verify|reset)\/([A-Za-z0-9-]{64,100})$/);if(!match)return;
    workspace.action=match[1];workspace.actionToken=match[2];history.replaceState(null,"",location.pathname+location.search+"#account");
    $("account-action-panel").hidden=false;$("account-action-title").textContent=match[1]==="verify" ? "Verify your email" : "Choose a new password";
    $("new-password-label").hidden=match[1]!=="reset";$("account-action-form").elements.password.required=match[1]==="reset";
}
$("account-action-form").addEventListener("submit",event=>formAction(event,"account-action-status",async(values,form)=>{
    const r=await api("/account/"+workspace.action,{method:"POST",body:{token:workspace.actionToken,...values}});
    workspace.actionToken=null;form.reset();status("account-action-status",r.message);
    if(workspace.action==="reset")signOut();else if(account)await refreshAccount();
}));
$("delete-account-form").addEventListener("submit",event=>formAction(event,"delete-status",async(values,form)=>{
    const r=await api("/account/delete",{method:"POST",authenticated:true,body:values});form.reset();signOut();status("delete-status",r.message);
}));
$("report-form").addEventListener("submit",event=>formAction(event,"report-status",async(values,form)=>{
    const r=await api("/reports",{method:"POST",authenticated:true,body:values});form.reset();status("report-status",r.message);
}));
async function loadReports() {
    const id=account?.id;if(account?.role!=="admin")return;
    try {const data=await api("/reports",{authenticated:true});if(account?.id!==id || account?.role!=="admin")return;
        $("moderation-list").replaceChildren();for(const r of data.items || []){
            const card=make("article",undefined,"moderation-card");card.append(make("h4",r.targetType+" / "+r.targetId),make("p",r.reason),make("p",timeLabel(r.createdAt),"fine"));
            const form=make("form"),select=make("select");for(const action of ["dismiss",...(r.targetType==="article" ? ["remove"] : r.targetType==="expert" ? ["restrict"] : [])]){const option=make("option",action);option.value=action;select.append(option);}
            const label=make("label","Decision"),notes=make("textarea"),noteLabel=make("label","Private decision notes");notes.required=true;notes.minLength=10;notes.maxLength=1000;noteLabel.append(notes);label.append(select);
            const button=make("button","Record moderation decision","secondary");button.type="submit";form.append(label,noteLabel,button);
            form.addEventListener("submit",async event=>{event.preventDefault();button.disabled=true;try{await api("/reports/"+r.id,{method:"POST",authenticated:true,body:{action:select.value,note:notes.value}});await loadReports();}catch(error){status("moderation-status",error.message,true);button.disabled=false;}});
            card.append(form);$("moderation-list").append(card);
        }status("moderation-status",data.items?.length ? "" : "No open safety reports.");
    }catch(error){if(account?.id===id)status("moderation-status",error.message,true);}
}
$("refresh-reports").addEventListener("click",loadReports);


function consultationStep(step,label){
    $("consultation-state").textContent=label;for(const key of ["devices","waiting","connected"]){const el=$("step-"+key);if(key===step)el.setAttribute("aria-current","step");else el.removeAttribute("aria-current");}
}
function releaseConsultation(message="Your microphone and camera are off.",notify=false){
    ++workspace.rtcEpoch;workspace.entering=false;clearTimeout(workspace.timer);workspace.timer=null;
    if(workspace.ws){const ws=workspace.ws;workspace.ws=null;if(notify && ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"hangup"}));ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.close();}
    workspace.rtc?.end();workspace.rtc=null;workspace.ticket=null;workspace.audioContext?.close().catch(()=>{});workspace.audioContext=null;cancelAnimationFrame(workspace.meterFrame);
    $("devices-ready").checked=false;$("device-confirmation").hidden=true;$("enter-consultation").disabled=true;$("device-check").disabled=false;$("device-check").hidden=false;
    for(const id of ["consultation-mute","consultation-camera","play-consultation-audio","stop-devices","device-selectors"])$(id).hidden=true;
    $("retry-consultation").hidden=!workspace.appointment;$("remote-placeholder").hidden=false;$("sound-meter").value=0;$("consultation-dialog").classList.remove("has-remote");
    consultationStep("devices","Devices off");status("consultation-status",message);
}
function closeConsultation(){releaseConsultation(undefined,true);workspace.appointment=null;$("consultation-dialog").close();$("waiting-countdown").textContent="";}
async function openConsultation(a){
    endCall();releaseConsultation();workspace.appointment=a;$("consultation-dialog").showModal();$("consultation-dialog").classList.toggle("audio-only",a.mode==="audio");$("consultation-title").textContent="Take a moment. You're in the right place.";
    $("consultation-description").textContent=methodNames[a.mode]+" · "+timeLabel(a.startAt)+" · "+careTime.zone()+" · display alias: "+a.alias;
    $("participant-placeholder").textContent=a.mode==="audio" ? "Just your voice. Space to talk." : "A little space to settle in.";
    $("device-check").textContent=a.mode==="audio" ? "Check microphone" : "Check microphone and camera";$("retry-consultation").hidden=true;$("relay-status").textContent="";$("microphone-device").replaceChildren();$("camera-device").replaceChildren();
    status("consultation-status","Start with a private device check. Nothing is sent to the other participant until you enter.");updateWaitingClock();
}
function updateWaitingClock(){
    const a=workspace.appointment;if(!a || !$("consultation-dialog").open)return;const now=serverNow(),opens=a.startAt-600,ends=a.startAt+1800;
    if(now>=ends){if(workspace.rtc || workspace.ws)releaseConsultation("The appointment has ended. Your devices are off.",true);$("device-check").disabled=true;$("enter-consultation").disabled=true;$("retry-consultation").hidden=true;consultationStep("devices","Appointment ended");const ended="This appointment's consultation window has ended.";if($("waiting-countdown").textContent!==ended)$("waiting-countdown").textContent=ended;return;}
    const countdown=now<opens ? "The waiting room opens in "+Math.ceil((opens-now)/60)+" minutes. You can check your devices now." : now<a.startAt ? "Your appointment begins in "+Math.ceil((a.startAt-now)/60)+" minutes. You may enter the waiting room." : "Your appointment window is open. Enter when you're ready.";
    if($("waiting-countdown").textContent!==countdown)$("waiting-countdown").textContent=countdown;
    $("enter-consultation").disabled=now<opens || !$("devices-ready").checked || !workspace.rtc || !!workspace.ws || !!workspace.entering;
}
$("close-consultation").addEventListener("click",closeConsultation);$("consultation-dialog").addEventListener("cancel",event=>{event.preventDefault();closeConsultation();});
function updateDeviceControls(){
    if(!workspace.rtc)return;$("consultation-mute").textContent=workspace.rtc.muted ? "Unmute microphone" : "Mute microphone";$("consultation-mute").setAttribute("aria-pressed",String(workspace.rtc.muted));
    $("consultation-camera").textContent=workspace.rtc.cameraOff ? "Turn camera on" : "Turn camera off";$("consultation-camera").setAttribute("aria-pressed",String(workspace.rtc.cameraOff));
}
$("device-check").addEventListener("click",async()=>{
    const a=workspace.appointment;if(!a || a.startAt+1800<=serverNow())return;const audioId=$("microphone-device").value,cameraId=$("camera-device").value;
    releaseConsultation();const epoch=workspace.rtcEpoch,owner=account?.id;$("device-check").disabled=true;$("retry-consultation").hidden=true;consultationStep("devices","Checking devices");
    try{
        const config=await api("/rtc-config",{authenticated:true});if(epoch!==workspace.rtcEpoch || owner!==account?.id)return;workspace.config=config;
        $("relay-status").textContent=config.relayAvailable ? "Calls use the configured TURN relay. Your account details are not shown to the other participant." : "A TURN relay is not configured. Some networks may block this call, and peer network information may be visible.";
        workspace.rtc=new TranquilCall({send:(type,payload={})=>{if(workspace.ws?.readyState===WebSocket.OPEN)workspace.ws.send(JSON.stringify({type,...payload}));},status:message=>{
            if(epoch!==workspace.rtcEpoch)return;status("consultation-status",message);
            if(message==="Connected"){consultationStep("connected","Connected");$("participant-placeholder").textContent="You're connected. Space to talk.";$("remote-placeholder").hidden=a.mode!=="audio";$("consultation-dialog").classList.add("has-remote");}
            else if(/interrupt|failed|Reconnect/i.test(message)){consultationStep("waiting","Reconnecting");$("retry-consultation").hidden=false;}
        },localVideo:$("consultation-local"),remoteVideo:$("consultation-remote"),iceServers:config.iceServers,iceTransportPolicy:config.iceTransportPolicy});
        const rtc=workspace.rtc;await rtc.prepare(a.mode,{audioDeviceId:audioId,videoDeviceId:cameraId});if(epoch!==workspace.rtcEpoch){rtc.end();return;}
        $("device-confirmation").hidden=false;$("stop-devices").hidden=false;$("consultation-mute").hidden=false;$("consultation-camera").hidden=a.mode==="audio";$("camera-device-label").hidden=a.mode==="audio";updateDeviceControls();
        consultationStep("devices","Devices ready");status("consultation-status",a.mode==="audio" ? "Microphone access is working. Your camera is off. Check the sound bar, then confirm you're ready." : "Microphone and camera access are working. Check the sound bar and your preview, then confirm you're ready.");startSoundMeter(rtc.stream);updateWaitingClock();
        try{const devices=await navigator.mediaDevices.enumerateDevices();if(epoch!==workspace.rtcEpoch)return;
            for(const [kind,id,selected] of [["audioinput","microphone-device",audioId],["videoinput","camera-device",cameraId]]){
                const select=$(id);select.replaceChildren();for(const [i,device] of devices.filter(d=>d.kind===kind).entries()){const option=make("option",device.label || (kind==="audioinput" ? "Microphone " : "Camera ")+(i+1));option.value=device.deviceId;select.append(option);}const actual=rtc.stream.getTracks().find(t=>t.kind===(kind==="audioinput" ? "audio" : "video"))?.getSettings?.().deviceId;select.value=actual || selected || select.options[0]?.value || "";
            }$("device-selectors").hidden=false;
        }catch{/* The initial device check remains usable when enumeration is unavailable. */}
        $("device-check").disabled=false;$("device-check").textContent="Check devices again";
    }catch(error){if(epoch===workspace.rtcEpoch){const help=error.name==="NotAllowedError" ? "Device permission was denied. Use your browser's site settings to allow the microphone"+(a.mode==="video" ? " and camera" : "")+", then retry." : error.name==="NotFoundError" ? "No matching device was found. Connect a microphone or choose another device." : error.message;releaseConsultation(help);}}
});
function startSoundMeter(stream){
    try{const Context=window.AudioContext || window.webkitAudioContext;if(!Context)throw new Error("Unavailable");const context=new Context();workspace.audioContext=context;context.resume().catch(()=>{});const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(stream).connect(analyser);const values=new Uint8Array(analyser.fftSize);
        const update=()=>{if(workspace.audioContext!==context)return;analyser.getByteTimeDomainData(values);let sum=0;for(const value of values)sum+=(value-128)**2;$("sound-meter").value=Math.min(100,Math.sqrt(sum/values.length)*5);workspace.meterFrame=requestAnimationFrame(update);};update();$("meter-help").textContent="Speak a few words. The bar indicates microphone input, not audio quality.";
    }catch{$("meter-help").textContent="The activity meter is unavailable in this browser. Check your microphone using your device settings.";}
}
$("devices-ready").addEventListener("change",updateWaitingClock);
for(const id of ["microphone-device","camera-device"])$(id).addEventListener("change",()=>$("device-check").click());
$("stop-devices").addEventListener("click",()=>releaseConsultation("Your devices are off. Check them again when you're ready.",true));
$("speaker-check").addEventListener("click",async()=>{
    const button=$("speaker-check");button.disabled=true;let context;
    try{const Context=window.AudioContext || window.webkitAudioContext;if(!Context)throw new Error("Speaker check is unavailable in this browser.");workspace.audioContext?.resume().catch(()=>{});context=new Context();await context.resume();const tone=context.createOscillator(),gain=context.createGain();tone.frequency.value=440;gain.gain.value=.035;tone.connect(gain);gain.connect(context.destination);tone.start();tone.stop(context.currentTime+.3);await new Promise(resolve=>{tone.onended=resolve;});status("consultation-status","A short tone played. Confirm you heard it through the speaker or headphones you plan to use.");}
    catch(error){status("consultation-status",error.message,true);}finally{if(context)context.close().catch(()=>{});button.disabled=false;}
});
$("enter-consultation").addEventListener("click",async()=>{
    const a=workspace.appointment;if(!workspace.rtc || !$("devices-ready").checked || !account || workspace.ws || workspace.entering || !a || serverNow()<a.startAt-600)return;
    workspace.entering=true;$("enter-consultation").disabled=true;const epoch=workspace.rtcEpoch,owner=account.id;
    try{
        const ticket=await api("/appointments/"+encodeURIComponent(a.id)+"/join",{method:"POST",authenticated:true,body:{}});if(epoch!==workspace.rtcEpoch || owner!==account?.id)return;
        if(ticket.startAt!==a.startAt || ticket.mode!==a.mode)throw new Error("The appointment details changed. Refresh your appointments and reopen the waiting room.");workspace.ticket=ticket.ticket;
        const ws=new WebSocket((location.protocol==="https:" ? "wss://" : "ws://")+location.host+"/rtc/signal");workspace.ws=ws;consultationStep("waiting","Connecting");status("consultation-status","Entering your private waiting room...");
        workspace.timer=setTimeout(()=>{if(epoch===workspace.rtcEpoch)releaseConsultation("Connection timed out. Your devices are off. Check your network and reconnect.");},12000);
        ws.onopen=()=>{if(epoch===workspace.rtcEpoch && owner===account?.id)ws.send(JSON.stringify({type:"join",ticket:workspace.ticket,accessToken:account.token}));};
        let queue=Promise.resolve();ws.onmessage=event=>{queue=queue.then(async()=>{
            if(epoch!==workspace.rtcEpoch)return;const data=JSON.parse(event.data);if(data.type==="error")throw new Error(data.error);
            if(data.type==="joined"){
                clearTimeout(workspace.timer);$("consultation-title").textContent="Your consultation";$("device-check").hidden=true;$("device-selectors").hidden=true;$("play-consultation-audio").hidden=false;
                consultationStep("waiting",data.peers ? "Connecting" : "Waiting for participant");status("consultation-status",data.peers ? "Connecting to "+(data.peerLabel || "your participant")+"..." : "You are in the waiting room. Your participant has not joined yet.");if(data.peers)await workspace.rtc.offer();
            }else if(data.type==="peer_joined"){consultationStep("waiting","Connecting");status("consultation-status",(data.peerLabel || "Your participant")+" has joined. Connecting...");}
            else if(["peer_left","hangup"].includes(data.type))releaseConsultation("The other participant left. Your devices are off. Reconnect if you both wish to continue.");else await workspace.rtc.receive(data.type,data);
        }).catch(error=>{if(epoch===workspace.rtcEpoch)releaseConsultation(error.message);});};
        ws.onerror=()=>{if(epoch===workspace.rtcEpoch)releaseConsultation("Network connection failed. Your devices are off. Check your network, then reconnect.");};
        ws.onclose=()=>{if(epoch===workspace.rtcEpoch)releaseConsultation("Consultation connection closed or access expired. Your devices are off.");};
    }catch(error){if(epoch===workspace.rtcEpoch)releaseConsultation(error.message+" Your devices are off.");}finally{if(epoch===workspace.rtcEpoch){workspace.entering=false;updateWaitingClock();}}
});
$("consultation-mute").addEventListener("click",()=>{workspace.rtc?.toggleMute();updateDeviceControls();});$("consultation-camera").addEventListener("click",()=>{workspace.rtc?.toggleCamera();updateDeviceControls();});
$("play-consultation-audio").addEventListener("click",async()=>{try{await $("consultation-remote").play();status("consultation-status","Consultation audio playback enabled.");}catch{status("consultation-status","Audio cannot play yet. Check your speaker output and wait for the other participant.",true);}});
$("retry-consultation").addEventListener("click",()=>$("device-check").click());
window.addEventListener("offline",()=>{if(workspace.ws || workspace.rtc)releaseConsultation("You're offline. Your devices are off. Reconnect after your network returns.");});
window.addEventListener("pagehide",()=>{closeConsultation();workspace.actionToken=null;$("account-action-form").reset();$("delete-account-form").reset();});
$("create-room").addEventListener("click",()=>{if(workspace.rtc)closeConsultation();});$("join-form").addEventListener("submit",()=>{if(workspace.rtc)closeConsultation();});
setInterval(updateWaitingClock,1000);
setInterval(()=>{if(account && document.visibilityState==="visible" && document.body.dataset.screen==="appointments" && !document.querySelector("dialog[open]") && !document.querySelector(".proposal") && !$("appointments").contains(document.activeElement))loadAppointments();},60000);
window.addEventListener("tranquil-preferences",()=>{timeZone=careTime.zone();if($("booking-dialog").open)fillBookingSlots();if(account){appointmentCalendar.setDates(workspace.items.map(a=>a.startAt));renderAppointments();if(account.role==="expert")loadOwnSlots();}});
// Media and location permissions are requested only after explicit user actions.
appRoute();
document.querySelectorAll("#app-menu nav a").forEach(link=>link.addEventListener("click",()=>{$("app-menu").open=false;}));
document.addEventListener("click",event=>{if(!$("app-menu").contains(event.target))$("app-menu").open=false;});
$("app-menu").addEventListener("keydown",event=>{if(event.key==="Escape"){$("app-menu").open=false;$("app-menu").querySelector("summary").focus();}});
