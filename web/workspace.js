"use strict";
const workspace = {booking:null, slots:[], bookingEpoch:0, appointmentsEpoch:0, appointment:null,
    rtc:null, ws:null, ticket:null, config:null, rtcEpoch:0, timer:null, actionToken:null, action:null, audioContext:null, meterFrame:null};
const timeLabel = seconds => new Date(seconds*1000).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function appRoute() {
    const raw=location.hash.slice(1);
    let page=raw.startsWith("expert/") ? "experts" : raw.startsWith("account/") ? "account" : raw.split("?")[0] || (account ? "home" : "signin");
    if(page==="register")page="signup";
    if(!["signin","signup","home","experts","care","connect","professional","verification","appointments","stories","events","account"].includes(page))page=account ? "home" : "signin";
    if(page==="home" && !account && !previewExploring)page="signin";
    if(account && ["signin","signup"].includes(page))page="home";
    if(page==="verification" && account?.role!=="admin")page="account";
    const entry=["signin","signup"].includes(page);document.body.dataset.screen=page;
    $("app-menu").hidden=entry;$("account-button").hidden=entry;$("logout").hidden=entry || !account;
    $("auth-navigation").hidden=!entry;$("route-label").hidden=entry;
    document.querySelector("footer").hidden=entry;document.querySelector(".support-note").hidden=entry;
    for(const section of document.querySelectorAll("main > section"))section.hidden=section.id!==page;
    document.querySelector(".intro-strip").hidden=page!=="home";
    for(const link of document.querySelectorAll("nav a")) {
        if(link.hash==="#"+page)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
    }
    const labels={signin:"Sign in",signup:"Create account",home:"Home",experts:"Find an expert",care:"Nearby clinics",connect:"Conversations",professional:"Professional profile",verification:"Verification",appointments:"Appointments",stories:"Resources",events:"Community",account:"Account"};
    $("route-label").textContent="YOUR SPACE / "+labels[page].toUpperCase();
    document.title=labels[page]+" | Tranquil Talk";
    if(page==="appointments")loadAppointments();
    if(page==="account") {renderAccountPage();readActionLink();}
    window.scrollTo({top:0,behavior:"instant"});
}
window.addEventListener("hashchange",appRoute);
function renderAccountPage() {
    $("email-state").textContent=!account ? "Sign in to manage your account." : account.emailVerified ?
        "Your email is verified. You can book and manage appointments." : "Verify your email before booking or managing availability.";
    $("request-verification").disabled=!account || account.emailVerified;
    $("moderation-workspace").hidden=account?.role!=="admin";
    if(account?.role==="admin")loadReports();
}
window.addEventListener("tranquil-account",()=>{
    ++workspace.bookingEpoch;++workspace.appointmentsEpoch;
    $("appointment-list").replaceChildren();$("own-slots").replaceChildren();
    $("moderation-list").replaceChildren();$("report-form").reset();$("delete-account-form").reset();
    renderAccountPage();
    if(!account){closeConsultation();$("availability-workspace").hidden=true;if($("booking-dialog").open)$("booking-dialog").close();}
    if(location.hash==="#appointments")loadAppointments();
    // The verification script updates permissions too; keep page visibility in sync afterwards.
    queueMicrotask(()=>appRoute());
});
window.reportItem=(type,id)=>{
    $("expert-dialog").close();$("report-form").elements.targetType.value=type;
    $("report-form").elements.targetId.value=id;location.hash="account";$("report-form").elements.reason.focus();
};
window.openBooking=async profile=>{
    if(!account){$("expert-dialog").close();openAuth();return;}
    if(account.role!=="patient"){status("expert-detail-status","Use a patient account to request support.",true);return;}
    if(!account.emailVerified){$("expert-dialog").close();location.hash="account";return;}
    workspace.booking=profile;workspace.slots=[];const epoch=++workspace.bookingEpoch;
    $("expert-dialog").close();$("booking-dialog").showModal();$("booking-expert").textContent=profile.name+" / "+timeZone;
    $("booking-form").reset();$("booking-slot").replaceChildren();$("booking-mode").replaceChildren();
    for(const method of profile.methods || []){const option=make("option",methodNames[method]);option.value=method;$("booking-mode").append(option);}
    status("booking-status","Loading available times...");$("booking-form").querySelector("button").disabled=true;
    try {
        const response=await api("/availability/"+encodeURIComponent(profile.id));
        if(epoch!==workspace.bookingEpoch)return;
        if(!Array.isArray(response.items))throw new Error("Available times could not be loaded.");
        workspace.slots=response.items;fillBookingSlots();
    }catch(error){if(epoch===workspace.bookingEpoch)status("booking-status",error.message,true);}
};
function fillBookingSlots() {
    $("booking-slot").replaceChildren();
    const slots=workspace.slots.filter(s=>$("booking-mode").value!=="in_person" || s.location);
    for(const slot of slots){const option=make("option",timeLabel(slot.startAt));option.value=slot.id;$("booking-slot").append(option);}
    $("booking-form").querySelector("button").disabled=!slots.length;
    status("booking-status",slots.length ? "Times are held when you send a request. The professional must accept before you can join." : "No available times for this method. Please check again later.");
    showBookingLocation();
}
function showBookingLocation(){const slot=workspace.slots.find(s=>s.id===$("booking-slot").value);$("booking-location").textContent=$("booking-mode").value==="in_person" ? slot?.location || "" : "Online consultation";}
$("booking-mode").addEventListener("change",fillBookingSlots);$("booking-slot").addEventListener("change",showBookingLocation);
$("close-booking").addEventListener("click",()=>{++workspace.bookingEpoch;$("booking-dialog").close();});
$("booking-dialog").addEventListener("cancel",()=>{++workspace.bookingEpoch;});
async function formAction(event,statusId,fn) {
    event.preventDefault();const form=event.currentTarget,button=event.submitter || form.querySelector('[type="submit"]');
    if(button?.disabled)return;if(button)button.disabled=true;status(statusId,"Working...");
    try{await fn(Object.fromEntries(new FormData(form)),form);}catch(error){status(statusId,error.message,true);}
    finally{if(button)button.disabled=false;}
}
$("booking-form").addEventListener("submit",event=>formAction(event,"booking-status",async values=>{
    await api("/appointments",{method:"POST",authenticated:true,body:{...values,expertId:workspace.booking.id}});
    $("booking-dialog").close();location.hash="appointments";await loadAppointments();
}));
function actionButton(label,fn,secondary=true) {
    const button=make("button",label,secondary ? "secondary small" : "small");button.type="button";
    button.addEventListener("click",async()=>{button.disabled=true;try{await fn();}catch(error){status("appointments-status",error.message,true);}finally{button.disabled=false;}});return button;
}
async function decideAppointment(a,action,slotId) {
    await api("/appointments/"+encodeURIComponent(a.id)+"/"+action,{method:"POST",authenticated:true,body:{revision:a.revision,...(slotId ? {slotId} : {})}});
    await loadAppointments();
}
async function proposeAppointment(a,card) {
    const old=card.querySelector(".proposal");if(old){old.remove();return;}
    const response=await api("/availability/"+encodeURIComponent(a.expertId));
    const form=make("form",undefined,"proposal"),label=make("label","Alternative available time"),select=make("select");select.required=true;
    for(const s of response.items || []){if(a.mode==="in_person" && !s.location)continue;const option=make("option",timeLabel(s.startAt));option.value=s.id;select.append(option);}
    label.append(select);const button=make("button","Send alternative","secondary small");button.type="submit";button.disabled=!select.options.length;form.append(label,button);
    form.addEventListener("submit",async event=>{event.preventDefault();button.disabled=true;try{await decideAppointment(a,"propose",select.value);}catch(error){status("appointments-status",error.message,true);button.disabled=false;}});card.append(form);
}
async function loadAppointments() {
    const epoch=++workspace.appointmentsEpoch;
    $("availability-workspace").hidden=account?.role!=="expert";
    if(!account){$("appointment-list").replaceChildren();status("appointments-status","Sign in to see your appointments.");return;}
    const owner=account.id;status("appointments-status","Loading your appointments...");
    try {
        const data=await api("/appointments",{authenticated:true});if(epoch!==workspace.appointmentsEpoch || owner!==account?.id)return;
        if(!Array.isArray(data.items))throw new Error("Appointments could not be loaded.");
        $("appointment-list").replaceChildren();
        for(const a of data.items) {
            const expert=account.id===a.expertId,card=make("article",undefined,"panel appointment-card");
            card.append(make("span",a.status.replaceAll("_"," "),"status-pill"),make("h3",expert ? a.alias : a.expertName),
                make("p",timeLabel(a.startAt)),make("p",methodNames[a.mode]+" / 30 minutes / "+timeZone,"fine"));
            if(a.mode==="in_person")card.append(make("p",a.location));
            const actions=make("div",undefined,"actions"),future=a.startAt*1000>Date.now();
            if(future && ((expert && a.status==="requested") || (!expert && a.status==="proposed"))) {
                actions.append(actionButton(expert ? "Accept request" : "Accept new time",()=>decideAppointment(a,"accept"),false),actionButton("Decline",()=>decideAppointment(a,"decline")));
            }
            if(expert && future && ["requested","accepted"].includes(a.status))actions.append(actionButton("Propose another time",()=>proposeAppointment(a,card)));
            if(future && ["requested","proposed","accepted"].includes(a.status))actions.append(actionButton("Cancel appointment",()=>decideAppointment(a,"cancel")));
            if(a.status==="accepted" && a.mode!=="in_person" && Date.now()< (a.startAt+1800)*1000) {
                const join=actionButton("Open waiting room",()=>openConsultation(a),false);join.disabled=Date.now()<(a.startAt-600)*1000;actions.append(join);
                if(join.disabled)card.append(make("p","Waiting room opens ten minutes before the appointment.","fine"));
            }
            actions.append(actionButton("Report concern",()=>window.reportItem("appointment",a.id)));card.append(actions);$("appointment-list").append(card);
        }
        status("appointments-status",data.items.length ? "Times shown in "+timeZone+". Refresh for the latest responses." : "No appointments yet. Find a professional to take your first step.");
        if(account.role==="expert")loadOwnSlots();
    }catch(error){if(epoch===workspace.appointmentsEpoch)status("appointments-status",error.message,true);}
}
$("refresh-appointments").addEventListener("click",loadAppointments);
async function loadOwnSlots() {
    const id=account?.id;if(!id)return;
    try {const data=await api("/availability/"+encodeURIComponent(id));if(account?.id!==id)return;
        $("own-slots").replaceChildren();for(const s of data.items || []){
            const row=make("div",undefined,"slot-row");row.append(make("span",timeLabel(s.startAt)+(s.location ? " / "+s.location : "")),actionButton("Remove",async()=>{
                await api("/availability/"+id,{method:"POST",authenticated:true,body:{startAt:s.startAt,remove:true}});await loadOwnSlots();
            }));$("own-slots").append(row);
        }
    }catch(error){status("availability-status",error.message,true);}
}
$("availability-form").addEventListener("submit",event=>formAction(event,"availability-status",async(values,form)=>{
    await api("/availability/"+account.id,{method:"POST",authenticated:true,body:{startAt:new Date(values.start).getTime()/1000,location:values.location}});
    form.reset();status("availability-status","Available time added.");await loadOwnSlots();
}));
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

