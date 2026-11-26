// Arrival composition and real input/state behavior, all three layouts and languages.
// POLISH_URL may reuse an already-running local dev server; otherwise this owns and closes one server.
import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {warmUp} from './helpers/warmup.mjs';
let browser,server,url=process.env.POLISH_URL;
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=process.env.POLISH_SHOTS;
before(async()=>{
  if(!url){server=await createServer({root,logLevel:'error',server:{host:'127.0.0.1',port:0}});await server.listen();url=server.resolvedUrls.local[0].replace(/\/$/,'');await warmUp(chromium,url);}
  browser=await chromium.launch({headless:true});if(out)mkdirSync(out,{recursive:true});
});
after(async()=>{await browser?.close();await server?.close();});
const layouts={desk:{width:1440,height:900},portrait:{width:390,height:844},landscape:{width:844,height:390}};
for(const [layout,viewport] of Object.entries(layouts))for(const lang of ['en','ja','my']){
 test(`${layout} ${lang}: arrival framing, manual camera ownership, stable controls and animated seek`,{timeout:240000},async()=>{
  const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce',hasTouch:layout!=='desk',isMobile:layout!=='desk'});
  await context.addInitScript(()=>{localStorage.setItem('gse.quality','low');navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('test: no camera','NotAllowedError')};});
  const page=await context.newPage();page.setDefaultTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.clock.install({time:new Date('2126-01-01T03:00:00Z')});
   const frames=async(n=2)=>{for(let i=0;i<n;i++)await page.clock.runFor(16)};
   const until=async(fn)=>{for(let i=0;i<400;i++){try{if(await page.evaluate(fn))return;await frames(1)}catch(e){if(!/Execution context was destroyed/.test(e.message))throw e}await new Promise(r=>setTimeout(r,100))}throw Error('load timeout')};
   await page.goto(`${url}/?site=ground&base=tanegashima&lang=${lang}`);
   await page.waitForFunction(()=>!!document.querySelector('[data-ui="spaceport-entry"]')&&window.__app?.localSpaceport.active&&!!window.__app.localSpaceport.viewPose());
   await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+10000)));
   await page.keyboard.press('Shift');await page.locator('[data-ui="spaceport-entry"]').focus();
   await page.evaluate(()=>addEventListener('keydown',e=>{if(e.key==='Enter')window.__polishGround=JSON.stringify(window.__app.localSpaceport.viewPose())},{capture:true,once:true}));
   await page.keyboard.press('Enter');const ground=await page.evaluate(()=>window.__polishGround);
   await until(()=>window.__app?.spaceport.viewer&&document.querySelector('#spaceport-view .spaceport-status')?.hidden);
   await page.evaluate(()=>document.fonts.ready);await frames(3);
   const press=async(sel)=>{const r=await page.locator(sel).boundingBox();assert.ok(r);if(layout==='desk')await page.mouse.click(r.x+r.width/2,r.y+r.height/2);else await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);await frames(3)};
   await press('[data-view="terminal"]');
   assert.equal(await page.locator('[data-view="terminal"]').getAttribute('aria-pressed'),'true');
   await press('[data-ui="spaceport-play"]');await frames(3);
   assert.equal(await page.evaluate(()=>window.__app.spaceport.viewer.playing),true);
   assert.equal(await page.locator('[data-view="terminal"]').getAttribute('aria-pressed'),'true','Play respects the explicitly chosen arrival view');
   await press('[data-ui="spaceport-play"]');
   const framing=await page.evaluate(async()=>{const v=window.__app.spaceport.viewer;const{terminalPoints}=await import('/src/scene/terminalFraming.ts');return{points:terminalPoints().map(p=>p.project(v.camera).toArray()),bands:v.bands,eye:v.camera.position.toArray()}});
   for(const [x,y,z] of framing.points){assert.ok(Math.abs(x)<=.921);assert.ok(y<=1-2*framing.bands.top-.079);assert.ok(y>=-1+2*framing.bands.bottom+.079);assert.ok(z>-1&&z<1)}
   const rectangles=()=>page.evaluate(()=>[...document.querySelectorAll('.spaceport-cameras button,[data-ui="spaceport-play"]')].map(e=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]}));
   const original=await rectangles();
   if(layout==='landscape') {
    const placeRow=await page.locator('.spaceport-landmarks').evaluate(row=>({
     width:row.clientWidth,maxChip:Math.max(...[...row.children].map(chip=>chip.getBoundingClientRect().width)),
    }));
    assert.ok(placeRow.width >= placeRow.maxChip, `landscape place row can show any chip fully: ${JSON.stringify(placeRow)}`);
   }
   const poses=[];
   for(const time of [0,8,19.958,8]){
    await page.evaluate(t=>window.__app.spaceport.viewer.seek(t),time);await frames(2);
    poses.push(await page.evaluate(()=>{const v=window.__app.spaceport.viewer;const bones=[];v.scene.traverse(o=>{if(o.isSkinnedMesh&&o.userData.arrivalActor){for(const b of o.skeleton.bones)bones.push(...b.matrixWorld.elements)}});return bones.map(n=>n.toFixed(5)).join(',')}));
    const current=await rectangles();assert.ok(original.every((r,i)=>r.every((n,j)=>Math.abs(n-current[i][j])<1)),'seeking does not move controls');
   }
   assert.ok(poses[0].length>0,'the actual app contains skinned passengers');
   assert.notEqual(poses[0],poses[1],'authored arrival advances with the shared timeline');
   assert.equal(poses[1],poses[3],'seeking back gives the same arrival pose');
   if(out)await page.screenshot({path:`${out}/${layout}-${lang}-terminal.png`});
   const canvas=await page.locator('.spaceport-stage canvas').boundingBox();
   await page.mouse.move(canvas.width*.5,canvas.height*.3);await page.mouse.down();await page.mouse.move(canvas.width*.58,canvas.height*.32,{steps:3});await page.mouse.up();await frames(3);
   assert.equal(await page.locator('.spaceport-cameras [aria-pressed="true"]').count(),0,'manual orbit clears the preset cue');
   await press('[data-view="terminal"]');assert.equal(await page.locator('[data-view="terminal"]').getAttribute('aria-pressed'),'true');
   const hit=await page.locator('[data-ui="spaceport-timeline"]').boundingBox();if(layout!=='desk')assert.ok(hit.height>=44);
   await press('[data-ui="spaceport-phase-marker"][data-phase="ignition"]');
   assert.equal(Number(await page.locator('[data-ui="spaceport-timeline"]').inputValue()),6);
   await page.locator('[data-ui="spaceport-timeline"]').focus();await page.keyboard.press('ArrowRight');await frames(2);
   assert.ok(Number(await page.locator('[data-ui="spaceport-timeline"]').inputValue())>6);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(out)await page.screenshot({path:`${out}/${layout}-${lang}-dock.png`});
   await press('[data-ui="spaceport-reset"]');assert.equal(await page.locator('[data-view="overview"]').getAttribute('aria-pressed'),'true');
   await press('[data-ui="spaceport-close"]');
   const restored=await page.evaluate(()=>JSON.stringify(window.__app.localSpaceport.viewPose()));
   const a=JSON.parse(ground),b=JSON.parse(restored);assert.ok([...a.eye,...a.target].every((n,i)=>Math.abs(n-[...b.eye,...b.target][i])<1e-5),'ground camera is restored');
   assert.deepEqual(errors,[]);
   if(out)writeFileSync(`${out}/${layout}-${lang}.json`,JSON.stringify({layout,lang,framing,errors},null,2));
  }finally{await context.close()}
 });
}
