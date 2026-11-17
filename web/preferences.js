"use strict";
(() => {
    let epoch=0,zones=null;
    function knownZones(){let list=[];try{list=Intl.supportedValuesOf("timeZone");}catch{}return [...new Set(["UTC",Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",account?.timeZone || "UTC",...list])].sort();}
    function fill(select,desired){const values=[...new Set([desired,...(zones || knownZones())])].filter(Boolean).sort();select.replaceChildren();for(const value of values){const option=make("option",value.replaceAll("_"," "));option.value=value;option.selected=option.defaultSelected=value===desired;select.append(option);}}
    const startLabel=$("managed-event-form").elements.start.closest("label"),zoneLabel=make("label","Event timezone"),eventZone=make("select");eventZone.id="managed-event-zone";eventZone.name="timeZone";eventZone.required=true;zoneLabel.append(eventZone);startLabel.after(zoneLabel);
    const occurrenceLabel=make("label","If a clock change repeats the event time"),occurrence=make("select");occurrence.name="occurrence";for(const [value,label] of [["","Ask me to choose if needed"],["earlier","First occurrence"],["later","Second occurrence"]]){const option=make("option",label);option.value=value;occurrence.append(option);}occurrenceLabel.append(occurrence);$("managed-event-form").querySelector(".actions").before(occurrenceLabel);
    function limits(){const form=$("availability-form"),zone=$("availability-zone").value || careTime.zone();form.elements.start.min=careTime.localInput(Date.now()/1000+300,zone);form.elements.start.max=careTime.localInput(Date.now()/1000+90*86400,zone);const event=$("managed-event-form"),eventZone=$("managed-event-zone").value || careTime.zone();event.elements.start.min=careTime.localInput(Date.now()/1000+60,eventZone);event.elements.start.max=careTime.localInput(Date.now()/1000+366*86400,eventZone);}
    function render(){
        const desired=account?.timeZone || careTime.zone();$("preference-panel").hidden=!account;fill($("preference-zone"),desired);fill($("availability-zone"),desired);fill($("managed-event-zone"),desired);
        $("preference-emails").checked=account?.appointmentEmails!==false;$("preference-reminders").checked=account?.appointmentReminders!==false;$("preference-reminders").disabled=!$("preference-emails").checked;limits();
    }
    async function load(){
        const version=++epoch;render();status("preference-status","");if(!account)return;const owner=account.id;
        try{const [preferences,available]=await Promise.all([api("/account/preferences",{authenticated:true}),zones ? Promise.resolve({items:zones}) : api("/timezones")]);if(version!==epoch || owner!==account?.id)return;if(!Array.isArray(available.items) || typeof preferences.timeZone!=="string")throw new Error("Account preferences could not be read.");zones=available.items.filter(v=>typeof v==="string");account={...account,...preferences};render();window.dispatchEvent(new CustomEvent("tranquil-preferences"));}
        catch(error){if(version===epoch)status("preference-status","Preferences could not be loaded. "+error.message,true);}
    }
    $("preferences-form").addEventListener("submit",event=>formAction(event,"preference-status",async()=>{const owner=account?.id,version=epoch;if(!owner)throw new Error("Sign in to save preferences.");const result=await api("/account/preferences",{method:"PUT",authenticated:true,body:{timeZone:$("preference-zone").value,appointmentEmails:$("preference-emails").checked,appointmentReminders:$("preference-reminders").checked}});if(owner!==account?.id || version!==epoch)return;account={...account,...result};window.dispatchEvent(new CustomEvent("tranquil-preferences"));status("preference-status","Preferences saved. Existing appointments keep the same instant; their displayed time uses your chosen zone.");}));
    $("preference-emails").addEventListener("change",()=>{$("preference-reminders").disabled=!$("preference-emails").checked;});$("availability-zone").addEventListener("change",limits);eventZone.addEventListener("change",limits);
    window.addEventListener("tranquil-account",load);window.addEventListener("pagehide",()=>{++epoch;$("preferences-form").reset();});render();
    document.querySelector(".skip").addEventListener("click",event=>{event.preventDefault();$("main").focus();$("main").scrollIntoView({block:"start",behavior:"instant"});});
    document.addEventListener("invalid",event=>{const field=event.target;if(field.matches("input,select,textarea"))field.setAttribute("aria-invalid","true");},true);
    document.addEventListener("input",event=>{const field=event.target;if(field.matches("input,select,textarea") && field.validity.valid)field.removeAttribute("aria-invalid");});
})();
