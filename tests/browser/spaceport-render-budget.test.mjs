// Launch Preview render budget in the real app: EVERY frame, shadow passes included, stays within 400,000 triangles.
//   node --test --test-concurrency=1 tests/browser/spaceport-render-budget.test.mjs
// Method: the dev server serves the app's own modules, so the test patches SpaceportPreview.prototype.update (the one
// place the preview renders, once per animation frame) before the preview opens. Each frame resets renderer.info and
// reads info.render.triangles after the frame, which sums every pass drawn in that frame (the shadow map's included).
// Covered: the opening frames (loading, the three one-off shadow-map frames, the first visible frames), camera presets and
// their eased moves, a place flight, drag + Reset, scrubbing (keys, markers, the range input), the full launch and
// Replay, and window resizes. Desktop runs High (shadows); phones run Low (a phone's Auto default).
// Headless software GL: triangle counts are exact; timings are not measured here.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const BUDGET = 400_000;
let server, browser, url;
before(async () => {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  await warmUp(chromium, url);
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

const SETUPS = {
  'desktop 1440x900 High': { viewport: { width: 1440, height: 900 }, quality: 'high' },
  // A real phone's Auto starts on Low; an emulated phone keeps a desktop user agent, so Low is set explicitly.
  'phone 390x844 Low': { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, quality: 'low' },
  'phone 844x390 Low': { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, quality: 'low' },
};

async function run(name) {
  const s = SETUPS[name];
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: s.viewport, isMobile: !!s.isMobile, hasTouch: !!s.hasTouch });
  await context.addInitScript((q) => {
    localStorage.setItem('gse.quality', q);
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  }, s.quality);
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?site=ground&base=tanegashima&lang=en`);
  await page.waitForFunction(() => window.__app?.localSpaceport?.active && document.querySelector('[data-ui="spaceport-entry"]'));
  // Instrument every preview frame before the preview exists.
  await page.evaluate(async () => {
    const { SpaceportPreview } = await import('/src/scene/spaceportPreview.ts');
    const original = SpaceportPreview.prototype.update;
    window.__frames = []; window.__phase = 'opening';
    SpaceportPreview.prototype.update = function (dt, reduced) {
      this.renderer.info.autoReset = false; this.renderer.info.reset();
      const shadowsBefore = this.shadowQueue.length > 0; // this frame draws a launch-state shadow map
      original.call(this, dt, reduced);
      const r = this.renderer.info.render;
      if (r.calls) window.__frames.push({ phase: window.__phase, triangles: r.triangles, calls: r.calls, shadow: !!shadowsBefore, t: +this.time.toFixed(2) });
    };
  });
  const phase = (p) => page.evaluate((x) => { window.__phase = x; }, p);
  const idle = () => page.waitForFunction(() => !window.__app.spaceport.viewer?.moving, null, { timeout: 120000 });
  const frames = (n) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const press = async (sel) => { const l = page.locator(sel).first(); if (s.hasTouch) await l.tap(); else await l.click(); };
  try {
    await page.keyboard.press('Shift');
    await page.locator('[data-ui="spaceport-entry"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#spaceport-view .spaceport-status')?.hidden && !document.querySelector('[data-ui="spaceport-play"]')?.disabled);
    await frames(4);
    for (const [label, sel] of [['Terminal', '[data-ui="spaceport-view"][data-view="terminal"]'], ['Observation Deck', '[data-ui="spaceport-view"][data-view="deck"]'], ['Launch Pad', '[data-ui="spaceport-view"][data-view="pad"]'], ['Follow', '[data-ui="spaceport-view"][data-view="launch"]'], ['Overview', '[data-ui="spaceport-view"][data-view="overview"]'], ['place flight', '#spaceport-view [data-landmark]'], ['Reset', '[data-ui="spaceport-reset"]']]) {
      await phase(label); await press(sel); await frames(2); await idle(); await frames(2);
    }
    await phase('drag + Reset');
    const c = await page.locator('.spaceport-stage canvas').boundingBox();
    if (!s.hasTouch) { await page.mouse.move(c.x + c.width * .5, c.y + c.height * .35); await page.mouse.down(); await page.mouse.move(c.x + c.width * .3, c.y + c.height * .3, { steps: 6 }); await page.mouse.up(); }
    else { const cdp = await context.newCDPSession(page); const at = (x) => [{ x: c.x + c.width * x, y: c.y + c.height * .35 }]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(.5) }); for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(.5 - i * .04) }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
    await frames(3); await press('[data-ui="spaceport-reset"]'); await frames(2); await idle(); await frames(2);
    await phase('scrub');
    await page.locator('[data-ui="spaceport-timeline"]').focus();
    for (let i = 0; i < 6; i++) { await page.keyboard.press('PageUp'); await frames(1); }
    for (const v of ['4.5', '7.5', '12', '17', '2']) { await page.locator('[data-ui="spaceport-timeline"]').fill(v); await frames(2); }
    for (const m of await page.locator('[data-ui="spaceport-phase-marker"]').all()) { if (s.hasTouch) await m.tap(); else await m.click(); await frames(2); }
    // Exercise the new arrival camera while passengers/doors advance on the same timeline.
    // Bound this sample; the existing complete launch and Replay coverage below remains intact.
    await page.evaluate(() => { const v = window.__app.spaceport.viewer; v.playing = false; v.seek(0); v.setView('terminal', { animate: false }); });
    await phase('Terminal playback');
    await press('[data-ui="spaceport-play"]');
    await frames(6);
    await page.evaluate(() => { const v = window.__app.spaceport.viewer; v.seek(8); });
    await frames(6);
    await page.evaluate(() => { const v = window.__app.spaceport.viewer; v.playing = false; v.seek(0); v.setView('overview', { animate: false }); });
    await phase('playback');
    await press('[data-ui="spaceport-play"]');
    await page.locator('[data-ui="spaceport-play"][data-state="replay"]').waitFor({ timeout: 300000 });
    await phase('Replay');
    await press('[data-ui="spaceport-play"]');
    await page.locator('[data-ui="spaceport-play"][data-state="pause"]').waitFor();
    await frames(20);
    await press('[data-ui="spaceport-play"]'); // pause
    await phase('resize');
    const v = s.viewport;
    await page.setViewportSize({ width: v.height, height: v.width }); await frames(4);
    await page.setViewportSize(v); await frames(4);
    const frames_ = await page.evaluate(() => window.__frames);
    const shadowMaps = await page.evaluate(() => {
      const maps = window.__app.spaceport.viewer.shadowMaps;
      return {
        states: [...maps.keys()],
        distinctTargets: new Set(maps.values()).size,
        allocated: [...maps.values()].every(map => map.width > 1 && map.height > 1 && !!map.texture),
      };
    });
    return { frames: frames_, errors, shadowMaps };
  } finally { await context.close(); }
}

for (const name of Object.keys(SETUPS)) {
  test(`${name}: every frame <= 400k triangles (opening, presets, moves, Reset, scrub, playback, Replay, resize)`, async () => {
    const { frames, errors, shadowMaps } = await run(name);
    const byPhase = {};
    for (const f of frames) { const p = (byPhase[f.phase] ??= { frames: 0, max: 0, shadowFrames: 0 }); p.frames++; p.max = Math.max(p.max, f.triangles); if (f.shadow) p.shadowFrames++; }
    const worst = frames.reduce((a, b) => (b.triangles > a.triangles ? b : a), { triangles: 0 });
    console.log(name, 'frames', frames.length, 'worst', JSON.stringify(worst), JSON.stringify(byPhase));
    for (const p of ['opening', 'Terminal', 'Observation Deck', 'Launch Pad', 'Follow', 'Overview', 'place flight', 'Reset', 'drag + Reset', 'scrub', 'Terminal playback', 'playback', 'Replay', 'resize']) assert.ok(byPhase[p]?.frames > 0, `frames recorded during ${p}`);
    assert.ok(frames.some(f => f.phase === 'Terminal playback' && f.t > 0), 'the arrival timeline advances in the Terminal view');
    assert.ok(byPhase.playback.frames >= 30, `the launch played through ${byPhase.playback.frames} frames`);
    const launch = frames.filter(f => f.phase === 'playback');
    assert.ok(launch[0].t < 0.5 && launch.at(-1).t >= 19.95, 'playback samples the full timeline, from launch start to completion');
    const over = frames.filter((f) => f.triangles > BUDGET);
    assert.deepEqual(over, [], `frames over ${BUDGET} triangles`);
    const shadowFrames = frames.filter((f) => f.shadow);
    console.log(name, 'shadow frames', JSON.stringify(shadowFrames));
    if (name.includes('High')) {
      assert.equal(shadowFrames.length, 3, 'the three launch-state shadow maps are drawn once each, one per frame');
      assert.deepEqual(shadowMaps, { states: ['rest', 'retracted', 'launched'], distinctTargets: 3, allocated: true });
      for (const f of shadowFrames) assert.ok(f.calls > 1, 'a shadow-map frame submits shadow casters');
    } else {
      assert.equal(shadowFrames.length, 0, 'Low draws no shadow map');
      assert.equal(shadowMaps.distinctTargets, 0, 'Low allocates no shadow targets');
    }
    assert.deepEqual(errors, []);
  });
}
