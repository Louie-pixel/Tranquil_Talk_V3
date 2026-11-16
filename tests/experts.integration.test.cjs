const {test}=require("node:test");
const assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const base=process.env.TEST_PROFILES_BASE_URL || "http://127.0.0.1:8081";
const container=process.env.TEST_ADMIN_CONTAINER;
async function api(path,{method="GET",body,token}={}){
    const response=await fetch(base+path,{method,headers:{connection:"close",
        ...(body?{"content-type":"application/json"}:{}),...(token?{authorization:"Bearer "+token}:{})},
        body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
}
test("expert application lifecycle, private credentials, revision reviews and immediate access revocation",
    {timeout:60000,skip:!container},async()=>{
    const suffix=Date.now(),password="a-private-fixture-password";
    async function account(label,role){
        const email=label+"-"+suffix+"@example.com";
        assert.equal((await api("/api/register",{method:"POST",body:{email,password,role}})).status,201);
        const result=await api("/api/login",{method:"POST",body:{email,password}});
        assert.equal(result.status,200);
        const claims=JSON.parse(Buffer.from(result.data.token.split(".")[1],"base64url"));
        return {email,token:result.data.token,id:claims.sub};
    }
    const admin=await account("review-operator","patient"),expert=await account("profile-applicant","expert"),
        other=await account("other-applicant","expert"),patient=await account("profile-patient","patient");
    assert.equal((await api("/api/admin/experts",{token:admin.token})).status,403);
    // Explicit operator command against a disposable CI container; no public role-promotion endpoint.
    execFileSync("docker",["exec",container,"/app/TranquilBackend","--grant-admin",admin.email],{stdio:"pipe"});
    assert.equal((await api("/api/me",{token:admin.token})).data.role,"admin");
    assert.equal((await api("/api/admin/experts")).status,401);
    assert.equal((await api("/api/admin/experts",{token:expert.token})).status,403);
    assert.equal((await api("/api/expert-profile",{token:patient.token})).status,403);
    assert.equal((await api("/api/expert-profile",{token:other.token})).data.profile,null);
    assert.equal((await api("/api/expert-profile",{method:"PUT",token:patient.token,body:{revision:0,name:"No"}})).status,403);
    let saved=await api("/api/expert-profile",{method:"PUT",token:expert.token,body:{revision:0,name:"Integration Professional"}});
    assert.equal(saved.status,200);let profile=saved.data.profile;
    assert.equal(profile.status,"draft");
    assert.equal((await api("/api/expert-profile/submit",{method:"POST",token:expert.token,body:{revision:profile.revision}})).status,400);
    assert.equal((await api("/api/experts/"+expert.id)).status,404);
    const complete={
        name:"Integration Professional",professionalTitle:"Counselling psychologist",
        bio:"I offer a thoughtful and collaborative approach to supporting adults through stress and major changes in their lives.",
        city:"Pretoria",country:"South Africa",practiceName:"Integration-only practice",website:"https://practice.example.com",
        yearsExperience:7,specialties:["Stress","Anxiety"],languages:["English","Kiswahili"],
        qualifications:["Master of Counselling Psychology, Test Institution"],methods:["audio","video"],
        registrationBody:"Test-only professional register",registrationNumber:"PRIVATE-REG-123",
        registrationCountry:"South Africa",credentialReference:"https://register.example.com/check"
    };
    const save=async()=>api("/api/expert-profile",{method:"PUT",token:expert.token,body:{...complete,revision:profile.revision}});
    assert.equal((await api("/api/expert-profile",{method:"PUT",token:expert.token,
        body:{...complete,revision:profile.revision,status:"approved"}})).status,400);
    assert.equal((await api("/api/expert-profile",{method:"PUT",token:expert.token,
        body:{...complete,revision:profile.revision,reviews:[]}})).status,400);
    assert.equal((await api("/api/expert-profile",{method:"PUT",token:expert.token,
        body:{...complete,revision:profile.revision,website:"javascript:alert(1)"}})).status,400);
    async function saveAndSubmit(){
        const result=await save();assert.equal(result.status,200);profile=result.data.profile;
        const submit=await api("/api/expert-profile/submit",{method:"POST",token:expert.token,body:{revision:profile.revision}});
        assert.equal(submit.status,200);profile=submit.data.profile;assert.equal(profile.status,"pending");
    }
    const decision=async(action,extra={})=>api("/api/admin/experts/"+expert.id+"/review",{
        method:"POST",token:admin.token,body:{revision:profile.revision,action,
            note:"Registration details checked for this integration-only application.",...extra}});
    await saveAndSubmit();
    const queue=await api("/api/admin/experts?status=pending",{token:admin.token});
    assert.equal(queue.status,200);
    assert.equal(queue.data.items.find(item=>item.id===expert.id).registrationNumber,"PRIVATE-REG-123");
    assert.equal((await decision("approve")).status,400);
    assert.equal((await decision("approve",{registryChecked:true,reference:"http://insecure.example"})).status,400);
    assert.equal((await decision("approve",{revision:profile.revision-1,registryChecked:true,reference:"https://register.example.com"})).status,409);
    const returned=await decision("request_changes");assert.equal(returned.status,200);profile=returned.data.profile;
    assert.equal(profile.status,"changes_requested");
    const own=await api("/api/expert-profile",{token:expert.token});
    assert.equal(own.data.profile.reviews.length,1);
    assert.equal(own.data.profile.reviews[0].reviewerId,undefined);
    assert.equal((await api("/api/expert-profile",{token:other.token})).data.profile,null);
    await saveAndSubmit();
    const approved=await decision("approve",{registryChecked:true,reference:"https://register.example.com/confirmed"});
    assert.equal(approved.status,200);profile=approved.data.profile;
    assert.equal(profile.status,"approved");
    // Old pending-expert token gains current access only after an administrator records approval.
    assert.equal((await api("/api/me",{token:expert.token})).data.role,"expert");
    const publicProfile=await api("/api/experts/"+expert.id);assert.equal(publicProfile.status,200);
    for(const key of ["registrationNumber","registrationBody","credentialReference","reviews","email","password","reviewerId","approvedRevision"])
        assert.equal(publicProfile.data[key],undefined);
    assert.equal(publicProfile.data.verificationLabel,"Registration reviewed");
    const results=await api("/api/experts?q=Integration&specialty=Stress&language=english&method=audio");
    assert.equal(results.status,200);assert(results.data.items.some(item=>item.id===expert.id));
    assert.equal(JSON.stringify(results.data).includes("PRIVATE-REG-123"),false);
    assert.equal((await api("/api/experts?q="+encodeURIComponent(".*"))).data.items.length,0);
    assert.equal((await api("/api/experts?offset=1.5")).status,400);
    const article={title:"Integration-only article",body:"An integration-only article with sufficient length to validate verified publishing permissions.",author:"Test Contributor"};
    assert.equal((await api("/api/blogs",{method:"POST",token:expert.token,body:article})).status,201);
    const stale=profile.revision;
    saved=await save();assert.equal(saved.status,200);profile=saved.data.profile;
    assert.equal(profile.status,"draft");
    assert.equal((await api("/api/me",{token:expert.token})).data.role,"expert_pending");
    assert.equal((await api("/api/experts/"+expert.id)).status,404);
    assert.equal((await api("/api/blogs",{method:"POST",token:expert.token,body:article})).status,403);
    assert.equal((await api("/api/expert-profile",{method:"PUT",token:expert.token,body:{...complete,revision:stale}})).status,409);
    let submitted=await api("/api/expert-profile/submit",{method:"POST",token:expert.token,body:{revision:profile.revision}});
    assert.equal(submitted.status,200);profile=submitted.data.profile;
    const approvedAgain=await decision("approve",{registryChecked:true,reference:"https://register.example.com/confirmed"});
    assert.equal(approvedAgain.status,200);profile=approvedAgain.data.profile;
    const suspended=await decision("suspend");assert.equal(suspended.status,200);profile=suspended.data.profile;
    assert.equal(profile.status,"suspended");
    assert.equal((await api("/api/me",{token:expert.token})).data.role,"expert_pending");
    assert.equal((await api("/api/experts/"+expert.id)).status,404);
    assert.equal((await api("/api/blogs",{method:"POST",token:expert.token,body:article})).status,403);
    assert.equal((await save()).status,403);
    assert.equal((await api("/api/expert-profile/submit",{method:"POST",token:expert.token,body:{revision:profile.revision}})).status,409);
    assert.equal((await api("/api/admin/experts/"+admin.id+"/review",{method:"POST",token:admin.token,
        body:{revision:1,action:"approve",note:"An attempted self review must not be permitted.",registryChecked:true,reference:"https://register.example.com"}})).status,403);
    const reopened=await decision("request_changes");assert.equal(reopened.status,200);
    assert.equal(reopened.data.profile.status,"changes_requested");
    assert.equal(reopened.data.profile.reviews.length,5);
});
