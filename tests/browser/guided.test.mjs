import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const artifacts=process.env.GUIDED_ARTIFACTS || `${root}../hand-gesture-artifacts/guided-${Date.now()}`;
let server,browser,url;
const measurements=[];
before(async()=>{await mkdir(artifacts,{recursive:true});server=await createServer({root,logLevel:'error',server:{host:'127.0.0.1',port:0}});await server.listen();url=server.resolvedUrls.local[0];browser=await chromium.launch({headless:true});});
after(async()=>{await writeFile(`${artifacts}/measurements.json`,JSON.stringify(measurements,null,2));console.log('Evidence:',artifacts);await browser?.close();await server?.close();});
async function open(path='',viewport={width:390,height:844}){
 const context=await browser.newContext({viewport,reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('gse.quality','low');navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Test: denied','NotAllowedError');};});
 await page.goto(url+path);await page.waitForFunction(()=>window.__app?.guided!==undefined && document.querySelector('#status')?.dataset.kind==='keyboard');
 return {page,context,errors};
}
for(const path of ['', '?flags=astrolife', '?flags=guided'])test(`flag isolation: /${path}`,async()=>{
 const {page,context,errors}=await open(path);assert.equal(await page.locator('#guided-mission').count(),0);assert.equal(await page.evaluate(()=>window.__app.modes.mode),'solarView');assert.deepEqual(errors,[]);await context.close();
});
for(const lang of ['en','ja','my'])for(const width of [360,390,430])test(`preflight and launch ${lang} ${width}`,async()=>{
 const {page,context,errors}=await open(`?flags=astrolife,guided&base=jezero&lang=${lang}`,{width,height:844});
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 assert.equal(await page.evaluate(()=>window.__app.mission.base.base.id),'jezero');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.waitForFunction(()=>window.__app.guided.session.stage==='destination');
 await page.locator('#guided-mission>div button').first().click();
 await page.screenshot({path:`${artifacts}/${lang}-${width}-destination.png`});
 const measure=await page.evaluate(()=>{const r=document.querySelector('#guided-mission').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,scroll:document.documentElement.scrollWidth,width:innerWidth};});
 assert.ok(measure.left>=0 && measure.right<=width && measure.scroll<=width,JSON.stringify(measure));measurements.push({lang,width,stage:'destination',...measure});
 await action.click();await page.waitForFunction(()=>window.__app.modes.mode==='launch');
 assert.equal(await page.evaluate(()=>window.__app.mission.countdown.auto),true);
 // A held confirmation cannot skip travel or launch twice.
 await page.evaluate(()=>{const g=window.__app.guided;for(let t=0;t<1500;t+=100)g.observe(t,{thumbsUp:true,pose:'fist'});});
 assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'outbound');
 await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 await page.screenshot({path:`${artifacts}/${lang}-${width}-travel.png`});
 assert.equal(await page.locator('#guided-mission').isVisible(),true);
 const gap=await page.evaluate(()=>{const h=document.querySelector('header.hud').getBoundingClientRect(),m=document.querySelector('#mission-hud').getBoundingClientRect();return m.top-h.bottom;});
 assert.ok(gap>=0,`header/HUD overlap ${-gap}`);measurements.push({lang,width,stage:'travel',headerHudGap:gap});
 assert.deepEqual(errors,[]);await context.close();
});
test('timer expiry waits for native landing, return confirmation and refresh preserve deadline',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 await page.evaluate(()=>{const a=window.__app;a.guided.session.deadline=Date.now()-1;a.guided.render();a.mission.trip.elapsed=a.mission.trip.seconds-0.01;});
 await page.waitForFunction(()=>window.__app.modes.mode==='docking');
 assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'outbound');
 await page.evaluate(()=>{const a=window.__app;for(let t=0;t<=700;t+=100)a.guided.observe(t,{pose:'fist',thumbsUp:false});});
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView',{},{timeout:90000});
 await page.waitForFunction(()=>window.__app.guided.session.stage==='return');
 const deadline=await page.evaluate(()=>window.__app.guided.session.deadline);
 await page.reload();await page.waitForFunction(()=>window.__app?.guided);
 await page.locator('#resume-mission-continue').click();await page.waitForFunction(()=>window.__app.guided.session.stage==='return');
 assert.equal(await page.evaluate(()=>window.__app.guided.session.deadline),deadline);
 await page.locator('#guided-mission>button').click();await page.waitForFunction(()=>window.__app.modes.mode==='launch');
 assert.equal(await page.evaluate(()=>window.__app.mission.destination.base.id),'cape');
 assert.deepEqual(errors,[]);await context.close();
});

