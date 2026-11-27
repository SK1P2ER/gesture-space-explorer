// Launch Preview fixes found by the 2026-11-22 QA pass (headless, dev server).
//   node --test --test-concurrency=1 tests/browser/spaceport-a11y-fixes.test.mjs
// 1. Short landscape: after a load failure, Retry sits clear of the dock and can be tapped; Retry -> recovery puts focus on Play.
// 2. Closing the place card with its x returns focus to that place's chip (it used to drop to <body>).
// 3. Top-bar buttons keep their dark panel on hover (the plain hover tint left 1.5:1 text over the sky).
// 4. Help panel: the Performance summary and the credits link are at least 44 px tall.
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
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function ground(viewport, { touch = false, lang = 'en' } = {}) {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport, isMobile: touch, hasTouch: touch });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const failGlb = { on: false };
  await page.route('**/spaceport/tanegashima-m03.glb', (route) => (failGlb.on ? route.fulfill({ status: 404, body: '' }) : route.continue()));
  await page.goto(`${url}/?site=ground&base=tanegashima&lang=${lang}`);
  await page.waitForFunction(() => window.__app?.localSpaceport?.active && document.querySelector('[data-ui="spaceport-entry"]'));
  return { context, page, failGlb };
}
const open = async (page) => {
  await page.keyboard.press('Shift');
  await page.locator('[data-ui="spaceport-entry"]').focus();
  await page.keyboard.press('Enter');
};
const loaded = (page) => page.waitForFunction(() => document.querySelector('#spaceport-view .spaceport-status')?.hidden && !document.querySelector('[data-ui="spaceport-play"]')?.disabled);
const active = (page) => page.evaluate(() => { const e = document.activeElement; return e?.dataset?.ui ? `${e.dataset.ui}${e.dataset.landmark ? ':' + e.dataset.landmark : ''}` : e?.tagName; });

test('844x390: Retry clears the dock, can be tapped, and recovery focuses Play', async () => {
  const { context, page, failGlb } = await ground({ width: 844, height: 390 }, { touch: true });
  try {
    failGlb.on = true;
    await open(page);
    const retry = page.locator('[data-ui="spaceport-retry"]');
    await retry.waitFor({ state: 'visible' });
    const geo = await page.evaluate(() => {
      const r = document.querySelector('[data-ui="spaceport-retry"]').getBoundingClientRect();
      const dock = document.querySelector('#spaceport-view .spaceport-dock').getBoundingClientRect();
      const status = document.querySelector('#spaceport-view .spaceport-status').getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-ui]')?.dataset.ui;
      return { retryBottom: r.bottom, dockTop: dock.top, statusBottom: status.bottom, retryTop: r.top, hit };
    });
    assert.ok(geo.retryBottom <= geo.dockTop, `Retry ends at ${geo.retryBottom}, the dock starts at ${geo.dockTop}`);
    assert.ok(geo.retryTop >= geo.statusBottom, 'Retry stays below the message');
    assert.equal(geo.hit, 'spaceport-retry', 'Retry receives a tap at its centre');
    failGlb.on = false;
    await retry.tap();
    await loaded(page);
    await page.waitForFunction(() => document.activeElement?.dataset?.ui === 'spaceport-play');
    assert.equal(await active(page), 'spaceport-play');
  } finally { await context.close(); }
});

test('1440x900: the place card x returns focus to its chip; top-bar hover keeps the panel', async () => {
  const { context, page } = await ground({ width: 1440, height: 900 });
  try {
    await open(page);
    await loaded(page);
    const chip = page.locator('#spaceport-view [data-landmark]').first();
    const id = await chip.getAttribute('data-landmark');
    await chip.focus(); await page.keyboard.press('Enter');
    const close = page.locator('[data-ui="spaceport-place-card-close"]');
    await close.waitFor();
    await close.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#spaceport-inspection').isHidden(), true);
    assert.equal(await active(page), `spaceport-place:${id}`, 'focus is back on the chip');
    for (const sel of ['[data-ui="spaceport-reset"]', '[data-ui="spaceport-close"]']) {
      const before = await page.locator(sel).evaluate((e) => getComputedStyle(e).backgroundColor);
      await page.locator(sel).hover();
      const hover = await page.locator(sel).evaluate((e) => ({ color: getComputedStyle(e).backgroundColor, image: getComputedStyle(e).backgroundImage }));
      assert.equal(hover.color, before, `${sel} keeps its panel colour on hover`);
      assert.match(hover.image, /gradient/, `${sel} is tinted on hover`);
    }
  } finally { await context.close(); }
});

