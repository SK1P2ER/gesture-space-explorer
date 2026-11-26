// Jezero Dome — First Exploration: the near-sunset preview is reversible (sunsetPreview.ts; Restore lives in the
// Explore card's time group with the Day / Golden Hour / Night presets since the presets pass).
//   node --test --test-concurrency=1 tests/browser/jezero-sunset.test.mjs
// Dev server; Explore and the near-sunset action are driven through the dev-only window.__app bus (or the visible
// controls where the case is about input). Synthetic: no camera (refused), no real hand. Fresh profile per test.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let server, browser, url;
before(async () => {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  await warmUp(chromium, url);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { args: ['--use-gl=angle', '--use-angle=d3d11'] } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });

const VIEWPORTS = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 }, land: { width: 844, height: 390 } };

async function open(query, { viewport = VIEWPORTS.desk, reducedMotion = 'reduce', hasTouch = false } = {}) {
  const context = await browser.newContext({ reducedMotion, viewport, hasTouch, isMobile: hasTouch && viewport.width < 900 });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?${query}`);
  await page.waitForFunction(() => window.__app?.mission && window.__app.sunsetPreview && document.querySelector('#status')?.dataset.kind === 'keyboard');
  return { context, page, errors };
}
/** Direct Jezero visit, then Explore (the horizon view). */
async function explore(page) {
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'jezero' && window.__app.showcases.get('jezero'));
  await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
  await page.waitForFunction(() => window.__app.mission.horizon !== null);
}
const emit = (page, intent) => page.evaluate((i) => window.__app.bus.emit(i), intent);
const time = (page) => page.evaluate(() => window.__app.clock.time);
const original = (page) => page.evaluate(() => window.__app.sunsetPreview.state?.original ?? null);
const restoreShown = (page) => page.locator('#restore-time').isVisible();
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const rects = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => !e.hidden && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }), sel);
const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('repeated near-sunset keeps the first original; Restore returns it exactly and stays in Explore (mouse, focus, one announcement)', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await explore(page);
    assert.equal(await restoreShown(page), false, 'nothing to restore before a sunset preview');
    const t0 = await time(page);
    await emit(page, { type: 'goldenHour' });
    const t1 = await time(page);
    assert.ok(Math.abs(t1 - t0) > 3600e3, 'the clock moved to near sunset');
    const saved = await original(page);
    assert.ok(Math.abs(saved - t0) < 1000, 'the time just before the jump is saved');
    await page.locator('#restore-time').waitFor({ state: 'visible' });
    // Again (twice): the clock may move on to a later sunset, but the saved original never changes.
    await emit(page, { type: 'goldenHour' });
    await emit(page, { type: 'goldenHour' });
    assert.equal(await original(page), saved);
    assert.match(await page.locator('#restore-time').textContent(), /Restore previous time/);
    assert.match(await page.locator('#restore-time').getAttribute('aria-label'), /^Restore previous time: /);
    await page.locator('#restore-time').click();
    const t2 = await time(page);
    assert.ok(Math.abs(t2 - saved) < 5000, `restored to the saved time (${t2 - saved} ms off)`);
    assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null, 'still exploring');
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.equal(await original(page), null);
    const focused = await page.evaluate(() => document.activeElement?.closest('#explore-time') ? document.activeElement.dataset.preset : document.activeElement?.id);
    assert.ok(['day', 'golden', 'night'].includes(focused), `focus stays in the time group (${focused})`);
    await page.waitForFunction(() => document.querySelector('#explore-time-live')?.textContent === 'Previous time restored');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a manual time change discards the restore; speed and pause keep it', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await explore(page);
    await emit(page, { type: 'goldenHour' });
    await page.locator('#restore-time').waitFor({ state: 'visible' });
    await emit(page, { type: 'setTimeSpeed', position: 0.3 });
    await emit(page, { type: 'togglePause' });
    await emit(page, { type: 'togglePause' });
    await emit(page, { type: 'reverseTime' });
    await page.waitForTimeout(200);
    assert.equal(await restoreShown(page), true, 'speed / pause / direction are not a time change');
    await emit(page, { type: 'timeNow' });
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.equal(await original(page), null);
    // timeJump (a date chosen by hand) discards a new preview the same way.
    await emit(page, { type: 'goldenHour' });
    await page.locator('#restore-time').waitFor({ state: 'visible' });
    await emit(page, { type: 'timeJump', ms: Date.UTC(2030, 0, 1) });
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__app.mission.horizon !== null), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('leaving Explore discards it: back in Explore there is no stale restore; a language change keeps it', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await explore(page);
    await emit(page, { type: 'goldenHour' });
    await page.locator('#restore-time').waitFor({ state: 'visible' });
    await emit(page, { type: 'toggleLanguage' });
    await page.waitForTimeout(200);
    assert.equal(await restoreShown(page), true, 'language change keeps it');
    assert.notEqual(await page.locator('#restore-time').textContent(), 'Restore previous time', 're-labelled');
    await emit(page, { type: 'toggleHorizon' }); // leave Explore
    await page.waitForFunction(() => window.__app.mission.horizon === null);
    await page.waitForTimeout(200);
    assert.equal(await original(page), null);
    assert.equal(await restoreShown(page), false);
    await emit(page, { type: 'toggleHorizon' });
    await page.waitForFunction(() => window.__app.mission.horizon !== null);
    await page.waitForTimeout(300);
    assert.equal(await restoreShown(page), false, 'no stale restore in a later Explore');
    // Leaving the base: also gone.
    await emit(page, { type: 'goldenHour' });
    await page.locator('#restore-time').waitFor({ state: 'visible' });
    await emit(page, { type: 'dismiss' }); // Esc: up out of the horizon view
    await page.waitForFunction(() => window.__app.mission.horizon === null);
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the near-sunset action where it cannot move the clock starts nothing (no showcase at the base)', async () => {
  const { page, context, errors } = await open('lang=en');
  try {
    await emit(page, { type: 'enterBase', baseId: 'cape' });
    await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'cape');
    const t0 = await time(page);
    await emit(page, { type: 'goldenHour' });
    assert.ok(Math.abs((await time(page)) - t0) < 2000);
    await page.waitForTimeout(200);
    assert.equal(await original(page), null);
    assert.equal(await restoreShown(page), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('keyboard: Restore is reachable and works with Enter; reduced motion has no animation on it', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await explore(page);
    await emit(page, { type: 'goldenHour' });
    await page.locator('#restore-time').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#restore-time').evaluate((e) => getComputedStyle(e).animationName), 'none');
    const saved = await original(page);
    await page.locator('#restore-time').focus();
    await page.keyboard.press('Enter');
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.ok(Math.abs((await time(page)) - saved) < 5000);
    assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
  test(`${vp}: Restore previous time is in the Explore time group, in view and clear of other controls (my, ja, en; ${vp === 'desk' ? 'mouse' : 'touch'})`, async () => {
    const touch = vp !== 'desk';
    for (const lang of ['my', 'ja', 'en']) {
      const { page, context, errors } = await open(`base=jezero&lang=${lang}`, { viewport, hasTouch: touch });
      try {
        await explore(page);
        // The visible near-sunset control if there is one (the exploration overlay), else the intent.
        const chip = page.locator('#horizon-sunset');
        if (await chip.isVisible().catch(() => false)) { if (touch) await chip.tap(); else await chip.click(); }
        else await emit(page, { type: 'goldenHour' });
        await page.locator('#restore-time').waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        const r = await rect(page, '#restore-time');
        assert.ok(r, `${lang}: shown`);
        assert.ok(r.left >= 0 && r.top >= 0 && r.right <= viewport.width && r.bottom <= viewport.height, `${lang}: in view ${JSON.stringify(r)}`);
        assert.ok(r.height >= 44, `${lang}: ≥ 44 px tall (${r.height})`);
        const clipped = await page.locator('#restore-time').evaluate((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1);
        assert.equal(clipped, false, `${lang}: label wraps, nothing clipped`);
        // In the same group as the local time and the presets.
        const group = await rect(page, '#explore-time');
        assert.ok(group && r.left >= group.left - 1 && r.right <= group.right + 1 && r.top >= group.top - 1 && r.bottom <= group.bottom + 1, `${lang}: inside the time group ${JSON.stringify([r, group])}`);
        assert.ok(await page.locator('#explore-local').isVisible(), `${lang}: local time shown`);
        for (const sel of ['#return-orbit', '#preview', '#gesture-flash', 'header.hud.top', '#mission-hud', '#clean-view', '#timebar']) {
          assert.ok(!overlaps(r, await rect(page, sel)), `${lang}: clear of ${sel} ${JSON.stringify([r, await rect(page, sel)])}`);
        }
        // The footer's own controls (its box spans the width under the centred time bar on desktop).
        for (const b of await rects(page, 'footer.hud :is(button, a)')) assert.ok(!overlaps(r, b), `${lang}: clear of a footer control ${JSON.stringify([r, b])}`);
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'no page scroll');
        const saved = await original(page);
        if (touch) await page.locator('#restore-time').tap(); else await page.locator('#restore-time').click();
        await page.locator('#restore-time').waitFor({ state: 'hidden' });
        assert.ok(Math.abs((await time(page)) - saved) < 5000, `${lang}: restored`);
        assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null, `${lang}: still exploring`);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
}
