// Jezero Dome — First Exploration: the explore card in the horizon view (place, Return to orbit, a look-around hint in
// the words of the last input, the near-sunset action explained before use), from the arrival and on a direct visit.
//   node --test --test-concurrency=1 tests/browser/jezero-explore.test.mjs
// Dev server; the mission is driven through the dev-only window.__app (intents on the bus, the flight shortened by
// moving trip.elapsed, auto-land). Synthetic: no camera, no real hand (the "hand" case sets the tracking status and
// emits the rotate intent the open hand sends). Chromium, a fresh profile per test.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.env.EXPLORE_SHOTS ?? null;
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
const NAMES = { en: ['Jezero Dome', 'Mars', 'Return to orbit'], ja: ['ジェゼロ・ドーム', '火星', '軌道に戻る'], my: ['Jezero အမိုးခုံး', 'အင်္ဂါ', 'ပတ်လမ်းသို့ ပြန်ရန်'] };

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
  return { context, page, errors };
}
/** Tanegashima → Jezero, flight shortened, auto-land: the arrival card is up. */
async function arrive(page) {
  await page.evaluate(() => window.__app.bus.emit({ type: 'enterBase', baseId: 'cape' }));
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'cape');
  await page.evaluate(() => { window.__app.bus.emit({ type: 'chooseDestination', baseId: 'jezero' }); window.__app.bus.emit({ type: 'launch' }); });
  await page.waitForFunction(() => window.__app.modes.mode === 'travel' && window.__app.mission.trip);
  await page.evaluate(() => { const t = window.__app.mission.trip; t.elapsed = t.seconds - 0.01; });
  await page.waitForFunction(() => window.__app.modes.mode === 'docking');
  await page.evaluate(() => window.__app.bus.emit({ type: 'select' }));
  await page.waitForFunction(() => window.__app.journey.phase === 'arrived');
  await page.locator('#journey-explore').waitFor({ state: 'visible' });
}
/** Direct visit (?base=jezero): the base view with its showcase. */
const directReady = (page) => page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero' && window.__app.modes.mode === 'baseView' && window.__app.showcases.get('jezero'));
const exploring = (page) => page.waitForFunction(() => window.__app.mission.horizon !== null && !document.querySelector('#mission-overlay').hidden && document.querySelector('#mission-overlay').classList.contains('explore'));
const orbit = (page) => page.waitForFunction(() => window.__app.mission.horizon === null);
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inView = (r, vp) => !!r && r.left >= 0 && r.top >= 0 && r.right <= vp.width + 0.5 && r.bottom <= vp.height + 0.5;
const hint = (page) => page.evaluate(() => { const h = document.querySelector('#explore-hint'); return h && !h.hidden ? h.textContent : null; });
/** A drag across the middle of the scene (mouse). */
async function drag(page, vp) {
  await page.mouse.move(vp.width * 0.5, vp.height * 0.6); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(vp.width * (0.5 - i * 0.03), vp.height * 0.6);
  await page.mouse.up();
}
/** A one-finger drag through real touch events (Chromium makes the pointer events). */
async function touchDrag(page, vp) {
  const cdp = await page.context().newCDPSession(page);
  const y = vp.height * 0.6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vp.width * 0.6, y }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vp.width * (0.6 - i * 0.04), y }] });
  // The finger rests before it lifts: a lift at speed starts a fling, and Chromium takes the next tap to stop it.
  await page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vp.width * (0.6 - 6 * 0.04), y }] });
  await page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('from the arrival (mouse): place and Return to orbit, the mouse hint until the first drag, sunset explained before use; not shown again on re-entry', async () => {
  const { page, context, errors } = await open('lang=en');
  try {
    await arrive(page);
    await page.locator('#journey-explore').click();
    await exploring(page);
    assert.equal(await page.locator('#mission-overlay .explore-title').textContent(), 'Jezero Dome · Mars');
    const back = page.locator('#return-orbit');
    assert.equal(await back.textContent(), '⬆ Return to orbit');
    assert.ok(inView(await rect(page, '#return-orbit'), DESK));
    assert.equal(await hint(page), 'Drag to look around · scroll to step closer or back');
    assert.equal(await page.locator('#journey-arrival').isVisible(), false);
    // The near-sunset action (now the Golden Hour preset) says what it does before it is used.
    const golden = page.locator('#horizon-sunset');
    assert.ok(await golden.isVisible());
    assert.equal(await golden.getAttribute('data-preset'), 'golden');
    assert.equal(await golden.getAttribute('aria-describedby'), 'horizon-sunset-note explore-golden-desc');
    assert.equal(await page.locator('#horizon-sunset-note').textContent(), 'Changes the local time at Jezero');
    assert.equal(await page.locator('#explore-golden-desc').textContent(), 'Changes local time to near sunset');
    assert.ok(await page.locator('#horizon-sunset-note').isVisible());
    // The sky facts are folded away, still there.
    assert.equal(await page.locator('#mission-overlay .explore-sky').evaluate((d) => d.open), false);
    assert.ok((await page.locator('#mission-overlay .explore-sky .sky dt').count()) >= 2);
    // The first look (a drag on the scene) takes the hint away.
    const looks0 = await page.evaluate(() => window.__app.mission.horizonLooks);
    await drag(page, DESK);
    await page.waitForFunction(() => document.querySelector('#explore-hint').hidden);
    assert.ok(await page.evaluate(() => window.__app.mission.horizonLooks) > looks0);
    // The live region spoke once.
    assert.equal(await page.locator('#mission-overlay > .explore-sr').textContent(), 'Drag to look around · scroll to step closer or back');
    // Return to orbit (mouse): back to the base view, the standard Horizon view is there again.
    await back.click();
    await orbit(page);
    await page.locator('#base-panel .horizon').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--explore-bottom')), '');
    // Re-entry from the base panel: the card again, no hint (once a session).
    await page.locator('#base-panel .horizon').click();
    await exploring(page);
    await page.waitForTimeout(300);
    assert.equal(await hint(page), null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('keyboard: Enter on Explore keeps today\'s focus (the page), the keyboard hint, ↑ is a look; Esc and O work from Return to orbit too', async () => {
  const { page, context, errors } = await open('lang=en');
  try {
    await arrive(page);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'journey-explore');
    await page.keyboard.press('Enter');
    await exploring(page);
    // Focus as before this change: the Explore button went with the card; nothing steals it.
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
    assert.equal(await hint(page), '↑ ↓ step closer or back · Esc returns to orbit');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#explore-hint').hidden);
    await page.keyboard.press('Escape');
    await orbit(page);
    // Again with O, then Tab to Return to orbit: its own keys still leave (a focused control owns scene keys).
    await page.keyboard.press('o');
    await exploring(page);
    await page.locator('#return-orbit').focus();
    await page.keyboard.press('Escape');
    await orbit(page);
    await page.keyboard.press('o');
    await exploring(page);
    await page.locator('#return-orbit').focus();
    await page.keyboard.press('O');
    await orbit(page);
    await page.keyboard.press('o');
    await exploring(page);
    await page.locator('#return-orbit').focus();
    await page.keyboard.press('Enter');
    await orbit(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('touch (direct Jezero visit, phone): the standard Horizon view opens the same card; touch hint until a one-finger drag; Return to orbit by tap', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en', { viewport: PHONE, hasTouch: true });
  try {
    await directReady(page);
    assert.equal(await page.locator('#mission-overlay').isVisible(), false, 'a direct visit has no explore card in the base view');
    const horizon = page.locator('#base-panel .horizon');
    await horizon.waitFor({ state: 'visible' });
    await horizon.tap();
    await exploring(page);
    assert.equal(await page.locator('#mission-overlay .explore-title').textContent(), 'Jezero Dome · Mars');
    assert.equal(await hint(page), 'Drag to look around');
    await touchDrag(page, PHONE);
    await page.waitForFunction(() => document.querySelector('#explore-hint').hidden);
    const back = await rect(page, '#return-orbit');
    assert.ok(inView(back, PHONE) && back.height >= 44, JSON.stringify(back));
    await page.locator('#return-orbit').tap();
    await orbit(page);
    await horizon.waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('hand tracking: the hint says to move the open hand; the hand\'s first look takes it away', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await directReady(page);
    await page.evaluate(() => { window.__app.state.status = { kind: 'tracking', delegate: 'GPU' }; });
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await exploring(page);
    assert.equal(await hint(page), 'Move your open hand to look around');
    await page.evaluate(() => window.__app.bus.emit({ type: 'rotate', dx: 0.05, dy: 0 })); // what the open hand sends
    await page.waitForFunction(() => document.querySelector('#explore-hint').hidden);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the hint also goes on its own (8 s) without a look', async () => {
  const { page, context } = await open('base=jezero&lang=en');
  try {
    await directReady(page);
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await exploring(page);
    assert.ok(await hint(page));
    await page.waitForFunction(() => document.querySelector('#explore-hint').hidden, null, { timeout: 15000 });
  } finally { await context.close(); }
});

test('near-sunset from Explore: Golden Hour (time jumps, still exploring)', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await directReady(page);
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await exploring(page);
    const t0 = await page.evaluate(() => window.__app.clock.time);
    await page.locator('#horizon-sunset').click();
    await page.waitForFunction((t) => window.__app.clock.time !== t, t0);
    assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null, 'still exploring');
    assert.ok(await page.locator('#return-orbit').isVisible());
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const [vpName, viewport, touch] of [['desk', DESK, false], ['phone', PHONE, true], ['land', LAND, true]]) {
  test(`layout ${vpName}: my / ja / en — the card wraps, Return to orbit and the sunset note in view, clear of the toast, preview, footer and clock`, async () => {
    for (const lang of ['my', 'ja', 'en']) {
      const { page, context, errors } = await open(`base=jezero&lang=${lang}`, { viewport, hasTouch: touch });
      try {
        await directReady(page);
        await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
        await exploring(page);
        const [base, body, ret] = NAMES[lang];
        assert.equal(await page.locator('#mission-overlay .explore-title').textContent(), `${base} · ${body}`);
        assert.equal(await page.locator('#return-orbit').textContent(), `⬆ ${ret}`);
        // A toast and the camera preview, shown as they would be (the passport stamp; a camera that started).
        await page.evaluate(() => {
          const f = document.querySelector('#gesture-flash'); f.hidden = false; f.textContent = '🛂 New passport stamp: Jezero Dome!';
          const p = document.querySelector('#preview'); p.hidden = false; p.style.display = 'block'; p.style.height = '126px';
        });
        await page.waitForTimeout(400); // the card's measured bottom (toasts sit below it)
        const card = await rect(page, '#mission-overlay');
        const back = await rect(page, '#return-orbit');
        const golden = await rect(page, '#horizon-sunset');
        const note = await rect(page, '#horizon-sunset-note');
        const tag = `${lang} ${vpName} ${JSON.stringify({ card, back })}`;
        assert.ok(inView(card, viewport), `card in view ${tag}`);
        assert.ok(inView(back, viewport) && back.height >= 44 && back.width >= 44, `Return to orbit ${tag}`);
        assert.ok(inView(golden, viewport) && golden.height >= 44, `sunset ${tag}`);
        assert.ok(inView(note, viewport) && note.bottom <= card.bottom + 0.5 && back.bottom <= card.bottom + 0.5, `sunset note and Return inside the card ${tag}`);
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop + document.scrollingElement.scrollLeft), 0);
        // Nothing clipped inside the card (wrapping, not cut).
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#mission-overlay .explore-title, #return-orbit, #horizon-sunset, #horizon-sunset-note')].filter((e) => e.scrollWidth > e.clientWidth + 1).length), 0, `clipped text ${tag}`);
        for (const sel of ['#gesture-flash', '#preview', 'footer.hud', '#timebar', 'header.hud.top', '#base-panel']) {
          const r = await rect(page, sel);
          assert.ok(!overlaps(card, r), `${sel} overlaps the card ${tag} ${JSON.stringify(r)}`);
        }
        // The land stays visible: the card keeps clear of the middle band of the screen.
        assert.ok(card.bottom < viewport.height * 0.62 || card.left > viewport.width * 0.45, `card leaves the land in view ${tag}`);
        if (vpName === 'land') assert.ok(card.left > viewport.width / 2, `landscape: the right column ${tag}`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/explore-${lang}-${vpName}.png` });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
}

test('reduced motion: the hint does not animate; without it, it fades in', async () => {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const { page, context } = await open('base=jezero&lang=en', { reducedMotion });
    try {
      await directReady(page);
      await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
      await exploring(page);
      const name = await page.locator('#explore-hint').evaluate((e) => getComputedStyle(e).animationName);
      assert.equal(name, reducedMotion === 'reduce' ? 'none' : 'explore-hint-in');
    } finally { await context.close(); }
  }
});
