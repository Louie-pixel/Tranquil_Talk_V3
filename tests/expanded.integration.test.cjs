const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const base=process.env.TEST_EXPANDED_BASE_URL || 'http://127.0.0.1:8085',mailbox=process.env.TEST_MAILBOX_BASE_URL || 'http://127.0.0.1:8025';
const mongo=process.env.TEST_MONGO_CONTAINER,container=process.env.TEST_ADMIN_CONTAINER,password='expanded-fixture-password';
function db(code){return JSON.parse(execFileSync('docker',['exec',mongo,'mongosh','--quiet','--eval',`const d=db.getSiblingDB('tranquil_talk');const value=(()=>{${code}})();print(JSON.stringify(value ?? null));`],{encoding:'utf8'}).trim());}
async function api(path,user,body,method=body ? 'POST' : 'GET'){const response=await fetch(base+'/api'+path,{method,headers:{connection:'close',...(user ? {authorization:'Bearer '+user.token} : {}),...(body ? {'content-type':'application/json'} : {})},body:body ? JSON.stringify(body) : undefined});return {status:response.status,data:await response.json()};}
async function poll(fn,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,300));}throw new Error('Timed out: '+label);}
async function message(email,predicate){return poll(async()=>{const list=await (await fetch(mailbox+'/api/v1/search?query='+encodeURIComponent('to:'+email))).json();for(const item of list.messages || []){const m=await (await fetch(mailbox+'/api/v1/message/'+item.ID)).json();if(predicate(m))return m;}},'expected local fixture email');}
async function link(email,purpose){const m=await message(email,m=>String(m.Text).includes('/#account/'+purpose+'/'));return m.Text.match(new RegExp('/#account/'+purpose+'/([A-Za-z0-9-]{64,100})'))[1];}
test('timezone/DST, transactional reminders, delivery recovery and reviewed clinic imports',{skip:!mongo || !container,timeout:180000},async()=>{
    const suffix=Date.now();async function user(label,role='patient'){const email=label+suffix+'@example.com';assert.equal((await api('/register',null,{email,password,role})).status,201);const login=await api('/login',null,{email,password});assert.equal(login.status,200);return {...login.data,email};}
    const patient=await user('expanded-patient-'),expert=await user('expanded-expert-','expert'),admin=await user('expanded-admin-');
    for(const u of [patient,expert,admin])assert.equal((await api('/account/request-verification',u,{})).status,200);
    for(const u of [patient,expert,admin])assert.equal((await api('/account/verify',null,{token:await link(u.email,'verify')})).status,200);
    execFileSync('docker',['exec',container,'/app/TranquilBackend','--grant-admin',admin.email],{stdio:'pipe'});
    db(`d.users.updateOne({_id:ObjectId(${JSON.stringify(expert.id)})},{$set:{role:'expert'}});d.expert_profiles.insertOne({_id:ObjectId(${JSON.stringify(expert.id)}),name:'Expanded fixture professional',status:'approved',revision:1,approvedRevision:1,methods:['audio','video','in_person']});`);
    assert.ok((await api('/timezones')).data.items.includes('UTC'));
    assert.equal((await api('/account/preferences',patient,{timeZone:'Not/A_Zone'},'PUT')).status,400);
    assert.equal((await api('/account/preferences',patient,{role:'admin'},'PUT')).status,400);
    assert.equal((await api('/account/preferences',patient,{timeZone:'Africa/Johannesburg',appointmentEmails:true,appointmentReminders:true},'PUT')).status,200);
    assert.equal((await api('/account/preferences',expert,{timeZone:'America/New_York'},'PUT')).status,200);
    const event={title:'DST fixture '+suffix,description:'A disposable fixture validating calendar conversions across clock changes.',location:'Fixture location',timeZone:'America/New_York'};
    assert.equal((await api('/manage/events',admin,{...event,localStart:'2027-03-14T02:30'})).status,400,'nonexistent local time rejected');
    assert.equal((await api('/manage/events',admin,{...event,localStart:'2027-11-07T01:30'})).status,400,'repeated local time needs occurrence');
    for(const [occurrence,expected] of [['earlier','2027-11-07T05:30:00Z'],['later','2027-11-07T06:30:00Z']]){const r=await api('/manage/events',admin,{...event,localStart:'2027-11-07T01:30',occurrence});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.startsAt,expected);}
    assert.equal((await api('/manage/events',admin,{...event,localStart:'2027-02-30T14:00'})).status,400);
    assert.equal((await api('/manage/events',admin,{...event,localStart:'2027-01-01T14:00',startAt:Date.now()/1000+86400})).status,400);
    const start=Math.ceil((Date.now()/1000+52*3600)/1800)*1800;
    for(const offset of [0,1800])assert.equal((await api('/availability/'+expert.id,expert,{startAt:start+offset,timeZone:'UTC'})).status,200);
    assert.equal((await api('/availability/'+expert.id,expert,{localStart:new Date((start+3600)*1000).toISOString().slice(0,16),timeZone:'UTC'})).status,200);
    const slots=(await api('/availability/'+expert.id)).data.items;
    let r=await api('/appointments',patient,{expertId:expert.id,slotId:slots[0].id,mode:'audio',alias:'Private Fixture Alias'});assert.equal(r.status,200);let a=r.data;
    assert.equal(a.time.timeZone,'Africa/Johannesburg');assert.ok(a.time.localStart.endsWith('+02:00'));assert.equal(a.patientId,undefined);
    r=await api(`/appointments/${a.id}/accept`,expert,{revision:a.revision});assert.equal(r.status,200);a=r.data;
    const reminders=()=>db(`return d.mail_outbox.find({appointmentId:${JSON.stringify(a.id)},purpose:{$regex:'^reminder-'}}).toArray();`);
    assert.equal(reminders().length,4,'two reminders per participant');
    const update=await message(patient.email,m=>m.Subject==='Tranquil Talk appointment update' && m.Text.includes('status: accepted'));
    assert.ok(update.Text.includes('Africa/Johannesburg'));assert.ok(!update.Text.includes(expert.email));assert.ok(!update.Text.includes('Private Fixture Alias'));
    assert.equal((await api('/account/preferences',patient,{appointmentReminders:false},'PUT')).status,200);assert.equal(reminders().length,2);
    assert.equal((await api('/account/preferences',patient,{appointmentReminders:true},'PUT')).status,200);assert.equal(reminders().length,4);
    db(`d.mail_outbox.updateOne({appointmentId:${JSON.stringify(a.id)},userId:${JSON.stringify(patient.id)},purpose:'reminder-3600'},{$set:{nextAttempt:Date.now()/1000-1}});`);
    const reminder=await message(patient.email,m=>m.Subject==='Tranquil Talk appointment reminder');assert.ok(reminder.Text.includes('Africa/Johannesburg'));assert.ok(!reminder.Text.includes(expert.email));
    r=await api(`/appointments/${a.id}/propose`,expert,{revision:a.revision,slotId:slots[1].id});assert.equal(r.status,200);a=r.data;assert.equal(reminders().length,0,'proposal invalidates reminders');
    r=await api(`/appointments/${a.id}/accept`,patient,{revision:a.revision});assert.equal(r.status,200);a=r.data;assert.equal(reminders().length,4);
    r=await api(`/appointments/${a.id}/cancel`,patient,{revision:a.revision});assert.equal(r.status,200);a=r.data;assert.equal(reminders().length,0);
    const retryId='fixture-retry-'+suffix;
    db(`d.mail_outbox.insertOne({_id:${JSON.stringify(retryId)},kind:'appointment',appointmentId:${JSON.stringify(a.id)},appointmentRevision:${a.revision},userId:${JSON.stringify(expert.id)},purpose:'update',state:'failed',attempts:8,createdAt:Date.now()/1000,nextAttempt:Date.now()/1000,expiresAt:Date.now()/1000+300});`);
    assert.equal((await api('/admin/mail/retry',patient,{id:retryId})).status,403);
    assert.ok((await api('/admin/operations',admin)).data.failedItems.some(i=>i.id===retryId));
    assert.equal((await api('/admin/mail/retry',admin,{id:retryId})).status,200);
    await poll(async()=>!db(`return d.mail_outbox.findOne({_id:${JSON.stringify(retryId)}});`),'retry sent');
    const city='ExpandedFixtureCity'+suffix,sourceId='fixture-'+suffix;
    const item={externalId:'clinic/one',name:'Import fixture one',lat:-25.75,lng:28.23,address:'Fixture street',city,country:'Fixture country',category:'mental_health',website:'https://example.com'};
    const batch={sourceId,sourceName:'Disposable fixture source',sourceUrl:'https://example.com/source',reviewed:true,items:[item,{...item,externalId:'clinic/two',name:'Import fixture two'}]};
    assert.equal((await api('/admin/clinics/import',patient,batch)).status,403);
    assert.equal((await api('/admin/clinics/import',admin,{...batch,items:[item,{...item,externalId:'bad',address:''}]})).status,400);
    assert.equal((await api('/clinics?q='+city)).data.length,0,'invalid batch commits no rows');
    r=await api('/admin/clinics/import',admin,batch);assert.equal(r.status,200);assert.equal(r.data.created,2);
    r=await api('/admin/clinics/import',admin,batch);assert.equal(r.data.created,0);assert.equal(r.data.updated,2);
    const id=createHash('sha256').update(sourceId+':'+item.externalId).digest('hex').slice(0,24),record=(await api('/manage/clinics',admin)).data.items.find(i=>i.id===id);assert.ok(record);
    r=await api('/manage/clinics/'+id,admin,{...item,name:'Reviewed manual correction',revision:record.revision},'PUT');assert.equal(r.status,200);assert.equal(r.data.sourceLocked,true);
    r=await api('/admin/clinics/import',admin,batch);assert.equal(r.data.skippedReviewed,1);
    let publicItems=(await api('/clinics?q='+city)).data;assert.equal(publicItems.length,2);assert.ok(publicItems.some(i=>i.name==='Reviewed manual correction'));assert.ok(publicItems.every(i=>i.sourceName===batch.sourceName && !i.ownerId));
    const latest=(await api('/manage/clinics',admin)).data.items.find(i=>i.id===id);assert.equal((await api('/manage/clinics/'+id,admin,{revision:latest.revision},'DELETE')).status,200);
    assert.equal((await api('/admin/clinics/import',admin,{...batch,overwriteReviewed:true})).status,200);assert.equal((await api('/clinics?q='+city)).data.length,1,'refresh preserves archive');
    assert.equal((await api('/admin/clinics/osm-preview',admin,{lat:-25.75,lng:28.23,radius:5000})).status,503,'external source is opt-in; CI sends no source request');
    assert.equal((await api('/account/request-reset',null,{email:patient.email})).status,200);const token=await link(patient.email,'reset');assert.equal((await api('/account/reset',null,{token,password:'changed-expanded-password'})).status,200);
    assert.equal((await api('/me',patient)).status,401);assert.equal((await api('/account/reset',null,{token,password:'another-expanded-password'})).status,400);
    const login=await api('/login',null,{email:patient.email,password:'changed-expanded-password'});assert.equal(login.status,200);assert.equal((await api('/account/delete',login.data,{password:'changed-expanded-password',confirmation:'DELETE'})).status,200);
});
