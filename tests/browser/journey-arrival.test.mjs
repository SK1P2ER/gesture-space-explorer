// SPCE-LINE Orbital Journey (Sprint 2): journey status and the Jezero arrival, Tanegashima → Jezero only.
//   node --test --test-concurrency=1 tests/browser/journey-arrival.test.mjs
// Dev server; the mission is driven through the dev-only window.__app (intents on the bus, the flight shortened by
// moving trip.elapsed, auto-land). Synthetic: no camera, no real hand. Chromium, a fresh profile per test.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.env.JOURNEY_SHOTS ?? null; // optional folder for review screenshots
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let server, browser, url;
before(async () => {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  await warmUp(chromium, url);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { args: ['--use-gl=angle', '--use-angle=d3d11'] } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });

const DESK = { width: 1280, height: 800 }, PHONE = { width: 390, height: 844 }, LAND = { width: 844, height: 390 };

async function open(query, { viewport = DESK, reducedMotion = 'reduce', hasTouch = false } = {}) {
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
  await page.waitForFunction(() => window.__app?.mission && window.__app.journey && document.querySelector('#status')?.dataset.kind === 'keyboard');
  // Every phase and announcement, as rendered (one entry per change).
  await page.evaluate(() => {
    const log = window.__journeyLog = [];
    const tick = () => {
      const a = window.__app, j = a.journey;
      const live = document.querySelector('#journey-live')?.textContent ?? '';
      const last = log[log.length - 1];
      if (!last || last.phase !== j.phase || last.live !== live) log.push({ phase: j.phase, live, mode: a.modes.mode, base: a.mission.base?.base.id ?? null, prep: j.prep.state, showcase: !!a.showcases.get('jezero') });
      requestAnimationFrame(tick);
    };
    tick();
  });
  return { context, page, errors };
}

/** At Tanegashima (base view), Jezero chosen, countdown started. */
async function launch(page) {
  await page.evaluate(() => window.__app.bus.emit({ type: 'enterBase', baseId: 'cape' }));
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'cape');
  await page.evaluate(() => { window.__app.bus.emit({ type: 'chooseDestination', baseId: 'jezero' }); window.__app.bus.emit({ type: 'launch' }); });
  await page.waitForFunction(() => window.__app.modes.mode === 'launch');
}
/** From the flight to the base view at Jezero (flight shortened, auto-land). */
async function flyAndLand(page) {
  await page.waitForFunction(() => window.__app.modes.mode === 'travel' && window.__app.mission.trip);
  await page.waitForFunction(() => window.__app.journey.phase === 'transit');
  await page.evaluate(() => { const t = window.__app.mission.trip; t.elapsed = t.seconds - 0.01; });
  await page.waitForFunction(() => window.__app.modes.mode === 'docking');
  await page.evaluate(() => window.__app.bus.emit({ type: 'select' }));
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'jezero');
}
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const phases = (log) => log.map((e) => e.phase).filter((p, i, a) => p !== a[i - 1]);

