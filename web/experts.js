"use strict";
const expertState = {
    directoryEpoch:0, directoryOffset:null, directoryQuery:"", directoryCount:0,
    accountEpoch:0, owner:null, reviewsOffset:null, selectedReview:null, publicEpoch:0,
    reviewEpoch:0, saveBusy:false, reviewBusy:false
};
const specialtyNames = ["Anxiety","Stress","Burnout","Trauma","Relationships","Grief","Depression","Youth support","General wellbeing"];
const methodNames = {audio:"Audio only",video:"Video call",in_person:"In person"};
const stateNames = {draft:"Draft",pending:"Awaiting review",approved:"Approved",changes_requested:"Changes requested",suspended:"Suspended"};
const editorFields = ["name","professionalTitle","bio","city","country","practiceName","website",
    "yearsExperience","registrationBody","registrationNumber","registrationCountry","credentialReference"];
function initials(name) {
    return String(name || "").trim().split(/\s+/).slice(0,2).map(part=>part[0] || "").join("").toUpperCase() || "TT";
}
function badge(text = "Registration reviewed") {
    const item=make("span",undefined,"status-pill");
    const dot=make("span",undefined,"status-dot");dot.setAttribute("aria-hidden","true");
    item.append(dot,document.createTextNode(text));return item;
}
function tags(values) {
    const list=make("div",undefined,"tag-list");
    for(const value of values || []) list.append(make("span",value,"profile-tag"));
    return list;
}
function dateLabel(value) {
    const date=new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" :
        date.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
}
function safeWebsite(value) {
    try {const url=new URL(value);return url.protocol==="https:" && !url.username && !url.password ? url.href : null;}
    catch{return null;}
}
function profileLink(id) {return location.origin + "/#expert/" + encodeURIComponent(id);}
function emptyDirectory(title,message) {
    const block=make("div",undefined,"directory-empty");
    block.append(make("p","PROFESSIONAL DIRECTORY","eyebrow"),make("h3",title),make("p",message));
    const link=make("a","Create a professional profile");link.href="#professional";block.append(link);
    return block;
}
function expertCard(profile) {
    const card=make("article",undefined,"expert-card");
    const top=make("div",undefined,"expert-card-top");
    const avatar=make("div",initials(profile.name),"expert-avatar");avatar.setAttribute("aria-hidden","true");
    top.append(avatar,badge());card.append(top,make("h3",profile.name),
        make("p",profile.professionalTitle,"expert-title"),
        make("p",[profile.city,profile.country].filter(Boolean).join(", "),"expert-location"),
        tags((profile.specialties || []).slice(0,3)));
    const bio=String(profile.bio || "").replace(/\s+/g," ");
    card.append(make("p",bio.length>145 ? bio.slice(0,142)+"..." : bio,"expert-bio"),
        make("p",(profile.languages || []).join(" / "),"expert-languages"));
    const link=make("a","View profile","button");
    link.href="#expert/"+encodeURIComponent(profile.id);
    link.setAttribute("aria-label","View profile: "+profile.name);
    card.append(link);return card;
}
async function loadExperts(append=false) {
    const epoch=++expertState.directoryEpoch;
    const params=new URLSearchParams(new FormData($("expert-search-form")));
    for(const [key,value] of [...params]) if(!value.trim()) params.delete(key);
    const query=params.toString();
    if(append && query!==expertState.directoryQuery) append=false;
    if(append && expertState.directoryOffset===null) return;
    if(append) params.set("offset",expertState.directoryOffset);
    const button=$("expert-search-form").querySelector('[type="submit"]');
    button.disabled=true;$("expert-load-more").disabled=true;
    status("expert-status",append ? "Loading more professionals..." : "Finding professionals...");
    if(!append){$("expert-list").replaceChildren();expertState.directoryCount=0;}
    try {
        const response=await api("/experts?"+params);
        if(epoch!==expertState.directoryEpoch)return;
        if(!Array.isArray(response.items))throw new Error("We could not read the professional directory.");
        for(const profile of response.items)$("expert-list").append(expertCard(profile));
        expertState.directoryCount+=response.items.length;
        expertState.directoryQuery=query;
        expertState.directoryOffset=Number.isInteger(response.nextOffset) ? response.nextOffset : null;
        $("expert-load-more").hidden=expertState.directoryOffset===null;
        $("expert-count").textContent=expertState.directoryCount===1 ? "1 professional" : expertState.directoryCount+" professionals";
        status("expert-status","");
        if(!expertState.directoryCount) $("expert-list").append(emptyDirectory(
            query ? "No matches just yet." : "A directory built on trust.",
            query ? "Try a different specialty, language or consultation type." :
                "Approved profiles will appear here as professionals complete their registration review."));
    } catch(error) {
        if(epoch!==expertState.directoryEpoch)return;
        status("expert-status",error.message,true);
        $("expert-load-more").hidden=true;
        if(!append)$("expert-list").append(emptyDirectory("We could not load the directory.","Please try your search again in a moment."));
    } finally {
        if(epoch===expertState.directoryEpoch){button.disabled=false;$("expert-load-more").disabled=false;}
    }
}
$("expert-search-form").addEventListener("submit",event=>{event.preventDefault();loadExperts();});
$("reset-expert-filters").addEventListener("click",()=>{$("expert-search-form").reset();loadExperts();});
$("expert-load-more").addEventListener("click",()=>loadExperts(true));
function closePublicProfile() {
    ++expertState.publicEpoch;
    if($("expert-dialog").open)$("expert-dialog").close();
    if(location.hash.startsWith("#expert/"))history.replaceState(null,"",location.pathname+location.search+"#experts");
}
$("close-expert").addEventListener("click",closePublicProfile);
$("expert-dialog").addEventListener("cancel",event=>{event.preventDefault();closePublicProfile();});
function renderPublicProfile(profile) {
    const root=$("expert-detail");root.replaceChildren();
    const hero=make("div",undefined,"profile-hero");
    const avatar=make("div",initials(profile.name),"expert-avatar");avatar.setAttribute("aria-hidden","true");
    const identity=make("div");const title=make("h2",profile.name);title.id="expert-dialog-title";
    identity.append(title,make("p",profile.professionalTitle,"expert-title"),
        make("p",[profile.city,profile.country].filter(Boolean).join(", "),"expert-location"),badge());
    hero.append(avatar,identity);
    const grid=make("div",undefined,"profile-detail-grid"),main=make("div"),side=make("aside",undefined,"profile-sidebar");
    main.append(make("h3","About my approach"),make("p",profile.bio,"profile-bio"),
        make("h3","Areas of support"),tags(profile.specialties),make("h3","Qualifications"));
    const qualifications=make("ul");
    for(const value of profile.qualifications || [])qualifications.append(make("li",value));
    main.append(qualifications,make("h3","Languages"),make("p",(profile.languages || []).join(", ")));
    side.append(make("h3","Consultation options"),tags((profile.methods || []).map(value=>methodNames[value] || value)),
        make("p",(profile.yearsExperience || 0)+" years of experience"));
    if(profile.practiceName)side.append(make("h3","Practice"),make("p",profile.practiceName));
    const website=safeWebsite(profile.website);
    if(website){const link=make("a","Visit practice website","button secondary");link.href=website;
        link.target="_blank";link.rel="noopener noreferrer";side.append(link);}
    side.append(make("p","Choose a thirty-minute time and request an audio, video or in-person consultation."));
    const book=make("button","See available times");book.type="button";
    book.addEventListener("click",()=>window.openBooking(profile));side.append(book);
    const report=make("button","Report a concern","text-link");report.type="button";
    report.addEventListener("click",()=>window.reportItem("expert",profile.id));side.append(report);
    side.append(make("h3","Registration review"),
        make("p","Professional registration was manually reviewed on "+dateLabel(profile.verifiedAt)+". This check does not guarantee suitability or availability.","profile-review-note"));
    grid.append(main,side);
    const share=make("div",undefined,"profile-share"),label=make("label","Share this profile");
    const field=make("input");field.readOnly=true;field.value=profileLink(profile.id);field.setAttribute("aria-label","Public profile link");label.append(field);
    const copy=make("button","Copy profile link","secondary small");copy.type="button";
    copy.addEventListener("click",async()=>{
        try{await navigator.clipboard.writeText(field.value);status("expert-detail-status","Profile link copied.");}
        catch{field.select();status("expert-detail-status","Select and copy the profile link.");}
    });
    share.append(label,copy);root.append(hero,grid,share);
}
async function handleExpertRoute() {
    if(!location.hash.startsWith("#expert/")) {
        if($("expert-dialog").open)$("expert-dialog").close();
        ++expertState.publicEpoch;return;
    }
    const id=location.hash.slice(8),epoch=++expertState.publicEpoch;
    $("expert-detail").replaceChildren();
    const heading=make("h2","Professional profile");heading.id="expert-dialog-title";$("expert-detail").append(heading);
    status("expert-detail-status","Loading professional profile...");
    if(!$("expert-dialog").open)$("expert-dialog").showModal();
    try {
        const profile=await api("/experts/"+encodeURIComponent(id));
        if(epoch!==expertState.publicEpoch)return;
        renderPublicProfile(profile);status("expert-detail-status","");
    } catch(error) {
        if(epoch===expertState.publicEpoch)status("expert-detail-status",error.status===404 ?
            "This profile is not currently available in the directory." : error.message,true);
    }
}
window.addEventListener("hashchange",handleExpertRoute);
for(const name of specialtyNames) {
    const label=make("label"),input=make("input");input.type="checkbox";input.name="specialties";input.value=name;
    label.append(input,document.createTextNode(name));$("profile-specialties").append(label);
}
function professionalAccount() {return account && ["expert","expert_pending"].includes(account.role);}
function ownerStatus(profile) {
    const state=profile?.status || "draft";
    $("profile-state").textContent=stateNames[state] || state;
    $("profile-state").dataset.state=state;
    const descriptions={
        draft:"Your draft is private. Submit the completed profile when you are ready for a registration review.",
        pending:"Your application is awaiting review. Saving changes withdraws this version and starts a new draft.",
        approved:"Your profile is live. Saving edits hides it until the updated version is approved.",
        changes_requested:"A reviewer has requested changes. Update the profile using their feedback and submit it again.",
        suspended:"This profile is not public. An administrator must reopen it before you can make changes."
    };
    $("profile-state-description").textContent=descriptions[state] || "";
    const last=profile?.reviews?.at(-1);
    $("profile-feedback").hidden=!last;
    $("profile-feedback").textContent=last ? (stateNames[state] || "Review")+" / "+dateLabel(last.at)+"\n"+last.note : "";
    $("my-public-profile").hidden=state!=="approved";
    if(profile?.id)$("my-public-profile").href="#expert/"+encodeURIComponent(profile.id);
    for(const control of $("expert-profile-form").elements)control.disabled=state==="suspended";
}
function fillOwner(profile) {
    expertState.owner=profile;
    const form=$("expert-profile-form");form.reset();
    for(const name of editorFields)form.elements.namedItem(name).value=profile?.[name] ?? (name==="yearsExperience" ? 0 : "");
    form.elements.namedItem("languages").value=(profile?.languages || []).join(", ");
    form.elements.namedItem("qualifications").value=(profile?.qualifications || []).join("\n");
    for(const input of form.querySelectorAll('[name="specialties"],[name="methods"]'))
        input.checked=(profile?.[input.name] || []).includes(input.value);
    ownerStatus(profile);
}
async function loadOwner() {
    const epoch=expertState.accountEpoch;
    if(!professionalAccount())return;
    status("profile-editor-status","Loading your profile...");
    try {
        const data=await api("/expert-profile",{authenticated:true});
        if(epoch!==expertState.accountEpoch || !professionalAccount())return;
        fillOwner(data.profile);status("profile-editor-status","");
    } catch(error) {
        if(epoch===expertState.accountEpoch)status("profile-editor-status",error.message,true);
    }
}
function profilePayload() {
    const form=$("expert-profile-form"),data=new FormData(form),payload={revision:expertState.owner?.revision || 0};
    for(const name of editorFields)payload[name]=data.get(name)?.trim() || "";
    payload.yearsExperience=Number(payload.yearsExperience);
    payload.languages=String(data.get("languages") || "").split(",").map(value=>value.trim()).filter(Boolean);
    payload.qualifications=String(data.get("qualifications") || "").split("\n").map(value=>value.trim()).filter(Boolean);
    payload.specialties=data.getAll("specialties");payload.methods=data.getAll("methods");
    return payload;
}
$("expert-profile-form").addEventListener("submit",async event=>{
    event.preventDefault();
    if(expertState.saveBusy || !professionalAccount())return;
    const epoch=expertState.accountEpoch;
    const submitting=event.submitter?.value==="submit";
    const payload=profilePayload();
    if(submitting && (!payload.specialties.length || !payload.languages.length || !payload.qualifications.length || !payload.methods.length)){
        status("profile-editor-status","Add at least one specialty, language, qualification and consultation method.",true);return;
    }
    expertState.saveBusy=true;
    const buttons=[...event.currentTarget.querySelectorAll('[type="submit"]')];buttons.forEach(button=>{button.disabled=true;});
    status("profile-editor-status",submitting ? "Saving and submitting your profile..." : "Saving your draft...");
    try {
        const saved=await api("/expert-profile",{method:"PUT",body:payload,authenticated:true});
        if(epoch!==expertState.accountEpoch)return;
        expertState.owner=saved.profile;
        let profile=saved.profile;
        if(submitting){
            const submitted=await api("/expert-profile/submit",{method:"POST",body:{revision:profile.revision},authenticated:true});
            if(epoch!==expertState.accountEpoch)return;
            profile=submitted.profile;
        }
        fillOwner(profile);
        status("profile-editor-status",submitting ? "Profile submitted for registration review." : "Draft saved. It is not visible in the public directory.");
        // Updating approval state changes current permissions without waiting for JWT expiry.
        const identity=await api("/me",{authenticated:true});
        if(epoch===expertState.accountEpoch && account){
            account={...account,...identity};
            $("publish-form").hidden=identity.role!=="expert";
            $("account-button").textContent=identity.role==="expert" ? "Verified professional" : "Professional account";
        }
        loadExperts();
    } catch(error) {
        if(epoch===expertState.accountEpoch)status("profile-editor-status",error.message,true);
    } finally {
        expertState.saveBusy=false;
        if(epoch===expertState.accountEpoch)buttons.forEach(button=>{button.disabled=expertState.owner?.status==="suspended";});
    }
});
$("refresh-profile").addEventListener("click",async()=>{
    try{await refreshAccount();}
    catch(error){status("profile-editor-status",error.message,true);}
});
function openProfessionalSignup() {
    if(account){location.hash="professional";status("professional-gate-status","Sign out first, then create or sign in to a professional account.",true);return;}
    if(!registering)$("switch-auth").click();
    $("auth-form").elements.namedItem("role").value="expert";openAuth();
}
$("professional-signup").addEventListener("click",openProfessionalSignup);
$("professional-signin").addEventListener("click",()=>{
    if(account){status("professional-gate-status","Sign out first to switch to a professional account.",true);return;}
    if(registering)$("switch-auth").click();openAuth();
});
async function loadReviewQueue(append=false) {
    if(account?.role!=="admin")return;
    const epoch=++expertState.reviewEpoch,accountEpoch=expertState.accountEpoch;
    const params=new URLSearchParams({status:$("review-filter").value});
    if(append){if(expertState.reviewsOffset===null)return;params.set("offset",expertState.reviewsOffset);}
    $("refresh-reviews").disabled=true;$("review-load-more").disabled=true;
    status("review-queue-status","Loading registration applications...");
    if(!append)$("review-list").replaceChildren();
    try {
        const result=await api("/admin/experts?"+params,{authenticated:true});
        if(epoch!==expertState.reviewEpoch || accountEpoch!==expertState.accountEpoch)return;
        if(!Array.isArray(result.items))throw new Error("We could not read the review queue.");
        for(const profile of result.items){
            const card=make("article",undefined,"review-card"),info=make("div");
            info.append(make("h3",profile.name || "Untitled draft"),make("p",
                (profile.professionalTitle || "Professional profile")+" / "+[profile.city,profile.country].filter(Boolean).join(", ")),
                make("p",(stateNames[profile.status] || profile.status)+" / Version "+profile.revision+" / "+dateLabel(profile.updatedAt)));
            const button=make("button","Review application","secondary");button.type="button";
            button.setAttribute("aria-label","Review application: "+(profile.name || profile.id));
            button.addEventListener("click",()=>openReview(profile));
            card.append(info,button);$("review-list").append(card);
        }
        expertState.reviewsOffset=Number.isInteger(result.nextOffset) ? result.nextOffset : null;
        $("review-load-more").hidden=expertState.reviewsOffset===null;
        status("review-queue-status",$("review-list").childElementCount ? "" : "No applications with this status.");
    } catch(error) {
        if(epoch===expertState.reviewEpoch && accountEpoch===expertState.accountEpoch)status("review-queue-status",error.message,true);
    } finally {
        if(epoch===expertState.reviewEpoch){$("refresh-reviews").disabled=false;$("review-load-more").disabled=false;}
    }
}
function credentialRow(list,label,value) {list.append(make("dt",label),make("dd",value || "Not provided"));}
async function openReview(summary) {
    if(account?.role!=="admin")return;
    const epoch=expertState.accountEpoch;
    status("review-queue-status","Loading the current application version...");
    try {
        const result=await api("/admin/experts/"+encodeURIComponent(summary.id),{authenticated:true});
        if(epoch!==expertState.accountEpoch || account?.role!=="admin")return;
        renderReview(result.profile);status("review-queue-status","");
    } catch(error) {
        if(epoch===expertState.accountEpoch)status("review-queue-status",error.message,true);
    }
}
function renderReview(profile) {
    if(account?.role!=="admin")return;
    expertState.selectedReview=profile;
    const root=$("review-detail");root.replaceChildren();
    root.append(make("h3",profile.name || "Untitled draft"),make("p",profile.professionalTitle),
        make("p",profile.bio,"profile-bio"),tags(profile.specialties),
        make("p","Languages: "+(profile.languages || []).join(", ")),
        make("p","Qualifications: "+(profile.qualifications || []).join("; ")));
    const block=make("div",undefined,"credential-block"),list=make("dl",undefined,"credential-list");
    block.append(make("h3","Private registration details"));
    credentialRow(list,"Registration body",profile.registrationBody);
    credentialRow(list,"Registration number",profile.registrationNumber);
    credentialRow(list,"Country",profile.registrationCountry);
    credentialRow(list,"Applicant reference",profile.credentialReference);
    credentialRow(list,"Profile version",String(profile.revision));block.append(list);root.append(block);
    if(profile.reviews?.length){
        const history=make("details",undefined,"audit-history");history.append(make("summary","Review history ("+profile.reviews.length+")"));
        for(const entry of [...profile.reviews].reverse()){
            const item=make("div",undefined,"audit-entry");
            item.append(make("strong",entry.action.replaceAll("_"," ")+" / "+dateLabel(entry.at)),
                make("p",entry.note),make("p","Reviewed version "+entry.reviewedRevision));
            if(entry.reference)item.append(make("p","Registry reference: "+entry.reference));
            history.append(item);
        }
        root.append(history);
    }
    $("review-decision-form").reset();
    const action=$("review-action");action.replaceChildren();
    const actions=profile.status==="pending" ? [["approve","Approve registration"],["request_changes","Request changes"],["suspend","Suspend profile"]] :
        profile.status==="suspended" ? [["request_changes","Reopen for changes"]] :
        ["draft","changes_requested"].includes(profile.status) ? [["suspend","Suspend profile"]] :
        [["request_changes","Request changes"],["suspend","Suspend profile"]];
    for(const [value,label] of actions){const option=make("option",label);option.value=value;action.append(option);}
    reviewActionFields();status("review-decision-status","");
    if(!$("review-dialog").open)$("review-dialog").showModal();
}
function reviewActionFields() {
    const approving=$("review-action").value==="approve";
    $("registry-confirmation").hidden=!approving;
    for(const input of $("registry-confirmation").querySelectorAll("input"))input.required=approving;
}
$("review-action").addEventListener("change",reviewActionFields);
$("close-review").addEventListener("click",()=>{$("review-dialog").close();expertState.selectedReview=null;});
$("review-decision-form").addEventListener("submit",async event=>{
    event.preventDefault();
    if(expertState.reviewBusy || !expertState.selectedReview || account?.role!=="admin")return;
    const selected=expertState.selectedReview,epoch=expertState.accountEpoch;
    const data=new FormData(event.currentTarget),button=event.currentTarget.querySelector('[type="submit"]');
    const body={revision:selected.revision,action:data.get("action"),note:data.get("note"),
        reference:data.get("reference"),registryChecked:data.has("registryChecked")};
    expertState.reviewBusy=true;button.disabled=true;status("review-decision-status","Recording the review decision...");
    try {
        await api("/admin/experts/"+encodeURIComponent(selected.id)+"/review",{method:"POST",body,authenticated:true});
        if(epoch!==expertState.accountEpoch)return;
        $("review-dialog").close();expertState.selectedReview=null;
        await loadReviewQueue();loadExperts();
        status("review-queue-status","Review decision recorded.");
    } catch(error) {
        if(epoch===expertState.accountEpoch)status("review-decision-status",error.message,true);
    } finally {expertState.reviewBusy=false;button.disabled=false;}
});
$("review-filter").addEventListener("change",()=>loadReviewQueue());
$("refresh-reviews").addEventListener("click",async()=>{
    try{await refreshAccount();}
    catch(error){status("review-queue-status",error.message,true);}
});
$("review-load-more").addEventListener("click",()=>loadReviewQueue(true));
function accountChanged() {
    ++expertState.accountEpoch;++expertState.reviewEpoch;
    expertState.owner=null;expertState.selectedReview=null;expertState.reviewsOffset=null;
    $("expert-profile-form").reset();$("review-decision-form").reset();$("review-detail").replaceChildren();
    $("review-list").replaceChildren();$("profile-feedback").textContent="";$("profile-feedback").hidden=true;
    if($("review-dialog").open)$("review-dialog").close();
    $("profile-workspace").hidden=!professionalAccount();
    $("professional-gate").hidden=Boolean(professionalAccount());
    status("professional-gate-status",account && !professionalAccount() ? "Use a separate professional account for a registration application. Sign out before switching accounts." : "");
    $("profile-nav").hidden=!professionalAccount();
    $("verification-nav").hidden=account?.role!=="admin";
    $("verification").hidden=account?.role!=="admin";
    $("my-public-profile").hidden=true;
    if(professionalAccount())loadOwner();
    if(account?.role==="admin")loadReviewQueue();
}
window.addEventListener("tranquil-account",accountChanged);
window.addEventListener("pagehide",()=>{++expertState.publicEpoch;++expertState.directoryEpoch;});
accountChanged();loadExperts();handleExpertRoute();
