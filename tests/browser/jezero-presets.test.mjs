// Jezero Dome: Day / Golden Hour / Night presets in the Explore card's time group (timePresets.ts, sunsetPreview.ts).
//   node --test --test-concurrency=1 tests/browser/jezero-presets.test.mjs
// Dev server; Explore is reached from the arrival (Tanegashima → Jezero, flight shortened, auto-land) or a direct
// ?base=jezero visit; state is read through the dev-only window.__app. Synthetic: camera refused, no real hand.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.env.PRESET_SHOTS ?? null;
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
  await page.waitForFunction(() => window.__app?.mission && window.__app.journey && window.__app.sunsetPreview && document.querySelector('#status')?.dataset.kind === 'keyboard');
  return { context, page, errors };
}
/** Tanegashima → Jezero, to the arrival card. */
async function arrive(page) {
  await page.evaluate(() => window.__app.bus.emit({ type: 'enterBase', baseId: 'cape' }));
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'cape');
  await page.evaluate(() => { window.__app.bus.emit({ type: 'chooseDestination', baseId: 'jezero' }); window.__app.bus.emit({ type: 'launch' }); });
  await page.waitForFunction(() => window.__app.modes.mode === 'travel' && window.__app.mission.trip);
  await page.evaluate(() => { const t = window.__app.mission.trip; t.elapsed = t.seconds - 0.01; });
  await page.waitForFunction(() => window.__app.modes.mode === 'docking');
  await page.evaluate(() => window.__app.bus.emit({ type: 'select' }));
  await page.waitForFunction(() => window.__app.journey.phase === 'arrived');
}
/** Direct ?base=jezero: the standard Horizon view opens Explore. */
async function direct(page, touch = false) {
  await page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero' && window.__app.modes.mode === 'baseView' && window.__app.showcases.get('jezero'));
  await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
  await exploring(page);
  void touch;
}
const exploring = (page) => page.waitForFunction(() => window.__app.mission.horizon !== null && document.querySelector('#mission-overlay')?.classList.contains('explore') && document.querySelector('#explore-time'));
const now = (page) => page.evaluate(() => window.__app.clock.time);
const original = (page) => page.evaluate(() => window.__app.sunsetPreview.state?.original ?? null);
const pressed = (page) => page.evaluate(() => [...document.querySelectorAll('#explore-time [data-preset]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.preset));
/** Camera pose in the base's own frame (the planet turns with time; the pose on the ground must not change). */
const pose = (page) => page.evaluate(() => {
  const a = window.__app, h = a.mission.horizon, g = a.mission.base.group;
  g.updateWorldMatrix(true, false);
  const local = g.worldToLocal(a.rig.camera.position.clone());
  return { yaw: h.yaw, pitch: h.pitch, distance: h.distance, x: local.x, y: local.y, z: local.z };
});
const clockState = (page) => page.evaluate(() => ({ paused: window.__app.clock.paused, rate: window.__app.clock.rate }));
const nextFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const rects = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => !e.hidden && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }), sel);
const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inView = (r, vp) => !!r && r.left >= -0.5 && r.top >= -0.5 && r.right <= vp.width + 0.5 && r.bottom <= vp.height + 0.5;
const near = (a, b, pose = 1e-6) => Math.abs(a - b) <= pose;

