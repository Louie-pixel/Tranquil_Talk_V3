const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{
    await page.route('**/api/status',r=>r.fulfill({json:{mode:'application'}}));
    await page.route('**/api/experts**',r=>r.fulfill({json:{items:[]}}));
    await page.route('**/api/expert-profile',r=>r.fulfill({json:{profile:null}}));
    await page.route('**/api/admin/experts**',r=>r.fulfill({json:{items:[]}}));
    await page.route('**/api/blogs',r=>r.fulfill({json:[]}));await page.route('**/api/events',r=>r.fulfill({json:[]}));await page.route('**/api/reports',r=>r.fulfill({json:{items:[]}}));
});
async function login(page,role){
    await page.route('**/api/login',r=>r.fulfill({json:{id:'fixture-user',token:'fixture-token',role,emailVerified:true,developmentMailbox:true,expiresIn:3600}}));
    await page.goto('/');await page.locator('#auth-form [name="email"]').fill('fixture@example.com');await page.locator('#password').fill('test-only-password');await page.locator('#auth-submit').click();
    await expect(page.locator('#home')).toBeVisible();await page.locator('#account-button').click();await expect(page.locator('#account')).toBeVisible();
}
test('verified professionals can create, archive and restore their clinic listing',async({page})=>{
    let records=[],last;
    await page.route('**/api/manage/clinics**',r=>{
        const method=r.request().method(),body=r.request().postDataJSON();
        if(method==='GET')return r.fulfill({json:{items:records,nextOffset:null}});
        last={method,body};
        if(method==='DELETE')records[0]={...records[0],archived:true,revision:records[0].revision+1};
        else records=[{...body,id:'0123456789abcdef01234567',revision:(records[0]?.revision || 0)+1,location:{coordinates:[body.lng,body.lat]}}];
        return r.fulfill({json:records[0]});
    });
    await login(page,'expert');await expect(page.locator('#clinic-management')).toBeVisible();await expect(page.locator('#event-management')).toBeHidden();await expect(page.locator('#local-mail-notice')).toBeVisible();
    const form=page.locator('#managed-clinic-form');for(const [field,value] of Object.entries({name:'Test practice',address:'Test street',city:'Pretoria',country:'South Africa',lat:'-25.75',lng:'28.23'}))await form.locator(`[name="${field}"]`).fill(value);
    await form.getByRole('button',{name:'Save clinic listing'}).click();await expect(page.locator('#managed-clinic-status')).toHaveText('Clinic listing saved.');expect(last.body.lat).toBe(-25.75);
    await expect(page.locator('#managed-clinics h4')).toHaveText('Test practice');page.once('dialog',d=>d.accept());await page.locator('#managed-clinics').getByRole('button',{name:'Archive',exact:true}).click();
    await expect(page.locator('#managed-clinics .status-pill')).toHaveText('Archived');await page.getByRole('button',{name:'Edit and restore'}).click();await form.getByRole('button',{name:'Save clinic listing'}).click();
    await expect(page.locator('#managed-clinics .status-pill')).toHaveText('Published');expect(last.method).toBe('PUT');expect(last.body.archived).toBe(false);
});
test('an administrator publishes a real event through the account workspace',async({page})=>{
    let event;
    await page.route('**/api/manage/clinics**',r=>r.fulfill({json:{items:[]}}));
    await page.route('**/api/manage/events**',r=>{
        if(r.request().method()==='GET')return r.fulfill({json:{items:event ? [event] : [],nextOffset:null}});
        const b=r.request().postDataJSON();event={...b,id:'1123456789abcdef01234567',revision:1,startsAt:new Date(b.startAt*1000).toISOString()};return r.fulfill({json:event});
    });
    await page.route('**/api/events',r=>r.fulfill({json:event ? [event] : []}));
    await login(page,'admin');await expect(page.locator('#event-management')).toBeVisible();const form=page.locator('#managed-event-form');
    await form.locator('[name="title"]').fill('Test community workshop');await form.locator('[name="description"]').fill('An event fixture for a supportive community conversation.');await form.locator('[name="location"]').fill('Test venue');await form.locator('[name="start"]').fill('2027-01-20T14:00');
    await form.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.locator('#managed-event-status')).toHaveText('Community event saved.');expect(Number.isFinite(event.startAt)).toBe(true);
    await page.locator('#app-menu summary').click();await page.getByRole('link',{name:'Community',exact:true}).click();await expect(page.locator('#event-list h3')).toHaveText('Test community workshop');
});
