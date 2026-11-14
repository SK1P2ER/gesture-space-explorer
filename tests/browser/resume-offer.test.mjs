// The saved-mission offer: while it is unanswered, nothing may start or redirect a journey, and the choice stays usable.
//   node --test --test-concurrency=1 tests/browser/resume-offer.test.mjs
// Dev server (state is read through the dev-only window.__app). Chromium, camera refused, a fresh browser profile per test:
// the tests never touch real browser data. The gesture case INJECTS a countdown intent on the app's bus (synthetic).
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

const KEY = 'gse.mission.v1';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const LANDSCAPE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

/** A new browser profile; the camera is refused, and every camera request is counted. */
async function profile(options = { viewport: { width: 1280, height: 800 } }) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    window.__cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.__cameraCalls++; throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors };
}
const ready = (page) => page.waitForFunction(() => window.__app?.mission && document.querySelector('#status')?.dataset.kind === 'keyboard');
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const app = (page) => page.evaluate(() => {
  const a = window.__app;
  return { mode: a.modes.mode, base: a.mission.base?.base.id ?? null, destination: a.mission.destination?.base.id ?? null,
    countdown: !!a.mission.countdown, trip: a.mission.trip ? { from: a.mission.trip.from.base.id, to: a.mission.trip.to.base.id } : null,
    offer: !!document.querySelector('#resume-mission') };
});

/** Rests at the Japan base until that is saved: a base-phase checkpoint, at Cape. */
async function savedAtCape(page) {
  await page.goto(`${url}/?base=cape&lang=en`);
  await ready(page);
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k) || 'null')?.baseId === 'cape', KEY);
}
/** Flies from Cape to Tranquility until the flight is saved: a travel-phase checkpoint. */
async function savedInFlight(page) {
  await savedAtCape(page);
  await page.locator('#base-tab-travel').click();
  await page.locator('#base-panel .destinations button').filter({ hasText: 'Tranquility' }).click();
  await page.locator('#base-panel .launch').click();
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k) || 'null')?.phase === 'travel', KEY, { timeout: 120000 });
}
/** Reloads so the saved mission is offered, then waits for the offer and the app. */
async function offered(page, path = '/?lang=en') {
  await page.goto(`${url}${path}`);
  await ready(page);
  await page.locator('#resume-mission').waitFor();
}
/** Everything stored except the checkpoint itself and the quality the tests pin. */
const unrelated = (page) => page.evaluate((k) => Object.fromEntries(Object.keys(localStorage).filter((x) => x !== k && x !== 'gse.quality').sort().map((x) => [x, localStorage.getItem(x)])), KEY);

test('pending offer: tapping a destination chooses nothing, so the Launch button stays disabled', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  const before = await saved(page); // after the reload: the first page writes once more as it unloads (pagehide)
  await page.locator('#base-tab-travel').click();
  await page.locator('#base-panel .destinations button').filter({ hasText: 'Jezero' }).click();
  await page.waitForTimeout(500);
  const launch = page.locator('#base-panel .launch');
  assert.equal(await launch.isVisible(), true, 'the Launch button is not shown');
  assert.equal((await app(page)).destination, null, 'a destination was chosen while the offer was pending');
  assert.equal(await launch.isDisabled(), true, 'Launch is enabled while the offer is pending');
  const s = await app(page);
  assert.deepEqual([s.mode, s.countdown, s.offer], ['baseView', false, true], JSON.stringify(s));
  assert.deepEqual(await saved(page), before, 'the saved mission changed');
  assert.deepEqual(errors, []);
  await context.close();
});

/** SYNTHETIC: sets a destination through the dev hook (Mission.choose), so a launch-type intent alone is what is tested. */
const withDestination = (page) => page.evaluate(() => { window.__app.mission.choose('jezero'); return window.__app.mission.destination?.base.id; });

test('pending offer: an injected launch intent starts no countdown, even with a destination set', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  const before = await saved(page);
  assert.equal(await withDestination(page), 'jezero');
  await page.evaluate(() => window.__app.bus.emit({ type: 'launch' }));
  await page.waitForTimeout(800);
  const s = await app(page);
  assert.deepEqual([s.mode, s.countdown, s.offer], ['baseView', false, true], JSON.stringify(s));
  assert.deepEqual(await saved(page), before);
  assert.deepEqual(errors, []);
  await context.close();
});

test('pending offer: an injected countdown gesture (3, 2, 1) starts no countdown, even with a destination set', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  assert.equal(await withDestination(page), 'jezero');
  await page.evaluate(() => { for (const n of [3, 2, 1]) window.__app.bus.emit({ type: 'countdown', n }); });
  await page.waitForTimeout(800);
  const s = await app(page);
  assert.deepEqual([s.mode, s.countdown, s.offer], ['baseView', false, true], JSON.stringify(s));
  assert.deepEqual(errors, []);
  await context.close();
});

