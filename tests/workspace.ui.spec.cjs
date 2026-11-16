const {test,expect}=require("@playwright/test");
const id="0123456789abcdef01234567";
const expert={id,name:"Fixture Professional",professionalTitle:"Counselling psychologist",bio:"A test-only profile describing a supportive approach for the browser workflow fixture.",city:"Pretoria",country:"South Africa",methods:["audio","video","in_person"],languages:["English"],qualifications:["Test qualification"],specialties:["Stress"]};
test.beforeEach(async({page})=>{
    await page.route("**/api/**",async route=>{
        const path=new URL(route.request().url()).pathname;
        const result=path==="/api/experts" ? {items:[expert]} : path==="/api/experts/"+id ? expert :
            path==="/api/login" ? {token:"fixture.token.signature",id:"patient-id",role:"patient",emailVerified:true,expiresIn:3600} :
            path==="/api/me" ? {id:"patient-id",role:"patient",emailVerified:true} :
            path.startsWith("/api/availability/") ? {items:[{id:"slot-one",startAt:Math.floor(Date.now()/1000)+3600,location:"Test practice"}]} :
            path==="/api/appointments" ? {items:[]} : path==="/api/expert-profile" ? {profile:null} :
            path.startsWith("/api/account/") ? {message:"Test account action complete."} : [];
        await route.fulfill({json:result});
    });
});
async function login(page){await page.locator("#account-button").click();await page.locator('#auth-form [name="email"]').fill("patient@example.com");await page.locator("#password").fill("fixture-long-password");await page.locator("#auth-submit").click();await expect(page.locator("#auth-dialog")).toBeHidden();}
test("navigation isolates pages, supports history, and stays within mobile viewport",async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    for(const width of [1440,390]){
        await page.setViewportSize({width,height:900});await page.goto("/");await expect(page.locator("#home")).toBeVisible();
        await page.getByRole("link",{name:"Appointments",exact:true}).click();await expect(page.locator("#appointments")).toBeVisible();await expect(page.locator("#home")).toBeHidden();
        await expect(page.locator("#appointments-status")).toContainText("Sign in");
        await page.getByRole("link",{name:"Resources",exact:true}).click();await expect(page.locator("#stories")).toBeVisible();await expect(page.locator("#experts")).toBeHidden();
        await page.goBack();await expect(page.locator("#appointments")).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/appointments-${width}.png`,fullPage:true});
    }expect(errors).toEqual([]);
});
test("patient books an expert with alias and a selected method, then sees appointments",async({page})=>{
    let request;
    await page.route("**/api/appointments",route=>{if(route.request().method()==="POST")request=route.request().postDataJSON();return route.fulfill({json:{items:[]}});});
    await page.goto("/#experts");await login(page);
    await page.getByRole("link",{name:"View profile: Fixture Professional"}).click();
    await page.getByRole("button",{name:"See available times"}).click();await expect(page.locator("#booking-dialog")).toBeVisible();
    await page.locator("#booking-mode").selectOption("audio");await page.locator('#booking-form [name="alias"]').fill("Quiet River");
    await page.getByRole("button",{name:"Request this time"}).click();await expect(page.locator("#booking-dialog")).toBeHidden();await expect(page.locator("#appointments")).toBeVisible();
    expect(request).toEqual({expertId:id,slotId:"slot-one",mode:"audio",alias:"Quiet River"});
});
test("account action links remove their token and account reporting submits privately",async({page})=>{
    let report;
    await page.route("**/api/reports",route=>{report=route.request().postDataJSON();return route.fulfill({json:{message:"Report received."}});});
    const token="a".repeat(72);await page.goto("/#account/verify/"+token);await expect(page).toHaveURL(/#account$/);
    await expect(page.locator("#account-action-panel")).toBeVisible();await page.locator('#account-action-form button').click();await expect(page.locator("#account-action-status")).toHaveText("Test account action complete.");
    await login(page);await page.locator('#report-form [name="targetId"]').fill(id);await page.locator('#report-form [name="reason"]').fill("Test-only safety concern for private review.");
    await page.getByRole("button",{name:"Submit private report"}).click();await expect(page.locator("#report-status")).toHaveText("Report received.");expect(report.targetId).toBe(id);
});
