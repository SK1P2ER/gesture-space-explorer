// Opt-in 3D destination picker (?flags=picker3d) in the real app, and the baseline without the flag.
//   node --test --test-concurrency=1 tests/browser/destination-picker.test.mjs
// Dev server (state is read and hand frames are INJECTED through the dev-only window.__app: synthetic observations,
// not a camera). Chromium, camera refused, a fresh browser profile per test.
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

async function open(path, viewport = { width: 1280, height: 800 }, reducedMotion = 'reduce', beforeGoto = null, hasTouch = false) {
  const context = await browser.newContext({ reducedMotion, viewport, hasTouch });
  if (beforeGoto) await beforeGoto(context);
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + path);
  await page.waitForFunction(() => window.__app?.mission && window.__app.trackingFrame && document.querySelector('#status')?.dataset.kind === 'keyboard');
  return { context, page, errors };
}
const shown = (page) => page.waitForFunction(() => window.__app.picker && !document.querySelector('#destination-picker').hidden && window.__app.picker.view.currentTargets.length > 0);
/** Free mode: screen 1's "Choose a destination" opens screen 2. */
const openFlow = async (page) => {
  await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
  await page.locator('#picker-open').click();
  await shown(page);
};
/** The flow's own state (dev-only window.__app.flow). */
const flowState = (page) => page.evaluate(() => { const f = window.__app.flow; return { screen: f.screen, preview: f.preview, confirmed: f.confirmed }; });
const checkpointDestination = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gse.mission.v1') || 'null')?.destinationId ?? null);
const app = (page) => page.evaluate(() => ({ mode: window.__app.modes.mode, destination: window.__app.mission.destination?.base.id ?? null, countdown: !!window.__app.mission.countdown }));
/** The normalized screen position of a destination's orb (where a 👆 would point). */
const orb = (page, baseId) => page.evaluate((id) => { const t = window.__app.picker.view.currentTargets.find((x) => x.baseId === id); return { x: t.x / innerWidth, y: t.y / innerHeight }; }, baseId);
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/**
 * INJECTED hand frames, 50 ms apart: the engine's stable pose/pointer and the raw observation main.ts reads, then one
 * tracking frame of layered gestures (main.ts trackingDeps.more), emitted on the bus as tracking.ts does.
 */
async function feed(page, ms, { pose, pointer = null, thumbsUp = false, fingers = null }) {
  const out = await page.evaluate(({ ms, pose, pointer, thumbsUp, fingers }) => {
    const a = window.__app;
    a.__t ??= 100000;
    const out = [];
    for (let i = 0; i <= ms; i += 50) {
      a.__t += 50;
      a.gestures.ui = { pose, action: null, pointer, hoverId: null, progress: 0 };
      a.gestures.lastObs = pose === null ? null : { pose, thumbsUp, center: pointer ?? { x: 0.5, y: 0.5 },
        fingers: fingers ?? { thumb: thumbsUp, index: pose === 'point', middle: false, ring: false, pinky: false } };
      out.push(...a.trackingFrame(a.__t).map((x) => x.type));
    }
    return out;
  }, { ms, pose, pointer, thumbsUp, fingers });
  await nextFrame(page);
  return out;
}
/** A 👍 held for ms (INJECTED frames), and a release (frames with no hand seen, the camera still running). */
const thumbFor = (page, ms) => feed(page, ms, { pose: 'fist', thumbsUp: true });
const release = (page) => feed(page, 100, { pose: null });
/** The release instruction (screen 2 and Guided): keep the hand in view and lower the thumb (no hand seen is no release). */
const RELEASE = {
  en: 'Lower your thumb while keeping your hand visible, then show 👍 again.',
  ja: '手をカメラに映したまま親指を下ろし、もう一度👍を見せてください。',
  my: 'လက်ကို ကင်မရာမြင်ကွင်းထဲမှာထားပြီး လက်မကို အရင်ချပါ။ ပြီးမှ 👍 ပြန်ပြပါ။',
};
const RELEASE_EN = RELEASE.en;
/** The controlling hand seen without 👍 (a fist): the observation that releases a 👍 owed for a destination change. */
const showHand = (page) => feed(page, 100, { pose: 'fist', thumbsUp: false });
/**
 * Keeps a 👍 up, one INJECTED frame per animation frame (the hand is always "just seen"), until the rendered text of
 * selector includes text: what a person holding 👍 sees, however slow the machine.
 */
const thumbUntilText = (page, selector, text) => page.waitForFunction(({ selector, text }) => {
  const a = window.__app;
  a.__t ??= 100000;
  a.__t += 50;
  a.gestures.ui = { pose: 'fist', action: null, pointer: null, hoverId: null, progress: 0 };
  a.gestures.lastObs = { pose: 'fist', thumbsUp: true, center: { x: 0.5, y: 0.5 }, fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false } };
  a.trackingFrame(a.__t);
  return (document.querySelector(selector)?.textContent ?? '').includes(text);
}, { selector, text }, { polling: 'raf' });
/** One 👍 frame, then Guided's "owes a release" read in the same task (no real time passes between the two). */
const guidedOwesWithThumb = (page) => page.evaluate(() => {
  const a = window.__app;
  a.__t += 50;
  a.gestures.ui = { pose: 'fist', action: null, pointer: null, hoverId: null, progress: 0 };
  a.gestures.lastObs = { pose: 'fist', thumbsUp: true, center: { x: 0.5, y: 0.5 }, fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false } };
  a.trackingFrame(a.__t);
  return a.guided.holdWaitingRelease;
});
/**
 * Keeps injecting 👍 frames, 50 ms apart, until the screen's action completes (free: screen 2's Confirm; Guided: its
 * confirm-and-launch); the synthetic time from the first of these frames, or null if none completed within maxMs.
 */
const holdUntil = (page, mode, maxMs = 3000) => page.evaluate(({ mode, maxMs }) => {
  const a = window.__app;
  a.__t ??= 100000;
  const done = () => a.modes.mode === 'launch' || (mode === 'guided' ? a.guided.session.stage !== 'destination' : a.flow.screen !== 'select');
  const t0 = a.__t + 50;
  while (a.__t + 50 - t0 <= maxMs) {
    a.__t += 50;
    a.gestures.ui = { pose: 'fist', action: null, pointer: null, hoverId: null, progress: 0 };
    a.gestures.lastObs = { pose: 'fist', thumbsUp: true, center: { x: 0.5, y: 0.5 }, fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false } };
    a.trackingFrame(a.__t);
    if (done()) return a.__t - t0;
  }
  return null;
}, { mode, maxMs });
/** A destination on screen other than those given. */
const otherThan = (page, not) => page.evaluate((n) => window.__app.picker.view.currentTargets.map((t) => t.baseId).find((id) => !n.includes(id)), not);
/** The picker's ways to choose a destination other than 👆, as a person uses them. */
const chooseBy = {
  tap: (page, id) => page.locator(`#destination-picker .picker-target[data-base="${id}"]`).click(),
  enter: async (page, id) => { await page.evaluate((b) => document.querySelector(`#destination-picker .picker-target[data-base="${b}"]`).focus(), id); await page.keyboard.press('Enter'); },
  list: async (page, id) => { await page.locator('#destination-picker .picker-all').click(); await page.locator(`#picker-list button[data-base="${id}"]`).click(); await shown(page); },
};
const settled = async (page) => {
  await page.waitForFunction(() => document.querySelector('#loading')?.hidden !== false
    && [...document.querySelectorAll('#destination-picker .picker-target')].every(b => b.hidden || b.dataset.look === 'texture'));
  const at = await page.evaluate(() => performance.now());
  await page.waitForFunction(t => window.__app.picker.view.measuredAt > t, at);
};
const toDestinationStep = async (page) => {
  for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__app.guided.requestConfirm()); await page.waitForTimeout(200); }
  await page.waitForFunction(() => window.__app.guided.session.stage === 'destination');
};