test('pending offer: keyboard (ArrowRight, Enter) chooses and launches nothing', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  assert.equal((await app(page)).destination, null, 'ArrowRight chose a destination');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const s = await app(page);
  assert.deepEqual([s.mode, s.destination, s.countdown, s.offer], ['baseView', null, false, true], JSON.stringify(s));
  assert.deepEqual(errors, []);
  await context.close();
});

test('pending Cape offer: leave the base, select Mars twice: Mars is browsed, Jezero is not entered', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  const before = await saved(page);
  const passport = await page.evaluate(() => localStorage.getItem('gse.passport'));
  await page.keyboard.press('Escape'); // leave the base
  await page.waitForFunction(() => window.__app.modes.mode !== 'baseView' && !window.__app.mission.base);
  // INJECTED: the select intent a tap on Mars sends. The first opens Mars; the second, on the open card, would go down to Jezero.
  const select = () => page.evaluate(() => window.__app.bus.emit({ type: 'select', bodyId: 'mars' }));
  await select();
  await page.waitForTimeout(600);
  const first = await page.evaluate(() => ({ selected: window.__app.state.selected?.id ?? null, mode: window.__app.modes.mode }));
  assert.equal(first.selected, 'mars', 'ordinary planet browsing was blocked');
  await select();
  await page.waitForTimeout(1500);
  const s = await app(page);
  assert.equal(s.base, null, `a base was entered: ${s.base}`);
  assert.notEqual(s.mode, 'baseView');
  assert.equal(s.offer, true);
  assert.equal(await page.evaluate(() => localStorage.getItem('gse.passport')), passport, 'a passport stamp was added');
  assert.deepEqual(await saved(page), before, 'the saved checkpoint changed');
  assert.match(await page.locator('#resume-mission [role="status"]').textContent(), /Continue mission|Start fresh/);
  // Browsing on stays free.
  const focus = await page.evaluate(() => window.__app.state.focus);
  await page.evaluate(() => window.__app.bus.emit({ type: 'next' }));
  await page.waitForTimeout(300);
  assert.notEqual(await page.evaluate(() => window.__app.state.focus), focus, '"next" did not move to another body');
  assert.deepEqual(errors, []);
  await context.close();
});

test('pending offer: the live hint is written once, not on every refusal or frame', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  await page.evaluate(() => window.__app.bus.emit({ type: 'chooseDestination', baseId: 'jezero' }));
  const hint = page.locator('#resume-mission [role="status"]');
  await hint.waitFor();
  const text = await hint.textContent();
  const changes = await page.evaluate(async () => {
    const root = document.querySelector('#resume-mission'), live = root.querySelector('[role="status"]');
    const records = [];
    const watch = new MutationObserver((list) => records.push(...list.map((m) => m.type + ':' + (m.attributeName ?? ''))));
    watch.observe(live, { childList: true, characterData: true, subtree: true, attributes: true });
    watch.observe(root, { attributes: true });
    for (let i = 0; i < 3; i++) { window.__app.bus.emit({ type: 'chooseDestination', baseId: 'jezero' }); window.__app.bus.emit({ type: 'launch' }); }
    await new Promise((r) => setTimeout(r, 1000)); // about a second of render frames
    watch.disconnect();
    return records;
  });
  assert.deepEqual(changes, [], `the live region or card changed ${changes.length} times: ${changes.slice(0, 5).join(', ')}`);
  assert.equal(await hint.textContent(), text);
  assert.deepEqual(errors, []);
  await context.close();
});

test('pending offer: entering another base, by link-free intent or the Japan marker, is refused', async () => {
  const { context, page, errors } = await profile();
  await savedInFlight(page); // saved: Cape → Tranquility, in flight
  await offered(page);
  await page.evaluate(() => window.__app.bus.emit({ type: 'enterBase', baseId: 'jezero' }));
  await page.waitForTimeout(800);
  assert.equal((await app(page)).base, null, 'a base was entered while the offer was pending');
  if (await page.locator('#japan-site-marker').isVisible()) await page.locator('#japan-site-marker').click();
  await page.waitForTimeout(800);
  const s = await app(page);
  assert.equal(s.trip, null, 'a journey began');
  assert.equal(s.offer, true);
  assert.equal((await saved(page)).phase, 'travel', 'the saved flight was overwritten');
  assert.deepEqual(errors, []);
  await context.close();
});

test('pending offer: a refused action says why, next to the choice', async () => {
  const { context, page } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  await page.locator('#base-tab-travel').click();
  await page.locator('#base-panel .destinations button').first().click();
  const hint = page.locator('#resume-mission [role="status"]');
  await hint.waitFor();
  assert.match(await hint.textContent(), /Continue mission|Start fresh/);
  await context.close();
});

