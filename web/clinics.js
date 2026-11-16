"use strict";
const clinicState={epoch:0,origin:null,items:[],radius:25000,area:"",locationBusy:false};
function clinicCoordinates(clinic){
    const c=clinic.location?.coordinates;
    return Array.isArray(c) && c.length===2 && c.every(Number.isFinite) && Math.abs(c[0])<=180 && Math.abs(c[1])<=90 ? c : null;
}
function clinicDistance(c){
    if(!clinicState.origin || !c)return null;
    const r=Math.PI/180,[lng,lat]=c,origin=clinicState.origin;
    const a=Math.sin((lat-origin.lat)*r/2)**2+Math.cos(lat*r)*Math.cos(origin.lat*r)*Math.sin((lng-origin.lng)*r/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(Math.min(1,a)),Math.sqrt(Math.max(0,1-a)));
}
function clinicEmpty(title,description){const root=make("div",undefined,"clinic-empty");root.append(make("div",undefined,"empty-location-mark"),make("h3",title),make("p",description));return root;}
function renderClinics(){
    const root=$("clinic-results");root.replaceChildren();
    const items=[...clinicState.items];
    if($("clinic-sort").value==="name")items.sort((a,b)=>a.name.localeCompare(b.name));
    else if(clinicState.origin)items.sort((a,b)=>(clinicDistance(clinicCoordinates(a)) ?? Infinity)-(clinicDistance(clinicCoordinates(b)) ?? Infinity));
    for(const clinic of items){
        const card=make("article",undefined,"clinic-place"),mark=make("div",undefined,"clinic-place-mark");mark.setAttribute("aria-hidden","true");
        const content=make("div",undefined,"clinic-place-content"),top=make("div",undefined,"clinic-place-top");
        const identity=make("div");identity.append(make("span","LISTED CLINIC","eyebrow"),make("h3",clinic.name));top.append(identity);
        const coordinates=clinicCoordinates(clinic),distance=clinicDistance(coordinates);
        if(distance!==null)top.append(make("span",distance<1 ? Math.round(distance*1000)+" m away" : distance.toFixed(1)+" km away","distance-pill"));
        const address=[clinic.address,clinic.suburb,clinic.city,clinic.country].filter(v=>typeof v==="string" && v.trim()).join(", ");
        content.append(top,make("p",address || "Contact this clinic to confirm its address.","clinic-address"),make("p","Confirm mental health services and availability directly with the clinic.","fine"));
        const actions=make("div",undefined,"clinic-place-actions"),directions=make("a","Get directions","button secondary small");
        directions.href="https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(coordinates ? coordinates[1]+","+coordinates[0] : clinic.name+" "+address);
        directions.target="_blank";directions.rel="noopener noreferrer";actions.append(directions);
        if(typeof clinic.phone==="string" && /^[+0-9 ()-]{5,40}$/.test(clinic.phone)){
            const phone=make("a","Call clinic","text-link small");phone.href="tel:"+clinic.phone.replace(/[ ()-]/g,"");actions.append(phone);
        }
        if(typeof clinic.website==="string"){
            try {const u=new URL(clinic.website);if(u.protocol==="https:" && !u.username && !u.password){const website=make("a","Visit website","text-link small");website.href=u.href;website.target="_blank";website.rel="noopener noreferrer";actions.append(website);}}catch{}
        }
        content.append(actions);card.append(mark,content);root.append(card);
    }
    if(!items.length)root.append(clinicEmpty("No listed clinics here yet.","Try another area or look further afield. You can also explore other providers on Google Maps."));
    $("expand-clinic-search").hidden=!clinicState.origin || clinicState.radius>=100000;
}
async function findClinics({q="",origin=null,area="",radius=25000}={}){
    const epoch=++clinicState.epoch;clinicState.origin=origin;clinicState.area=area;clinicState.radius=radius;
    $("clinic-area-label").textContent=area || "Your current area";$("clinic-results").setAttribute("aria-busy","true");
    $("clinic-results").replaceChildren(clinicEmpty("Finding places to start...","Checking the clinics listed for your area."));
    status("clinic-status","Finding care near "+(area || "you")+"...");$("expand-clinic-search").hidden=true;
    const params=new URLSearchParams();if(q)params.set("q",q);
    if(origin){params.set("lat",origin.lat);params.set("lng",origin.lng);params.set("radius",radius);}
    $("clinic-maps-link").href="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent("mental health clinics "+(origin ? origin.lat+","+origin.lng : q));
    try {
        await backendReady;
        if(backendMode!=="application")throw new Error(backendMode==="preview" ? "The full application server is not running in this layout preview. Start it to search live clinic listings." : "The clinic service could not be reached. Please try again.");
        const data=await api("/clinics?"+params);if(epoch!==clinicState.epoch)return;
        if(!Array.isArray(data))throw new Error("Clinic results could not be read. Please try again.");
        clinicState.items=data.filter(c=>c && typeof c.name==="string" && c.name.trim());renderClinics();
        const count=clinicState.items.length;
        status("clinic-status",count ? count+" listed clinic"+(count===1 ? "" : "s")+(origin ? " near you. Distances are approximate." : " matching your area.") : "No listed clinics match this search yet.");
    }catch(error){if(epoch!==clinicState.epoch)return;clinicState.items=[];
        $("clinic-results").replaceChildren(clinicEmpty("We couldn't load nearby care.","Please try again, or explore clinics on Google Maps."));status("clinic-status",error.message,true);
    }finally{if(epoch===clinicState.epoch)$("clinic-results").removeAttribute("aria-busy");}
}
$("clinic-form").addEventListener("submit",event=>{
    event.preventDefault();const q=$("clinic-query").value.trim();
    if(q.length<2){status("clinic-status","Enter a suburb, city or clinic name, or choose current location.",true);$("clinic-query").focus();return;}
    findClinics({q,area:q});
});
$("locate").addEventListener("click",async()=>{
    if(clinicState.locationBusy)return;
    if(!window.isSecureContext){status("clinic-status","Location needs a secure HTTPS connection or localhost. You can search by area instead.",true);$("clinic-query").focus();return;}
    if(!navigator.geolocation){status("clinic-status","Your browser does not support location access. Search by suburb or city instead.",true);$("clinic-query").focus();return;}
    clinicState.locationBusy=true;$("locate").disabled=true;const epoch=++clinicState.epoch;
    $("clinic-results").removeAttribute("aria-busy");
    status("clinic-status","Allow location access in your browser to find nearby care...");
    try {
        const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:15000,maximumAge:60000}));
        if(epoch!==clinicState.epoch)return;
        const lat=position.coords.latitude,lng=position.coords.longitude;
        if(!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180)throw {code:2};
        $("clinic-query").value="";await findClinics({origin:{lat,lng},area:"Current location"});
    }catch(error){if(epoch!==clinicState.epoch)return;
        const messages={1:"Location access is blocked. Allow it in your browser's site settings and try again, or search by area.",
            2:"Your device couldn't determine its location. Check that device location services are enabled, or search by area.",
            3:"Location is taking too long. Try again, or enter your suburb or city."};
        status("clinic-status",messages[error.code] || "Location couldn't be obtained. Search by area instead.",true);$("clinic-query").focus();
    }finally{clinicState.locationBusy=false;$("locate").disabled=false;}
});
$("clinic-sort").addEventListener("change",renderClinics);
$("expand-clinic-search").addEventListener("click",()=>{if(clinicState.origin)findClinics({origin:clinicState.origin,area:clinicState.area,radius:Math.min(100000,clinicState.radius*2)});});
window.addEventListener("pagehide",()=>{++clinicState.epoch;clinicState.origin=null;clinicState.items=[];$("clinic-query").value="";$("clinic-area-label").textContent="Choose an area";$("clinic-results").replaceChildren();$("clinic-maps-link").href="https://www.google.com/maps/search/mental+health+clinics/";});