for(const lang of ['en','ja','my'])test(`landscape and desktop ${lang}`,async()=>{
 const {page,context,errors}=await open(`?flags=astrolife,guided&base=jezero&lang=${lang}`,{width:844,height:390});
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 await page.locator('#guided-mission>button').click();await page.locator('#guided-mission>button').click();
 for(const viewport of [{width:844,height:390},{width:1100,height:760}]) {
   await page.setViewportSize(viewport);await page.waitForTimeout(150);
   const bounds=await page.locator('header.hud').boundingBox();
   assert.ok(bounds.x>=0 && bounds.x+bounds.width<=viewport.width && bounds.y+bounds.height<=viewport.height,JSON.stringify(bounds));
   const hud=await page.locator('#mission-hud').boundingBox(), clean=await page.locator('#clean-view').boundingBox();
   const overlap=hud&&clean ? Math.max(0,Math.min(hud.x+hud.width,clean.x+clean.width)-Math.max(hud.x,clean.x))*Math.max(0,Math.min(hud.y+hud.height,clean.y+clean.height)-Math.max(hud.y,clean.y)):0;
   assert.equal(overlap,0,'mission HUD overlaps clean-view control');
   measurements.push({lang,viewport,stage:'layout',hudCleanOverlapArea:overlap});
   await page.screenshot({path:`${artifacts}/${lang}-${viewport.width}-layout.png`});
 }
 assert.deepEqual(errors,[]);await context.close();
});
test('thumb confirmation is stage-scoped, release rearms, Escape aborts countdown',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 await page.locator('#guided-mission>button').click();
 await page.evaluate(()=>{const g=window.__app.guided;for(let t=0;t<1000;t+=100)g.observe(t,{thumbsUp:true,pose:'fist'});});
 assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'destination');
 await page.locator('#guided-mission>div button').first().click();
 await page.evaluate(()=>{const g=window.__app.guided;for(let t=1000;t<1800;t+=100)g.observe(t,{thumbsUp:true,pose:'fist'});});
 assert.equal(await page.evaluate(()=>window.__app.modes.mode),'baseView');
 await page.evaluate(()=>{const g=window.__app.guided;g.observe(1900,null);for(let t=2000;t<=2600;t+=100)g.observe(t,{thumbsUp:true,pose:'fist'});});
 assert.equal(await page.evaluate(()=>window.__app.modes.mode),'launch');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'destination');
 assert.deepEqual(errors,[]);await context.close();
});

test('guided entry is explicit and starts at Earth without changing the flag-only startup',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&lang=my');
 assert.equal(await page.evaluate(()=>window.__app.modes.mode),'solarView');
 assert.equal(await page.evaluate(()=>window.__app.mission.base),null);
 await page.locator('#guided-mission>button').click();
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 assert.equal(await page.evaluate(()=>window.__app.mission.base.base.id),'cape');
 assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'review');
 assert.equal(await page.evaluate(()=>window.__app.mission.countdown),null);
 assert.deepEqual(errors,[]);await context.close();
});