test('Tanegashima ground link: tracking loss and 👍 re-entry cannot launch before a visible release', async () => {
  const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=my', { width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.__app.localSpaceport.active);
    await openFlow(page);
    assert.equal(await page.evaluate(() => window.__app.localSpaceport.active), false);
    await feed(page, 600, { pose: 'point', pointer: await orb(page, 'jezero') });
    assert.deepEqual(await flowState(page), { screen: 'select', preview: 'jezero', confirmed: null });
    assert.equal((await app(page)).destination, null);
    await page.evaluate(() => {
      const a = window.__app;
      a.testLaunchCount = 0;
      a.bus.on((intent) => { if (intent.type === 'launch') a.testLaunchCount++; });
    });
    const launches = () => page.evaluate(() => window.__app.testLaunchCount);

    await thumbFor(page, 700);
    assert.deepEqual(await flowState(page), { screen: 'confirm', preview: 'jezero', confirmed: 'jezero' });
    assert.deepEqual(await app(page), { mode: 'baseView', destination: 'jezero', countdown: false });
    await thumbFor(page, 1500);
    assert.equal((await app(page)).mode, 'baseView', 'the confirmation hold must not launch');
    await feed(page, 400, { pose: null });
    assert.equal(await launches(), 0);
    await thumbFor(page, 1500);
    assert.equal((await app(page)).mode, 'baseView', 'a thumb held through re-entry must still owe a release');
    assert.equal(await launches(), 0);
    assert.equal(await page.evaluate(() => window.__app.picker.logic.waitingRelease), true);
    assert.equal(await page.locator('.picker-confirm').isEnabled(), true, 'manual launch remains available');
    await showHand(page);
    assert.equal(await page.evaluate(() => window.__app.picker.logic.waitingRelease), false);
    await thumbFor(page, 700);
    assert.equal((await app(page)).mode, 'launch');
    await thumbFor(page, 1500);
    assert.equal(await launches(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Tanegashima picker cursor stays steady through jitter and a missed detection', async () => {
  const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=my', { width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.__app.localSpaceport.active);
    await openFlow(page);
    const mars = await orb(page, 'jezero');
    const cursor = page.locator('#pointer');
    const position = () => cursor.evaluate((element) => element.style.transform);
    await feed(page, 0, { pose: 'point', pointer: mars });
    await cursor.waitFor({ state: 'visible' });
    const initial = await position();
    await feed(page, 0, { pose: 'point', pointer: { x: mars.x + 3 / 390, y: mars.y - 2 / 844 } });
    await nextFrame(page);
    assert.equal(await position(), initial);
    await feed(page, 0, { pose: null });
    await nextFrame(page);
    assert.equal(await cursor.isVisible(), true);
    assert.equal(await position(), initial);
    assert.equal(await page.evaluate(() => window.__app.picker.logic.focusProgress), 0);
    await feed(page, 0, { pose: 'point', pointer: mars });
    assert.equal(await page.evaluate(() => window.__app.picker.logic.focusProgress), 0, 'the reacquisition frame must not count the missed interval');
    await feed(page, 0, { pose: 'point', pointer: await orb(page, 'kraken') });
    await nextFrame(page);
    assert.notEqual(await position(), initial);
    assert.equal(await page.evaluate(() => window.__app.picker.logic.hover), 'kraken');
    await showHand(page);
    await cursor.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('phone boarding pass: stable gesture targets, fresh dwell after resize and accessible Burmese landscape actions', async () => {
  const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=my', { width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.__app.localSpaceport.active);
    await openFlow(page);
    await page.locator('.picker-card[data-phone="portrait"]').waitFor();
    await settled(page);
    const idle = await targetsOf(page);
    const pointer = await orb(page, 'jezero');
    await feed(page, 200, { pose: 'point', pointer });
    assert.deepEqual(await targetsOf(page), idle);
    await feed(page, 400, { pose: 'point', pointer });
    assert.equal((await flowState(page)).preview, 'jezero');
    assert.deepEqual(await targetsOf(page), idle);

    await feed(page, 150, { pose: 'point', pointer: await orb(page, 'kraken') });
    assert.ok(await page.evaluate(() => window.__app.picker.logic.focusProgress > 0));
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('.picker-card[data-phone="landscape"]').waitFor();
    const newPointer = await orb(page, 'kraken');
    await feed(page, 0, { pose: 'point', pointer: newPointer });
    assert.equal(await page.evaluate(() => window.__app.picker.logic.focusProgress), 0);
    assert.equal((await flowState(page)).preview, 'jezero');
    assert.notDeepEqual(await targetsOf(page), idle);
    await feed(page, 350, { pose: 'point', pointer: newPointer });
    assert.equal((await flowState(page)).preview, 'jezero', 'old dwell must not count in landscape');

    await thumbFor(page, 700);
    await page.locator('.picker-card[data-phone="landscape"][data-screen="confirm"]').waitFor();
    await thumbUntilText(page, '.picker-state', '👍');
    const layout = await page.evaluate(() => {
      const card = document.querySelector('.picker-card');
      const planet = window.__app.picker.view.currentTargets[0];
      return {
        left: planet.x + planet.r < card.getBoundingClientRect().left,
        routeScrollable: getComputedStyle(card.querySelector('.picker-route')).overflowY === 'auto',
        buttonsVisible: [...card.querySelectorAll('.picker-back, .picker-confirm')].every((button) => {
          const r = button.getBoundingClientRect();
          const inside = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
          return inside && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === button;
        }),
      };
    });
    assert.deepEqual(layout, { left: true, routeScrollable: true, buttonsVisible: true });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

for (const input of ['keyboard', 'mouse', 'touch']) {
  test(`Tanegashima ground link: ${input} can launch while a visible gesture release is owed`, async () => {
    const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=my',
      { width: 844, height: 390 }, 'reduce', null, input === 'touch');
    try {
      await page.waitForFunction(() => window.__app.localSpaceport.active);
      await openFlow(page);
      await feed(page, 600, { pose: 'point', pointer: await orb(page, 'jezero') });
      await thumbFor(page, 700);
      await feed(page, 400, { pose: null });
      await thumbFor(page, 1500);
      assert.equal(await page.evaluate(() => window.__app.picker.logic.waitingRelease), true);
      assert.deepEqual(await app(page), { mode: 'baseView', destination: 'jezero', countdown: false });
      const launch = page.locator('.picker-confirm');
      if (input === 'keyboard') await launch.press('Enter');
      else if (input === 'touch') await launch.tap();
      else await launch.click();
      assert.equal((await app(page)).mode, 'launch');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

test('flag off: no picker is created, and gestures keep their current meaning', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en');
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker')), null);
  assert.equal(await page.evaluate(() => window.__app.picker), undefined);
  // The engine's own actions pass as before (camera rotate, 👆 dwell-select, ✌️ next).
  for (const i of [{ type: 'rotate', dx: 0.1, dy: 0 }, { type: 'select', bodyId: 'moon' }, { type: 'next' }]) assert.equal(await page.evaluate((x) => window.__app.trackingDeps.keep(x), i), true, i.type);
  // A held 👆 is still the countdown's "1" path here (it fires nothing without 3 and 2 first) and selects nothing.
  assert.deepEqual(await feed(page, 600, { pose: 'point', pointer: { x: 0.2, y: 0.5 } }), []);
  assert.equal((await app(page)).destination, null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag off, Guided: ✋ still picks the destination in the destination step (baseline kept)', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=astrolife,guided');
  await toDestinationStep(page);
  await page.evaluate(() => { for (let t = 0; t < 5; t++) window.__app.guided.observe(200000 + t * 50, { pose: 'palm', thumbsUp: false, center: { x: 0.05, y: 0.5 } }); });
  assert.equal(await page.evaluate(() => window.__app.guided.session.destination), 'tranquility');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, screen 1: a base view keeps its own controls and gestures; the flow opens only from "Choose a destination"', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker').hidden), true);
  assert.equal(await page.textContent('#picker-open'), '🪐 Choose a destination');
  // Screen 1 is the base view as it was: the engine's actions apply and the base sheet is there.
  for (const i of [{ type: 'rotate', dx: 0.1, dy: 0 }, { type: 'select', bodyId: 'moon' }, { type: 'next' }]) assert.equal(await page.evaluate((x) => window.__app.trackingDeps.keep(x), i), true, i.type);
  assert.equal(await page.evaluate(() => document.querySelector('#base-panel').hidden), false);
  assert.equal(await page.evaluate(() => document.body.classList.contains('destination-flow')), false);
  await page.locator('#picker-open').click();
  await shown(page);
  assert.deepEqual(await flowState(page), { screen: 'select', preview: null, confirmed: null });
  assert.equal(await page.evaluate(() => document.querySelector('#base-panel').hidden), true, 'the base sheet stayed beside screen 2');
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry').hidden), true);
  assert.equal(await page.evaluate((x) => window.__app.trackingDeps.keep(x), { type: 'rotate', dx: 0.1, dy: 0 }), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: the planet labels step aside while the picker shows, and come back as they were when it goes', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  const vis = () => page.evaluate(() => getComputedStyle(document.querySelector('#labels')).visibility);
  assert.equal(await vis(), 'hidden');
  // Leaving the base view ends the picker's ownership: the labels are back.
  assert.equal(await page.evaluate(() => window.__app.modes.go('solarView')), true);
  await page.waitForFunction(() => document.querySelector('#destination-picker').hidden);
  assert.equal(await page.evaluate(() => document.body.classList.contains('picker-active')), false);
  assert.equal(await vis(), 'visible');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: one object per valid destination, mapped by base id, drawn by the existing renderer', async () => {
  const off = await open('/?base=jezero&lang=en');
  const canvasesOff = await off.page.evaluate(() => document.querySelectorAll('canvas').length);
  await off.context.close();
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  const labels = await page.evaluate(() => [...document.querySelectorAll('#destination-picker .picker-target:not([hidden])')].map((b) => ({ base: b.dataset.base, text: b.textContent, label: b.getAttribute('aria-label') })));
  assert.deepEqual(labels.map((l) => l.base), ['cape', 'tranquility', 'conamara', 'kraken']);
  assert.deepEqual(labels.map((l) => l.text), ['Earth', 'Moon', 'Europa', 'Titan']);
  assert.match(labels[0].label, /Tanegashima Spaceport · Earth/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length), canvasesOff, 'a renderer was added');
  assert.equal(await page.evaluate(() => window.__app.system.scene.children.filter((c) => c.name === 'destination-picker').length), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, screen 2: 👆 previews after a steady focus (the mission is untouched); ✋ does not; no countdown or camera action', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  await settled(page);
  // While the flow owns input the engine's own actions are dropped (no camera rotate, no dwell-select, no ✌️).
  for (const i of [{ type: 'rotate', dx: 0.1, dy: 0 }, { type: 'zoom', factor: 1.1 }, { type: 'select', bodyId: 'moon' }, { type: 'next' }, { type: 'togglePause' }]) assert.equal(await page.evaluate((x) => window.__app.trackingDeps.keep(x), i), false, i.type);
  const kraken = await orb(page, 'kraken');
  assert.deepEqual(await feed(page, 200, { pose: 'point', pointer: kraken }), []);
  assert.equal((await flowState(page)).preview, null, 'a brief hover selected');
  assert.deepEqual(await feed(page, 400, { pose: 'point', pointer: kraken }), [], 'a preview sent an intent');
  assert.equal((await flowState(page)).preview, 'kraken');
  assert.deepEqual(await app(page), { mode: 'baseView', destination: null, countdown: false });
  // ✋ over another destination: nothing.
  assert.deepEqual(await feed(page, 1000, { pose: 'palm', pointer: await orb(page, 'tranquility') }), []);
  assert.equal((await flowState(page)).preview, 'kraken');
  // The finger countdown (3, 2, 1) does not run while the flow owns input.
  const counts = [{ index: true, middle: true, ring: true }, { index: true, middle: true, ring: false }, { index: true, middle: false, ring: false }];
  for (const f of counts) assert.deepEqual(await feed(page, 400, { pose: 'v', fingers: { thumb: false, pinky: false, ...f } }), []);
  assert.deepEqual(await app(page), { mode: 'baseView', destination: null, countdown: false });
  assert.equal(await checkpointDestination(page), null);
  assert.deepEqual(errors, []);
  await context.close();
});

/** 👍 through screen 2 (Confirm) and screen 3 (Launch): one action each, a release in between, whatever the motion setting. */
async function thumbsThroughTheFlow(reducedMotion) {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d', undefined, reducedMotion);
  await openFlow(page);
  const thumb = { pose: 'fist', thumbsUp: true };
  await feed(page, 600, thumb);
  assert.equal((await flowState(page)).screen, 'select', 'confirmed with nothing selected');
  await feed(page, 100, { pose: null });
  await feed(page, 600, { pose: 'point', pointer: await orb(page, 'cape') });
  assert.equal((await flowState(page)).preview, 'cape');
  // Tracking loss mid-hold: the hold starts over.
  await feed(page, 300, thumb);
  await page.evaluate(() => window.__app.trackingDeps.stopped());
  await feed(page, 300, thumb);
  assert.equal((await flowState(page)).screen, 'select', 'a dropout let a partial hold confirm');
  await feed(page, 100, { pose: null });
  // A full hold: Confirm (the mission takes the destination), screen 3, no launch.
  await feed(page, 700, thumb);
  assert.deepEqual(await flowState(page), { screen: 'confirm', preview: 'cape', confirmed: 'cape' });
  assert.deepEqual(await app(page), { mode: 'baseView', destination: 'cape', countdown: false });
  // The same 👍, still up across the screen change: nothing, however long; the card asks for a release.
  await feed(page, 1500, thumb);
  assert.equal((await app(page)).mode, 'baseView', 'a 👍 held across the screen change launched');
  await page.waitForFunction(() => /Release 👍/.test(document.querySelector('#destination-picker .picker-state').textContent));
  // Released, then a fresh full hold: Launch, once.
  await showHand(page);
  await feed(page, 700, thumb);
  assert.equal((await app(page)).mode, 'launch');
  // The flow closes on the next frame (it follows the mission each frame).
  await page.waitForFunction(() => window.__app.flow.screen === 'closed');
  assert.deepEqual(errors, []);
  return { context, page, errors, thumb };
}

test('flag on: 👍 confirms on screen 2, then must be released before it can launch on screen 3 (reduced motion)', async () => {
  const { context, page, errors, thumb } = await thumbsThroughTheFlow('reduce');
  // A cancelled countdown: back on screen 1, the confirmation stands (a shortcut), and the held 👍 does nothing there.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView');
  await page.waitForFunction(() => !document.querySelector('#picker-entry .picker-journey').hidden);
  await feed(page, 800, thumb);
  assert.equal((await app(page)).mode, 'baseView');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: the same with animations on: the release rule does not depend on the transition', async () => {
  const { context } = await thumbsThroughTheFlow('no-preference');
  await context.close();
});

/** Screen 1 with Titan confirmed in this session (Confirm, then Back twice), focus on the page. */
async function confirmedOnScreenOne(page) {
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.locator('#destination-picker .picker-confirm').click();
  await page.locator('#destination-picker .picker-back').click();
  await page.locator('#destination-picker .picker-back').click();
  await page.waitForFunction(() => window.__app.flow.screen === 'closed' && !document.querySelector('#picker-entry .picker-journey').hidden);
  await page.evaluate(() => document.activeElement?.blur());
}

test('flag on, keyboard: Enter on the focused Confirm confirms; the same Enter, held, neither goes on to Launch nor back', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await nextFrame(page);
  await page.focus('#destination-picker .picker-confirm');
  await page.keyboard.down('Enter'); // native activation of the focused Confirm
  await nextFrame(page);
  assert.deepEqual(await flowState(page), { screen: 'confirm', preview: 'kraken', confirmed: 'kraken' });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('picker-back')), true);
  for (let i = 0; i < 6; i++) await page.keyboard.down('Enter'); // auto-repeat: on Back now, and as the page's Enter
  await page.waitForTimeout(300);
  assert.equal((await flowState(page)).screen, 'confirm', 'a repeat of the same Enter activated Back');
  assert.equal((await app(page)).mode, 'baseView', 'a repeat of the same Enter launched');
  await page.keyboard.up('Enter');
  // A new, deliberate press on Launch launches.
  await page.focus('#destination-picker .picker-confirm');
  await page.keyboard.press('Enter');
  assert.equal((await app(page)).mode, 'launch');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, keyboard on screen 1: a held Enter opens screen 3 and its repeats do not launch; a new press does', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await confirmedOnScreenOne(page);
  await page.keyboard.down('Enter');
  assert.equal((await flowState(page)).screen, 'confirm');
  for (let i = 0; i < 8; i++) await page.keyboard.down('Enter'); // auto-repeat
  await page.waitForTimeout(300);
  assert.equal((await app(page)).mode, 'baseView', 'the repeats of the Enter that opened screen 3 launched');
  await page.keyboard.up('Enter');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  assert.equal((await app(page)).mode, 'launch', 'a new Enter press did not launch');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, keyboard: focus lost while Enter is held (no keyup ever comes): no launch on return, and the keyboard is not left blocked', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await confirmedOnScreenOne(page);
  // The page's own Enter, dispatched as the browser would (a keydown, then the window loses focus: no keyup).
  const enter = (repeat) => page.evaluate((r) => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: r, bubbles: true, cancelable: true })), repeat);
  await enter(false);
  assert.equal((await flowState(page)).screen, 'confirm');
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
  await page.waitForTimeout(600);
  assert.equal((await app(page)).mode, 'baseView', 'focus loss launched');
  // Back on the page: nothing launches by itself; a new press is a deliberate Launch (the keyboard is not stuck).
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(600);
  assert.equal((await app(page)).mode, 'baseView', 'coming back launched');
  await enter(false);
  assert.equal((await app(page)).mode, 'launch', 'the keyboard stayed blocked after the focus loss');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: the Enter-release listener is added once and removed: opening and closing again does not pile listeners up', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d', undefined, 'reduce', async (c) => {
    await c.addInitScript(() => {
      // Live count of window keyup/blur listeners (added minus removed, by function identity).
      const live = window.__liveListeners = { keyup: new Set(), blur: new Set() };
      const add = window.addEventListener, remove = window.removeEventListener;
      window.addEventListener = function (type, fn, opts) { if (type in live) live[type].add(fn); return add.call(this, type, fn, opts); };
      window.removeEventListener = function (type, fn, opts) { if (type in live) live[type].delete(fn); return remove.call(this, type, fn, opts); };
    });
  });
  const base = await page.evaluate(() => ({ keyup: window.__liveListeners.keyup.size, blur: window.__liveListeners.blur.size }));
  await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('Enter'); // opens screen 2 (nothing confirmed)
    assert.equal((await flowState(page)).screen, 'select');
    const during = await page.evaluate(() => ({ keyup: window.__liveListeners.keyup.size, blur: window.__liveListeners.blur.size }));
    assert.ok(during.keyup <= base.keyup + 1 && during.blur <= base.blur + 1, `listeners piled up: ${JSON.stringify(during)}`);
    await page.keyboard.up('Enter');
    await page.locator('#destination-picker .picker-back').click();
    await page.waitForFunction(() => window.__app.flow.screen === 'closed');
  }
  assert.deepEqual(await page.evaluate(() => ({ keyup: window.__liveListeners.keyup.size, blur: window.__liveListeners.blur.size })), base, 'a listener was left behind');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, screen 1: a held 👍 across the shortcut to screen 3 does not launch; the finger countdown opens the flow and starts nothing', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await confirmedOnScreenOne(page);
  const thumb = { pose: 'fist', thumbsUp: true };
  await feed(page, 800, thumb); // 👍 up on screen 1: nothing
  await page.locator('#picker-entry .picker-journey').click();
  assert.equal((await flowState(page)).screen, 'confirm');
  await feed(page, 1500, thumb); // the same 👍, still up
  assert.equal((await app(page)).mode, 'baseView', 'a 👍 held across the shortcut launched');
  await feed(page, 150, { pose: null });
  await page.locator('#destination-picker .picker-back').click();
  await page.locator('#destination-picker .picker-back').click();
  await page.waitForFunction(() => window.__app.flow.screen === 'closed');
  // The finger countdown 3, 2, 1 on screen 1 (with a confirmation): screen 3 opens; no countdown, no launch.
  for (const n of [3, 2, 1]) await page.evaluate((k) => window.__app.bus.emit({ type: 'countdown', n: k }), n);
  await page.waitForTimeout(300);
  assert.equal((await flowState(page)).screen, 'confirm');
  assert.deepEqual(await app(page), { mode: 'baseView', destination: 'kraken', countdown: false });
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: touch and keyboard use the same actions and states (labels, ←/→ preview, Confirm, Launch)', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="tranquility"]').click();
  await nextFrame(page);
  assert.equal((await flowState(page)).preview, 'tranquility');
  assert.equal((await app(page)).destination, null, 'a tap changed the mission');
  assert.equal(await page.getAttribute('#destination-picker .picker-target[data-base="tranquility"]', 'aria-pressed'), 'true');
  assert.match(await page.textContent('#destination-picker .picker-target[data-base="tranquility"]'), /^✓ /);
  assert.equal(await page.textContent('#destination-picker .picker-sel-label'), 'Selected —');
  // The label just tapped keeps focus, and a focused button keeps its keys (by design); page shortcuts resume once it is blurred.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  const after = (await flowState(page)).preview;
  assert.notEqual(after, 'tranquility');
  assert.equal((await app(page)).destination, null, '→ changed the mission on screen 2');
  await page.waitForFunction((id) => document.querySelector(`#destination-picker .picker-target[data-base="${id}"]`)?.getAttribute('aria-pressed') === 'true', after);
  const confirm = page.locator('#destination-picker .picker-confirm');
  assert.equal(await confirm.textContent(), '👍 Confirm destination');
  await confirm.click();
  await nextFrame(page);
  // Screen 3: the state (one live status), the greeting (plain text), From/To, Launch; focus on Back, not on Launch.
  assert.deepEqual(await flowState(page), { screen: 'confirm', preview: after, confirmed: after });
  assert.equal((await app(page)).destination, after);
  assert.equal(await page.textContent('#destination-picker .picker-confirmed'), '✓ Destination confirmed');
  assert.equal(await page.getAttribute('#destination-picker .picker-confirmed', 'role'), 'status');
  assert.equal(await page.textContent('#destination-picker .picker-led'), 'Thank you for travelling with us.');
  assert.deepEqual(await page.evaluate(() => { const l = document.querySelector('#destination-picker .picker-led'); return [l.getAttribute('role'), l.getAttribute('aria-live'), l.getAttribute('aria-hidden')]; }), [null, null, null]);
  assert.match(await page.textContent('#destination-picker .picker-route'), /^From: Jezero Dome · Mars\nTo: /);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('picker-back')), true, 'focus did not move to Back on screen 3');
  assert.equal(await page.textContent('#destination-picker .picker-back'), '← Change destination');
  // Enter on the focused Back goes back; it never launches.
  await page.keyboard.press('Enter');
  assert.equal((await flowState(page)).screen, 'select');
  assert.equal((await app(page)).mode, 'baseView');
  await confirm.click();
  await page.locator('#destination-picker .picker-confirm', { hasText: 'Launch' }).click();
  assert.equal((await app(page)).mode, 'launch');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, screen 1: one launch flow: the Travel tab, keys, the finger countdown and 👆 dwell open the flow; nothing launches or changes', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
  const untouched = async (why) => {
    assert.deepEqual(await app(page), { mode: 'baseView', destination: null, countdown: false }, why);
    assert.equal(await checkpointDestination(page), null, why);
  };
  const closeFlow = async () => { await page.locator('#destination-picker .picker-back').click(); await page.waitForFunction(() => window.__app.flow.screen === 'closed'); };
  // The Travel tab: a destination opens screen 2 with it as the preview only.
  await page.locator('#base-panel [role="tab"]', { hasText: 'Travel' }).click();
  await page.locator('#base-panel .destinations button', { hasText: 'Kraken Shore' }).click();
  assert.deepEqual(await flowState(page), { screen: 'select', preview: 'kraken', confirmed: null });
  await untouched('a Travel tab destination changed the mission');
  await closeFlow();
  // The Travel tab's button with no destination: "Choose a destination" (it opens screen 2), and nothing else.
  await page.locator('#base-panel [role="tab"]', { hasText: 'Travel' }).click();
  await page.waitForFunction(() => document.querySelector('#base-panel .chip.launch').textContent === '🪐 Choose a destination');
  await page.locator('#base-panel .chip.launch').click();
  assert.equal((await flowState(page)).screen, 'select');
  await untouched('the Travel tab button launched');
  await closeFlow();
  // Keyboard: Enter (launch) and → (next destination) open the same flow.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  assert.equal((await flowState(page)).screen, 'select');
  await untouched('Enter launched');
  await closeFlow();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  assert.equal((await flowState(page)).screen, 'select');
  assert.notEqual((await flowState(page)).preview, null);
  await untouched('→ changed the mission');
  await closeFlow();
  // The finger countdown's "3" and a 👆 dwell on a planet with a base: the flow, not a countdown or a choice.
  for (const intent of [{ type: 'countdown', n: 3 }, { type: 'select', bodyId: 'titan' }]) {
    await page.evaluate((i) => window.__app.bus.emit(i), intent);
    assert.equal((await flowState(page)).screen, 'select', intent.type);
    await untouched(`${intent.type} bypassed the flow`);
    await closeFlow();
  }
  // With a destination that is only saved (not confirmed here: INJECTED as if restored), the Travel tab's Launch opens
  // screen 2 with it as the preview, and launches nothing.
  await page.evaluate(() => { const m = window.__app.mission; m.destination = m.node('conamara'); });
  await page.locator('#base-panel [role="tab"]', { hasText: 'Travel' }).click();
  await page.waitForFunction(() => !document.querySelector('#base-panel .chip.launch').disabled);
  await page.locator('#base-panel .chip.launch').click();
  assert.deepEqual(await flowState(page), { screen: 'select', preview: 'conamara', confirmed: null });
  assert.deepEqual(await app(page), { mode: 'baseView', destination: 'conamara', countdown: false }, 'the Travel tab Launch launched');
  await closeFlow();
  // With a destination confirmed in this session, a launch request on screen 1 opens screen 3, and still does not launch.
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.locator('#destination-picker .picker-confirm').click();
  await page.locator('#destination-picker .picker-back').click();
  await closeFlow();
  await page.locator('#base-panel [role="tab"]', { hasText: 'Travel' }).click();
  await page.locator('#base-panel .chip.launch').click();
  assert.equal((await flowState(page)).screen, 'confirm');
  assert.deepEqual(await app(page), { mode: 'baseView', destination: 'kraken', countdown: false });
  // Back on screen 2 (the mission still has Titan): Enter there does not launch it; only screen 3 can.
  await page.locator('#destination-picker .picker-back').click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  assert.equal((await flowState(page)).screen, 'select');
  assert.equal((await app(page)).mode, 'baseView', 'Enter on screen 2 launched');
  assert.deepEqual(errors, []);
  await context.close();
});