test('normal journey: departing → transit → preparing → arrived, each announced once; Arrived only when Jezero is interactive', async () => {
  const { page, context, errors } = await open('lang=en');
  try {
    await launch(page);
    await page.waitForFunction(() => window.__app.journey.phase === 'departing');
    assert.equal(await page.locator('#journey-status .journey-text').textContent(), 'Launching from Tanegashima');
    assert.equal(await page.locator('#journey-status .journey-route').isVisible(), false, 'departure already names Tanegashima');
    // The flight carries the compact route.
    await page.waitForFunction(() => window.__app.journey.phase === 'transit');
    assert.equal(await page.locator('#journey-status .journey-route').textContent(), 'Tanegashima → Jezero Dome');
    assert.equal(await page.locator('#journey-status .journey-route').isVisible(), true);
    await flyAndLand(page);
    await page.waitForFunction(() => window.__app.journey.phase === 'arrived');
    const log = await page.evaluate(() => window.__journeyLog);
    assert.deepEqual(phases(log).filter(Boolean), ['departing', 'transit', 'preparing', 'arrived']);
    const lives = log.map((e) => e.live).filter((l, i, a) => l && l !== a[i - 1]);
    assert.deepEqual(lives, ['Launching from Tanegashima', 'En route to Mars', 'Preparing Jezero Dome…', 'Arrived at Jezero Dome']);
    const firstArrived = log.find((e) => e.phase === 'arrived');
    assert.equal(firstArrived.mode, 'baseView'); assert.equal(firstArrived.base, 'jezero'); assert.equal(firstArrived.showcase, true); assert.equal(firstArrived.prep, 'ready');
    // The card: heading, one primary action, focused.
    // Leads with the place, then its world; the card's name is both.
    assert.equal(await page.locator('#journey-arrival h2').textContent(), 'Jezero Dome');
    assert.equal(await page.locator('#journey-arrival .journey-planet').textContent(), 'Mars');
    assert.equal(await page.evaluate(() => document.querySelector('#journey-arrival').getAttribute('aria-labelledby')), 'journey-arrival-title journey-arrival-planet');
    const sizes = await page.evaluate(() => ['#journey-arrival h2', '#journey-arrival .journey-planet', '#journey-arrival .journey-arrived'].map((q) => parseFloat(getComputedStyle(document.querySelector(q)).fontSize)));
    assert.ok(sizes[0] > sizes[1] && sizes[0] > sizes[2], `heading leads ${sizes}`);
    assert.equal(await page.locator('#journey-arrival .journey-arrived').textContent(), '✓ Arrived');
    assert.equal(await page.locator('#journey-arrival button').count(), 1);
    assert.equal(await page.locator('#journey-explore').textContent(), 'Explore Jezero Dome');
    assert.equal(await page.locator('#base-panel .horizon').isVisible(), false, 'Explore already opens the horizon');
    assert.equal(await page.locator('#base-panel .golden').isVisible(), true, 'the sunset view is a separate action');
    // …that says it moves the clock (a visible second line, and its description).
    assert.equal(await page.locator('#base-panel .golden .chip-note').textContent(), 'Changes local time to near sunset');
    assert.equal(await page.locator('#base-panel .golden .chip-note').isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelector('#base-panel .golden').getAttribute('aria-describedby')), 'golden-note');
    // The base overview stays in the Overview tab (gravity, local time, sunrise/sunset), quieter while the card shows.
    assert.equal(await page.locator('#base-tab-overview').getAttribute('aria-selected'), 'true');
    const facts = await page.evaluate(() => { const dl = document.querySelector('#base-panel dl'); return { text: dl.textContent, shown: !!dl.getClientRects().length && !dl.closest('[hidden]'), ariaHidden: !!dl.closest('[aria-hidden="true"],[inert]'), opacity: parseFloat(getComputedStyle(document.querySelector('#base-panel')).opacity) }; });
    assert.ok(/3\.7 m\/s²/.test(facts.text) && /Local solar time/.test(facts.text) && /Sunrise/.test(facts.text), facts.text);
    assert.ok(facts.shown && !facts.ariaHidden, 'facts visible and in the accessibility tree');
    assert.ok(facts.opacity < 1, `panel de-emphasized (opacity ${facts.opacity})`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'journey-explore');
    assert.equal(await page.locator('#journey-status').isVisible(), false);
    // Enter on the focused action opens the existing horizon view; the card and status go.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__app.mission.horizon !== null);
    await page.waitForFunction(() => document.querySelector('#journey-arrival').hidden && !document.body.classList.contains('journey-on'));
    assert.equal(await page.evaluate(() => window.__app.journey.phase), null);
    // Back up: the journey is over; no card comes back.
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await page.waitForFunction(() => window.__app.mission.horizon === null);
    await page.locator('#base-panel .horizon').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#journey-arrival').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('countdown cancelled: the message goes; no status for another route', async () => {
  const { page, context, errors } = await open('lang=en');
  try {
    await launch(page);
    await page.waitForFunction(() => window.__app.journey.phase === 'departing');
    await page.evaluate(() => window.__app.bus.emit({ type: 'dismiss' }));
    await page.waitForFunction(() => window.__app.modes.mode === 'baseView');
    await page.waitForFunction(() => window.__app.journey.phase === null && document.querySelector('#journey-status').hidden);
    // Another route: no journey message.
    await page.evaluate(() => { window.__app.bus.emit({ type: 'chooseDestination', baseId: 'tranquility' }); window.__app.bus.emit({ type: 'launch' }); });
    await page.waitForFunction(() => window.__app.modes.mode === 'launch');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__app.journey.phase), null);
    assert.equal(await page.locator('#journey-status').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('slow destination (?journeysim=slow): Mars and a readable "Preparing" status stay; exploring waits; then Arrived', async () => {
  const { page, context, errors } = await open('lang=en&journeysim=slow');
  try {
    await launch(page); await flyAndLand(page);
    const t0 = Date.now();
    await page.waitForFunction(() => window.__app.journey.prep.state === 'loading');
    for (let i = 0; i < 3; i++) {
      const s = await page.evaluate(() => ({ phase: window.__app.journey.phase, mode: window.__app.modes.mode, base: window.__app.mission.base?.base.id, text: document.querySelector('#journey-status .journey-text').textContent, focus: window.__app.state.focus }));
      assert.equal(s.phase, 'preparing'); assert.equal(s.mode, 'baseView'); assert.equal(s.base, 'jezero'); assert.equal(s.text, 'Preparing Jezero Dome…');
      assert.equal(await page.locator('#journey-status .journey-route').textContent(), 'Tanegashima → Jezero Dome');
      const r = await rect(page, '#journey-status');
      assert.ok(r && r.top >= 0 && r.bottom <= 800 && r.height >= 20, `status on screen ${JSON.stringify(r)}`);
      await page.waitForTimeout(700);
    }
    // The horizon view (exploring) is held until ready.
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__app.mission.horizon), null);
    assert.equal(await page.locator('#journey-arrival').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#base-panel :is(.horizon, .golden)')].map((b) => b.disabled)), [true, true]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/preparing-en-desk.png` });
    await page.waitForFunction(() => window.__app.journey.phase === 'arrived');
    assert.ok(Date.now() - t0 >= 3500, `arrived after ${Date.now() - t0} ms (simulated 4 s)`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('failed destination (?journeysim=fail): a recoverable failure with Try again (touch); then Arrived with focus on Explore', async () => {
  const { page, context, errors } = await open('lang=en&journeysim=fail', { viewport: PHONE, hasTouch: true });
  try {
    await launch(page); await flyAndLand(page);
    await page.waitForFunction(() => window.__app.journey.phase === 'failed');
    assert.equal(await page.locator('#journey-status .journey-text').textContent(), 'Couldn’t prepare Jezero Dome');
    assert.equal(await page.locator('#journey-retry').textContent(), 'Try again');
    assert.equal(await page.evaluate(() => window.__app.mission.base?.base.id), 'jezero');
    const r = await rect(page, '#journey-retry');
    assert.ok(r.height >= 44 && r.width >= 44, `retry target ${r.width}×${r.height}`);
    const pill = await rect(page, '#journey-status');
    for (const sel of ['header.hud.top', '#mission-hud', '#clean-view']) assert.ok(!overlaps(pill, await rect(page, sel)), `${sel} overlaps the status`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/failed-en-phone.png` });
    await page.locator('#journey-retry').tap();
    await page.waitForFunction(() => window.__app.journey.phase === 'preparing');
    await page.waitForFunction(() => window.__app.journey.phase === 'arrived');
    assert.equal(await page.evaluate(() => window.__app.journey.prep.attempts), 2);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'journey-explore');
    const b = await rect(page, '#journey-explore');
    assert.ok(b.height >= 44, `explore target height ${b.height}`);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#base-panel :is(.horizon, .golden)')].map((b) => b.disabled)), [false, false]);
    await page.locator('#journey-explore').tap();
    await page.waitForFunction(() => window.__app.mission.horizon !== null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('launch presentation (motion on): the status sits in the launch dialog, clear of Skip, Close and the dock', async () => {
  const { page, context, errors } = await open('lang=en', { reducedMotion: 'no-preference' });
  try {
    await launch(page);
    await page.waitForFunction(() => window.__app.mission.presentingLaunch && document.querySelector('#spaceport-view[open]'), null, { timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('#spaceport-view #journey-status') && !document.querySelector('#journey-status').hidden);
    assert.equal(await page.locator('#journey-status .journey-text').textContent(), 'Launching from Tanegashima');
    const status = await rect(page, '#journey-status');
    for (const sel of ['#spaceport-skip-launch', '#spaceport-view .spaceport-heading', '#spaceport-view .spaceport-controls']) {
      const other = await rect(page, sel);
      assert.ok(!overlaps(status, other), `${sel} overlaps the status: ${JSON.stringify({ status, other })}`);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/departing-en-desk.png` });
    await page.locator('#spaceport-skip-launch').click();
    await page.waitForFunction(() => window.__app.journey.phase === 'transit');
    await page.waitForFunction(() => document.querySelector('#journey-status')?.parentElement === document.body);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('direct Jezero visit (?base=jezero): no journey card; Horizon view and the near-sunset action (with its time note) are there', async () => {
  for (const [vpName, viewport] of [['desk', DESK], ['phone', PHONE], ['land', LAND]]) {
    const { page, context, errors } = await open('base=jezero&lang=en', { viewport, hasTouch: vpName !== 'desk' });
    try {
      await page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero' && window.__app.modes.mode === 'baseView' && window.__app.showcases.get('jezero'));
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => window.__app.journey.phase), null, vpName);
      assert.equal(await page.locator('#journey-arrival').isVisible(), false, vpName);
      assert.equal(await page.locator('#base-panel .horizon').isVisible(), true, `${vpName}: Horizon view`);
      assert.equal(await page.locator('#base-panel .golden .chip-note').textContent(), 'Changes local time to near sunset');
      assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#base-panel')).opacity)), 1, 'not de-emphasized without the card');
      await page.locator('#base-panel .horizon').click();
      await page.waitForFunction(() => window.__app.mission.horizon !== null);
      assert.equal(await page.locator('#journey-arrival').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

for (const [vpName, viewport] of [['desk', DESK], ['phone', PHONE], ['land', LAND]]) {
  for (const lang of ['my', 'ja', 'en']) {
    test(`arrival card ${lang} ${vpName}: text and Explore in view, wrapped not clipped; the stamp toast stays clear of it`, async () => {
      const { page, context, errors } = await open(`lang=${lang}`, { viewport });
      try {
        await launch(page); await flyAndLand(page);
        await page.waitForFunction(() => window.__app.journey.phase === 'arrived');
        // The passport stamp toast comes 1.6 s after touchdown (a fresh profile has no Jezero stamp).
        await page.waitForFunction(() => /🛂/.test(document.querySelector('#gesture-flash').textContent) && !document.querySelector('#gesture-flash').hidden, null, { timeout: 10000 });
        await page.waitForTimeout(250); // the toast's entry animation
        const card = await rect(page, '#journey-arrival'), button = await rect(page, '#journey-explore'), toast = await rect(page, '#gesture-flash');
        assert.ok(card.left >= 0 && card.top >= 0 && card.right <= viewport.width && card.bottom <= viewport.height, `card in view ${JSON.stringify(card)}`);
        assert.ok(button.bottom <= card.bottom && button.top >= card.top && button.height >= 44, `button ${JSON.stringify(button)}`);
        assert.ok(button.top >= 0 && button.bottom <= viewport.height, 'Explore in view without scrolling');
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
        assert.equal(await page.evaluate(() => document.body.dataset.journeyLayout), vpName);
        // Where the card sits, so the world stays in view: phones low (upper half free), landscape on the right.
        if (vpName === 'phone') assert.ok(card.top >= viewport.height * 0.4, `phone card low ${JSON.stringify(card)}`);
        if (vpName === 'land') assert.ok(card.left >= viewport.width / 2, `landscape card on the right ${JSON.stringify(card)}`);
        if (vpName === 'desk') assert.ok(card.top < viewport.height / 2, `desk card high ${JSON.stringify(card)}`);
        assert.deepEqual(await page.evaluate(() => { const r = window.__app.journey.view.cardRect(); return r && [r.left, r.top]; }), [card.left, card.top]);
        assert.ok(!overlaps(card, toast), `toast overlaps the card ${JSON.stringify({ card, toast })}`);
        if (vpName === 'land') {
          for (const sel of ['#photo', '#passport', '#menu']) {
            assert.ok(!overlaps(toast, await rect(page, sel)), `toast overlaps ${sel}`);
          }
        }
        const clip = await page.evaluate(() => [...document.querySelectorAll('#journey-arrival, #journey-arrival *')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.tagName + (e.id ? '#' + e.id : '')));
        assert.deepEqual(clip, [], 'no clipped text in the card');
        for (const sel of ['header.hud.top', '#base-panel', '#picker-entry', '#clean-view', '#mission-hud', '#timebar', '#info', 'footer.hud', '#preview']) {
          const other = await rect(page, sel);
          assert.ok(!overlaps(card, other), `${sel} overlaps the card ${JSON.stringify({ card, other })}`);
        }
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/arrival-${lang}-${vpName}.png` });
        if (lang === 'en') {
          // The camera preview (hidden in this no-camera run): shown, the card re-places clear of it.
          await page.evaluate(() => { document.querySelector('#preview').hidden = false; });
          await page.waitForTimeout(450); // the card re-places every 200 ms
          const preview = await rect(page, '#preview'), explore = await rect(page, '#journey-explore');
          assert.ok(!overlaps(preview, explore), `camera preview overlaps Explore ${JSON.stringify({ preview, explore })}`);
          await page.evaluate(() => { document.querySelector('#preview').hidden = true; });
        }
        if (vpName === 'land' && lang === 'my') {
          // Exercise the camera layout without granting webcam access.
          for (const tucked of [false, true]) {
            const region = await page.evaluate((tucked) => {
              const preview = document.querySelector('#preview');
              const toast = document.querySelector('#gesture-flash');
              preview.hidden = false;
              preview.classList.toggle('tucked', tucked);
              return { camera: preview.getBoundingClientRect().toJSON(), toast: toast.getBoundingClientRect().toJSON() };
            }, tucked);
            assert.ok(region.camera.width > 0 && region.toast.width > 0);
            assert.ok(!overlaps(region.camera, region.toast), `toast overlaps ${tucked ? 'tucked' : 'expanded'} camera preview`);
          }
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
}