// Focused usability regressions; simulated observations are not real-camera evidence.
test('gesture feedback, touch cancellation and one clear destination action',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();
 assert.match(await page.locator('.guided-instruction').textContent(),/Passenger/);
 await page.evaluate(()=>window.__app.guided.observe(0,{thumbsUp:false,pose:'palm',center:{x:.5,y:.5}}));
 await page.waitForFunction(()=>document.querySelector('.guided-feedback').dataset.state==='seen');
 await page.evaluate(()=>{const g=window.__app.guided;g.observe(100,{thumbsUp:true,pose:'fist'});g.observe(200,{thumbsUp:true,pose:'fist'});});
 await page.waitForFunction(()=>document.querySelector('.guided-feedback').dataset.state==='holding');
 await page.evaluate(()=>{const g=window.__app.guided;for(let t=300;t<=600;t+=100)g.observe(t,{thumbsUp:true,pose:'fist'});});
 await page.waitForFunction(()=>document.querySelector('.guided-feedback').dataset.state==='confirmed');
 await page.waitForFunction(()=>document.querySelector('.guided-feedback').dataset.state==='release');
 assert.match(await page.locator('.guided-instruction').textContent(),/destination/i);
 assert.doesNotMatch(await page.locator('.guided-instruction').textContent(),/Passenger/);
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='launch');assert.match(await action.textContent(),/Cancel/);
 await action.click();await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'destination');
 assert.deepEqual(errors,[]);await context.close();
});

test('complete summary, next visitor and one-minute suggestion preserve native history',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 measurements.push(await page.evaluate(()=>({stage:'native-timing',route:[window.__app.mission.trip.from.base.id,window.__app.mission.trip.to.base.id],nativeFlightSeconds:window.__app.mission.trip.seconds,note:'Configured simulation duration, not measured user-study wall time'})));
 await page.evaluate(()=>{const a=window.__app;a.mission.trip.elapsed=a.mission.trip.seconds-.01;});
 await page.waitForFunction(()=>window.__app.modes.mode==='docking');
 await page.locator('#mission-overlay .auto-land').click(); // touch-equivalent native control remains functional
 await page.evaluate(()=>{const a=window.__app;a.bus.emit({type:'select'});}); // deterministic native auto-land
 await page.waitForFunction(()=>window.__app.guided.session.stage==='exploring',null,{timeout:90000});
 await page.evaluate(()=>{window.__app.guided.session.deadline=Date.now()+59000;});
 await page.waitForFunction(()=>/1 minute/.test(document.querySelector('.guided-instruction').textContent));
 await action.click();await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 await page.evaluate(()=>{const a=window.__app;a.mission.trip.elapsed=a.mission.trip.seconds-.01;});
 await page.waitForFunction(()=>window.__app.modes.mode==='docking');
 await page.evaluate(()=>window.__app.bus.emit({type:'select'}));
 await page.waitForFunction(()=>window.__app.guided.session.stage==='complete',null,{timeout:90000});
 assert.match(await page.locator('.guided-summary').textContent(),/Tranquility/);
 assert.match(await action.textContent(),/Next visitor/);
 const duration=await page.locator('.guided-summary').textContent();await page.waitForTimeout(1100);
 assert.equal(await page.locator('.guided-summary').textContent(),duration);
 const passport=await page.evaluate(()=>localStorage.getItem('gse.passport'));
 await page.waitForFunction(()=>document.querySelector('#gesture-flash').hidden);
 await page.screenshot({path:`${artifacts}/complete-summary.png`});
 await action.click();assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'review');
 assert.deepEqual(await page.evaluate(()=>window.__app.guided.session.visited),[]);
 assert.equal(await page.evaluate(()=>localStorage.getItem('gse.passport')),passport);
 assert.deepEqual(errors,[]);await context.close();
});

