const {test,expect}=require("@playwright/test");
test.beforeEach(async({page})=>{
    await page.route("**/api/status",r=>r.fulfill({json:{mode:"application"}}));
    for(const endpoint of ["blogs","events"])await page.route("**/api/"+endpoint,r=>r.fulfill({json:[]}));
    await page.route("**/api/experts**",r=>r.fulfill({json:{items:[],nextOffset:null}}));
    await page.route("**/api/login",r=>r.fulfill({json:{token:"fixture.token.signature",id:"patient-id",role:"patient",expiresIn:3600}}));
});
test("root opens sign-in, signup is a separate page, and login opens home with a keyboard-accessible dropdown",async({page})=>{
    let registration;await page.route("**/api/register",r=>{registration=r.request().postDataJSON();return r.fulfill({status:201,json:{message:"Account created"}});});
    await page.goto("/");await expect(page.locator("#signin")).toBeVisible();await expect(page.locator("#home")).toBeHidden();
    await page.locator("#switch-auth").click();await expect(page.locator("#signup")).toBeVisible();await expect(page.locator("#signin")).toBeHidden();
    await page.locator('#signup-form [name="email"]').fill("new@example.com");await page.locator("#signup-password").fill("private-fixture-password");await page.locator("#signup-submit").click();
    await expect(page.locator("#signin")).toBeVisible();await expect(page.locator("#auth-status")).toContainText("Your account is ready");expect(registration.role).toBe("patient");
    await page.locator("#password").fill("private-fixture-password");await page.locator("#auth-submit").click();await expect(page.locator("#home")).toBeVisible();
    const menu=page.locator("#app-menu");await menu.locator("summary").click();await expect(page.getByRole("link",{name:"Clinics",exact:true})).toBeVisible();await menu.press("Escape");expect(await menu.getAttribute("open")).toBe(null);
    await menu.locator("summary").click();await page.getByRole("link",{name:"Clinics",exact:true}).click();await expect(page.locator("#care")).toBeVisible();expect(await menu.getAttribute("open")).toBe(null);
});
test("location permission starts clinic search immediately and shows distance-sorted modern cards",async({page,context})=>{
    await context.grantPermissions(["geolocation"]);await context.setGeolocation({latitude:-25.75,longitude:28.23});let params;
    await page.route("**/api/clinics?**",r=>{params=new URL(r.request().url()).searchParams;return r.fulfill({json:[
        {name:"Further test clinic",city:"Pretoria",location:{coordinates:[28.25,-25.77]}},
        {name:"Nearby test clinic",address:"Test street",city:"Pretoria",phone:"+27120000000",location:{coordinates:[28.231,-25.751]}}
    ]});});
    for(const width of [1280,390]){
        await page.setViewportSize({width,height:900});await page.goto("/#care");await page.getByRole("button",{name:"Use current location"}).click();
        await expect(page.locator("#clinic-status")).toContainText("2 listed clinics");expect(Number(params.get("lat"))).toBe(-25.75);expect(Number(params.get("lng"))).toBe(28.23);
        await expect(page.locator(".clinic-place h3").first()).toHaveText("Nearby test clinic");await expect(page.locator(".distance-pill").first()).toContainText("away");await expect(page.locator("#clinic-area-label")).toHaveText("Current location");
        expect(await page.locator('#care input[type="number"]').count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/clinics-${width}.png`,fullPage:true});
    }
});
test("permission denial, unavailable location and timeout all recover through area search",async({page})=>{
    await page.route("**/api/clinics?**",r=>r.fulfill({json:[{name:"Test area clinic",city:"Centurion",location:{coordinates:[28.18,-25.86]}}]}));
    for(const code of [1,2,3]){
        await page.addInitScript(code=>Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(success,error){error({code});}}}),code);
        await page.goto("/#care");await page.getByRole("button",{name:"Use current location"}).click();await expect(page.locator("#clinic-status")).toHaveClass(/error/);await expect(page.locator("#locate")).toBeEnabled();
        await page.locator("#clinic-query").fill("Centurion");await page.getByRole("button",{name:"Find care",exact:true}).click();await expect(page.locator("#clinic-status")).toContainText("1 listed clinic");await expect(page.locator("#clinic-area-label")).toHaveText("Centurion");
    }
});
test("a late location callback cannot overwrite a newer area search",async({page})=>{
    await page.addInitScript(()=>Object.defineProperty(navigator,"geolocation",{value:{getCurrentPosition(success){window.completeLocation=()=>success({coords:{latitude:-25.75,longitude:28.23}});}}}));
    const queries=[];await page.route("**/api/clinics?**",r=>{queries.push(new URL(r.request().url()).search);return r.fulfill({json:[]});});
    await page.goto("/#care");await page.locator("#locate").click();await page.locator("#clinic-query").fill("Pretoria");await page.getByRole("button",{name:"Find care",exact:true}).click();await expect(page.locator("#clinic-area-label")).toHaveText("Pretoria");
    await page.evaluate(()=>window.completeLocation());await expect(page.locator("#locate")).toBeEnabled();await expect(page.locator("#clinic-area-label")).toHaveText("Pretoria");expect(queries).toEqual(["?q=Pretoria"]);
});