test('pending offer: Guided cannot start until the choice is made', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?flags=astrolife,guided&lang=en');
  const start = page.locator('#guided-mission > button');
  await start.waitFor();
  assert.equal(await start.isDisabled(), true, 'Guided can start past a pending offer');
  await page.evaluate(() => window.__app.bus.emit({ type: 'launch' }));
  await page.waitForTimeout(800);
  assert.equal((await app(page)).countdown, false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Continue restores the saved flight, and a refused action before it did not disturb it', async () => {
  const { context, page, errors } = await profile();
  await savedInFlight(page);
  await offered(page);
  await page.evaluate(() => window.__app.bus.emit({ type: 'enterBase', baseId: 'jezero' }));
  await page.locator('#resume-mission-continue').click();
  await page.waitForFunction(() => window.__app.modes.mode === 'travel');
  const s = await app(page);
  assert.deepEqual(s.trip, { from: 'cape', to: 'tranquility' });
  assert.equal(s.offer, false);
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k) || 'null')?.trip?.toId === 'tranquility', KEY);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Start fresh allows a new journey, saves it, and a reload offers the new one', async () => {
  const { context, page, errors } = await profile();
  await savedInFlight(page); // the old one: to Tranquility
  await offered(page, '/?base=cape&lang=en');
  await page.locator('#resume-mission-discard').click();
  await page.locator('#base-tab-travel').click();
  await page.locator('#base-panel .destinations button').filter({ hasText: 'Jezero' }).click();
  await page.locator('#base-panel .launch').click();
  await page.waitForFunction((k) => { const s = JSON.parse(localStorage.getItem(k) || 'null'); return s?.phase === 'travel' && s.trip.toId === 'jezero'; }, KEY, { timeout: 120000 });
  await offered(page);
  assert.match(await page.locator('#resume-mission').textContent(), /Jezero/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('deep links: a link to another base wins with no offer; a link to the saved base keeps the offer and that base', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await page.goto(`${url}/?base=jezero&lang=en`);
  await ready(page);
  await page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero');
  assert.equal(await page.locator('#resume-mission').count(), 0, 'an offer for Cape on a link to Jezero');
  // Jezero is now saved; back to it by link, the offer and the base both come.
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k) || 'null')?.baseId === 'jezero', KEY);
  await offered(page, '/?base=jezero&lang=en');
  await page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero');
  assert.deepEqual(errors, []);
  await context.close();
});

test('pending offer: other stored records stay as they were through refused actions and Start fresh', async () => {
  const { context, page } = await profile();
  await savedAtCape(page);
  await page.evaluate(() => { localStorage.setItem('gse.weightKg', '61'); localStorage.setItem('test.unrelated', 'keep me'); });
  await offered(page, '/?base=cape&lang=en');
  const before = await unrelated(page);
  await page.evaluate(() => { window.__app.bus.emit({ type: 'launch' }); window.__app.bus.emit({ type: 'enterBase', baseId: 'jezero' }); });
  await page.locator('#resume-mission-discard').click();
  await page.waitForTimeout(1500);
  const after = await unrelated(page);
  assert.deepEqual(after, before);
  assert.equal(after['test.unrelated'], 'keep me');
  await context.close();
});

test('pending offer: the camera restart and Settings still work', async () => {
  const { context, page, errors } = await profile();
  await savedAtCape(page);
  await offered(page, '/?base=cape&lang=en');
  const calls = await page.evaluate(() => window.__cameraCalls);
  await page.locator('#hand-control').click();
  await page.waitForFunction((n) => window.__cameraCalls > n, calls);
  await page.locator('#menu').click();
  await page.locator('#quality').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#resume-mission').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

for (const [name, options] of [['portrait 390×844', PHONE], ['landscape 844×390', LANDSCAPE]]) for (const lang of ['en', 'ja', 'my']) {
  test(`phone ${name} ${lang}: both choices are on screen and take a touch`, async () => {
    const { context, page, errors } = await profile(options);
    await savedAtCape(page);
    await offered(page, `/?base=cape&lang=${lang}`);
    await page.waitForTimeout(800); // the base sheet settles
    const hits = await page.evaluate(() => ['#resume-mission-continue', '#resume-mission-discard'].map((sel) => {
      const el = document.querySelector(sel), r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { sel, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, ok: hit === el || el.contains(hit), by: hit?.id || hit?.className || hit?.tagName, size: [Math.round(r.width), Math.round(r.height)] };
    }));
    for (const h of hits) {
      assert.ok(h.inside, `${h.sel} is off screen: ${JSON.stringify(h)}`);
      assert.ok(h.ok, `${h.sel} is covered by ${h.by}`);
      assert.ok(h.size[1] >= 44, `${h.sel} is ${h.size[1]} px tall`);
    }
    await page.locator('#resume-mission-continue').tap();
    await page.waitForFunction(() => !document.querySelector('#resume-mission'));
    assert.deepEqual(errors, []);
    await context.close();
  });
}