for(const lang of ['en','ja','my'])test(`compact landing and touch help ${lang}`,async()=>{
 const {page,context,errors}=await open(`?flags=astrolife,guided&base=jezero&lang=${lang}`);
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView');const action=page.locator('#guided-mission>button');
 await action.click();await action.click();await page.locator('#guided-mission>div button').filter({hasText:/Tranquility|静か/}).click();
 await action.click();await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 await page.evaluate(()=>{const a=window.__app;a.mission.trip.elapsed=a.mission.trip.seconds-.01;});await page.waitForFunction(()=>window.__app.modes.mode==='docking');
 // Freeze native simulation only for deterministic layout measurements, not performance/timing claims.
 await page.evaluate(()=>window.__app.mission.update=()=>null);
 for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
   await page.setViewportSize(viewport);await page.waitForTimeout(180);
   assert.equal(await page.locator('#mission-overlay .buttons>button').count(),1);
   assert.equal(await page.locator('#mission-overlay .auto-land').isVisible(),true);
   assert.equal(await page.locator('#mission-overlay .steering').isVisible(),false);
   const measure=await page.evaluate(()=>{const c=document.querySelector('#mission-overlay .mission-actions').getBoundingClientRect(),h=document.querySelector('#mission-hud').getBoundingClientRect();return {x:c.x,y:c.y,width:c.width,height:c.height,viewport:{width:innerWidth,height:innerHeight},overlap:Math.max(0,Math.min(c.right,h.right)-Math.max(c.left,h.left))*Math.max(0,Math.min(c.bottom,h.bottom)-Math.max(c.top,h.top))};});
   assert.ok(measure.x>=0&&measure.y>=0&&measure.x+measure.width<=viewport.width&&measure.y+measure.height<=viewport.height,JSON.stringify(measure));assert.equal(measure.overlap,0);
   measurements.push({lang,stage:'compact-landing',...measure});await page.screenshot({path:`${artifacts}/${lang}-${viewport.width}-compact-landing.png`});
   await page.locator('#mission-overlay .landing-help summary').click();assert.equal(await page.locator('#mission-overlay .steering').isVisible(),true);
   await page.locator('#mission-overlay .steering').click();await page.locator('#mission-overlay .landing-help summary').click();
 }
 assert.deepEqual(errors,[]);await context.close();
});

// Regressions (audit 2026-11-11). Simulated observations are not real-camera evidence.
// Reopened during a guided countdown or flight with no destination in the address, then "Start fresh": the
// native mission is gone, so the guided panel must offer a way on (Start, which goes to Earth), not a flight
// stage with no flight and no action. (A plain reload keeps ?base=jezero in the address: see the link test.)
for(const phase of ['launch','travel'])test(`start fresh during a guided ${phase} leaves a startable guided state`,async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction((phase)=>{const c=JSON.parse(localStorage.getItem('gse.mission.v1')??'null');return window.__app.modes.mode===phase&&c?.destinationId==='tranquility'&&c.phase===(phase==='travel'?'travel':'base');},phase);
 await page.goto(new URL('?flags=astrolife,guided&lang=en',page.url()).href);await page.waitForFunction(()=>window.__app?.guided&&document.querySelector('#resume-mission-discard'));
 await page.locator('#resume-mission-discard').click();
 await page.waitForFunction(()=>['solarView','focus'].includes(window.__app.modes.mode));
 await page.evaluate(()=>new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,300)))));
 const after=await page.evaluate(()=>({stage:window.__app.guided.session.stage,mode:window.__app.modes.mode}));
 assert.equal(after.stage,'idle',`guided stage after Start fresh: ${JSON.stringify(after)}`);
 assert.equal(await action.isVisible(),true);assert.equal(await action.isEnabled(),true);assert.match(await action.textContent(),/Start/);
 await action.click();await page.waitForFunction(()=>window.__app.modes.mode==='baseView'&&window.__app.guided.session.stage==='review');
 assert.equal(await page.evaluate(()=>window.__app.mission.base.base.id),'cape');
 assert.deepEqual(errors,[]);await context.close();
});

