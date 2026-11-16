const {test,expect}=require("@playwright/test");
const {execFileSync}=require("node:child_process");
test("an accepted appointment connects its two accounts using only the patient alias and releases devices",async({browser,request,baseURL})=>{
    test.skip(!process.env.TEST_MONGO_CONTAINER,"Requires a disposable MongoDB fixture container");
    const password="appointment-test-password",suffix=Date.now();
    async function create(label,role){
        const email=label+suffix+"@example.com";expect((await request.post("/api/register",{data:{email,password,role}})).status()).toBe(201);
        const login=await request.post("/api/login",{data:{email,password}});expect(login.status()).toBe(200);return {...await login.json(),email};
    }
    const patient=await create("call-patient-","patient"),expert=await create("call-professional-","expert");
    function database(script){execFileSync("docker",["exec",process.env.TEST_MONGO_CONTAINER,"mongosh","--quiet","--eval","const d=db.getSiblingDB('tranquil_talk');"+script],{stdio:"pipe"});}
    database(`d.users.updateMany({_id:{$in:[ObjectId(${JSON.stringify(patient.id)}),ObjectId(${JSON.stringify(expert.id)})]}},{$set:{emailVerified:true}});d.users.updateOne({_id:ObjectId(${JSON.stringify(expert.id)})},{$set:{role:'expert'}});d.expert_profiles.insertOne({_id:ObjectId(${JSON.stringify(expert.id)}),name:'Call Fixture Professional',status:'approved',revision:1,approvedRevision:1,methods:['audio']});`);
    const start=Math.ceil((Date.now()/1000+600)/1800)*1800,headers=token=>({authorization:"Bearer "+token});
    expect((await request.post("/api/availability/"+expert.id,{headers:headers(expert.token),data:{startAt:start}})).status()).toBe(200);
    const slots=await (await request.get("/api/availability/"+expert.id)).json();
    const created=await request.post("/api/appointments",{headers:headers(patient.token),data:{expertId:expert.id,mode:"audio",alias:"Quiet River",slotId:slots.items[0].id}});expect(created.status()).toBe(200);
    const a=await created.json();const accepted=await request.post(`/api/appointments/${a.id}/accept`,{headers:headers(expert.token),data:{revision:a.revision}});
    expect(accepted.status(),await accepted.text()).toBe(200);
    // Move a disposable fixture into the consultation window; booking rules are covered separately.
    database(`d.appointments.updateOne({_id:${JSON.stringify(a.id)}},{$set:{startAt:Math.floor(Date.now()/1000)-30}});`);
    const contexts=await Promise.all([0,1].map(()=>browser.newContext({baseURL,permissions:["microphone","camera"]})));
    try {
        const pages=await Promise.all(contexts.map(c=>c.newPage()));
        const errors=[];pages.forEach(page=>page.on("pageerror",e=>errors.push(e.message)));
        for(const [index,user] of [patient,expert].entries()){
            const page=pages[index];await page.goto("/#appointments");await page.locator("#account-button").click();
            await page.locator('#auth-form [name="email"]').fill(user.email);await page.locator("#password").fill(password);await page.locator("#auth-submit").click();
            await expect(page.locator("#auth-dialog")).toBeHidden();await expect(page.getByRole("button",{name:"Open waiting room"})).toBeEnabled();
            if(index===1){expect(await page.locator("#appointment-list").innerText()).not.toContain(patient.email);await expect(page.locator("#appointment-list h3")).toHaveText("Quiet River");}
            await page.getByRole("button",{name:"Open waiting room"}).click();
            expect(await page.evaluate(()=>document.getElementById("consultation-local").srcObject)).toBe(null);
            await page.getByRole("button",{name:"Check microphone",exact:true}).click();
            await expect(page.locator("#device-confirmation")).toBeVisible();
            expect(await page.evaluate(()=>workspace.rtc.stream.getVideoTracks().length)).toBe(0);
            // Media has not been sent and a signaling socket has not been created during the device check.
            expect(await page.evaluate(()=>workspace.ws)).toBe(null);
            await page.locator("#devices-ready").check();await page.getByRole("button",{name:"Enter consultation",exact:true}).click();
        }
        for(const page of pages)await expect(page.locator("#consultation-status")).toHaveText("Connected",{timeout:15000});
        await pages[0].getByRole("button",{name:"Mute microphone",exact:true}).click();
        expect(await pages[0].evaluate(()=>workspace.rtc.stream.getAudioTracks()[0].enabled)).toBe(false);
        await pages[0].locator("#close-consultation").click();
        await expect(pages[1].locator("#consultation-status")).toContainText("other participant left");
        for(const page of pages){expect(await page.evaluate(()=>workspace.rtc)).toBe(null);expect(await page.evaluate(()=>document.getElementById("consultation-local").srcObject)).toBe(null);}
        await expect(pages[1].locator("#retry-consultation")).toBeVisible();expect(errors).toEqual([]);
    }finally{await Promise.all(contexts.map(c=>c.close()));}
});
