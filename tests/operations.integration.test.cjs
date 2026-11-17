const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const base=process.env.TEST_OPERATIONS_BASE_URL || 'http://127.0.0.1:8084';
const mailbox=process.env.TEST_MAILBOX_BASE_URL || 'http://127.0.0.1:8025';
const mongo=process.env.TEST_MONGO_CONTAINER,container=process.env.TEST_ADMIN_CONTAINER;
const password='operations-fixture-password';
async function api(path,user,body,method=body ? 'POST' : 'GET'){
    const r=await fetch(base+path,{method,headers:{connection:'close',...(user ? {authorization:'Bearer '+user.token} : {}),...(body ? {'content-type':'application/json'} : {})},body:body ? JSON.stringify(body) : undefined});
    const data=await r.json();if(r.status>=500)console.log('Operation failed',path,r.status,data.error);return {status:r.status,data};
}
function database(code){execFileSync('docker',['exec',mongo,'mongosh','--quiet','--eval',`const d=db.getSiblingDB('tranquil_talk');${code}`],{stdio:'pipe'});}
async function receivedLink(email,purpose){
    const deadline=Date.now()+25000;
    while(Date.now()<deadline){
        const response=await fetch(mailbox+'/api/v1/search?query='+encodeURIComponent('to:'+email),{headers:{connection:'close'}});
        if(response.ok){const list=await response.json();for(const summary of list.messages || []){
            const message=await (await fetch(mailbox+'/api/v1/message/'+summary.ID,{headers:{connection:'close'}})).json();
            const match=String(message.Text || '').match(new RegExp('/#account/'+purpose+'/([A-Za-z0-9-]{64,100})'));
            if(match)return match[1];
        }}await new Promise(resolve=>setTimeout(resolve,400));
    }throw new Error('No expected account email arrived in the isolated local inbox');
}
test('real local email delivery, readiness and authorised listing/event management',{skip:!mongo || !container,timeout:120000},async()=>{
    const health=await api('/api/health');assert.equal(health.status,200);assert.equal(health.data.ready,true);assert.equal(health.data.database,'connected');
    const suffix=Date.now();
    async function user(label,role='patient'){
        const email=label+suffix+'@example.com';assert.equal((await api('/api/register',null,{email,password,role})).status,201);
        const r=await api('/api/login',null,{email,password});assert.equal(r.status,200);return {...r.data,email};
    }
    const patient=await user('op-patient-'),expert=await user('op-expert-','expert'),admin=await user('op-admin-'),other=await user('op-other-','expert');
    assert.equal((await api('/api/manage/clinics',patient)).status,403);assert.equal((await api('/api/manage/clinics',expert)).status,403);
    for(const u of [patient,expert,admin])assert.equal((await api('/api/account/request-verification',u,{})).status,200);
    for(const u of [patient,expert,admin]){
        const token=await receivedLink(u.email,'verify');assert.equal((await api('/api/account/verify',null,{token})).status,200);
        assert.equal((await api('/api/me',u)).data.emailVerified,true);
    }
    execFileSync('docker',['exec',container,'/app/TranquilBackend','--grant-admin',admin.email],{stdio:'pipe'});
    for(const u of [expert,other])database(`d.users.updateOne({_id:ObjectId(${JSON.stringify(u.id)})},{$set:{role:'expert',emailVerified:true}});d.expert_profiles.insertOne({_id:ObjectId(${JSON.stringify(u.id)}),name:'Operations fixture professional',status:'approved',revision:1,approvedRevision:1,methods:['audio']});`);
    const clinic={name:'Operations fixture clinic',address:'Test street',city:'OperationsCity'+suffix,suburb:'Test suburb',country:'Test country',phone:'+27120000000',website:'https://clinic.example.com',lat:-25.75,lng:28.23};
    let r=await api('/api/manage/clinics',expert,{...clinic,ownerId:other.id});assert.equal(r.status,200);let record=r.data;assert.ok(record.id);assert.equal(record.ownerId,undefined);
    assert.equal((await api('/api/manage/clinics',expert)).data.items.some(c=>c.id===record.id),true);
    assert.equal((await api('/api/manage/clinics',other)).data.items.some(c=>c.id===record.id),false);
    assert.equal((await api('/api/manage/clinics/'+record.id,other,{...clinic,revision:record.revision},'PUT')).status,404);
    r=await api('/api/manage/clinics/'+record.id,expert,{...clinic,name:'Updated fixture clinic',revision:record.revision},'PUT');assert.equal(r.status,200);record=r.data;
    assert.equal((await api('/api/manage/clinics/'+record.id,expert,{...clinic,revision:1},'PUT')).status,409);
    r=await api('/api/manage/clinics/'+record.id,expert,{revision:record.revision},'DELETE');assert.equal(r.status,200);record=r.data;
    assert.equal((await api('/api/clinics?q='+clinic.city)).data.length,0,'archived clinics are hidden publicly');
    r=await api('/api/manage/clinics/'+record.id,expert,{...clinic,revision:record.revision,archived:false},'PUT');assert.equal(r.status,200);record=r.data;
    assert.equal((await api('/api/clinics?q='+clinic.city)).data.length,1);
    const event={title:'Operations community event '+suffix,description:'A real API test fixture for an upcoming community support workshop.',location:'Test venue',startAt:Math.floor(Date.now()/1000)+86400};
    assert.equal((await api('/api/manage/events',expert,event)).status,403);
    assert.equal((await api('/api/manage/events',admin,{...event,startAt:0})).status,400);
    r=await api('/api/manage/events',admin,event);assert.equal(r.status,200);let published=r.data;
    assert.equal((await api('/api/events')).data.some(e=>e.title===event.title),true);
    r=await api('/api/manage/events/'+published.id,admin,{revision:published.revision},'DELETE');assert.equal(r.status,200);published=r.data;
    assert.equal((await api('/api/events')).data.some(e=>e.title===event.title),false);
    r=await api('/api/manage/events/'+published.id,admin,{...event,revision:published.revision,archived:false},'PUT');assert.equal(r.status,200);
    assert.equal((await api('/api/manage/events?offset=-1',admin)).status,400);
    assert.equal((await api('/api/manage/events?offset=0',admin)).status,200);
    assert.equal((await api('/api/account/request-reset',null,{email:patient.email})).status,200);
    const reset=await receivedLink(patient.email,'reset');assert.equal((await api('/api/account/reset',null,{token:reset,password:'changed-fixture-password'})).status,200);
    assert.equal((await api('/api/me',patient)).status,401,'real reset email invalidates the old session');
    assert.equal((await api('/api/account/delete',expert,{password,confirmation:'DELETE'})).status,200);
    assert.equal((await api('/api/clinics?q='+clinic.city)).data.length,0,'deletion removes owned clinic listings');
    assert.equal((await api('/api/manage/clinics',expert)).status,401);
});