// A 👍 still held when the craft touches down is a new step: it must be released before it can confirm
// "Return to Earth". Without that, the return countdown started about 0.75 s after landing.
test('a thumbs-up held through touchdown must be released before Return to Earth',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 await page.evaluate(()=>{const a=window.__app;a.mission.trip.elapsed=a.mission.trip.seconds-.01;});
 await page.waitForFunction(()=>window.__app.modes.mode==='docking');
 // A steady 👍 through the landing, as the tracking loop would observe it. Observation times are synthetic,
 // 100 ms apart, so a slow test machine can't break the hold with long gaps.
 await page.evaluate(()=>{const a=window.__app;window.__t=performance.now();window.__thumb=setInterval(()=>a.guided.observe(window.__t+=100,{thumbsUp:true,pose:'fist',center:{x:.5,y:.5}}),100);a.bus.emit({type:'select'});});
 await page.waitForFunction(()=>window.__app.guided.session.stage==='exploring',null,{timeout:90000});
 // Landed: the same 👍 held for another second (twice the 500 ms hold), with no release.
 await page.evaluate(()=>{clearInterval(window.__thumb);const g=window.__app.guided;for(let i=0;i<10;i++)g.observe(window.__t+=100,{thumbsUp:true,pose:'fist',center:{x:.5,y:.5}});});
 await page.evaluate(()=>new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const held=await page.evaluate(()=>({mode:window.__app.modes.mode,stage:window.__app.guided.session.stage,feedback:document.querySelector('.guided-feedback').dataset.state}));
 assert.deepEqual(held,{mode:'baseView',stage:'exploring',feedback:'release'});
 // Released, then a fresh 👍: Return to Earth.
 await page.evaluate(()=>{const g=window.__app.guided;g.observe(window.__t+=100,null);for(let i=0;i<7;i++)g.observe(window.__t+=100,{thumbsUp:true,pose:'fist',center:{x:.5,y:.5}});});
 await page.waitForFunction(()=>window.__app.modes.mode==='launch');
 assert.equal(await page.evaluate(()=>window.__app.guided.session.stage),'returning');
 assert.deepEqual(errors,[]);await context.close();
});

// Start fresh with an explicit ?base= link: the link is honoured (the visitor arrives at that base), and
// the guided panel offers Start there.
test('start fresh during a guided flight still honours an explicit ?base= link',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel'&&JSON.parse(localStorage.getItem('gse.mission.v1')??'null')?.phase==='travel');
 await page.goto(new URL('?flags=astrolife,guided&base=jezero&lang=en',page.url()).href);
 await page.waitForFunction(()=>window.__app?.guided&&document.querySelector('#resume-mission-discard'));
 await page.locator('#resume-mission-discard').click();
 await page.waitForFunction(()=>window.__app.guided.session.stage==='idle'||window.__app.modes.mode==='focus',null,{timeout:30000});
 await page.evaluate(()=>new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,1500)))));
 const after=await page.evaluate(()=>({mode:window.__app.modes.mode,base:window.__app.mission.base?.base.id??null,stage:window.__app.guided.session.stage}));
 assert.deepEqual(after,{mode:'baseView',base:'jezero',stage:'idle'});
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('gse.guided.v1')).stage),'idle');
 await action.click();await page.waitForFunction(()=>window.__app.guided.session.stage==='review');
 assert.equal(await page.evaluate(()=>window.__app.mission.base.base.id),'jezero');
 assert.deepEqual(errors,[]);await context.close();
});

// A link to another base than the saved mission's: no checkpoint is offered, so the restored guided journey
// is orphaned. It starts over and the link is honoured; the saved checkpoint itself is left to the native code.
test('a ?base= link that bypasses the checkpoint offer starts the guided journey over at that base',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel'&&JSON.parse(localStorage.getItem('gse.mission.v1')??'null')?.baseId==='jezero');
 await page.goto(new URL('?flags=astrolife,guided&base=cape&lang=en',page.url()).href);
 await page.waitForFunction(()=>window.__app?.guided&&window.__app.modes.mode==='baseView',null,{timeout:30000});
 await page.evaluate(()=>new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,1500)))));
 const after=await page.evaluate(()=>({mode:window.__app.modes.mode,base:window.__app.mission.base?.base.id??null,stage:window.__app.guided.session.stage,offer:!!document.querySelector('#resume-mission')}));
 assert.deepEqual(after,{mode:'baseView',base:'cape',stage:'idle',offer:false});
 await action.click();await page.waitForFunction(()=>window.__app.guided.session.stage==='review');
 assert.deepEqual(errors,[]);await context.close();
});

