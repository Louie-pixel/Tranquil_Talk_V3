"use strict";
const careTime={
    zone(){const desired=account?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";try{new Intl.DateTimeFormat(undefined,{timeZone:desired});return desired;}catch{return "UTC";}},
    dateKey(seconds){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:this.zone(),year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(seconds*1000));const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));return p.year+"-"+p.month+"-"+p.day;},
    label(seconds,options={dateStyle:"medium",timeStyle:"short"}){return new Intl.DateTimeFormat(undefined,{timeZone:this.zone(),...options}).format(new Date(seconds*1000));},
    localInput(seconds,zone=this.zone()){const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(seconds*1000)).map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
};
class TranquilCalendar {
    constructor(root,{label="Calendar",onSelect=()=>{}}={}){this.root=root;this.label=label;this.onSelect=onSelect;this.keys=[];this.selected=null;this.month=careTime.dateKey(Date.now()/1000).slice(0,7);this.focusKey=null;this.render();}
    setDates(seconds,{selected=null,preserveMonth=false}={}){
        this.keys=[...new Set(seconds.filter(Number.isFinite).map(s=>careTime.dateKey(s)))].sort();this.selected=this.keys.includes(selected) ? selected : null;
        if(!preserveMonth)this.month=(this.selected || this.keys[0] || careTime.dateKey(Date.now()/1000)).slice(0,7);
        this.render();
    }
    shift(amount){const [year,month]=this.month.split("-").map(Number),date=new Date(Date.UTC(year,month-1+amount,1));this.month=date.toISOString().slice(0,7);this.render();}
    render(){
        const [year,month]=this.month.split("-").map(Number),first=new Date(Date.UTC(year,month-1,1));
        const title=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric",timeZone:"UTC"}).format(first),head=make("div",undefined,"calendar-heading"),heading=make("h4",title);
        const prev=make("button","←","secondary small"),next=make("button","→","secondary small");prev.type=next.type="button";prev.setAttribute("aria-label","Previous month");next.setAttribute("aria-label","Next month");
        const months=this.keys.map(k=>k.slice(0,7));prev.disabled=!months.some(m=>m<this.month);next.disabled=!months.some(m=>m>this.month);
        prev.addEventListener("click",()=>{this.shift(-1);this.root.querySelector('.calendar-day:not(:disabled)')?.focus();});next.addEventListener("click",()=>{this.shift(1);this.root.querySelector('.calendar-day:not(:disabled)')?.focus();});
        head.append(prev,heading,next);const grid=make("div",undefined,"calendar-grid");grid.setAttribute("role","grid");grid.setAttribute("aria-label",this.label+", "+title);
        const weekdays=make("div",undefined,"calendar-week");weekdays.setAttribute("role","row");
        for(let i=0;i<7;i++){const date=new Date(Date.UTC(2024,0,1+i)),full=new Intl.DateTimeFormat(undefined,{weekday:"long",timeZone:"UTC"}).format(date),cell=make("span",full.slice(0,2));cell.setAttribute("role","columnheader");cell.setAttribute("aria-label",full);weekdays.append(cell);}grid.append(weekdays);
        const days=new Date(Date.UTC(year,month,0)).getUTCDate(),offset=(first.getUTCDay()+6)%7,today=careTime.dateKey(Date.now()/1000);
        let row;
        const available=this.keys.filter(k=>k.startsWith(this.month)),tabKey=available.includes(this.focusKey) ? this.focusKey : available.includes(this.selected) ? this.selected : available[0];
        for(let i=0;i<Math.ceil((offset+days)/7)*7;i++){
            if(i%7===0){row=make("div",undefined,"calendar-week");row.setAttribute("role","row");grid.append(row);}
            const day=i-offset+1;if(day<1 || day>days){const blank=make("span");blank.setAttribute("role","gridcell");row.append(blank);continue;}
            const key=this.month+"-"+String(day).padStart(2,"0"),cell=make("div");cell.setAttribute("role","gridcell");cell.setAttribute("aria-selected",String(key===this.selected));
            const button=make("button",String(day),"calendar-day"),date=new Date(Date.UTC(year,month-1,day));button.type="button";button.dataset.date=key;button.disabled=!this.keys.includes(key);button.tabIndex=key===tabKey ? 0 : -1;
            button.setAttribute("aria-label",new Intl.DateTimeFormat(undefined,{dateStyle:"full",timeZone:"UTC"}).format(date)+(button.disabled ? ", no times" : ", available"));
            if(key===today)button.setAttribute("aria-current","date");if(key===this.selected)button.classList.add("selected");
            button.addEventListener("click",()=>{this.selected=key;this.focusKey=key;this.render();this.root.querySelector(`[data-date="${key}"]`)?.focus();this.onSelect(key);});
            button.addEventListener("keydown",event=>{
                const index=this.keys.indexOf(key);let target;
                if(event.key==="ArrowRight")target=this.keys[index+1];else if(event.key==="ArrowLeft")target=this.keys[index-1];
                else if(["ArrowDown","ArrowUp"].includes(event.key)){const d=new Date(key+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+(event.key==="ArrowDown" ? 7 : -7));const desired=d.toISOString().slice(0,10);target=event.key==="ArrowDown" ? this.keys.find(k=>k>=desired) : [...this.keys].reverse().find(k=>k<=desired);}
                else if(event.key==="Home")target=available[0];else if(event.key==="End")target=available.at(-1);else return;
                event.preventDefault();if(target){this.focusKey=target;this.month=target.slice(0,7);this.render();this.root.querySelector(`[data-date="${target}"]`)?.focus();}
            });cell.append(button);row.append(cell);
        }
        this.root.replaceChildren(head,grid);if(!this.keys.length)this.root.append(make("p","No available dates to display.","fine"));
    }
}