test('390x844: help panel summary and credits link are 44 px touch targets', async () => {
  const { context, page } = await ground({ width: 390, height: 844 }, { touch: true, lang: 'my' });
  try {
    await open(page);
    await loaded(page);
    await page.locator('#spaceport-view .spaceport-heading button[aria-controls="spaceport-about"], [data-ui="spaceport-help"]').first().tap();
    await page.locator('#spaceport-about').waitFor({ state: 'visible' });
    const sizes = await page.evaluate(() => ({
      summary: document.querySelector('#spaceport-about .spaceport-performance summary').getBoundingClientRect().height,
      link: document.querySelector('#spaceport-about .spaceport-credits a').getBoundingClientRect().height,
    }));
    assert.ok(sizes.summary >= 44, `summary ${sizes.summary}px`);
    assert.ok(sizes.link >= 44, `credits link ${sizes.link}px`);
  } finally { await context.close(); }
});

// 5. Phone timeline: a 44 px touch hit area, the track where it was, markers below and intact.
for (const [label, viewport, lang] of [['390x844', { width: 390, height: 844 }, 'my'], ['844x390', { width: 844, height: 390 }, 'ja']]) {
  test(`${label}: the timeline is a 44 px touch target that scrubs, markers still select, keys still step`, async () => {
    const { context, page } = await ground(viewport, { touch: true, lang });
    try {
      await open(page);
      await loaded(page);
      const geo = await page.evaluate(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
        const input = document.querySelector('[data-ui="spaceport-timeline"]'), dock = document.querySelector('#spaceport-view .spaceport-dock');
        const markers = [...document.querySelectorAll('[data-ui="spaceport-phase-marker"]')].map(box);
        const t = box(input);
        return { t, dock: box(dock), markers, hit: document.elementFromPoint(t.cx, t.cy)?.dataset?.ui, hitTop: document.elementFromPoint(t.cx, t.top + 2)?.dataset?.ui, hitBottom: document.elementFromPoint(t.cx, t.bottom - 2)?.dataset?.ui,
          markerHits: markers.map((m) => document.elementFromPoint(m.cx, m.cy)?.closest('[data-ui]')?.dataset.ui) };
      });
      assert.ok(geo.t.height >= 44, `timeline ${geo.t.height}px tall`);
      assert.ok(geo.t.top >= geo.dock.top, 'the hit area stays inside the dock');
      assert.deepEqual([geo.hit, geo.hitTop, geo.hitBottom], ['spaceport-timeline', 'spaceport-timeline', 'spaceport-timeline'], 'the whole 44 px band reaches the input');
      for (const m of geo.markers) { assert.ok(m.top >= geo.t.bottom - 0.5, 'markers start below the timeline (no overlap)'); assert.ok(m.height >= 44, `marker ${m.height}px`); }
      assert.ok(geo.markerHits.every((h) => h === 'spaceport-phase-marker'), 'each marker receives a tap at its centre');
      // Touch drag along the track (near its lower edge, outside the old 28 px box) scrubs.
      const cdp = await context.newCDPSession(page);
      const y = geo.t.bottom - 5, at = (f) => [{ x: geo.t.left + (geo.t.right - geo.t.left) * f, y }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0.1) });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(0.1 + i * 0.08) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const scrubbed = Number(await page.locator('[data-ui="spaceport-timeline"]').inputValue());
      assert.ok(scrubbed > 6 && scrubbed < 14, `the drag scrubbed to ${scrubbed}s`);
      // A marker tap seeks to its phase; keys step the timeline.
      await page.locator('[data-ui="spaceport-phase-marker"]').nth(2).tap();
      const afterMarker = Number(await page.locator('[data-ui="spaceport-timeline"]').inputValue());
      assert.equal(afterMarker, 6, 'the Ignition marker seeks to 6 s');
      await page.locator('[data-ui="spaceport-timeline"]').focus();
      await page.keyboard.press('ArrowRight');
      assert.ok(Number(await page.locator('[data-ui="spaceport-timeline"]').inputValue()) > afterMarker, 'ArrowRight steps forward');
    } finally { await context.close(); }
  });
}