// A saved guided session with no mission checkpoint at all (cleared or never written): nothing native to
// continue, so the guided panel starts over, with or without a ?base= link, and a further refresh can't strand it.
test('a guided session without a mission checkpoint starts over and stays startable across refreshes',async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 // From the next navigation on, the mission checkpoint is gone when the page starts.
 await context.addInitScript(()=>{if(sessionStorage.getItem('test.dropCheckpoint'))localStorage.removeItem('gse.mission.v1');});
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 await page.evaluate(()=>sessionStorage.setItem('test.dropCheckpoint','1'));
 const settle=()=>page.evaluate(()=>new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,1500)))));
 const state=()=>page.evaluate(()=>({mode:window.__app.modes.mode,base:window.__app.mission.base?.base.id??null,stage:window.__app.guided.session.stage,offer:!!document.querySelector('#resume-mission')}));
 // No link: the overview, with Start.
 await page.goto(new URL('?flags=astrolife,guided&lang=en',page.url()).href);await page.waitForFunction(()=>window.__app?.guided);await settle();
 assert.deepEqual(await state(),{mode:'solarView',base:null,stage:'idle',offer:false});
 assert.equal(await action.isEnabled(),true);await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='baseView'&&window.__app.guided.session.stage==='review');
 // Refresh again (the address now links to the Earth base): still startable, and the link is honoured.
 await page.reload();await page.waitForFunction(()=>window.__app?.guided);await settle();
 assert.deepEqual(await state(),{mode:'baseView',base:'cape',stage:'idle',offer:false});
 await action.click();await page.waitForFunction(()=>window.__app.guided.session.stage==='review');
 assert.deepEqual(errors,[]);await context.close();
});

// "Continue mission" must keep the guided journey as it was: stage, destination, deadline and visits.
for(const leg of ['outbound','returning'])test(`continue mission keeps the guided journey (${leg} flight)`,async()=>{
 const {page,context,errors}=await open('?flags=astrolife,guided&base=jezero&lang=en');await page.waitForFunction(()=>window.__app.modes.mode==='baseView');
 const action=page.locator('#guided-mission>button');await action.click();await action.click();
 await page.locator('#guided-mission>div button').filter({hasText:'Tranquility'}).click();await action.click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 if(leg==='returning') {
   await page.evaluate(()=>{const a=window.__app;a.mission.trip.elapsed=a.mission.trip.seconds-.01;});
   await page.waitForFunction(()=>window.__app.modes.mode==='docking');await page.evaluate(()=>window.__app.bus.emit({type:'select'}));
   await page.waitForFunction(()=>window.__app.guided.session.stage==='exploring',null,{timeout:90000});
   await action.click();await page.waitForFunction(()=>window.__app.modes.mode==='travel'&&window.__app.guided.session.stage==='returning');
 }
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gse.mission.v1')??'null')?.phase==='travel');
 const journey=()=>page.evaluate(()=>{const s=window.__app.guided.session,t=window.__app.mission.trip;return {stage:s.stage,destination:s.destination,deadline:s.deadline,startedAt:s.startedAt,visited:[...s.visited],from:t?.from.base.id,to:t?.to.base.id};});
 const before=await journey();
 // The saved location: the same flight, between the same bases.
 assert.deepEqual([before.from,before.to],leg==='returning'?['tranquility','cape']:['jezero','tranquility']);
 await page.reload();await page.waitForFunction(()=>window.__app?.guided&&document.querySelector('#resume-mission-continue'));
 await page.locator('#resume-mission-continue').click();
 await page.waitForFunction(()=>window.__app.modes.mode==='travel');
 await page.evaluate(()=>new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,500)))));
 assert.deepEqual(await journey(),before);
 assert.deepEqual(before.visited,leg==='returning'?['tranquility']:[]);
 assert.deepEqual(errors,[]);await context.close();
});
