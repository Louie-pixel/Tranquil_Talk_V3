const {test,expect}=require("@playwright/test");
test.beforeEach(async({page})=>{
    await page.route("**/api/status",r=>r.fulfill({json:{mode:"application"}}));
    await page.route("**/api/experts**",r=>r.fulfill({json:{items:[],nextOffset:null}}));
    await page.route("**/api/expert-profile",r=>r.fulfill({json:{profile:null}}));
    await page.route("**/api/blogs",r=>r.fulfill({json:r.request().method()==="POST" ? {message:"Published"} : [{title:"A little space to reflect",author:"Test Contributor",body:"<script>window.injected=true</script>"}]}));
    await page.route("**/api/events",r=>r.fulfill({json:[]}));
});
async function login(page,role="patient"){
    await page.route("**/api/login",r=>r.fulfill({json:{token:"test-token",id:"aaaaaaaaaaaaaaaaaaaaaaaa",role,expiresIn:3600}}));
    if(!await page.locator("#auth-form").isVisible())await page.locator("#account-button").click();
    await page.locator('#auth-form [name="email"]').fill("fixture@example.com");await page.locator("#password").fill("test-password-for-ui");await page.locator("#auth-submit").click();
    await expect(page.locator("#home")).toBeVisible();
}
async function navigate(page,label){await page.locator("#app-menu summary").click();await page.getByRole("link",{name:label,exact:true}).click();}
test("sign-in is first; home, mobile navigation, safe articles and reflection work",async({page})=>{
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    for(const width of [1280,390]){
        await page.setViewportSize({width,height:900});await page.goto("/");await expect(page.locator("#signin")).toBeVisible();await expect(page.locator("#home")).toBeHidden();
        await page.screenshot({path:`test-results/signin-${width}.png`,fullPage:true});await login(page);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/home-${width}.png`,fullPage:true});
    }
    await navigate(page,"Resources");await page.getByText("A little space to reflect",{exact:true}).click();await expect(page.locator(".article .body")).toHaveText("<script>window.injected=true</script>");
    expect(await page.evaluate(()=>window.injected)).toBeUndefined();await page.locator("#reflection").fill("Today I feel hopeful");await expect(page.locator("#reflection-count")).toHaveText("4 words");
    await page.getByRole("button",{name:"Clear thoughts"}).click();await expect(page.locator("#reflection")).toHaveValue("");expect(errors).toEqual([]);
});
test("area search recovers from errors and provides safe directions",async({page})=>{
    let fail=true;await page.route("**/api/clinics?**",r=>fail ? r.fulfill({status:503,json:{error:"Search temporarily unavailable"}}) : r.fulfill({json:[{name:"Test-only clinic",city:"Pretoria",location:{coordinates:[28.23,-25.75]}}]}));
    await page.goto("/#care");await page.locator("#clinic-query").fill("Pretoria");await page.getByRole("button",{name:"Find care",exact:true}).click();await expect(page.locator("#clinic-status")).toHaveText("Search temporarily unavailable");
    fail=false;await page.getByRole("button",{name:"Find care",exact:true}).click();await expect(page.locator("#clinic-status")).toContainText("1 listed clinic");
    await expect(page.getByRole("link",{name:"Get directions"})).toHaveAttribute("rel","noopener noreferrer");await expect(page.locator("#clinic-area-label")).toHaveText("Pretoria");
});
test("sign-in gates rooms, expert publishing works, and sign-out returns to sign-in",async({page})=>{
    await page.route("**/api/sessions",r=>r.fulfill({status:201,json:{ticket:"part.one.signature",expiresIn:1800}}));
    await page.goto("/#connect");await page.getByRole("button",{name:"Create a private room"}).click();await expect(page.locator("#signin")).toBeVisible();await login(page,"expert");
    await navigate(page,"Conversations");await page.getByRole("button",{name:"Create a private room"}).click();await expect(page.locator("#invitation")).toHaveValue(/#invite=part.one.signature/);
    await navigate(page,"Resources");await page.getByRole("textbox",{name:"Public author name"}).fill("Test Contributor");await page.getByRole("textbox",{name:"Title",exact:true}).fill("A reflection");
    await page.getByRole("textbox",{name:"Article",exact:true}).fill("This is test-only article content with more than fifty characters.");await page.getByRole("button",{name:"Publish article"}).click();await expect(page.locator("#publish-status")).toHaveText("Article published.");
    await page.locator("#logout").click();await expect(page.locator("#signin")).toBeVisible();await expect(page.locator("#publish-form")).toBeHidden();
});
test("an invitation fragment is removed and never auto-starts media",async({page})=>{
    await page.goto("/#invite=part.one.signature");await expect(page.locator("#ticket")).toHaveValue("part.one.signature");await expect(page.locator("#call-panel")).toBeHidden();expect(new URL(page.url()).hash).toBe("#connect");
});
