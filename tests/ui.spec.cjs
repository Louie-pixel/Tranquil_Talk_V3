const {test,expect} = require("@playwright/test");

test.beforeEach(async ({page})=>{
    await page.route("**/api/experts**",route=>route.fulfill({json:{items:[],nextOffset:null}}));
    await page.route("**/api/expert-profile",route=>route.fulfill({json:{profile:null}}));
    await page.route("**/api/blogs",route=>{
        if(route.request().method()==="POST") return route.fulfill({status:201,json:{message:"Published"}});
        return route.fulfill({json:[{title:"A little space to reflect",author:"Test Contributor",body:"<script>window.injected=true</script>"}]});
    });
    await page.route("**/api/events",route=>route.fulfill({json:[]}));
});
test("desktop and mobile pages fit, articles render as text, and reflection clears",async({page})=>{
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    for(const width of [1280,390]){
        await page.setViewportSize({width,height:900});
        await page.goto("/");
        await expect(page.locator("h1")).toBeVisible();
        await expect(page.locator("#blog-status")).toHaveText("");
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:"test-results/home-"+width+".png",fullPage:true});
    }
    await page.getByRole("link",{name:"Resources",exact:true}).click();
    await page.getByText("A little space to reflect",{exact:true}).click();
    await expect(page.locator(".article .body")).toHaveText("<script>window.injected=true</script>");
    expect(await page.evaluate(()=>window.injected)).toBeUndefined();
    await page.locator("#reflection").fill("Today I feel hopeful");
    await expect(page.locator("#reflection-count")).toHaveText("4 words");
    await page.getByRole("button",{name:"Clear thoughts"}).click();
    await expect(page.locator("#reflection")).toHaveValue("");
    expect(errors).toEqual([]);
});
test("clinic search shows recoverable errors and safe external directions",async({page})=>{
    let fail=true;
    await page.route("**/api/clinics?**",route=> fail ?
        route.fulfill({status:503,json:{error:"Search temporarily unavailable"}}):
        route.fulfill({json:[{name:"Test-only clinic",location:{coordinates:[28.23,-25.75]}}]}));
    await page.goto("/");
    await page.getByRole("link",{name:"Clinics",exact:true}).click();
    await page.locator("#latitude").fill("-25.75");
    await page.locator("#longitude").fill("28.23");
    await page.getByRole("button",{name:"Search clinics"}).click();
    await expect(page.locator("#clinic-status")).toHaveText("Search temporarily unavailable");
    fail=false;
    await page.getByRole("button",{name:"Search clinics"}).click();
    await expect(page.locator("#clinic-status")).toHaveText("1 clinic(s) found.");
    await expect(page.getByRole("link",{name:"Open directions"})).toHaveAttribute("rel","noopener noreferrer");
});
test("sign-in gates room creation, verified expert publication completes, and sign-out clears access",async({page})=>{
    await page.route("**/api/login",route=>route.fulfill({json:{token:"test-token",role:"expert",expiresIn:3600}}));
    await page.route("**/api/sessions",route=>route.fulfill({status:201,json:{ticket:"part.one.signature",expiresIn:1800}}));
    await page.goto("/");
    await page.getByRole("link",{name:"Conversations",exact:true}).click();
    await page.getByRole("button",{name:"Create a private room"}).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("textbox",{name:"Email",exact:true}).fill("expert@example.com");
    await page.locator("#password").fill("test-password-for-ui");
    await page.locator("#auth-submit").click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button",{name:"Create a private room"}).click();
    await expect(page.locator("#invitation")).toHaveValue(/#invite=part.one.signature/);
    await page.getByRole("link",{name:"Resources",exact:true}).click();
    await page.getByRole("textbox",{name:"Public author name"}).fill("Test Contributor");
    await page.getByRole("textbox",{name:"Title",exact:true}).fill("A reflection");
    await page.getByRole("textbox",{name:"Article",exact:true}).fill("This is test-only article content with more than fifty characters.");
    await page.getByRole("button",{name:"Publish article"}).click();
    await expect(page.locator("#publish-status")).toHaveText("Article published.");
    await page.getByRole("button",{name:"Sign out",exact:true}).click();
    await expect(page.locator("#publish-form")).toBeHidden();
    await expect(page.locator("#logout")).toBeHidden();
});
test("an invitation fragment is removed from the address and never auto-starts media",async({page})=>{
    await page.goto("/#invite=part.one.signature");
    await expect(page.locator("#ticket")).toHaveValue("part.one.signature");
    await expect(page.locator("#call-panel")).toBeHidden();
    expect(new URL(page.url()).hash).toBe("#connect");
});