/** The on-screen hit targets (layout positions and radii), rounded. */
const targetsOf = (page) => page.evaluate(() => window.__app.picker.view.currentTargets.map((t) => [t.baseId, Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(t.r * 10) / 10]));

test('flag on, screen 2: pointing, selected and confirming look different; the selected planet is drawn 12% larger; hit targets never move', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d', { width: 390, height: 844 });
  await openFlow(page);
  await page.waitForTimeout(400);
  await settled(page);
  const home = await targetsOf(page);
  const drawn = (id) => page.evaluate((b) => { const it = window.__app.picker.view.items.get(b); return Math.round(it.holder.scale.y * 1e4) / 1e4; }, id);
  const look = (id) => page.evaluate((b) => { const it = window.__app.picker.view.items.get(b); return { state: it.button.dataset.state, halo: '#' + it.haloMaterial.color.getHexString(), opacity: it.haloMaterial.opacity }; }, id);
  const idleScale = await drawn('kraken');
  // Pointing (👆 dwell, not yet chosen).
  await feed(page, 200, { pose: 'point', pointer: await orb(page, 'kraken') });
  const pointing = await look('kraken');
  assert.equal(pointing.state, 'hover');
  assert.deepEqual(await targetsOf(page), home, 'pointing moved a hit target');
  // Selected (a tap): 12% larger, drawn only.
  await feed(page, 100, { pose: null });
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.waitForTimeout(250);
  const selected = await look('kraken');
  assert.equal(selected.state, 'selected');
  assert.ok(Math.abs((await drawn('kraken')) / idleScale - 1.12) < 0.005, 'the selected planet is not drawn 12% larger');
  assert.deepEqual(await targetsOf(page), home, 'selecting moved a hit target');
  // Confirming (👍 held, part way).
  await feed(page, 300, { pose: 'fist', thumbsUp: true });
  const confirming = await look('kraken');
  assert.equal(confirming.state, 'confirming');
  assert.deepEqual(await targetsOf(page), home, 'a 👍 hold moved a hit target');
  // Three different looks, and no success greeting on screen 2.
  assert.equal(new Set([pointing, selected, confirming].map((l) => `${l.state}|${l.halo}|${l.opacity}`)).size, 3);
  assert.equal(await page.evaluate(() => { const l = document.querySelector('#destination-picker .picker-led'); return !!l && !l.hidden && l.getClientRects().length > 0; }), false, 'the LED greeting showed before confirmation');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, screen 2: the compact info card: surface map (described as a texture), base, two facts; same card height before and after a choice', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d', { width: 390, height: 844 });
  await openFlow(page);
  await page.waitForTimeout(400);
  const cardH = () => page.evaluate(() => Math.round(document.querySelector('#destination-picker .picker-card').getBoundingClientRect().height));
  const home = await targetsOf(page), h0 = await cardH();
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker .picker-details').hidden), true, 'Details offered with nothing selected');
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const thumb = document.querySelector('#destination-picker .picker-thumb');
    return { name: document.querySelector('#destination-picker .picker-info-name').textContent, facts: [...document.querySelectorAll('#destination-picker .picker-facts li')].map((l) => l.textContent),
      role: thumb.getAttribute('role'), label: thumb.getAttribute('aria-label'), caption: thumb.textContent };
  });
  assert.equal(info.name, 'Kraken Shore · Titan');
  assert.deepEqual(info.facts, ['Surface gravity 1.354 m/s²', 'Day 15.9 days']);
  assert.equal(info.role, 'img');
  // Titan's map is a USGS mosaic from mission data (the file shown: titan.jpg).
  assert.equal(info.label, 'Titan surface map: a mosaic made from spacecraft data (colours approximate), not a photo of the base');
  assert.equal(info.caption, '');
  assert.equal(await page.textContent('#destination-picker .picker-image-description'), 'Surface illustration · not a photo of the base');
  assert.deepEqual(await page.locator('#destination-picker .picker-thumb').evaluate(e => [e.offsetWidth, e.offsetHeight]), [80, 80]);
  assert.equal(await cardH(), h0, 'the card changed height with a choice');
  assert.deepEqual(await targetsOf(page), home, 'the info card moved a hit target');
  assert.equal(await page.getAttribute('#destination-picker .picker-details', 'aria-expanded'), 'false');
  // The Moon's map (moon.jpg, Solar System Scope): described neutrally, not as spacecraft data. (At Jezero, Mars is
  // the base itself, not a destination.)
  await page.locator('#destination-picker .picker-target[data-base="tranquility"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.getAttribute('#destination-picker .picker-thumb', 'aria-label'), 'Moon surface illustration, not a photo of the base');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, Details dialog: modal (background inert), focus in and back, Escape / Close; 👆 / 👍 paused, fresh input after; choice and mission untouched', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d', { width: 390, height: 844 });
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.waitForTimeout(300);
  const home = await targetsOf(page);
  const thumb = { pose: 'fist', thumbsUp: true };
  // A 👍 hold part way (after a frame with no 👍: opening the flow owes a release first), then Details opens (a tap):
  // the hold is cancelled.
  await feed(page, 100, { pose: null });
  await feed(page, 300, thumb);
  assert.ok(await page.evaluate(() => window.__app.picker.logic.confirmProgress) > 0.4);
  await page.locator('#destination-picker .picker-details').click();
  const open1 = await page.evaluate(() => {
    const s = document.querySelector('#destination-picker .picker-sheet');
    return { shown: !s.hidden, role: s.getAttribute('role'), modal: s.getAttribute('aria-modal'), focus: s.contains(document.activeElement) && document.activeElement.classList.contains('picker-sheet-close'),
      see: s.querySelector('.picker-see').textContent, inert: ['.picker-confirm', '.picker-all', '.picker-back', '.picker-details', '.picker-target[data-base="kraken"]'].every((q) => !!document.querySelector(`#destination-picker ${q}`).closest('[inert]')),
      expanded: document.querySelector('#destination-picker .picker-details').getAttribute('aria-expanded'), progress: window.__app.picker.logic.confirmProgress };
  });
  assert.deepEqual({ ...open1, see: open1.see.slice(0, 16) }, { shown: true, role: 'dialog', modal: 'true', focus: true, see: "What you’ll seeO", inert: true, expanded: 'true', progress: 0 });
  assert.deepEqual(await targetsOf(page), home, 'opening Details moved a hit target');
  // Tab stays in the dialog.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker .picker-sheet').contains(document.activeElement)), true, 'Tab left the dialog');
  // While open: 👍 held long, 👆 on another planet: nothing; the mission's clock runs on (only input pauses).
  const t0 = await page.evaluate(() => window.__app.clock.time);
  await feed(page, 1200, thumb);
  await feed(page, 100, { pose: null });
  await feed(page, 900, { pose: 'point', pointer: await orb(page, 'tranquility') });
  assert.deepEqual(await flowState(page), { screen: 'select', preview: 'kraken', confirmed: null });
  assert.equal(await page.evaluate(() => window.__app.clock.paused), false);
  await page.waitForTimeout(300);
  assert.notEqual(await page.evaluate(() => window.__app.clock.time), t0, 'the mission clock stopped');
  // Escape closes it; focus back on Details; nothing changed.
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker .picker-sheet').hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('picker-details')), true, 'focus did not return to Details');
  assert.equal(await page.evaluate(() => !!document.querySelector('#destination-picker .picker-confirm').closest('[inert]')), false, 'the card stayed inert');
  assert.deepEqual(await flowState(page), { screen: 'select', preview: 'kraken', confirmed: null }, 'Escape closed the screen or changed the choice');
  // After closing: the hit targets are where they were, and the mission (destination, checkpoint, mode) is untouched.
  assert.deepEqual(await targetsOf(page), home, 'the dialog moved a hit target');
  assert.deepEqual(await app(page), { mode: 'baseView', destination: null, countdown: false });
  assert.equal(await checkpointDestination(page), null);
  // A 👍 held across closing does not confirm; released, then a fresh full hold does.
  await feed(page, 300, thumb);
  await page.locator('#destination-picker .picker-details').click();
  await page.locator('#destination-picker .picker-sheet-close').click();
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('picker-details')), true);
  await feed(page, 1500, thumb);
  assert.equal((await flowState(page)).screen, 'select', 'a 👍 held across the dialog confirmed');
  await feed(page, 150, { pose: null });
  await feed(page, 700, thumb);
  assert.deepEqual(await flowState(page), { screen: 'confirm', preview: 'kraken', confirmed: 'kraken' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: the Travel tab\'s button says what it does (choose / view journey); only screen 3 says Launch; flag off unchanged', async () => {
  const off = await open('/?base=jezero&lang=en');
  await off.page.locator('#base-panel [role="tab"]', { hasText: 'Travel' }).click();
  assert.deepEqual(await off.page.evaluate(() => { const b = document.querySelector('#base-panel .chip.launch'); return [b.textContent, b.disabled]; }), ['🚀 Launch', true]);
  await off.context.close();
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
  await page.locator('#base-panel [role="tab"]', { hasText: 'Travel' }).click();
  const button = () => page.evaluate(() => { const b = document.querySelector('#base-panel .chip.launch'); return [b.textContent, b.disabled]; });
  await page.waitForFunction(() => document.querySelector('#base-panel .chip.launch').textContent === '🪐 Choose a destination');
  assert.deepEqual(await button(), ['🪐 Choose a destination', false]);
  await page.locator('#base-panel .chip.launch').click();
  assert.equal((await flowState(page)).screen, 'select');
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await nextFrame(page);
  await page.locator('#destination-picker .picker-confirm').click();
  await nextFrame(page);
  assert.match(await page.textContent('#destination-picker .picker-confirm'), /Launch/);
  await page.locator('#destination-picker .picker-back').click();
  await page.locator('#destination-picker .picker-back').click();
  await page.waitForFunction(() => window.__app.flow.screen === 'closed');
  await page.locator('#base-panel [role="tab"]', { hasText: 'Travel' }).click();
  await page.waitForFunction(() => document.querySelector('#base-panel .chip.launch').textContent === '🧭 View journey');
  await page.locator('#base-panel .chip.launch').click();
  assert.equal((await flowState(page)).screen, 'confirm');
  assert.equal((await app(page)).mode, 'baseView');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: where the flow cannot open (horizon view, Build, the cinematic) no launch or destination request gets past it', async () => {
  const requests = [{ type: 'launch' }, { type: 'select' }, { type: 'countdown', n: 3 }, { type: 'chooseDestination', baseId: 'kraken' }, { type: 'next' }, { type: 'select', bodyId: 'titan' }];
  const tryAll = (page) => page.evaluate((rs) => { for (const r of rs) window.__app.bus.emit(r); }, requests);
  // The horizon view (still the base view): nothing launches, no destination is set, it stays on the ground.
  {
    const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
    await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await page.waitForFunction(() => !!window.__app.mission.horizon);
    await tryAll(page);
    await page.waitForTimeout(800);
    assert.deepEqual(await app(page), { mode: 'baseView', destination: null, countdown: false }, 'horizon view');
    assert.equal(await page.evaluate(() => !!window.__app.mission.horizon), true);
    assert.equal(await checkpointDestination(page), null);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Build mode: launch and destination intents are not Build's (its ← → and Enter are the palette's).
  {
    const { context, page, errors } = await open('/?base=jezero&lang=en&flags=build,picker3d');
    await page.waitForFunction(() => window.__app.picker && window.__app.modes.mode === 'baseView');
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleBuild' }));
    await page.waitForFunction(() => window.__app.modes.mode === 'build');
    await tryAll(page);
    await page.waitForTimeout(800);
    assert.deepEqual(await app(page), { mode: 'build', destination: null, countdown: false }, 'build');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // The cinematic (its fly-over playing; it needs motion on): a launch request does not get through to the mission.
  {
    const { context, page, errors } = await open('/?base=jezero&lang=en&flags=cinematic,picker3d', undefined, 'no-preference');
    await page.waitForFunction(() => window.__app.picker && !document.querySelector('#cinematic-panel').hidden);
    await page.evaluate(() => { document.querySelector('#cinematic-panel').open = true; });
    await page.locator('#cinematic-panel [data-action="flyover"]').click();
    await page.waitForFunction(() => window.__app.cinematic.active);
    // A saved destination (INJECTED, not confirmed here; let the checkpoint record it): a launch request during the
    // cinematic is blocked: it does not launch, does not change the destination or the checkpoint, and does not
    // cancel the cinematic by accident (it keeps playing).
    await page.evaluate(() => { const m = window.__app.mission; m.destination = m.node('conamara'); });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gse.mission.v1') || 'null')?.destinationId === 'conamara', null, { timeout: 15000 });
    const before = await checkpointDestination(page);
    for (const r of [{ type: 'launch' }, { type: 'select' }, { type: 'countdown', n: 3 }, { type: 'chooseDestination', baseId: 'kraken' }]) {
      await page.evaluate((x) => window.__app.bus.emit(x), r);
      await page.waitForTimeout(300);
      assert.deepEqual(await app(page), { mode: 'baseView', destination: 'conamara', countdown: false }, `cinematic ${r.type}`);
      assert.equal(await page.evaluate(() => window.__app.cinematic.active), true, `${r.type} cancelled the cinematic`);
      assert.equal(await checkpointDestination(page), before, `${r.type} changed the checkpoint`);
    }
    assert.equal((await flowState(page)).screen, 'closed');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // The horizon view with a saved destination: Enter / Launch / the countdown do not launch it.
  {
    const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
    await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
    await page.evaluate(() => { const m = window.__app.mission; m.destination = m.node('conamara'); });
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await page.waitForFunction(() => !!window.__app.mission.horizon);
    for (const r of [{ type: 'launch' }, { type: 'select' }, { type: 'countdown', n: 3 }]) {
      await page.evaluate((x) => window.__app.bus.emit(x), r);
      await page.waitForTimeout(300);
      assert.deepEqual(await app(page), { mode: 'baseView', destination: 'conamara', countdown: false }, `horizon ${r.type}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('countdown cancellation before the next render returns to View journey', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  try {
    await confirmedOnScreenOne(page);
    for (const input of ['button', 'keyboard']) {
      await page.locator('#picker-entry .picker-journey').click();
      await page.locator('.picker-card[data-screen="confirm"] .picker-confirm').waitFor();
      const result = await page.evaluate((input) => {
        const a = window.__app;
        if (input === 'button') document.querySelector('.picker-confirm').click();
        else a.bus.emit({ type: 'select' });
        const started = !!a.mission.countdown;
        const closedBeforeCancel = a.flow.screen === 'closed';
        a.bus.emit({ type: 'dismiss' });
        return { started, closedBeforeCancel, mode: a.modes.mode, confirmed: a.flow.confirmed };
      }, input);
      assert.deepEqual(result, { started: true, closedBeforeCancel: true, mode: 'baseView', confirmed: 'kraken' }, input);
      await page.locator('#picker-entry .picker-journey').waitFor({ state: 'visible' });
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('flag on: a countdown actually cancelled keeps the confirmation (same base and destination); launching again needs a new input', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await confirmedOnScreenOne(page);
  // Enter opens screen 3; released; a new Enter launches.
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__app.modes.mode === 'launch' && !!window.__app.mission.countdown);
  // Cancelled (Escape): back on screen 1 with the same base and destination; the confirmation (shortcut) stays.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && !window.__app.mission.countdown);
  await page.locator('#picker-entry .picker-journey').waitFor({ state: 'visible' });
  assert.deepEqual(await app(page), { mode: 'baseView', destination: 'kraken', countdown: false });
  assert.equal(await page.evaluate(() => window.__app.flow.confirmedFor({ baseId: 'jezero', destinationId: 'kraken', mode: 'baseView', blocked: false })), 'kraken');
  // Nothing relaunches by itself; a held Enter opens screen 3 only (its repeats don't launch); a new press launches.
  await page.waitForTimeout(1200);
  assert.equal((await app(page)).mode, 'baseView', 'relaunched by itself');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('Enter');
  for (let i = 0; i < 6; i++) await page.keyboard.down('Enter');
  await page.waitForTimeout(300);
  assert.equal((await flowState(page)).screen, 'confirm');
  assert.equal((await app(page)).mode, 'baseView', 'a held Enter relaunched after the cancel');
  await page.keyboard.up('Enter');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  assert.equal((await app(page)).mode, 'launch');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: a Confirm the mission refuses stays on screen 2: no confirmed status, no greeting, no screen 3 or shortcut', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  // The mission declines every choice (INJECTED: its own choose() made a no-op), as a refusal would.
  await page.evaluate(() => { window.__app.mission.choose = () => {}; });
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.locator('#destination-picker .picker-confirm').click();
  assert.deepEqual(await flowState(page), { screen: 'select', preview: 'kraken', confirmed: null });
  assert.equal((await app(page)).destination, null);
  assert.equal(await checkpointDestination(page), null);
  await page.waitForFunction(() => /can’t be confirmed/.test(document.querySelector('#destination-picker .picker-state').textContent));
  assert.deepEqual(await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0 && e.textContent.trim() !== ''; };
    return { chip: vis('#destination-picker .picker-confirmed'), led: vis('#destination-picker .picker-led'), route: vis('#destination-picker .picker-route') };
  }), { chip: false, led: false, route: false });
  await page.locator('#destination-picker .picker-back').click();
  await page.waitForFunction(() => !document.querySelector('#picker-entry').hidden);
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry .picker-journey').hidden), true);
  assert.equal((await app(page)).mode, 'baseView');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: Back, the screen 1 shortcut and a saved destination: what each changes', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  // Screen 2 → Back: the preview is discarded, the mission and its checkpoint are unchanged.
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.locator('#destination-picker .picker-back').click();
  assert.deepEqual(await flowState(page), { screen: 'closed', preview: null, confirmed: null });
  assert.equal((await app(page)).destination, null);
  assert.equal(await checkpointDestination(page), null);
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry .picker-journey').hidden && document.querySelector('#picker-entry .picker-saved').hidden), true);
  // Confirm Titan, then Back twice: screen 2 keeps it as the preview; screen 1 offers the shortcut.
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.locator('#destination-picker .picker-confirm').click();
  await page.locator('#destination-picker .picker-back').click();
  assert.deepEqual(await flowState(page), { screen: 'select', preview: 'kraken', confirmed: 'kraken' });
  await page.locator('#destination-picker .picker-back').click();
  assert.equal((await flowState(page)).screen, 'closed');
  assert.equal((await app(page)).destination, 'kraken');
  await page.waitForFunction(() => !document.querySelector('#picker-entry .picker-journey').hidden);
  assert.equal(await page.textContent('#picker-entry .picker-journey'), 'View journey — Kraken Shore · Titan');
  // The shortcut opens screen 3 and launches nothing.
  await page.locator('#picker-entry .picker-journey').click();
  assert.equal((await flowState(page)).screen, 'confirm');
  assert.equal((await app(page)).mode, 'baseView');
  await page.locator('#destination-picker .picker-back').click();
  await page.locator('#destination-picker .picker-back').click();
  // Another destination by another route (INJECTED: every UI route now goes through the flow, so the mission's
  // destination is changed directly): the confirmation is gone for good; it is only "saved".
  await page.evaluate(() => { const m = window.__app.mission; m.destination = m.node('conamara'); });
  await page.waitForFunction(() => document.querySelector('#picker-entry .picker-journey').hidden && !document.querySelector('#picker-entry .picker-saved').hidden);
  assert.match(await page.textContent('#picker-entry .picker-saved'), /^Saved destination — .*Confirm this destination again before launch\.$/);
  await page.evaluate(() => { const m = window.__app.mission; m.destination = m.node('kraken'); }); // back to Titan: the old confirmation does not come back
  await page.waitForTimeout(300);
  assert.equal((await app(page)).destination, 'kraken');
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry .picker-journey').hidden), true);
  assert.equal(await page.evaluate(() => window.__app.flow.showJourney({ baseId: 'jezero', destinationId: 'kraken', mode: 'baseView', blocked: false })), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: after a reload a saved destination is only "saved"; Start fresh leaves nothing to resume', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.locator('#destination-picker .picker-confirm').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('gse.mission.v1') || 'null')?.destinationId === 'kraken');
  // Reload, continue the saved mission: the destination is back, but not as confirmed.
  await page.goto(url + '/?base=jezero&lang=en&flags=picker3d');
  await page.waitForFunction(() => window.__app?.trackingFrame && document.querySelector('#resume-mission'));
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry')?.hidden ?? true), true, 'the way in showed beside the offer');
  await page.locator('#resume-mission-continue').click();
  await page.waitForFunction(() => window.__app.mission.destination?.base.id === 'kraken' && !document.querySelector('#picker-entry .picker-saved').hidden);
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry .picker-journey').hidden), true);
  // Screen 2 opens with it as the preview, to be confirmed again.
  await page.locator('#picker-open').click();
  await shown(page);
  assert.deepEqual(await flowState(page), { screen: 'select', preview: 'kraken', confirmed: null });
  // Reload again and choose Start fresh: no destination, nothing saved, no shortcut.
  await page.goto(url + '/?base=jezero&lang=en&flags=picker3d');
  await page.waitForFunction(() => window.__app?.trackingFrame && document.querySelector('#resume-mission'));
  await page.locator('#resume-mission-discard').click();
  await page.waitForFunction(() => !document.querySelector('#picker-entry').hidden);
  assert.equal((await app(page)).destination, null);
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry .picker-journey').hidden && document.querySelector('#picker-entry .picker-saved').hidden), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: screens 2–3 own the screen: hiding the time pill does not pause time; Pause stays in Settings; all comes back', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d', { width: 390, height: 844 });
  const shownEl = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
  await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
  const before = { title: await shownEl('header.hud.top h1'), time: await shownEl('#timebar'), status: await shownEl('#status') };
  await openFlow(page);
  assert.equal(await shownEl('header.hud.top h1'), false);
  assert.equal(await shownEl('#timebar'), false);
  assert.equal(await shownEl('#status'), true, 'the camera / hand status is gone on screen 2');
  // Time runs on while its pill is hidden.
  const t0 = await page.evaluate(() => window.__app.clock.time);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__app.clock.paused), false);
  assert.ok((await page.evaluate(() => window.__app.clock.time)) !== t0, 'time stopped with its pill hidden');
  // Settings → Pause / Resume.
  await page.locator('#menu').click();
  await page.locator('#menu-pause').click();
  assert.equal(await page.evaluate(() => window.__app.clock.paused), true);
  await page.waitForFunction(() => document.querySelector('#menu-pause').textContent === '▶ Resume');
  await page.locator('#menu-pause').click();
  assert.equal(await page.evaluate(() => window.__app.clock.paused), false);
  await page.keyboard.press('Escape'); // closes the menu, not the flow
  assert.equal((await flowState(page)).screen, 'select');
  // Footer buttons stay, compact, with their full names.
  const dock = await page.evaluate(() => [...document.querySelectorAll('.footer-links > button')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), name: b.textContent.trim().length > 2 }; }));
  for (const d of dock) { assert.ok(d.w >= 44 && d.h >= 44, `dock button ${d.w}x${d.h}`); assert.ok(d.name); }
  await page.locator('#destination-picker .picker-back').click();
  await nextFrame(page);
  assert.deepEqual({ title: await shownEl('header.hud.top h1'), time: await shownEl('#timebar'), status: await shownEl('#status') }, before);
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, pending saved-mission offer: the picker steps aside and nothing can select or confirm', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=picker3d');
  // A saved journey that needs the offer: Cape with a destination confirmed (an idle Cape alone is not offered).
  await openFlow(page);
  await page.locator('#destination-picker .picker-target[data-base="kraken"]').click();
  await page.locator('#destination-picker .picker-confirm').click();
  await page.waitForFunction(() => window.__app.flow.screen === 'confirm');
  await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('gse.mission.v1') || 'null'); return s?.baseId === 'cape' && s.destinationId === 'kraken'; });
  const savedBefore = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gse.mission.v1')); return { phase: s.phase, baseId: s.baseId, destinationId: s.destinationId }; });
  await page.goto(url + '/?base=cape&lang=en&flags=picker3d');
  await page.waitForFunction(() => window.__app?.trackingFrame && document.querySelector('#resume-mission'));
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker')?.hidden ?? true), true);
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry')?.hidden ?? true), true);
  assert.equal(await page.evaluate(() => window.__app.picker?.view.currentTargets.length ?? 0), 0);
  // Nothing can open the flow while the offer is pending.
  assert.equal(await page.evaluate(() => { window.__app.picker?.view.entry.click(); return window.__app.flow.screen; }), 'closed');
  assert.deepEqual(await feed(page, 800, { pose: 'point', pointer: { x: 0.3, y: 0.4 } }), []);
  assert.deepEqual(await feed(page, 800, { pose: 'fist', thumbsUp: true }), []);
  assert.deepEqual(await app(page), { mode: 'baseView', destination: null, countdown: false });
  // The saved journey is untouched by all of that.
  assert.deepEqual(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gse.mission.v1')); return { phase: s.phase, baseId: s.baseId, destinationId: s.destinationId }; }), savedBefore);
  await page.locator('#resume-mission-continue').click();
  await page.waitForFunction(() => window.__app.mission.destination?.base.id === 'kraken');
  await openFlow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, Guided destination step: 👆 and the labels use Guided\'s own choice; ✋ does not; Guided\'s 👍 still confirms', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=astrolife,guided,picker3d');
  await toDestinationStep(page);
  await shown(page);
  // Option A: Guided keeps its own flow; the free-mode way in and screens are not offered here.
  assert.equal(await page.evaluate(() => document.querySelector('#picker-entry').hidden), true);
  assert.equal(await page.evaluate(() => window.__app.flow.screen), 'closed');
  assert.equal(await page.evaluate(() => document.body.classList.contains('destination-flow')), false);
  assert.equal(await page.evaluate(() => document.querySelector('#base-panel').hidden), true, 'the base sheet is not hidden in the picker\'s Guided step');
  // One way to choose and one Confirm: Guided keeps its step and time, its own list and button step aside.
  assert.deepEqual(await page.evaluate(() => { const g = window.__app.guided; return { list: g.destinations.hidden, action: g.action.hidden, step: g.step.hidden, timer: g.timer.hidden }; }), { list: true, action: true, step: false, timer: false });
  assert.equal(await page.locator('button:visible', { hasText: /Confirm/ }).count(), 1);
  // A step change latches Guided's 👍 release, but with no hand seen the card must not ask to release one.
  assert.equal(await page.evaluate(() => window.__app.guided.holdWaitingRelease), false);
  assert.doesNotMatch(await page.textContent('#destination-picker .picker-state'), /Release/);
  await page.locator('#destination-picker .picker-target[data-base="jezero"]').click();
  assert.equal(await page.evaluate(() => window.__app.guided.session.destination), 'jezero');
  assert.equal((await app(page)).destination, null, 'the picker bypassed Guided and chose on the mission');
  await page.evaluate(() => { for (let t = 0; t < 5; t++) window.__app.guided.observe(300000 + t * 50, { pose: 'palm', thumbsUp: false, center: { x: 0.05, y: 0.5 } }); });
  assert.equal(await page.evaluate(() => window.__app.guided.session.destination), 'jezero', '✋ selected under the picker');
  await feed(page, 600, { pose: 'point', pointer: await orb(page, 'kraken') });
  assert.equal(await page.evaluate(() => window.__app.guided.session.destination), 'kraken');
  // Guided's own 👍 hold (HoldConfirm, through the same tracking frames) confirms and launches.
  await feed(page, 100, { pose: null });
  await feed(page, 700, { pose: 'fist', thumbsUp: true });
  await page.waitForFunction(() => window.__app.modes.mode === 'launch');
  assert.equal(await page.evaluate(() => window.__app.guided.session.stage), 'outbound');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, outside the picker (planet focus, not a base view): 👆 dwell-select, ✋ rotate and the rest work as before', async () => {
  const { context, page, errors } = await open('/?body=earth&lang=en&flags=picker3d');
  await page.waitForFunction(() => window.__app.picker && ['focus', 'solarView'].includes(window.__app.modes.mode));
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker').hidden), true);
  for (const i of [{ type: 'rotate', dx: 0.1, dy: 0 }, { type: 'select', bodyId: 'moon' }, { type: 'next' }, { type: 'togglePause' }]) assert.equal(await page.evaluate((x) => window.__app.trackingDeps.keep(x), i), true, i.type);
  // The engine's 👆 dwell-select still reaches the app: selecting a body opens it as before.
  await page.evaluate(() => window.__app.bus.emit({ type: 'select', bodyId: 'mars' }));
  await page.waitForFunction(() => window.__app.state.selected?.id === 'mars');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: disposing the view removes its own objects only; the planets\' geometry, materials and textures are untouched', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const a = window.__app, calls = [];
    const shared = [...a.picker.view.items.values()].map((it) => it.node.mesh);
    // The orbs draw the planets' own geometry and colour maps: spy on every shared resource's dispose().
    const spy = (o, name) => { if (!o) return; const d = o.dispose.bind(o); o.dispose = () => { calls.push(name); d(); }; };
    for (const m of shared) { spy(m.geometry, 'geometry'); spy(m.material, 'material'); spy(m.material.map, 'map'); }
    const sharedGeometry = [...a.picker.view.items.values()].every((it) => it.orb.geometry === it.node.mesh.geometry);
    const ownMaterial = [...a.picker.view.items.values()].every((it) => it.material !== it.node.mesh.material);
    a.picker.view.dispose();
    return { sharedGeometry, ownMaterial, calls, group: a.system.scene.children.some((c) => c.name === 'destination-picker'), root: !!document.querySelector('#destination-picker'), entry: !!document.querySelector('#picker-entry'), maps: shared.every((m) => !!m.material.map) };
  });
  assert.deepEqual(r, { sharedGeometry: true, ownMaterial: true, calls: [], group: false, root: false, entry: false, maps: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: "All destinations" is collapsed by default; it opens and closes with focus moved in and back; a choice there closes it', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  const toggle = page.locator('#destination-picker .picker-all');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle.getAttribute('aria-controls'), 'picker-list');
  assert.equal(await page.locator('#picker-list').isHidden(), true);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#picker-list').isVisible(), true);
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#picker-list')), true, 'focus did not move into the list');
  // The orbs step aside while the list is open (one way to choose at a time).
  assert.equal(await page.evaluate(() => window.__app.picker.view.currentTargets.length), 0);
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('picker-all')), true, 'focus did not return to the toggle');
  assert.equal((await app(page)).mode, 'baseView', 'Escape in the list reached the page');
  assert.equal((await flowState(page)).screen, 'select', 'Escape in the list closed the screen');
  await toggle.click();
  await page.locator('#picker-list button', { hasText: 'Titan' }).click();
  assert.equal((await flowState(page)).preview, 'kraken');
  assert.equal((await app(page)).destination, null, 'a list choice changed the mission');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('picker-all')), true);
  await shown(page);
  await nextFrame(page);
  assert.equal(await page.getAttribute('#destination-picker .picker-target[data-base="kraken"]', 'aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, Tanegashima ground view: the picker opens from it and Back returns, with no stamp, entry, selection or launch', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=my&flags=picker3d', { width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#enter-spaceport')?.click());
  await page.waitForFunction(() => window.__app.localSpaceport.active, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#picker-open').hidden);
  await page.waitForTimeout(1500); // the arrival stamp and checkpoint settle first
  // The way in sits with the page's HTML controls: the scene's vehicle marker does not cover it (whole rectangles, not
  // a centre hit test), and moving the ground camera does not move it.
  const entryBox = () => page.evaluate(() => { const r = document.querySelector('#picker-open').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); });
  const overlap = () => page.evaluate(() => {
    const b = document.querySelector('#picker-open').getBoundingClientRect(), v = document.querySelector('.active-vehicle-label');
    if (!v || v.hidden || !v.getClientRects().length || getComputedStyle(v).visibility === 'hidden') return 0;
    const r = v.getBoundingClientRect();
    return Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left)) * Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
  });
  assert.equal(await overlap(), 0, 'the vehicle marker covers the way in');
  const placed = await entryBox();
  await page.evaluate(() => { const c = window.__app.localSpaceport.camera; c.position.multiplyScalar(1.4); c.updateMatrixWorld(); });
  await page.waitForTimeout(1200);
  assert.deepEqual(await entryBox(), placed, 'the way in moved with the 3D scene');
  // Whatever the planet labels were before the picker (the ground view hides them itself) is what Back restores.
  const labelsBefore = await page.evaluate(() => getComputedStyle(document.querySelector('#labels')).visibility);
  assert.equal(await page.evaluate(() => document.body.classList.contains('picker-active')), false);
  const snap = () => page.evaluate(() => {
    const a = window.__app, cp = JSON.parse(localStorage.getItem('gse.mission.v1') || 'null');
    return { passport: localStorage.getItem('gse.passport'), levels: localStorage.getItem('gse.baseLevels'), base: a.mission.base?.base.id ?? null, destination: a.mission.destination?.base.id ?? null, mode: a.modes.mode, cp: cp && { baseId: cp.baseId, destinationId: cp.destinationId ?? null, view: cp.view } };
  });
  const before = await snap();
  assert.equal(before.cp?.view, 'spaceport');
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  await page.locator('#picker-open').click();
  await shown(page);
  assert.equal(await page.evaluate(() => window.__app.localSpaceport.active), false);
  assert.equal(await page.locator('#destination-picker .picker-back').isVisible(), true);
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#destination-picker')), true, 'focus was left behind on the page');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#labels')).visibility), 'hidden', 'planet labels over the picker');
  assert.match(await page.textContent('#destination-picker .picker-all'), /^နေရာအားလုံး \(၄\)/);
  assert.match(await page.textContent('#destination-picker .picker-back'), /အာကာသဆိပ်ကမ်းသို့ ပြန်ရန်/);
  assert.equal(await page.locator('#destination-picker .picker-target[aria-pressed="true"]').count(), 0, 'something was pre-selected');
  await page.waitForTimeout(1200);
  assert.deepEqual(await snap(), before, 'opening the picker changed mission state or storage');
  assert.equal(await page.evaluate(() => document.querySelectorAll('canvas').length), canvases, 'a renderer was added');
  await page.locator('#destination-picker .picker-back').click();
  await page.waitForFunction(() => window.__app.localSpaceport.active);
  await page.waitForTimeout(1200);
  assert.deepEqual(await snap(), before, 'Back changed mission state or storage');
  assert.equal(await page.evaluate(() => document.querySelector('#destination-picker').hidden), true);
  assert.equal(await page.locator('#picker-open').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'picker-open', 'focus was not returned to the way in');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#labels')).visibility), labelsBefore, 'planet labels not restored');
  assert.equal(await page.evaluate(() => document.body.classList.contains('picker-active')), false);
  assert.deepEqual(await entryBox(), placed);
  assert.deepEqual(errors, []);
  await context.close();
});

/** In the page: the ground camera panned (camera and target together) until the vehicle marker's anchor sits on (x, y) px. */
const panVehicleTo = (page, x, y) => page.evaluate(({ x, y }) => {
  const a = window.__app, cam = a.localSpaceport.camera, controls = a.localSpaceport.scene.controls;
  const rocket = a.localSpaceport.vehicleObject.getWorldPosition(cam.position.clone());
  const want = { x: (x / innerWidth) * 2 - 1, y: 1 - (y / innerHeight) * 2 };
  for (let i = 0; i < 25; i++) {
    cam.updateMatrixWorld();
    const p = rocket.clone().project(cam), d = cam.position.distanceTo(rocket), t = Math.tan((cam.fov * Math.PI) / 360) * d;
    const right = cam.position.clone().setFromMatrixColumn(cam.matrixWorld, 0), up = cam.position.clone().setFromMatrixColumn(cam.matrixWorld, 1);
    const shift = right.multiplyScalar(-(want.x - p.x) * t * cam.aspect).add(up.multiplyScalar(-(want.y - p.y) * t));
    cam.position.add(shift); controls.target.add(shift);
  }
  controls.update();
}, { x, y });
/** In the page: the ground camera orbited around its target (azimuth/polar in degrees, distance factor). */
const orbit = (page, az, polar, k) => page.evaluate(({ az, polar, k }) => {
  const a = window.__app, cam = a.localSpaceport.camera, controls = a.localSpaceport.scene.controls;
  const off = cam.position.clone().sub(controls.target), r = off.length() * k;
  const th = (az * Math.PI) / 180, ph = (polar * Math.PI) / 180;
  cam.position.set(controls.target.x + r * Math.sin(ph) * Math.sin(th), controls.target.y + r * Math.cos(ph), controls.target.z + r * Math.sin(ph) * Math.cos(th));
  cam.lookAt(controls.target); controls.update();
}, { az, polar, k });
/** The marker and the way in: is the marker on screen and drawn, does its box enter the 12 px zone, where is the button. */
const markerState = (page) => page.evaluate(() => {
  const v = document.querySelector('.active-vehicle-label'), b = document.querySelector('#picker-open');
  const e = b && !b.hidden ? b.getBoundingClientRect() : null;
  const placed = v && !v.hidden && v.getClientRects().length > 0;
  const r = placed ? v.getBoundingClientRect() : null;
  const enters = !!(r && e && r.left < e.right + 12 && r.right > e.left - 12 && r.top < e.bottom + 12 && r.bottom > e.top - 12);
  return { placed, drawn: placed && getComputedStyle(v).visibility !== 'hidden', yielded: !!v && 'yield' in v.dataset, enters, button: e && [e.left, e.top, e.right, e.bottom].map(Math.round) };
});

test('flag on, ground view: the vehicle marker yields to the way in at any camera position; the button never moves', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=my&flags=picker3d', { width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#enter-spaceport')?.click());
  await page.waitForFunction(() => window.__app.localSpaceport.active && window.__app.localSpaceport.vehicleObject, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#picker-open').hidden);
  await page.waitForTimeout(1000);
  const home = (await markerState(page)).button;
  // Forced: the marker panned onto the button. It must yield, not be drawn over it.
  const c = await page.evaluate(() => { const r = document.querySelector('#picker-open').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 - 24 }; });
  await panVehicleTo(page, c.x, c.y);
  await page.waitForTimeout(300);
  let s = await markerState(page);
  assert.deepEqual({ placed: s.placed, enters: s.enters, yielded: s.yielded, drawn: s.drawn }, { placed: true, enters: true, yielded: true, drawn: false });
  assert.deepEqual(s.button, home, 'the button moved');
  // Panned well clear: it comes back.
  await panVehicleTo(page, 300, 200);
  await page.waitForTimeout(300);
  s = await markerState(page);
  assert.deepEqual({ placed: s.placed, enters: s.enters, yielded: s.yielded, drawn: s.drawn }, { placed: true, enters: false, yielded: false, drawn: true });
  // An orbit sweep: never drawn inside the zone, the button never moves.
  let yields = 0, shown = 0;
  for (const k of [0.6, 1, 1.6]) for (const polar of [35, 60, 80]) for (let az = 0; az < 360; az += 30) {
    await orbit(page, az, polar, k);
    await page.waitForTimeout(60);
    s = await markerState(page);
    assert.equal(s.drawn && s.enters, false, `drawn over the way in at az ${az} polar ${polar} k ${k}`);
    assert.deepEqual(s.button, home, `the button moved at az ${az} polar ${polar} k ${k}`);
    if (s.yielded) yields++; if (s.drawn) shown++;
  }
  assert.ok(shown > 0, 'the marker was never shown in the sweep');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, screen 1 on the globe: the Japan marker (a scene control) yields to the way in as the globe turns; the way in never moves', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=picker3d', { width: 844, height: 390 });
  await page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
  await page.waitForTimeout(800);
  const state = () => page.evaluate(() => {
    const m = document.querySelector('#japan-site-marker'), e = document.querySelector('#picker-entry').getBoundingClientRect();
    const r = m.getBoundingClientRect(), drawn = !m.hidden && m.getClientRects().length > 0;
    const enters = r.left < e.right + 12 && r.right > e.left - 12 && r.top < e.bottom + 12 && r.bottom > e.top - 12;
    return { drawn, enters, entry: [e.left, e.top, e.right, e.bottom].map(Math.round) };
  });
  const home = (await state()).entry;
  let shown = 0;
  for (let i = 0; i < 36; i++) {
    await page.evaluate((k) => { window.__app.bus.emit({ type: 'rotate', dx: 0.18, dy: k % 2 ? 0.04 : -0.04 }); }, i);
    await page.waitForTimeout(80);
    const s = await state();
    assert.equal(s.drawn && s.enters, false, `the Japan marker drawn over the way in at step ${i}`);
    assert.deepEqual(s.entry, home, `the way in moved at step ${i}`);
    if (s.drawn) shown++;
  }
  assert.ok(shown > 0, 'the Japan marker was never shown in the sweep');
  // Forced (the sweep alone may never cross): the app's own marker logic with the marker projected onto a kept-clear zone.
  const forced = await page.evaluate(async () => {
    const { JapanViewControls } = await import('/src/ui/japanViewControls.ts');
    const a = window.__app, cam = a.rig.camera;
    const c = new JapanViewControls(() => {}, () => {}, () => {});
    const base = new a.system.scene.constructor(); // an Object3D, at the screen centre in front of the camera
    cam.updateMatrixWorld();
    base.position.copy(cam.position).addScaledVector(cam.getWorldDirection(cam.position.clone()), 10);
    base.updateMatrixWorld();
    const cx = innerWidth / 2, cy = innerHeight / 2;
    c.update(base, cam, true, null); const free = !c.marker.hidden;
    c.update(base, cam, true, { left: cx - 120, top: cy - 40, right: cx + 120, bottom: cy + 40 }); const yielded = c.marker.hidden;
    c.update(base, cam, true, { left: 0, top: 0, right: 40, bottom: 20 }); const back = !c.marker.hidden;
    c.dispose();
    return { free, yielded, back };
  });
  assert.deepEqual(forced, { free: true, yielded: true, back: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag off, ground view: the vehicle marker is the baseline (it never yields)', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=my', { width: 390, height: 844 });
  await page.evaluate(() => document.querySelector('#enter-spaceport')?.click());
  await page.waitForFunction(() => window.__app.localSpaceport.active && window.__app.localSpaceport.vehicleObject, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => document.querySelector('#picker-open')), null);
  await panVehicleTo(page, 100, 400);
  await page.waitForTimeout(300);
  const s = await markerState(page);
  assert.deepEqual({ placed: s.placed, yielded: s.yielded, drawn: s.drawn }, { placed: true, yielded: false, drawn: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on: an orb waiting for its texture shows a body-coloured stand-in, a failed one its procedural texture; never white', async () => {
  const held = [];
  // Mars waits (its colour map and bump map); Europa fails (the app's own failure path gives it procedural textures). Routed before the page loads.
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=picker3d', undefined, 'reduce', async (c) => {
    await c.route(/\/textures\/.*mars[^/]*\.jpg/, (route) => { held.push(route); });
    await c.route(/\/textures\/.*europa[^/]*\.jpg/, (route) => route.abort());
  });
  await openFlow(page);
  await page.waitForFunction(() => document.querySelector('#destination-picker .picker-target[data-base="conamara"]')?.dataset.look === 'texture');
  const look = () => page.evaluate(() => Object.fromEntries([...window.__app.picker.view.items.values()].map((it) => [it.baseId, { look: it.button.dataset.look, map: !!it.material.map, color: it.material.color.getHexString() }])));
  let l = await look();
  assert.equal(l.jezero.look, 'fallback');
  assert.equal(l.jezero.map, false);
  assert.notEqual(l.jezero.color, 'ffffff', 'a white stand-in');
  assert.match(await page.getAttribute('#destination-picker .picker-target[data-base="jezero"]', 'aria-label'), /loading/i);
  assert.equal(l.conamara.map, true, 'the failed body has no procedural texture');
  // Its info card says so: a colour illustration, not the spacecraft-data wording of the file it could not load.
  await page.locator('#destination-picker .picker-target[data-base="conamara"]').click();
  await page.waitForFunction(() => document.querySelector('#destination-picker .picker-image-description')?.textContent === 'Colour illustration');
  assert.equal(await page.getAttribute('#destination-picker .picker-thumb', 'aria-label'), 'Europa: a colour illustration (its surface map is unavailable), not a photo of the base');
  // Choosing still works while a texture is on its way.
  await page.locator('#destination-picker .picker-target[data-base="jezero"]').click();
  assert.equal((await flowState(page)).preview, 'jezero');
  await context.unroute(/\/textures\/.*mars[^/]*\.jpg/);
  for (const r of held) await r.continue();
  await page.waitForFunction(() => document.querySelector('#destination-picker .picker-target[data-base="jezero"]')?.dataset.look === 'texture', null, { timeout: 30000 });
  l = await look();
  assert.equal(l.jezero.map, true);
  assert.deepEqual(errors, []);
  await context.close();
});


// Retain observed-release safety regressions on the restored visual layer.
test('flag on, destination changed mid-hold (tap, ←/→, Enter on a label, the list, 👆): the held 👍 never confirms the new one, even after the hand is lost and found; seen without 👍, then a full hold, it does', async () => {
  const { context, page, errors } = await open('/?base=jezero&lang=en&flags=picker3d');
  await openFlow(page);
  await settled(page);
  const owes = (route) => thumbUntilText(page, '#destination-picker .picker-state', RELEASE_EN).catch((e) => { throw new Error(`${route}: the release instruction not shown: ${e.message}`); });
  const keepsWaiting = async (route, to) => {
    const before = await app(page);
    await thumbFor(page, 2000); // the same 👍, kept up four times longer than a hold
    await owes(route);
    await feed(page, 400, { pose: null }); // the hand lost from view: no release seen
    await thumbFor(page, 2000); // found again, 👍 still up
    assert.equal((await flowState(page)).screen, 'select', `${route}: the carried-over 👍 confirmed ${to}`);
    assert.deepEqual(await app(page), before, `${route}: the carried-over 👍 changed the mission`);
    assert.equal(await page.evaluate(() => window.__app.picker.logic.waitingRelease), true, `${route}: no release asked for`);
    await owes(route);
  };
  const freshHold = async (route, to) => {
    await showHand(page);
    const ms = await holdUntil(page, 'free');
    assert.ok(ms !== null && ms >= 500, `${route}: a fresh hold confirmed after ${ms} ms`);
    assert.deepEqual(await flowState(page), { screen: 'confirm', preview: to, confirmed: to });
    assert.equal((await app(page)).mode, 'baseView', `${route}: a Confirm launched`);
    await page.locator('#destination-picker .picker-back').click(); // ← Change destination
    await page.waitForFunction(() => window.__app.flow.screen === 'select');
  };
  const partialHoldOn = async (id) => {
    await chooseBy.tap(page, id);
    await showHand(page);
    await thumbFor(page, 300);
    const p = await page.evaluate(() => window.__app.picker.logic.confirmProgress);
    assert.ok(p > 0.5 && p < 1, `the partial hold is at ${p}`);
  };
  for (const route of ['tap', 'enter', 'list']) {
    await partialHoldOn('kraken');
    const to = await otherThan(page, ['kraken']);
    await chooseBy[route](page, to);
    assert.equal((await flowState(page)).preview, to, `${route}: not chosen`);
    await keepsWaiting(route, to);
    await freshHold(route, to);
  }
  // ←/→ (focus off the labels: the page's own keys).
  await partialHoldOn('kraken');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  const stepped = (await flowState(page)).preview;
  assert.notEqual(stepped, 'kraken');
  await keepsWaiting('←/→', stepped);
  await freshHold('←/→', stepped);
  // 👆: a 👆 is the hand seen without 👍 (a release); the next 👍 is still a full hold.
  await partialHoldOn('kraken');
  const pointed = await otherThan(page, ['kraken']);
  await feed(page, 600, { pose: 'point', pointer: await orb(page, pointed) });
  assert.equal((await flowState(page)).preview, pointed);
  await release(page);
  const ms = await holdUntil(page, 'free');
  assert.ok(ms !== null && ms >= 500, `👆: a fresh hold confirmed after ${ms} ms`);
  assert.deepEqual(await flowState(page), { screen: 'confirm', preview: pointed, confirmed: pointed });
  await page.locator('#destination-picker .picker-back').click();
  await page.waitForFunction(() => window.__app.flow.screen === 'select');
  // Camera stopped and restarted after the change (the new session first sees no hand): not a release.
  await partialHoldOn('kraken');
  const tapped = await otherThan(page, ['kraken']);
  await chooseBy.tap(page, tapped);
  await page.evaluate(() => window.__app.trackingDeps.stopped());
  await feed(page, 300, { pose: null });
  await keepsWaiting('camera stop', tapped);
  await freshHold('camera stop', tapped);
  // The same destination chosen again (tap, the list) is not a change: the hold goes on and completes at 500 ms.
  for (const route of ['tap', 'list']) {
    await partialHoldOn('kraken');
    await chooseBy[route](page, 'kraken');
    const more = await holdUntil(page, 'free');
    assert.ok(more !== null && more <= 250, `${route}: re-choosing the same destination restarted the hold (${more} ms more)`);
    assert.deepEqual(await flowState(page), { screen: 'confirm', preview: 'kraken', confirmed: 'kraken' });
    await page.locator('#destination-picker .picker-back').click();
    await page.waitForFunction(() => window.__app.flow.screen === 'select');
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, Guided: destination changed mid-hold (tap, Enter on a label, the list, 👆): Guided\'s held 👍 never launches it, even after the hand is lost and found or the camera restarts; seen without 👍, then a full hold, it does', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=astrolife,guided,picker3d');
  await toDestinationStep(page);
  await shown(page);
  await settled(page);
  const g = () => page.evaluate(() => ({ destination: window.__app.guided.session.destination, stage: window.__app.guided.session.stage, mode: window.__app.modes.mode, mission: window.__app.mission.destination?.base.id ?? null }));
  const owes = (route) => thumbUntilText(page, '#destination-picker .picker-state', RELEASE_EN).catch((e) => { throw new Error(`${route}: the release instruction not shown: ${e.message}`); });
  const partialHoldOn = async (id) => {
    await chooseBy.tap(page, id);
    await showHand(page);
    await thumbFor(page, 300);
    const p = await page.evaluate(() => window.__app.guided.holdProgress);
    assert.ok(p > 0.5 && p < 1, `Guided's partial hold is at ${p}`);
  };
  const keepsWaiting = async (route, to) => {
    await thumbFor(page, 2000);
    assert.deepEqual(await g(), { destination: to, stage: 'destination', mode: 'baseView', mission: null }, `${route}: the carried-over 👍 went on`);
    assert.equal(await guidedOwesWithThumb(page), true, `${route}: no release asked for`);
    await owes(route);
    await feed(page, 400, { pose: null }); // the hand lost from view: no release seen
    await thumbFor(page, 2000);
    assert.deepEqual(await g(), { destination: to, stage: 'destination', mode: 'baseView', mission: null }, `${route}: the 👍 found again went on`);
    assert.equal(await guidedOwesWithThumb(page), true, `${route}: no release asked for after the hand came back`);
    await owes(route);
    await showHand(page);
  };
  for (const route of ['tap', 'enter', 'list']) {
    await partialHoldOn('kraken');
    const to = await otherThan(page, ['kraken']);
    await chooseBy[route](page, to);
    assert.equal((await g()).destination, to, `${route}: not chosen`);
    await keepsWaiting(route, to);
  }
  await partialHoldOn('kraken');
  const tapped = await otherThan(page, ['kraken']);
  await chooseBy.tap(page, tapped);
  await page.evaluate(() => window.__app.trackingDeps.stopped());
  await feed(page, 300, { pose: null });
  await keepsWaiting('camera stop', tapped);
  // 👆 (the hand seen without 👍), then a fresh full hold: Guided confirms and launches the destination it shows.
  await partialHoldOn('kraken');
  const pointed = await otherThan(page, ['kraken']);
  await feed(page, 600, { pose: 'point', pointer: await orb(page, pointed) });
  assert.equal((await g()).destination, pointed);
  await release(page);
  const ms = await holdUntil(page, 'guided');
  assert.ok(ms !== null && ms >= 500, `a fresh hold launched after ${ms} ms`);
  await page.waitForFunction(() => window.__app.modes.mode === 'launch');
  assert.deepEqual(await g(), { destination: pointed, stage: 'outbound', mode: 'launch', mission: pointed });
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag on, Guided: the same destination chosen again keeps the hold; it launches at 500 ms', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=astrolife,guided,picker3d');
  await toDestinationStep(page);
  await shown(page);
  await chooseBy.tap(page, 'kraken');
  await release(page);
  await thumbFor(page, 300);
  await chooseBy.tap(page, 'kraken');
  await chooseBy.list(page, 'kraken');
  const ms = await holdUntil(page, 'guided');
  assert.ok(ms !== null && ms <= 250, `re-choosing the same destination restarted Guided's hold (${ms} ms more)`);
  await page.waitForFunction(() => window.__app.modes.mode === 'launch');
  assert.equal(await page.evaluate(() => window.__app.mission.destination?.base.id), 'kraken');
  assert.deepEqual(errors, []);
  await context.close();
});

test('flag off, Guided\'s own destination buttons: a change mid-hold launches nothing, even after the hand is lost and found, until the hand is seen without 👍 and a full hold', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=en&flags=astrolife,guided');
  await toDestinationStep(page);
  const pick = (k) => page.evaluate((i) => { const b = window.__app.guided.destinations.querySelectorAll('button')[i]; b.click(); return window.__app.guided.session.destination; }, k);
  await pick(0);
  await release(page);
  await thumbFor(page, 300);
  assert.ok(await page.evaluate(() => window.__app.guided.holdProgress) > 0.5);
  await page.waitForTimeout(100); // the card re-renders its buttons
  const to = await pick(1);
  await thumbFor(page, 2000);
  assert.deepEqual(await page.evaluate(() => [window.__app.guided.session.stage, window.__app.modes.mode]), ['destination', 'baseView'], 'the carried-over 👍 launched');
  await feed(page, 400, { pose: null }); // the hand lost from view
  await thumbFor(page, 2000);
  assert.deepEqual(await page.evaluate(() => [window.__app.guided.session.stage, window.__app.modes.mode]), ['destination', 'baseView'], 'the 👍 found again launched');
  assert.equal(await guidedOwesWithThumb(page), true, 'no release asked for');
  await thumbUntilText(page, '#guided-mission .guided-feedback', RELEASE_EN);
  await showHand(page);
  const ms = await holdUntil(page, 'guided');
  assert.ok(ms !== null && ms >= 500, `a fresh hold launched after ${ms} ms`);
  await page.waitForFunction(() => window.__app.modes.mode === 'launch');
  assert.equal(await page.evaluate(() => window.__app.mission.destination?.base.id), to);
  assert.deepEqual(errors, []);
  await context.close();
});


test('restored design: ice-blue Milky Way bar follows the real hold without moving targets; release clears it', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=ja&flags=picker3d');
  try {
    await openFlow(page); await settled(page);
    await page.locator('.picker-target[data-base="jezero"]').click();
    await page.waitForTimeout(400);
    const home = await targetsOf(page);
    const charge = () => page.evaluate(() => ({
      value: Number(document.querySelector('.picker-card').style.getPropertyValue('--charge')),
      logic: window.__app.picker.logic.confirmProgress,
      color: getComputedStyle(document.querySelector('.picker-confirm')).getPropertyValue('--charge-base').trim(),
      frame: window.__app.flow.screen,
    }));
    await showHand(page); await thumbFor(page, 250);
    await page.waitForFunction(() => Number(document.querySelector('.picker-card').style.getPropertyValue('--charge')) > 0);
    const active = await charge();
    assert.equal(active.value, active.logic);
    assert.ok(active.value > 0 && active.value < 1);
    assert.equal(active.color, '#9fe3f5');
    assert.deepEqual(await targetsOf(page), home);
    await showHand(page);
    await page.waitForFunction(() => Number(document.querySelector('.picker-card').style.getPropertyValue('--charge')) === 0);
    assert.equal((await charge()).frame, 'select');
    assert.equal(await page.locator('.picker-confirm').evaluate(e => getComputedStyle(e, '::before').animationName), 'none');
    await context.close();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Japanese default: fresh profile uses ja; explicit URL language still wins', async () => {
  const a = await open('/?base=cape&flags=picker3d');
  try { assert.equal(await a.page.evaluate(() => window.__app.state.lang), 'ja'); }
  finally { await a.context.close(); }
  const b = await open('/?base=cape&lang=my&flags=picker3d');
  try { assert.equal(await b.page.evaluate(() => window.__app.state.lang), 'my'); }
  finally { await b.context.close(); }
});

test('confirmation card: a held-thumb release message does not resize, scroll or shift the Launch card', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=ja&flags=picker3d', { width: 780, height: 590 });
  try {
    await openFlow(page); await settled(page);
    await chooseBy.tap(page, 'kraken');
    await page.locator('.picker-confirm').click();
    await page.waitForFunction(() => window.__app.flow.screen === 'confirm');
    await page.addStyleTag({ content: '.picker-card::-webkit-scrollbar{width:16px}' });
    await page.waitForTimeout(750);
    const geometry = () => page.locator('.picker-card').evaluate(e => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width), scroll: e.scrollHeight > e.clientHeight, top: e.scrollTop };
    });
    const home = await geometry();
    assert.equal(home.scroll, false);
    await thumbFor(page, 1500); // The carried-over thumb owes a release, not a Launch.
    await page.waitForTimeout(750);
    assert.deepEqual(await geometry(), home, 'release text changed the card slot or introduced overflow');
    assert.equal((await flowState(page)).screen, 'confirm');
    await showHand(page);
    await page.waitForTimeout(750);
    assert.deepEqual(await geometry(), home, 'clearing the release instruction moved/scrolled the card');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Milky Way: visible twinkling layers on both Confirm and Launch, a deep-blue Launch, and motion opt-out', async () => {
  const { context, page, errors } = await open('/?base=cape&lang=ja&flags=picker3d', { width: 1280, height: 800 }, 'no-preference');
  try {
    await openFlow(page); await settled(page);
    await chooseBy.tap(page, 'jezero');
    const stars = () => page.locator('.picker-confirm').evaluate(e => ({
      before: getComputedStyle(e, '::before').animationName,
      after: getComputedStyle(e, '::after').animationName,
      base: getComputedStyle(e).getPropertyValue('--charge-base').trim(),
      rect: [e.offsetWidth, e.offsetHeight],
    }));
    const confirm = await stars();
    assert.equal(confirm.base, '#9fe3f5');
    assert.equal(confirm.before, 'picker-starlight');
    assert.equal(confirm.after, 'picker-starlight-back');
    await page.locator('.picker-confirm').click();
    await page.locator('.picker-card[data-screen="confirm"] .picker-confirm').waitFor();
    const launch = await stars();
    assert.equal(launch.base, '#164e8c');
    assert.equal(await page.locator('.picker-confirm').evaluate(e => getComputedStyle(e).color), 'rgb(255, 255, 255)');
    assert.equal(launch.before, 'picker-starlight');
    assert.equal(launch.after, 'picker-starlight-back');
    await showHand(page); await thumbFor(page, 250);
    await page.waitForFunction(() => Number(document.querySelector('.picker-card').style.getPropertyValue('--charge')) > 0);
    assert.equal(await page.evaluate(() => window.__app.modes.mode), 'baseView');
    assert.deepEqual((await stars()).rect, launch.rect);
    await showHand(page);
    await page.waitForFunction(() => Number(document.querySelector('.picker-card').style.getPropertyValue('--charge')) === 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.picker-confirm'), '::before').animationName === 'none');
    assert.equal((await stars()).after, 'none');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// A phone on its side (844×390): Back, the destination (screen 2's name, screen 3's route), the current gesture
// instruction and Confirm / Launch are in view without scrolling, uncut, in EN/JA/MY for every destination, through
// choosing, holding, the release instruction and a refusal; within a screen neither the card nor the hit targets move.
// The image and the facts are in Details there.
test('phone landscape (844×390), EN/JA/MY, every destination: Back, the destination, the instruction and Confirm / Launch stay in view without scrolling; nothing moves within a screen', async () => {
  const problems = [], seen = [];
  for (const lang of ['en', 'ja', 'my']) for (const base of ['jezero', 'cape']) {
    const at = `${lang} ${base}`;
    const { context, page, errors } = await open(`/?base=${base}&lang=${lang}&flags=picker3d`, { width: 844, height: 390 });
    await openFlow(page);
    await settled(page);
    // The layout settles just after opening (it measures the card, then places it once more): start from where it
    // rests, the same over three re-measures in a row.
    let last = '', same = 0;
    while (same < 3) {
      const t = await page.evaluate(() => performance.now());
      await page.waitForFunction((x) => window.__app.picker.view.measuredAt > x, t);
      const now = await page.evaluate(() => JSON.stringify([window.__app.picker.view.cardRect, window.__app.picker.view.currentTargets.map((x) => [x.baseId, Math.round(x.x), Math.round(x.y)])]));
      same = now === last ? same + 1 : 0;
      last = now;
    }
    const look = () => page.evaluate(() => {
      const c = document.querySelector('#destination-picker .picker-card'), cr = c.getBoundingClientRect();
      const shown = (e) => !!e && !e.closest('[hidden]') && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
      const inView = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= cr.top - 0.5 && r.bottom <= cr.bottom + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5; };
      const whole = (e) => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1;
      const screen = c.dataset.screen;
      const need = { back: c.querySelector('.picker-back'), action: c.querySelector('.picker-confirm'),
        destination: screen === 'confirm' ? c.querySelector('.picker-route') : c.querySelector('.picker-info-name') };
      const state = c.querySelector('.picker-state');
      if (state.textContent) need.instruction = state;
      return { screen, card: [cr.left, cr.top, cr.width, cr.height].map(Math.round), scrolls: c.scrollHeight > c.clientHeight + 1, stateText: state.textContent,
        targets: window.__app.picker.view.currentTargets.map((t) => `${t.baseId}@${Math.round(t.x)},${Math.round(t.y)}`).join(' '),
        missing: Object.entries(need).filter(([, e]) => !shown(e) || !inView(e) || !whole(e)).map(([k]) => k) };
    });
    const check = (where, l, home) => {
      if (l.scrolls) problems.push(`${at} ${where}: the card scrolls`);
      if (l.missing.length) problems.push(`${at} ${where}: not wholly in view: ${l.missing.join(', ')}`);
      if (home && l.card.join() !== home.card.join()) problems.push(`${at} ${where}: the card moved ${home.card} → ${l.card}`);
      if (home && l.targets !== home.targets) problems.push(`${at} ${where}: the hit targets moved`);
    };
    const s2 = await look();
    check('screen 2, nothing chosen', s2);
    const ids = s2.targets.split(' ').map((s) => s.split('@')[0]);
    for (const [k, id] of ids.entries()) {
      await chooseBy.tap(page, id);
      await page.waitForTimeout(300);
      check(`${id} chosen`, await look(), s2);
      await showHand(page); await thumbFor(page, 300);
      check(`${id} held`, await look(), s2);
      const next = ids[(k + 1) % ids.length];
      await chooseBy.tap(page, next);
      await thumbUntilText(page, '#destination-picker .picker-state', RELEASE[lang]);
      const r = await look();
      check(`${id}→${next} release`, r, s2);
      seen.push({ at, step: `${id}→${next} release`, card: r.card });
      await showHand(page);
    }
    // Details carries the image and the facts here (the card shows neither).
    await chooseBy.tap(page, ids[0]);
    await page.locator('#destination-picker .picker-details').click();
    const sheet = await page.evaluate(() => {
      const s = document.querySelector('#picker-sheet'), vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
      return { thumb: vis(s.querySelector('.picker-sheet-thumb')), facts: s.querySelectorAll('.picker-sheet-facts li').length, label: s.querySelector('.picker-sheet-thumb')?.getAttribute('aria-label') ?? null,
        card: { thumb: vis(document.querySelector('#destination-picker .picker-info .picker-thumb')), facts: vis(document.querySelector('#destination-picker .picker-info .picker-facts')) } };
    });
    if (!sheet.thumb || sheet.facts !== 2 || !sheet.label) problems.push(`${at}: Details lacks the image or the facts ${JSON.stringify(sheet)}`);
    if (sheet.card.thumb || sheet.card.facts) problems.push(`${at}: the card still shows the image or the facts ${JSON.stringify(sheet.card)}`);
    await page.keyboard.press('Escape');
    // Screen 3 (a fresh 👍 hold confirms; the same 👍 still up shows "release, then hold again"): the route, the
    // instruction and Launch in view, nothing moving between the two.
    await showHand(page);
    await thumbFor(page, 700);
    await page.waitForFunction(() => window.__app.flow.screen === 'confirm');
    await page.waitForFunction(() => document.querySelector('#destination-picker .picker-state').textContent !== '');
    const s3 = await look();
    check('screen 3, release instruction', s3);
    await showHand(page);
    await page.waitForFunction(() => document.querySelector('#destination-picker .picker-state').textContent === '');
    check('screen 3, arrival', await look(), s3);
    // Refusal on screen 2 (INJECTED: the mission's choose() made a no-op): its words in the same place.
    await page.locator('#destination-picker .picker-back').click();
    await page.waitForFunction(() => window.__app.flow.screen === 'select');
    await page.evaluate(() => { window.__app.mission.choose = () => {}; });
    await chooseBy.tap(page, ids[1]);
    await page.locator('#destination-picker .picker-confirm').click();
    await page.waitForFunction(() => document.querySelector('#destination-picker .picker-state').textContent !== '');
    check('refused', await look(), s2);
    if (errors.length) problems.push(`${at}: ${errors.join('; ')}`);
    await context.close();
  }
  console.log('[landscape]', JSON.stringify(seen));
  assert.deepEqual(problems, []);
});

test('passport stamp toast is deferred while picker is open (both timing orders, quick close, and direct launch)', async () => {
  // Timing order A: picker opens BEFORE the 1.6 s stamp timer fires -> held until Back returns to ground view.
  {
    const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=en', { width: 390, height: 844 });
    try {
      await page.waitForFunction(() => window.__app.localSpaceport.active && !document.querySelector('#picker-entry').hidden, null, { timeout: 60000 });
      await openFlow(page);
      // Passport stamp is already saved immediately even though toast is deferred.
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gse.passport') || '{}'));
      assert.ok(saved.cape, `Tanegashima stamp saved immediately: ${JSON.stringify(saved)}`);
      // Wait past the 1.6 s timer while picker stays open -> #gesture-flash must stay hidden!
      await page.waitForTimeout(2100);
      assert.equal(await page.evaluate(() => document.querySelector('#gesture-flash').hidden), true, 'stamp toast stayed hidden while picker was open');
      // Close picker -> deferred stamp toast appears once on return!
      await page.locator('#destination-picker .picker-back').click();
      await page.waitForFunction(() => !document.querySelector('#gesture-flash').hidden && document.querySelector('#gesture-flash').textContent.includes('Tanegashima'), null, { timeout: 5000 });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  // Timing order B: stamp toast is ALREADY visible when picker opens -> cleared immediately and retained until return.
  {
    const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=en', { width: 844, height: 390 });
    try {
      await page.waitForFunction(() => window.__app.localSpaceport.active && !document.querySelector('#picker-entry').hidden, null, { timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('#gesture-flash').hidden && document.querySelector('#gesture-flash').textContent.includes('Tanegashima'), null, { timeout: 6000 });
      await page.locator('#picker-open').click();
      await shown(page);
      assert.equal(await page.evaluate(() => document.querySelector('#gesture-flash').hidden), true, 'visible stamp toast cleared when picker opened');
      // Quick open/close returns and re-displays the retained stamp toast once.
      await page.locator('#destination-picker .picker-back').click();
      await page.waitForFunction(() => !document.querySelector('#gesture-flash').hidden && document.querySelector('#gesture-flash').textContent.includes('Tanegashima'), null, { timeout: 5000 });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  // Direct launch from confirmation: stamp toast stays hidden on select + confirm, then flushes once on launch.
  {
    const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=my', { width: 390, height: 844 });
    try {
      await page.waitForFunction(() => window.__app.localSpaceport.active && !document.querySelector('#picker-entry').hidden, null, { timeout: 60000 });
      await openFlow(page);
      await page.waitForTimeout(2000);
      assert.equal(await page.evaluate(() => document.querySelector('#gesture-flash').hidden), true, 'stamp toast held on select');
      await page.locator('#destination-picker .picker-target[data-base="jezero"]').click();
      await nextFrame(page);
      await page.locator('#destination-picker .picker-confirm').click();
      await page.waitForFunction(() => window.__app.flow.screen === 'confirm');
      assert.equal(await page.evaluate(() => document.querySelector('#gesture-flash').hidden), true, 'stamp toast held on confirm');
      await page.locator('#destination-picker .picker-confirm').click();
      await page.waitForFunction(() => window.__app.modes.mode === 'launch');
      await page.waitForFunction(() => !document.querySelector('#gesture-flash').hidden && document.querySelector('#gesture-flash').textContent.trim().length > 0, null, { timeout: 5000 });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('regular Tanegashima URL (no flag): vehicle marker yields on overlap, returns when clear, and Change destination returns focus to selected planet', async () => {
  const { context, page, errors } = await open('/?site=ground&base=tanegashima&lang=my', { width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.__app.localSpaceport.active && window.__app.localSpaceport.vehicleObject, null, { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('#picker-open').hidden);
    await page.waitForTimeout(600);
    const home = (await markerState(page)).button;
    const c = await page.evaluate(() => { const r = document.querySelector('#picker-open').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 - 24 }; });
    await panVehicleTo(page, c.x, c.y);
    await page.waitForTimeout(250);
    let s = await markerState(page);
    assert.deepEqual({ placed: s.placed, enters: s.enters, yielded: s.yielded, drawn: s.drawn }, { placed: true, enters: true, yielded: true, drawn: false });
    assert.deepEqual(s.button, home, 'entry button stayed put when marker overlapped');
    await panVehicleTo(page, 300, 180);
    await page.waitForTimeout(250);
    s = await markerState(page);
    assert.deepEqual({ placed: s.placed, enters: s.enters, yielded: s.yielded, drawn: s.drawn }, { placed: true, enters: false, yielded: false, drawn: true });
    // Keyboard Enter on #picker-open -> select Mars -> confirm -> Change destination restores focus to Mars
    await page.locator('#picker-open').focus();
    await page.keyboard.press('Enter');
    await shown(page);
    await page.locator('#destination-picker .picker-target[data-base="jezero"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#destination-picker .picker-confirm')?.disabled);
    await page.locator('#destination-picker .picker-confirm').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__app.flow.screen === 'confirm');
    await page.locator('#destination-picker .picker-back').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__app.flow.screen === 'select');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-base') === 'jezero', null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-base')), 'jezero', 'Change destination restored keyboard focus to Mars');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
