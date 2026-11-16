const {test}=require("node:test");
const assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const base=process.env.TEST_WORKFLOW_BASE_URL || "http://127.0.0.1:8082";
const mongo=process.env.TEST_MONGO_CONTAINER;
const password="test-only-workflow-password";
function database(code){return JSON.parse(execFileSync("docker",["exec",mongo,"mongosh","--quiet","--eval",`const d=db.getSiblingDB('tranquil_talk'); const result=(()=>{${code}})(); print(JSON.stringify(result ?? null));`],{encoding:"utf8"}).trim());}
async function api(path,token,body,method=body ? "POST" : "GET"){
    const r=await fetch(base+"/api"+path,{method,headers:{connection:"close",...(token ? {authorization:"Bearer "+token} : {}),...(body ? {"content-type":"application/json"} : {})},body:body ? JSON.stringify(body) : undefined});
    return {status:r.status,data:await r.json()};
}
test("transactional booking, participant-only rooms, account actions and moderation",{skip:!mongo,timeout:90000},async()=>{
    async function user(label,role="patient"){
        const email=label+"-"+Date.now()+"@example.com";
        assert.equal((await api("/register",null,{email,password,role})).status,201);
        const r=await api("/login",null,{email,password});assert.equal(r.status,200);return {...r.data,email};
    }
    const p1=await user("booking-patient-one"),p2=await user("booking-patient-two"),e1=await user("booking-expert-one","expert"),e2=await user("booking-expert-two","expert");
    const ids=[p1.id,p2.id,e1.id,e2.id];
    // Trusted fixture setup exercises booking independently of the existing verification-lifecycle suite.
    for(const e of [e1,e2])database(`d.users.updateOne({_id:ObjectId(${JSON.stringify(e.id)})},{$set:{role:'expert',emailVerified:true}});d.expert_profiles.insertOne({_id:ObjectId(${JSON.stringify(e.id)}),name:'Fixture Professional',status:'approved',revision:1,approvedRevision:1,methods:['audio','video','in_person']});`);
    const start=Math.ceil((Date.now()/1000+1200)/1800)*1800;
    for(const e of [e1,e2])for(const offset of [0,1800,3600])assert.equal((await api("/availability/"+e.id,e.token,{startAt:start+offset,location:"Fixture practice"})).status,200);
    assert.equal((await api("/availability/"+e1.id,p1.token,{startAt:start+7200})).status,403);
    const slots=(await api("/availability/"+e1.id)).data.items;
    const request={expertId:e1.id,slotId:slots[0].id,mode:"audio",alias:"Quiet River"};
    assert.equal((await api("/appointments",p1.token,request)).status,403,"unverified email cannot book");
    assert.equal((await api("/account/request-verification",p1.token,{})).status,200);
    const email=database(`return d.mail_outbox.findOne({userId:${JSON.stringify(p1.id)},purpose:'verify'});`);
    assert.ok(email && email.url.includes("/#account/verify/"));const token=email.url.split("/").at(-1);
    assert.equal((await api("/account/verify",null,{token})).status,200);
    assert.equal((await api("/account/verify",null,{token})).status,400,"verification link is single-use");
    database(`d.users.updateOne({_id:ObjectId(${JSON.stringify(p2.id)})},{$set:{emailVerified:true}});`);
    const competing=await Promise.all([p1,p2].map(p=>api("/appointments",p.token,request)));
    assert.deepEqual(competing.map(r=>r.status).sort(),[200,409],"one winner for simultaneous requests");
    const winner=competing[0].status===200 ? p1 : p2,other=winner===p1 ? p2 : p1;
    let a=competing.find(r=>r.status===200).data;
    assert.ok(!JSON.stringify(a).includes(winner.email));assert.equal(a.patientId,undefined);assert.equal(a.roomId,undefined);
    const otherSlot=(await api("/availability/"+e2.id)).data.items[0];
    assert.equal((await api("/appointments",winner.token,{...request,expertId:e2.id,slotId:otherSlot.id})).status,409,"patient cannot book another expert at same time");
    assert.equal((await api("/availability/"+e1.id,e1.token,{startAt:start,remove:true})).status,409,"reserved slot cannot be deleted");
    assert.equal((await api(`/appointments/${a.id}/accept`,other.token,{revision:a.revision})).status,404);
    assert.equal((await api(`/appointments/${a.id}/accept`,winner.token,{revision:a.revision})).status,409);
    let r=await api(`/appointments/${a.id}/accept`,e1.token,{revision:a.revision});assert.equal(r.status,200);a=r.data;
    assert.equal((await api(`/appointments/${a.id}/cancel`,winner.token,{revision:1})).status,409,"stale update rejected");
    assert.equal((await api(`/appointments/${a.id}/join`,other.token,{})).status,404);
    assert.equal((await api(`/appointments/${a.id}/join`,winner.token,{})).status,403,"cannot join before waiting room");
    r=await api(`/appointments/${a.id}/propose`,e1.token,{revision:a.revision,slotId:slots[1].id});assert.equal(r.status,200);a=r.data;
    assert.equal(a.status,"proposed");assert.equal((await api(`/appointments/${a.id}/accept`,e1.token,{revision:a.revision})).status,409);
    r=await api(`/appointments/${a.id}/accept`,winner.token,{revision:a.revision});assert.equal(r.status,200);a=r.data;
    // Move only this fixture into its join window to exercise ticket enforcement without waiting in CI.
    database(`d.appointments.updateOne({_id:${JSON.stringify(a.id)}},{$set:{startAt:Math.floor(Date.now()/1000)-60}});`);
    const joined=await api(`/appointments/${a.id}/join`,winner.token,{});assert.equal(joined.status,200);
    const claims=JSON.parse(Buffer.from(joined.data.ticket.split('.')[1],'base64url'));
    assert.equal(claims.aud,"tranquil-appointment");assert.equal(claims.userId,winner.id);assert.ok(!JSON.stringify(claims).includes(winner.email));
    async function socketJoin(accessToken){
        const ws=new WebSocket(base.replace("http","ws")+"/rtc/signal");
        const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("WebSocket timeout")),8000);ws.onopen=()=>ws.send(JSON.stringify({type:"join",ticket:joined.data.ticket,...(accessToken ? {accessToken} : {})}));ws.onmessage=e=>{clearTimeout(timeout);resolve(JSON.parse(e.data));};ws.onerror=reject;});ws.close();return result;
    }
    assert.equal((await socketJoin()).type,"error","forwarded ticket alone cannot enter");
    assert.equal((await socketJoin(other.token)).type,"error","nonparticipant token cannot enter");
    assert.equal((await socketJoin(winner.token)).type,"joined");
    database(`d.appointments.updateOne({_id:${JSON.stringify(a.id)}},{$set:{startAt:${a.startAt}}});`);
    assert.equal((await api(`/appointments/${a.id}/cancel`,winner.token,{revision:a.revision})).status,200);
    assert.equal((await api(`/appointments/${a.id}/join`,winner.token,{})).status,403);
    assert.equal((await api("/appointments",other.token,{...request,slotId:slots[1].id})).status,200,"cancellation frees both reservations");
    const report=await api("/reports",p1.token,{targetType:"expert",targetId:e1.id,reason:"Test-only report for a moderation lifecycle."});assert.equal(report.status,200);
    assert.equal((await api("/reports",p1.token)).status,403);
    database(`d.users.updateOne({_id:ObjectId(${JSON.stringify(e2.id)})},{$set:{role:'admin'}});`);
    const reports=(await api("/reports",e2.token)).data.items;const own=reports.find(r=>r.targetId===e1.id);assert.ok(own);
    assert.equal((await api("/reports/"+own.id,e2.token,{action:"restrict",note:"Test fixture restriction after recorded review."})).status,200);
    assert.equal((await api("/me",e1.token)).status,401,"restriction revokes existing access");
    const oldToken=p1.token;
    assert.equal((await api("/account/request-reset",null,{email:p1.email})).status,200);
    const reset=database(`return d.mail_outbox.findOne({userId:${JSON.stringify(p1.id)},purpose:'reset'});`).url.split('/').at(-1);
    assert.equal((await api("/account/reset",null,{token:reset,password:"new-test-only-password"})).status,200);
    assert.equal((await api("/me",oldToken)).status,401,"password recovery invalidates old sessions");
    assert.equal((await api("/account/reset",null,{token:reset,password:"another-test-password"})).status,400);
    const signedIn=await api("/login",null,{email:p1.email,password:"new-test-only-password"});assert.equal(signedIn.status,200);
    assert.equal((await api("/account/delete",p2.token,{password,confirmation:"DELETE"})).status,200);
    assert.equal((await api("/me",p2.token)).status,401);assert.equal(database(`return d.users.countDocuments({_id:ObjectId(${JSON.stringify(p2.id)})});`),0);
    assert.equal(database(`return d.reservations.countDocuments({userId:${JSON.stringify(p2.id)}});`),0);
    const config=(await api("/rtc-config",signedIn.data.token)).data;assert.equal(config.relayAvailable,true);assert.equal(config.iceTransportPolicy,"relay");
    assert.ok(config.iceServers[0].credential);assert.ok(!JSON.stringify(config).includes("ci-test-turn-secret"));
    assert.equal(ids.length,4);
});
