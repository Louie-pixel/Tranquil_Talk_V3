const {test,expect}=require("@playwright/test");
const professional={
    id:"123456789012345678901234",name:"Amara Test",professionalTitle:"Counselling psychologist",
    bio:"I offer a collaborative and thoughtful space for adults navigating stress, relationships and significant changes in their lives.",
    city:"Pretoria",country:"South Africa",practiceName:"Test-only practice",website:"https://practice.example.com",
    specialties:["Stress","Anxiety"],languages:["English","Kiswahili"],qualifications:["MA Counselling Psychology, Test Institution"],
    methods:["audio","video"],yearsExperience:7,verifiedAt:"2026-11-16T10:00:00Z"
};
test.beforeEach(async({page})=>{
    await page.route("**/api/blogs",route=>route.fulfill({json:[]}));
    await page.route("**/api/events",route=>route.fulfill({json:[]}));
});
async function login(page,role){
    await page.route("**/api/login",route=>route.fulfill({json:{id:"aaaaaaaaaaaaaaaaaaaaaaaa",token:"test-only-token",role,expiresIn:3600}}));
    await page.route("**/api/me",route=>route.fulfill({json:{id:"aaaaaaaaaaaaaaaaaaaaaaaa",role}}));
    await page.locator("#account-button").click();
    await page.locator('#auth-form [name="email"]').fill("fixture@example.com");
    await page.locator("#password").fill("a-test-only-password");
    await page.locator("#auth-submit").click();
    await expect(page.locator("#auth-dialog")).not.toBeVisible();
}
test("modern directory fits desktop/mobile, supports filters and opens shareable public profiles without emojis",async({page})=>{
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    let lastSearch;
    await page.route("**/api/experts**",route=>{
        const url=new URL(route.request().url());
        if(url.pathname==="/api/experts/"+professional.id)return route.fulfill({json:{...professional,registrationNumber:"MUST-NOT-RENDER"}});
        lastSearch=url;
        return route.fulfill({json:{items:url.searchParams.get("q")==="no matches"?[]:[professional],nextOffset:null}});
    });
    for(const width of [1280,390]){
        await page.setViewportSize({width,height:900});
        await page.goto("/#experts");
        await expect(page.locator(".expert-card h3")).toHaveText("Amara Test");
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await page.locator("body").innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
        await page.screenshot({path:"test-results/experts-"+width+".png",fullPage:true});
    }
    const form=page.locator("#expert-search-form");
    await form.locator('[name="specialty"]').selectOption("Stress");
    await form.locator('[name="language"]').fill("English");
    await form.locator('[name="method"]').selectOption("audio");
    await form.getByRole("button",{name:"Find professionals"}).click();
    await expect(page.locator("#expert-status")).toHaveText("");
    expect(lastSearch.searchParams.get("specialty")).toBe("Stress");
    expect(lastSearch.searchParams.get("method")).toBe("audio");
    await page.getByRole("link",{name:"View profile: Amara Test"}).click();
    await expect(page.locator("#expert-dialog")).toBeVisible();
    await expect(page.locator("#expert-dialog-title")).toHaveText("Amara Test");
    await expect(page.getByRole("textbox",{name:"Public profile link"})).toHaveValue("http://127.0.0.1:8099/#expert/"+professional.id);
    expect(await page.locator("#expert-detail").innerText()).not.toContain("MUST-NOT-RENDER");
    await page.locator("#close-expert").click();
    await page.goto("/#expert/"+professional.id);
    await expect(page.locator("#expert-dialog-title")).toHaveText("Amara Test");
    await page.locator("#close-expert").click();
    await form.locator('[name="q"]').fill("no matches");
    await form.getByRole("button",{name:"Find professionals"}).click();
    await expect(page.locator("#expert-list")).toContainText("No matches just yet.");
    expect(errors).toEqual([]);
});
test("professional saves and submits private registration details, then sign-out clears the workspace",async({page})=>{
    let profile=null,savedBody;
    await page.route("**/api/experts**",route=>route.fulfill({json:{items:[],nextOffset:null}}));
    await page.route("**/api/expert-profile",route=>{
        if(route.request().method()==="PUT"){
            savedBody=route.request().postDataJSON();profile={...savedBody,id:professional.id,revision:1,status:"draft",reviews:[]};
        }
        return route.fulfill({json:{profile}});
    });
    await page.route("**/api/expert-profile/submit",route=>{
        profile={...profile,revision:2,status:"pending"};return route.fulfill({json:{profile}});
    });
    await page.setViewportSize({width:390,height:900});
    await page.goto("/#professional");await login(page,"expert_pending");
    await expect(page.locator("#profile-editor-status")).toHaveText("");
    const form=page.locator("#expert-profile-form");
    for(const [key,value] of Object.entries({
        name:"Amara Test",professionalTitle:"Counselling psychologist",bio:professional.bio,city:"Pretoria",country:"South Africa",
        practiceName:"Test-only practice",website:"https://practice.example.com",yearsExperience:"7",languages:"English, Kiswahili",
        qualifications:"MA Counselling Psychology, Test Institution",registrationBody:"Test Register",registrationNumber:"PRIVATE-123",
        registrationCountry:"South Africa",credentialReference:"https://register.example.com"
    })) await form.locator('[name="'+key+'"]').fill(value);
    await form.getByRole("checkbox",{name:"Stress",exact:true}).check();
    await form.getByRole("checkbox",{name:"Audio only",exact:true}).check();
    await form.getByRole("button",{name:"Submit for review"}).click();
    await expect(page.locator("#profile-state")).toHaveText("Awaiting review");
    await expect(page.locator("#profile-editor-status")).toHaveText("Profile submitted for registration review.");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(savedBody.registrationNumber).toBe("PRIVATE-123");
    expect(savedBody.status).toBeUndefined();
    await expect(page.locator("#publish-form")).toBeHidden();
    await page.locator("#logout").click();
    await expect(page.locator("#profile-workspace")).toBeHidden();
    await expect(form.locator('[name="registrationNumber"]')).toHaveValue("");
});
test("administrator reviews a version, must attest registry checking, and records an approval",async({page})=>{
    let approved=false,decisions=0;
    const pending={...professional,status:"pending",revision:2,registrationBody:"Test Register",
        registrationNumber:"PRIVATE-456",registrationCountry:"South Africa",credentialReference:"https://register.example.com",
        updatedAt:"2026-11-16T10:00:00Z",reviews:[]};
    await page.route("**/api/experts**",route=>route.fulfill({json:{items:approved?[professional]:[],nextOffset:null}}));
    await page.route("**/api/admin/experts?**",route=>route.fulfill({json:{items:approved?[]:[pending],nextOffset:null}}));
    await page.route("**/api/admin/experts/"+professional.id,route=>route.fulfill({json:{profile:pending}}));
    await page.route("**/api/admin/experts/*/review",route=>{
        const body=route.request().postDataJSON();expect(body.revision).toBe(2);expect(body.registryChecked).toBe(true);
        expect(body.reference).toBe("https://official-register.example.com/");
        approved=true;decisions++;return route.fulfill({json:{profile:{...pending,status:"approved",revision:3}}});
    });
    await page.goto("/");await login(page,"admin");
    await page.locator("#verification-nav").click();
    await page.getByRole("button",{name:"Review application: Amara Test"}).click();
    await expect(page.locator("#review-detail")).toContainText("PRIVATE-456");
    await page.locator('#review-decision-form [name="note"]').fill("Matched the applicant registration details against the official register.");
    await page.getByRole("button",{name:"Record decision",exact:true}).click();
    expect(decisions).toBe(0);
    await page.locator('#review-decision-form [name="reference"]').fill("https://official-register.example.com/");
    await page.locator('#review-decision-form [name="registryChecked"]').check();
    await page.getByRole("button",{name:"Record decision",exact:true}).click();
    await expect(page.locator("#review-queue-status")).toHaveText("Review decision recorded.");
    expect(decisions).toBe(1);
    await expect(page.locator(".expert-card h3")).toHaveText("Amara Test");
    await page.locator("#logout").click();
    await expect(page.locator("#verification")).toBeHidden();
    await expect(page.locator("#review-detail")).toBeEmpty();
});