test('direct visit (mouse, paused, custom speed): Day → Golden Hour → Night → Restore returns EXACTLY to the original; camera pose, pause and speed kept', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await direct(page);
    // A custom speed, then paused: both must survive every preset and Restore.
    await page.evaluate(() => { window.__app.bus.emit({ type: 'setTimeSpeed', position: 0.35 }); window.__app.bus.emit({ type: 'togglePause' }); });
    const speed = await clockState(page);
    assert.equal(speed.paused, true);
    assert.ok(speed.rate !== 0);
    await nextFrames(page);
    assert.deepEqual(await pressed(page), [], 'no preset active before the first');
    assert.equal(await page.locator('#restore-time').isVisible(), false);
    assert.match(await page.locator('#explore-local').textContent(), /^\d\d:\d\d$/);
    const t0 = await now(page);
    const pose0 = await pose(page);
    const expected = await page.evaluate((t) => window.__app.presetTimes(t), t0);
    for (const preset of ['day', 'golden', 'night']) {
      await page.locator(`#explore-time [data-preset="${preset}"]`).click();
      assert.equal(await now(page), expected[preset], `${preset}: the clock is exactly at the preset time`);
      assert.equal(await original(page), t0, `${preset}: the original is saved once`);
      await page.waitForFunction((p) => document.querySelector(`#explore-time [data-preset="${p}"]`).getAttribute('aria-pressed') === 'true', preset);
      assert.deepEqual(await pressed(page), [preset]);
      const p = await pose(page);
      for (const k of Object.keys(pose0)) assert.ok(near(p[k], pose0[k], 1e-4), `${preset}: camera ${k} kept (${p[k]} vs ${pose0[k]})`);
      assert.deepEqual(await clockState(page), speed, `${preset}: pause and speed kept`);
      assert.ok(await page.locator('#restore-time').isVisible(), `${preset}: Restore offered`);
    }
    const labels = { day: 'Day', golden: 'Golden Hour', night: 'Night' };
    assert.equal(await page.locator('#explore-active').textContent(), `· ${labels.night}`);
    await page.waitForFunction(() => /^Night · \d\d:\d\d local time$/.test(document.querySelector('#explore-time-live')?.textContent ?? ''));
    await page.locator('#restore-time').click();
    assert.equal(await now(page), t0, 'Restore: exactly the original timestamp');
    assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null, 'still exploring');
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.deepEqual(await pressed(page), []);
    assert.equal(await original(page), null);
    assert.deepEqual(await clockState(page), speed, 'Restore keeps pause and speed');
    const p = await pose(page);
    for (const k of Object.keys(pose0)) assert.ok(near(p[k], pose0[k], 1e-4), `Restore: camera ${k} kept`);
    await page.waitForFunction(() => document.querySelector('#explore-time-live')?.textContent === 'Previous time restored');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.preset ?? null), 'day', 'focus stays in the time group');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('from the arrival (keyboard, clock running): arrows move between presets, Enter / Space apply; Restore by keyboard; arrival card and Return to orbit unchanged', async () => {
  const { page, context, errors } = await open('lang=en');
  try {
    await arrive(page);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'journey-explore');
    await page.keyboard.press('Enter');
    await exploring(page);
    assert.ok(await page.locator('#return-orbit').isVisible());
    assert.equal(await page.locator('#journey-arrival').isVisible(), false);
    const speed = await clockState(page);
    assert.equal(speed.paused, false);
    const pose0 = await pose(page);
    // One tab stop: Day; → Golden Hour (focus only), Enter applies; → Night, Space applies.
    await page.locator('#preset-day').focus();
    const t0 = await now(page);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.preset), 'golden');
    assert.ok(Math.abs((await now(page)) - t0) < 5000, 'moving focus does not change the time');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#horizon-sunset').getAttribute('aria-pressed') === 'true');
    const saved = await original(page);
    assert.ok(Math.abs(saved - t0) < 5000, 'original saved just before the first preset');
    const expected = await page.evaluate((t) => window.__app.presetTimes(t), saved);
    assert.ok(Math.abs((await now(page)) - expected.golden) < 5000, 'Golden Hour: the existing sunset time (clock running on)');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('#preset-night').getAttribute('aria-pressed') === 'true');
    assert.equal(await original(page), saved);
    assert.ok(Math.abs((await now(page)) - expected.night) < 5000);
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#preset-day').getAttribute('aria-pressed') === 'true');
    // Restore by keyboard (Tab from the presets reaches it).
    await page.locator('#restore-time').focus();
    await page.keyboard.press('Enter');
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.ok(Math.abs((await now(page)) - saved) < 3000, 'restored to the original (the clock runs on at real time)');
    assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null);
    assert.deepEqual(await clockState(page), speed);
    const p = await pose(page);
    for (const k of ['yaw', 'pitch', 'distance']) assert.ok(near(p[k], pose0[k], 1e-4), `camera ${k} kept`);
    // Esc still returns to orbit from a focused control in the card.
    await page.locator('#preset-day').focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__app.mission.horizon === null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Now, a chosen date, and leaving Explore clear the snapshot and the active preset; no stale Restore later', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await direct(page);
    for (const intent of [{ type: 'timeNow' }, { type: 'timeJump', ms: Date.UTC(2031, 2, 3) }]) {
      await page.locator('#preset-night').click();
      await page.locator('#restore-time').waitFor({ state: 'visible' });
      await page.evaluate((i) => window.__app.bus.emit(i), intent);
      await page.locator('#restore-time').waitFor({ state: 'hidden' });
      assert.equal(await original(page), null, intent.type);
      await nextFrames(page);
      assert.deepEqual(await pressed(page), [], `${intent.type}: no active preset`);
    }
    // Speed / pause keep it.
    await page.locator('#preset-day').click();
    await page.evaluate(() => { window.__app.bus.emit({ type: 'setTimeSpeed', position: 0.2 }); window.__app.bus.emit({ type: 'togglePause' }); window.__app.bus.emit({ type: 'togglePause' }); });
    await nextFrames(page);
    assert.ok(await page.locator('#restore-time').isVisible());
    // Leaving Explore discards it; back in Explore nothing is offered.
    await page.locator('#return-orbit').click();
    await page.waitForFunction(() => window.__app.mission.horizon === null);
    assert.equal(await original(page), null);
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await exploring(page);
    await nextFrames(page);
    assert.equal(await page.locator('#restore-time').isVisible(), false);
    assert.deepEqual(await pressed(page), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the base panel near-sunset chip still opens Explore at sunset, shown there as Golden Hour with Restore', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero' && window.__app.modes.mode === 'baseView' && window.__app.showcases.get('jezero'));
    const t0 = await now(page);
    await page.locator('#base-panel .golden').click();
    await exploring(page);
    await nextFrames(page);
    assert.ok(Math.abs((await original(page)) - t0) < 5000);
    assert.deepEqual(await pressed(page), ['golden']);
    assert.ok(await page.locator('#restore-time').isVisible());
    // A preset after it keeps that original.
    await page.locator('#preset-day').click();
    assert.ok(Math.abs((await original(page)) - t0) < 5000);
    await page.locator('#restore-time').click();
    assert.ok(Math.abs((await now(page)) - t0) < 5000);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('reduced motion: the lighting state follows a preset within a few frames (no transition); Restore has no animation', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en', { reducedMotion: 'reduce' });
  try {
    await direct(page);
    const night = () => page.evaluate(() => window.__app.showcases.sky('jezero')?.dome?.material.uniforms.night.value ?? null);
    await page.locator('#preset-day').click();
    await nextFrames(page);
    assert.ok((await night()) < 0.05, `day: sky night uniform ${await night()}`);
    await page.locator('#preset-night').click();
    await nextFrames(page);
    assert.ok((await night()) > 0.95, `night: sky night uniform ${await night()}`);
    assert.equal(await page.locator('#restore-time').evaluate((e) => getComputedStyle(e).animationName), 'none');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const [vp, viewport] of [['phone', PHONE], ['land', LAND]]) {
  test(`${vp} (touch, webcam preview open): presets, local time, Restore and Return to orbit in view and clear — my / ja / en`, async () => {
    for (const lang of ['my', 'ja', 'en']) {
      const { page, context, errors } = await open(`base=jezero&lang=${lang}`, { viewport, hasTouch: true });
      try {
        await direct(page, true);
        await page.evaluate(() => { const p = document.querySelector('#preview'); p.hidden = false; p.style.display = 'block'; p.style.height = '126px'; });
        await page.waitForTimeout(300);
        // Before the first preset: what they do is said, visibly.
        assert.ok(await page.locator('#horizon-sunset-note').isVisible(), `${lang}: explanation before use`);
        await page.locator('#horizon-sunset').tap();
        await page.locator('#restore-time').waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        const tag = (x) => `${lang} ${vp} ${JSON.stringify(x)}`;
        const card = await rect(page, '#mission-overlay');
        const controls = ['#return-orbit', '#explore-local', '#preset-day', '#horizon-sunset', '#preset-night', '#restore-time'];
        for (const sel of controls) {
          const r = await rect(page, sel);
          assert.ok(inView(r, viewport), `${sel} in view ${tag(r)}`);
          // Not scrolled out of the card (the card may scroll in short landscape): fully inside its box.
          assert.ok(r.top >= card.top - 0.5 && r.bottom <= card.bottom + 0.5, `${sel} visible inside the card ${tag([r, card])}`);
          if (sel !== '#explore-local') assert.ok(r.height >= 44 && r.width >= 44, `${sel} ≥ 44 px ${tag(r)}`);
          for (const other of ['#preview', '#gesture-flash', '#timebar', 'header.hud.top']) assert.ok(!overlaps(r, await rect(page, other)), `${sel} clear of ${other} ${tag([r, await rect(page, other)])}`);
          for (const b of await rects(page, 'footer.hud :is(button, a)')) assert.ok(!overlaps(r, b), `${sel} clear of a footer control ${tag([r, b])}`);
        }
        assert.ok(!overlaps(card, await rect(page, '#preview')), `card clear of the preview ${tag([card, await rect(page, '#preview')])}`);
        const clipped = await page.evaluate((sels) => sels.filter((s) => { const e = document.querySelector(s); return e && e.scrollWidth > e.clientWidth + 1; }), controls);
        assert.deepEqual(clipped, [], `${lang}: labels wrap, nothing clipped`);
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'no page scroll');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/presets-${lang}-${vp}.png` });
        const saved = await original(page);
        await page.locator('#restore-time').tap();
        await page.locator('#restore-time').waitFor({ state: 'hidden' });
        assert.ok(Math.abs((await now(page)) - saved) < 3000, `${lang}: restored`);
        assert.ok(await page.locator('#return-orbit').isVisible());
        await page.locator('#return-orbit').tap();
        await page.waitForFunction(() => window.__app.mission.horizon === null);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
}
