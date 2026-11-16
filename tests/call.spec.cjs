// Emulated browser devices are restricted to this test configuration.
const {test,expect}=require("@playwright/test");
test("two invitees connect through the real backend, audio keeps camera off, and hangup releases devices",
    async({browser,request,baseURL})=>{
    const email="call-"+Date.now()+"@example.com",password="test-only-long-password";
    expect((await request.post("/api/register",{data:{email,password,role:"patient"}})).status()).toBe(201);
    const login=await request.post("/api/login",{data:{email,password}});
    expect(login.status()).toBe(200);
    const {token}=await login.json();
    const created=await request.post("/api/sessions",{headers:{authorization:"Bearer "+token}});
    expect(created.status()).toBe(201);
    const {ticket}=await created.json();
    const contexts=await Promise.all([0,1].map(()=>browser.newContext({
        baseURL,permissions:["microphone","camera"]
    })));
    try {
        const [first,second]=await Promise.all(contexts.map(context=>context.newPage()));
        for(const page of [first,second]) page.on("console",message=>{
            if(message.type() === "error") console.log("Browser error:",message.text());
        });
        await Promise.all([first,second].map(page=>page.goto("/#invite="+encodeURIComponent(ticket))));
        await second.getByRole("radio",{name:"Video & audio"}).check();
        await first.getByRole("button",{name:"Enter conversation"}).click();
        await expect(first.locator("#call-status")).toHaveText("Waiting for the other participant…");
        await second.getByRole("button",{name:"Enter conversation"}).click();
        await expect(first.locator("#call-status")).toHaveText("Connected",{timeout:15000});
        await expect(second.locator("#call-status")).toHaveText("Connected",{timeout:15000});
        expect(await first.evaluate(()=>call.stream.getVideoTracks().length)).toBe(0);
        expect(await second.evaluate(()=>call.stream.getVideoTracks().length)).toBe(1);
        await first.getByRole("button",{name:"Mute microphone",exact:true}).click();
        expect(await first.evaluate(()=>call.stream.getAudioTracks()[0].enabled)).toBe(false);
        await second.getByRole("button",{name:"Turn camera off",exact:true}).click();
        expect(await second.evaluate(()=>call.stream.getVideoTracks()[0].enabled)).toBe(false);
        await first.getByRole("button",{name:"End conversation",exact:true}).click();
        for(const page of [first,second]){
            await expect(page.locator("#call-panel")).toBeHidden();
            expect(await page.evaluate(()=>document.getElementById("local-video").srcObject)).toBe(null);
        }
    } finally {await Promise.all(contexts.map(context=>context.close()));}
});
