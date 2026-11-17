"use strict";
(() => {
    const count=make("p","","fine");count.id="clinic-filter-count";count.setAttribute("role","status");$("clinic-status").after(count);$("clinic-results").removeAttribute("aria-live");
    const view=$("clinic-map"),tiles=$("map-tiles"),markers=$("map-markers");
    const state={enabled:false,items:[],origin:null,selected:-1,centre:{lat:0,lng:0},zoom:2,tiles:new Map(),frame:0,drag:null,failures:0};
    const motion=()=>matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    function project(lat,lng,z=state.zoom){const n=256*2**z,s=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180);return {x:(lng+180)/360*n,y:(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n};}
    function unproject(x,y){const n=256*2**state.zoom;return {lat:Math.max(-85.0511,Math.min(85.0511,Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI)),lng:((x/n*360+180)%360+360)%360-180};}
    function visible(){return state.enabled && !$("clinic-map-panel").hidden && document.body.dataset.screen==="care";}
    function schedule(){cancelAnimationFrame(state.frame);state.frame=requestAnimationFrame(draw);}
    function draw(){
        if(!visible() || !view.clientWidth)return;
        const width=view.clientWidth,height=view.clientHeight,centre=project(state.centre.lat,state.centre.lng),left=centre.x-width/2,top=centre.y-height/2,n=2**state.zoom,needed=new Set();
        for(let x=Math.floor(left/256);x<=Math.floor((left+width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+height)/256);y++){
            if(y<0 || y>=n)continue;const wrapped=((x%n)+n)%n,key=state.zoom+"/"+x+"/"+y;needed.add(key);let img=state.tiles.get(key);
            if(!img){img=document.createElement("img");img.alt="";img.draggable=false;img.decoding="async";
                // Origin-only referrer identifies the website without disclosing its URL or hash.
                img.referrerPolicy="origin";img.src=`https://tile.openstreetmap.org/${state.zoom}/${wrapped}/${y}.png`;
                img.addEventListener("error",()=>{if(state.enabled){++state.failures;status("map-status","Some map tiles could not load. The clinic list and directions remain available.",true);}});
                state.tiles.set(key,img);tiles.append(img);
            }
            img.style.transform=`translate(${Math.round(x*256-left)}px,${Math.round(y*256-top)}px)`;
        }
        for(const [key,img] of state.tiles)if(!needed.has(key)){img.remove();state.tiles.delete(key);}
        const active=document.activeElement?.dataset.marker;markers.replaceChildren();
        for(const [index,item] of state.items.entries()){
            const coordinate=clinicCoordinates(item);if(!coordinate)continue;const p=project(coordinate[1],coordinate[0]);
            const world=256*n;let dx=p.x-centre.x;dx-=Math.round(dx/world)*world;const x=width/2+dx,y=p.y-top;
            if(x<0 || x>width || y<0 || y>height)continue;
            const marker=make("button",String(index+1),"map-marker"+(state.selected===index ? " selected" : ""));marker.type="button";marker.dataset.marker=String(index);marker.setAttribute("aria-label",item.name+", show clinic details");marker.setAttribute("aria-pressed",String(state.selected===index));marker.style.left=x+"px";marker.style.top=y+"px";
            marker.addEventListener("click",()=>select(index,false));markers.append(marker);if(active===String(index))marker.focus({preventScroll:true});
        }
        if(state.origin){const p=project(state.origin.lat,state.origin.lng),world=256*n;let dx=p.x-centre.x;dx-=Math.round(dx/world)*world;const dot=make("span",undefined,"map-origin");dot.setAttribute("role","img");dot.setAttribute("aria-label","Search location");dot.style.left=(width/2+dx)+"px";dot.style.top=(p.y-top)+"px";markers.append(dot);}
        if(active && !markers.querySelector(`[data-marker="${active}"]`))view.focus({preventScroll:true});
        $("map-zoom-in").disabled=state.zoom>=17;$("map-zoom-out").disabled=state.zoom<=2;
    }
    function fit(){
        const points=state.items.map(clinicCoordinates).filter(Boolean).map(([lng,lat])=>({lat,lng}));if(state.origin)points.push(state.origin);
        if(!points.length){state.centre={lat:0,lng:0};state.zoom=2;}
        else {
            // Unwrap longitudes around the first point for areas crossing the date line.
            const anchor=points[0].lng,lngs=points.map(p=>anchor+((((p.lng-anchor)+180)%360+360)%360)-180);
            const latMin=Math.min(...points.map(p=>p.lat)),latMax=Math.max(...points.map(p=>p.lat)),lngMin=Math.min(...lngs),lngMax=Math.max(...lngs);
            state.centre={lat:(latMin+latMax)/2,lng:((lngMin+lngMax)/2+540)%360-180};state.zoom=points.length===1 ? 13 : 16;
            while(state.zoom>2){const a=project(latMin,lngMin),b=project(latMax,lngMax);if(Math.abs(a.x-b.x)<Math.max(180,view.clientWidth-100) && Math.abs(a.y-b.y)<Math.max(140,view.clientHeight-100))break;--state.zoom;}
        }
        schedule();
    }
    function setView(map){$("clinic-map-panel").hidden=!map;$("clinic-layout").classList.toggle("list-only",!map);$("clinic-list-view").setAttribute("aria-pressed",String(!map));$("clinic-map-view").setAttribute("aria-pressed",String(map));if(map)schedule();}
    function select(index,fromList){
        const item=state.items[index];if(!item)return;state.selected=index;clinicState.selected=item;
        document.querySelectorAll(".clinic-place").forEach((card,i)=>card.classList.toggle("selected",i===index));
        if(fromList){setView(true);const point=clinicCoordinates(item);if(point){state.centre={lat:point[1],lng:point[0]};state.zoom=Math.max(13,state.zoom);}$("clinic-map-panel").scrollIntoView({block:"nearest",behavior:motion()});if(state.enabled)view.focus({preventScroll:true});else $("enable-clinic-map").focus({preventScroll:true});}
        else {const card=$("clinic-card-"+index);card?.scrollIntoView({block:"nearest",behavior:motion()});card?.focus({preventScroll:true});}
        status("map-status",item.name+" selected. Contact the clinic to confirm services.");schedule();
    }
    function pan(dx,dy){const c=project(state.centre.lat,state.centre.lng);state.centre=unproject(c.x+dx,c.y+dy);schedule();}
    function zoom(delta){state.zoom=Math.max(2,Math.min(17,state.zoom+delta));schedule();}
    $("clinic-list-view").addEventListener("click",()=>setView(false));$("clinic-map-view").addEventListener("click",()=>setView(true));
    $("enable-clinic-map").addEventListener("click",()=>{state.enabled=true;state.failures=0;$("map-consent").hidden=true;view.hidden=false;$("disable-clinic-map").hidden=false;$("fit-clinic-map").disabled=false;status("map-status","Map enabled. Only listed clinics are marked.");const selected=clinicCoordinates(state.items[state.selected] || {});if(selected){state.centre={lat:selected[1],lng:selected[0]};state.zoom=14;schedule();}else fit();view.focus();});
    function disable(){state.enabled=false;cancelAnimationFrame(state.frame);tiles.replaceChildren();markers.replaceChildren();state.tiles.clear();view.hidden=true;$("map-consent").hidden=false;$("disable-clinic-map").hidden=true;$("fit-clinic-map").disabled=true;status("map-status","Map off. Clinic search remains available.");}
    $("disable-clinic-map").addEventListener("click",()=>{disable();$("enable-clinic-map").focus();});$("fit-clinic-map").addEventListener("click",fit);
    $("map-zoom-in").addEventListener("click",()=>zoom(1));$("map-zoom-out").addEventListener("click",()=>zoom(-1));
    for(const [direction,x,y] of [["north",0,-160],["south",0,160],["east",160,0],["west",-160,0]])$("map-pan-"+direction).addEventListener("click",()=>pan(x,y));
    view.addEventListener("keydown",event=>{if(event.target!==view)return;const actions={ArrowUp:()=>pan(0,-100),ArrowDown:()=>pan(0,100),ArrowLeft:()=>pan(-100,0),ArrowRight:()=>pan(100,0),"+":()=>zoom(1),"=":()=>zoom(1),"-":()=>zoom(-1)};if(actions[event.key]){event.preventDefault();actions[event.key]();}});
    view.addEventListener("pointerdown",event=>{if(event.target.closest("button,a") || !state.enabled || event.button!==0)return;state.drag={x:event.clientX,y:event.clientY,id:event.pointerId};view.setPointerCapture(event.pointerId);view.classList.add("dragging");});
    view.addEventListener("pointermove",event=>{if(state.drag?.id!==event.pointerId)return;pan(state.drag.x-event.clientX,state.drag.y-event.clientY);state.drag.x=event.clientX;state.drag.y=event.clientY;});
    for(const type of ["pointerup","pointercancel","lostpointercapture"])view.addEventListener(type,()=>{state.drag=null;view.classList.remove("dragging");});
    window.addEventListener("tranquil-clinic-results",event=>{state.items=event.detail.items;state.origin=event.detail.origin;state.selected=event.detail.selected;if(state.enabled)fit();});
    window.addEventListener("tranquil-clinic-select",event=>select(event.detail.index,event.detail.fromList));
    window.addEventListener("hashchange",schedule);if(window.ResizeObserver)new ResizeObserver(schedule).observe(view);else window.addEventListener("resize",schedule);
    window.addEventListener("pagehide",()=>{disable();state.items=[];state.origin=null;state.selected=-1;});
})();
