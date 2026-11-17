const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const id='0123456789abcdef01234567';
const start=Math.ceil((Date.now()/1000+3*86400)/1800)*1800;
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}});
const appointments=[{id:'fixture-accepted',expertId:id,expertName:'Fixture Professional',alias:'Quiet River',status:'accepted',mode:'audio',startAt:start,revision:2},{id:'fixture-proposal',expertId:id,expertName:'Fixture Professional',alias:'Quiet River',status:'proposed',mode:'video',startAt:start+1800,revision:3},{id:'fixture-past',expertId:id,expertName:'Fixture Professional',alias:'Quiet River',status:'cancelled',mode:'audio',startAt:start-8*86400,revision:4}];
test.beforeEach(async({page})=>{
    await page.route('**/api/**',async r=>{const p=new URL(r.request().url()).pathname;
        const data=p==='/api/status' ? {mode:'application'} : p==='/api/login' ? {id:'fixture-patient',token:'fixture-token',role:'patient',emailVerified:true,timeZone:'Africa/Johannesburg',expiresIn:3600} : p==='/api/account/preferences' ? {timeZone:r.request().method()==='PUT' ? r.request().postDataJSON().timeZone : 'Africa/Johannesburg',appointmentEmails:true,appointmentReminders:true} : p==='/api/timezones' ? {items:['UTC','Africa/Johannesburg','America/New_York']} : p==='/api/appointments' ? {items:appointments,serverNow:Date.now()/1000} : p==='/api/experts' ? {items:[]} : [];
        await r.fulfill({json:data});
    });
});
async function login(page){await page.goto('/');await page.locator('#auth-form [name=email]').fill('fixture@example.com');await page.locator('#password').fill('fixture-password');await page.locator('#auth-submit').click();await expect(page.locator('#home')).toBeVisible();}
test('clinic map requires consent, links real fixture cards, filters and supports keyboard controls',async({page})=>{
    let tiles=0;await page.route('https://tile.openstreetmap.org/**',r=>{++tiles;return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4dfd7"/><path d="M0 128H256M128 0V256" stroke="#bbb"/></svg>'});});
    await page.route('**/api/clinics?**',r=>r.fulfill({json:[{name:'Mental health fixture',category:'mental_health',city:'Fixture city',phone:'+27120000000',location:{coordinates:[28.23,-25.75]},sourceName:'Fixture source',sourceUrl:'https://example.com/source'},{name:'General clinic fixture',category:'general_clinic',city:'Fixture city',location:{coordinates:[28.232,-25.752]}}]}));
    await page.goto('/#care');await page.locator('#clinic-query').fill('Fixture city');await page.getByRole('button',{name:'Find care',exact:true}).click();await expect(page.locator('.clinic-place')).toHaveCount(2);expect(tiles).toBe(0);
    await page.getByRole('button',{name:'Enable map',exact:true}).click();await expect.poll(()=>tiles).toBeGreaterThan(0);await expect(page.locator('.map-marker')).toHaveCount(2);
    await page.locator('#clinic-map').focus();const before=tiles;await page.keyboard.press('+');await expect.poll(()=>tiles).toBeGreaterThan(before);
    await page.getByRole('button',{name:'Mental health fixture, show clinic details',exact:true}).click();await expect(page.locator('#clinic-card-0')).toBeFocused();await expect(page.locator('#clinic-card-0')).toHaveClass(/selected/);
    await page.locator('#clinic-category').selectOption('mental_health');await expect(page.locator('.clinic-place')).toHaveCount(1);await page.locator('#clinic-contact-only').check();await expect(page.locator('.clinic-place')).toHaveCount(1);
    await page.getByRole('button',{name:'Turn map off',exact:true}).click();await expect(page.locator('#map-tiles img')).toHaveCount(0);
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}await page.screenshot({path:'test-results/clinic-map-mobile.png',fullPage:true});
});
test('appointment filtering, private calendar download, confirmation and timezone preferences',async({page})=>{
    let mutation;await page.route('**/api/appointments/fixture-accepted/cancel',r=>{mutation=r.request().postDataJSON();return r.fulfill({json:{...appointments[0],status:'cancelled'}});});
    await login(page);await page.goto('/#appointments');await expect(page.locator('#upcoming-count')).toHaveText('2');await expect(page.locator('#response-count')).toHaveText('1');
    await page.getByRole('button',{name:'Needs response',exact:true}).click();await expect(page.locator('#appointment-list .appointment-card')).toHaveCount(1);await expect(page.locator('#appointment-list')).toContainText('suggested this time');
    await page.getByRole('button',{name:'All',exact:true}).click();await expect(page.locator('#appointment-list .appointment-card')).toHaveCount(3);
    await page.locator('#appointment-calendar .calendar-day:not(:disabled)').first().focus();await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(page.locator('#clear-appointment-day')).toBeVisible();await page.locator('#clear-appointment-day').click();
    const card=page.locator('[data-appointment="fixture-accepted"]');const download=page.waitForEvent('download');await card.getByRole('button',{name:'Add to calendar',exact:true}).click();expect((await download).suggestedFilename()).toBe('private-appointment.ics');
    await card.getByRole('button',{name:'Cancel appointment',exact:true}).click();await expect(page.locator('#appointment-confirmation')).toBeVisible();await page.keyboard.press('Escape');expect(mutation).toBeUndefined();
    await card.getByRole('button',{name:'Cancel appointment',exact:true}).click();await page.locator('#appointment-confirm-proceed').click();await expect.poll(()=>mutation).toEqual({revision:2});
    await page.goto('/#account');await page.locator('#preference-zone').selectOption('America/New_York');await page.getByRole('button',{name:'Save preferences',exact:true}).click();await expect(page.locator('#preference-status')).toContainText('Preferences saved');await page.goto('/#appointments');await expect(page.locator('#appointments-zone')).toHaveText('America/New_York');
});
test('new care/appointment/account screens have keyboard focus, mobile reflow and no axe WCAG AA violations',async({page})=>{
    await login(page);await page.emulateMedia({reducedMotion:'reduce'});
    for(const route of ['appointments','account','care']){
        await page.goto('/#'+route);await expect(page.locator('#'+route)).toBeVisible();
        const results=await new AxeBuilder({page}).include('#'+route).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
        for(const width of [390,320]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    }
    await page.locator('.skip').focus();await page.keyboard.press('Enter');await expect(page.locator('#main')).toBeFocused();
});
test('booking calendar and early waiting room reflow, keyboard operation, accessibility and device cleanup',async({page,context})=>{
    await context.grantPermissions(['microphone','camera']);let joins=0;
    await page.route('**/api/appointments/*/join',r=>{++joins;return r.fulfill({status:403,json:{error:'Join window closed'}});});
    await page.route('**/api/rtc-config',r=>r.fulfill({json:{relayAvailable:false,iceServers:[],iceTransportPolicy:'all'}}));
    await page.route('**/api/availability/**',r=>r.fulfill({json:{items:[{id:'slot-a',startAt:start},{id:'slot-b',startAt:start+1800}]}}));
    await login(page);await page.evaluate(id=>window.openBooking({id,name:'Fixture Professional',methods:['audio','video']}),id);await expect(page.locator('#booking-times [role=radio]')).toHaveCount(2);
    await page.locator('#booking-times [role=radio]').first().focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#booking-times [role=radio]').nth(1)).toHaveAttribute('aria-checked','true');
    let results=await new AxeBuilder({page}).include('#booking-dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});const box=await page.locator('#booking-dialog').boundingBox();expect(box.width).toBeLessThanOrEqual(width);expect(box.height).toBeLessThanOrEqual(900);await page.locator('#booking-dialog').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:`test-results/booking-${width}.png`});}
    await page.locator('#close-booking').click();await page.goto('/#appointments');await page.locator('#appointment-list').getByRole('button',{name:'Open waiting room',exact:true}).click();await page.getByRole('button',{name:'Check microphone',exact:true}).click();await expect(page.locator('#device-confirmation')).toBeVisible();await page.locator('#devices-ready').check();await expect(page.locator('#enter-consultation')).toBeDisabled();expect(joins).toBe(0);
    expect(await page.evaluate(()=>workspace.rtc.stream.getVideoTracks().length)).toBe(0);await page.evaluate(()=>{globalThis.__fixtureTracks=workspace.rtc.stream.getTracks();});
    results=await new AxeBuilder({page}).include('#consultation-dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});const box=await page.locator('#consultation-dialog').boundingBox();expect(box.width).toBeLessThanOrEqual(width);expect(box.height).toBeLessThanOrEqual(900);await page.locator('#consultation-dialog').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:`test-results/waiting-${width}.png`});}
    await page.locator('#close-consultation').click();expect(await page.evaluate(()=>__fixtureTracks.every(t=>t.readyState==='ended'))).toBe(true);
});
test('availability accepts a valid half-hour independently of the minimum-time minute',async({page})=>{
    let saved;await page.route('**/api/login',r=>r.fulfill({json:{id,token:'fixture-token',role:'expert',emailVerified:true,expiresIn:3600}}));
    await page.route('**/api/availability/**',r=>{if(r.request().method()==='POST')saved=r.request().postDataJSON();return r.fulfill({json:{items:[]}});});
    await login(page);await page.goto('/#appointments');await page.locator('#availability-zone').selectOption('UTC');
    const date=new Date((Date.now()/1000+5*86400)*1000).toISOString().slice(0,10),input=page.locator('#availability-form [name=start]');
    await input.evaluate((el,date)=>{el.min=date+'T09:17';el.max=date+'T23:59';},date);await input.fill(date+'T12:00');expect(await input.evaluate(el=>el.validity.stepMismatch)).toBe(false);
    await page.getByRole('button',{name:'Add available time',exact:true}).click();await expect.poll(()=>saved?.localStart).toBe(date+'T12:00');expect(saved.timeZone).toBe('UTC');
});