function releaseConsultation(message="Your microphone and camera are off.",notify=false) {
    ++workspace.rtcEpoch;clearTimeout(workspace.timer);workspace.timer=null;
    if(workspace.ws){const ws=workspace.ws;workspace.ws=null;if(notify && ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"hangup"}));ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.close();}
    workspace.rtc?.end();workspace.rtc=null;workspace.audioContext?.close();workspace.audioContext=null;cancelAnimationFrame(workspace.meterFrame);
    $("devices-ready").checked=false;$("device-confirmation").hidden=true;$("enter-consultation").disabled=true;$("device-check").disabled=false;
    $("consultation-mute").hidden=true;$("consultation-camera").hidden=true;$("retry-consultation").hidden=!workspace.appointment;
    status("consultation-status",message);
}
function closeConsultation(){releaseConsultation(undefined,true);workspace.appointment=null;$("consultation-dialog").close();}
async function openConsultation(a) {
    endCall();releaseConsultation();workspace.appointment=a;workspace.ticket=null;
    $("consultation-dialog").showModal();$("consultation-title").textContent="Your waiting room";
    $("consultation-description").textContent=methodNames[a.mode]+" / "+timeLabel(a.startAt)+" / display alias: "+a.alias;
    $("device-check").textContent=a.mode==="audio" ? "Check microphone" : "Check microphone and camera";
    $("retry-consultation").hidden=true;status("consultation-status","Check your devices when you are ready. Nothing is sent to your professional yet.");
}
$("close-consultation").addEventListener("click",closeConsultation);
$("consultation-dialog").addEventListener("cancel",event=>{event.preventDefault();closeConsultation();});
$("device-check").addEventListener("click",async()=>{
    if(!workspace.appointment)return;
    releaseConsultation();const epoch=workspace.rtcEpoch;$("device-check").disabled=true;$("retry-consultation").hidden=true;
    try {
        const a=workspace.appointment;
        const [ticket,config]=await Promise.all([api("/appointments/"+a.id+"/join",{method:"POST",authenticated:true,body:{}}),api("/rtc-config",{authenticated:true})]);
        if(epoch!==workspace.rtcEpoch)return;
        workspace.ticket=ticket.ticket;workspace.config=config;
        $("relay-status").textContent=config.relayAvailable ? "Relay protection is available; your peer connection uses the relay." : "Relay service is not configured. Some networks may block calls, and peer network information may be visible.";
        workspace.rtc=new TranquilCall({send:(type,payload={})=>{if(workspace.ws?.readyState===WebSocket.OPEN)workspace.ws.send(JSON.stringify({type,...payload}));},
            status:message=>status("consultation-status",message),localVideo:$("consultation-local"),remoteVideo:$("consultation-remote"),iceServers:config.iceServers,iceTransportPolicy:config.iceTransportPolicy});
        const rtc=workspace.rtc;await rtc.prepare(ticket.mode);
        if(epoch!==workspace.rtcEpoch){rtc.end();return;}
        $("device-confirmation").hidden=false;$("enter-consultation").disabled=true;
        status("consultation-status",ticket.mode==="audio" ? "Microphone permission is working. Your camera is off. Check the sound indicator, then confirm you are ready." : "Microphone and camera permission are working. Check your preview and the sound indicator, then confirm you are ready.");
        startSoundMeter(rtc.stream);
    }catch(error){if(epoch===workspace.rtcEpoch)releaseConsultation(error.message);}
});
function startSoundMeter(stream) {
    try {
        const Context=window.AudioContext || window.webkitAudioContext;if(!Context)return;
        const context=new Context();workspace.audioContext=context;const analyser=context.createAnalyser();analyser.fftSize=256;
        context.createMediaStreamSource(stream).connect(analyser);const values=new Uint8Array(analyser.fftSize);
        const update=()=>{if(workspace.audioContext!==context)return;analyser.getByteTimeDomainData(values);let sum=0;for(const v of values)sum+=(v-128)**2;
            $("sound-meter").value=Math.min(100,Math.sqrt(sum/values.length)*5);workspace.meterFrame=requestAnimationFrame(update);};update();
    }catch{/* Permission and preview remain usable when the audio meter is unavailable. */}
}
$("devices-ready").addEventListener("change",()=>{$("enter-consultation").disabled=!$("devices-ready").checked || !workspace.rtc || !!workspace.ws;});
$("enter-consultation").addEventListener("click",()=>{
    if(!workspace.rtc || !$("devices-ready").checked || !account || workspace.ws)return;
    $("enter-consultation").disabled=true;const epoch=workspace.rtcEpoch;
    const ws=new WebSocket((location.protocol==="https:" ? "wss://" : "ws://")+location.host+"/rtc/signal");workspace.ws=ws;
    workspace.timer=setTimeout(()=>{if(epoch===workspace.rtcEpoch)releaseConsultation("Connection timed out. Check your network, then reconnect.");},12000);
    ws.onopen=()=>{if(epoch===workspace.rtcEpoch)ws.send(JSON.stringify({type:"join",ticket:workspace.ticket,accessToken:account.token}));};
    let queue=Promise.resolve();ws.onmessage=event=>{queue=queue.then(async()=>{
        if(epoch!==workspace.rtcEpoch)return;const data=JSON.parse(event.data);
        if(data.type==="error")throw new Error(data.error);
        if(data.type==="joined") {
            clearTimeout(workspace.timer);$("consultation-title").textContent="Your consultation";
            status("consultation-status",data.peers ? "Connecting to "+(data.peerLabel || "your participant")+"..." : "You are in the waiting room. Waiting for the other participant.");
            $("consultation-mute").hidden=false;$("consultation-mute").textContent="Mute microphone";
            $("consultation-camera").hidden=workspace.appointment.mode==="audio";$("consultation-camera").textContent="Turn camera off";
            if(data.peers)await workspace.rtc.offer();
        }else if(data.type==="peer_joined")status("consultation-status",(data.peerLabel || "Your participant")+" has joined. Connecting...");
        else if(["peer_left","hangup"].includes(data.type))releaseConsultation("The other participant left. Your devices are off. Reconnect if you both wish to continue.");
        else await workspace.rtc.receive(data.type,data);
    }).catch(error=>{if(epoch===workspace.rtcEpoch)releaseConsultation(error.message);});};
    ws.onerror=()=>{if(epoch===workspace.rtcEpoch)releaseConsultation("Network connection failed. Your devices are off. Check your connection and reconnect.");};
    ws.onclose=()=>{if(epoch===workspace.rtcEpoch)releaseConsultation("Consultation connection closed or access expired. Your devices are off.");};
});
$("consultation-mute").addEventListener("click",()=>{if(workspace.rtc)$("consultation-mute").textContent=workspace.rtc.toggleMute() ? "Unmute microphone" : "Mute microphone";});
$("consultation-camera").addEventListener("click",()=>{if(workspace.rtc)$("consultation-camera").textContent=workspace.rtc.toggleCamera() ? "Turn camera on" : "Turn camera off";});
$("retry-consultation").addEventListener("click",()=>$("device-check").click());
window.addEventListener("pagehide",()=>{closeConsultation();workspace.actionToken=null;$("account-action-form").reset();$("delete-account-form").reset();});
$("create-room").addEventListener("click",()=>{if(workspace.rtc)closeConsultation();});
$("join-form").addEventListener("submit",()=>{if(workspace.rtc)closeConsultation();});
// Do not request media, location or notification permissions during navigation.
appRoute();
document.querySelectorAll("#app-menu nav a").forEach(link=>link.addEventListener("click",()=>{$("app-menu").open=false;}));
document.addEventListener("click",event=>{if(!$("app-menu").contains(event.target))$("app-menu").open=false;});
$("app-menu").addEventListener("keydown",event=>{if(event.key==="Escape"){$("app-menu").open=false;$("app-menu").querySelector("summary").focus();}});
