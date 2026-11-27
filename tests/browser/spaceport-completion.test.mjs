// Playback completion and Replay in the launch preview, in the real app.
//   node --test --test-concurrency=1 tests/browser/spaceport-completion.test.mjs
// Dev server. Mouse, keyboard and touch-sized viewports; hand frames are INJECTED through the dev-only window.__app
// (synthetic observations, not a camera), as in spaceport-gestures.test.mjs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const END = 479 / 24;
const VIEWPORTS = {
  desk: { viewport: { width: 1440, height: 900 } },
  portrait: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
};
let server, browser, url;
before(async () => {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  await warmUp(chromium, url);
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function openPreview(viewport, lang, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ reducedMotion, deviceScaleFactor: 1, ...VIEWPORTS[viewport] });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?site=ground&base=tanegashima&lang=${lang}`);
  await page.waitForFunction(() => window.__app?.trackingFrame && window.__app.localSpaceport?.active && document.querySelector('#status')?.dataset.kind === 'keyboard');
  await page.locator('[data-ui="spaceport-entry"]').click();
  await page.waitForFunction(() => window.__app.spaceport.ownsHand && document.querySelector('#spaceport-view .spaceport-status')?.hidden);
  // Count what the completion status and the phase announcer say (screen-reader output), from here on.
  await page.evaluate(() => {
    window.__said = { complete: [], phase: [] };
    const watch = (el, list) => new MutationObserver(() => { if (el.textContent) list.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
    // The completion live region (a hidden announcer; before the landscape fix the visible status was the region).
    watch(document.querySelector('#spaceport-complete-live') ?? document.querySelector('[data-ui="spaceport-complete"]'), window.__said.complete);
    watch(document.querySelector('#spaceport-phase-live'), window.__said.phase);
  });
  return { context, page, errors };
}
const st = (page) => page.evaluate(() => {
  const v = window.__app.spaceport.viewer, play = document.querySelector('[data-ui="spaceport-play"]'), b = play.getBoundingClientRect();
  // The visible completion message: the floating status, or (short landscape) the final phase marker's slot.
  const shown = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible' && el.textContent.trim() ? el.textContent.trim() : null;
  const status = document.querySelector('[data-ui="spaceport-complete"]');
  const slot = document.querySelector('[data-ui="spaceport-phase-marker"][data-phase="ascent"] .spaceport-marker-done');
  return {
    time: v.time, playing: v.playing, view: v.view, button: play.dataset.state, rect: [b.left, b.top, b.width, b.height],
    focus: document.activeElement?.dataset?.ui ?? document.activeElement?.tagName,
    phase: document.querySelector('[data-ui="spaceport-phase-marker"][aria-current="true"]')?.dataset.phase ?? null,
    complete: (status.dataset.shown === 'true' ? shown(status) : null) ?? shown(slot),
    where: status.dataset.shown === 'true' && shown(status) ? 'float' : shown(slot) ? 'marker' : null,
  };
});
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const sameRect = (a, b, what) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1), `${what}: ${a} vs ${b}`);
const said = (page) => page.evaluate(() => window.__said);
/** The dock's rectangle and every button's (the gesture targets), rounded to 0.1 px. */
const controls = (page) => page.evaluate(() => {
  const out = {}, r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => v.toFixed(1)).join(','); };
  out.dock = r(document.querySelector('[data-ui="spaceport-dock"]'));
  for (const e of document.querySelectorAll('#spaceport-view button[data-ui]')) {
    if (e.closest('[hidden]') || !e.getBoundingClientRect().width) continue;
    out[`${e.dataset.ui}:${e.dataset.view ?? e.dataset.landmark ?? e.dataset.phase ?? ''}`] = r(e);
  }
  return out;
});
function sameControls(a, b, what) {
  const off = (x, y) => !x || !y || x.split(',').some((v, i) => Math.abs(Number(v) - Number(y.split(',')[i])) >= 1);
  assert.deepEqual(Object.keys({ ...a, ...b }).filter(k => off(a[k], b[k])).map(k => `${k}: ${b[k]} → ${a[k]}`), [], what);
}

for (const viewport of Object.keys(VIEWPORTS)) for (const lang of ['ja', 'my', 'en']) {
  test(`${viewport} · ${lang}: the run ends → "complete" once, Replay in place; Ignition seek stays paused; resume; scrub; Replay; Close`, { timeout: 300000 }, async () => {
    const touch = viewport !== 'desk';
    const { context, page, errors } = await openPreview(viewport, lang);
    try {
      const start = await st(page);
      const startControls = await controls(page);
      // Near the end, Play by keyboard; focus stays on the button through the end.
      await page.evaluate((t) => window.__app.spaceport.viewer.seek(t), END - 1.2);
      await page.keyboard.press('Shift');
      await page.locator('[data-ui="spaceport-play"]').focus();
      await page.keyboard.press('Enter');
      let s = await st(page);
      assert.equal(s.playing, true); assert.equal(s.view, 'launch');
      await page.waitForFunction(() => !window.__app.spaceport.viewer.playing, null, { timeout: 60000 });
      await frame(page);
      s = await st(page);
      assert.ok(s.time >= END - 0.01, 'the final frame stays (time at the end)');
      assert.equal(s.view, 'launch', 'the selected camera stays');
      assert.equal(s.button, 'replay', 'the primary button says Replay');
      sameRect(s.rect, start.rect, 'same button, same size and place');
      assert.equal(s.focus, 'spaceport-play', 'keyboard focus stays on it');
      assert.ok(s.complete && s.complete.length > 0, 'the completion status shows');
      // Short landscape: in the dock (the final phase marker's slot), not over the rocket; elsewhere above the dock.
      assert.equal(s.where, viewport === 'landscape' ? 'marker' : 'float');
      sameControls(await controls(page), startControls, 'the dock and every target keep their size and place');
      assert.equal(s.phase, 'ascent');
      await page.waitForTimeout(600);
      assert.equal((await said(page)).complete.length, 1, 'completion is announced once');

      // Ignition from the end, while paused: seeks to 6 s and stays paused; Play, not Replay; the status clears.
      await (touch ? page.locator('[data-ui="spaceport-phase-marker"][data-phase="ignition"]').tap() : page.locator('[data-ui="spaceport-phase-marker"][data-phase="ignition"]').click());
      await frame(page);
      s = await st(page);
      assert.equal(s.time, 6); assert.equal(s.playing, false); assert.equal(s.button, 'play'); assert.equal(s.phase, 'ignition'); assert.equal(s.complete, null);
      sameRect(s.rect, start.rect, 'after the Ignition seek');
      // Explicit resume continues from Ignition (no restart).
      await page.locator('[data-ui="spaceport-play"]').click();
      await page.waitForTimeout(400);
      s = await st(page);
      assert.equal(s.playing, true); assert.ok(s.time >= 6 && s.time < 9, `resumed from Ignition (${s.time.toFixed(2)})`); assert.equal(s.button, 'pause');
      await page.locator('[data-ui="spaceport-play"]').click();

      // Keyboard scrubbing to the end and back: Replay at the end, Play again away from it; nothing announced.
      const phaseSaid = (await said(page)).phase.length;
      await page.locator('#spaceport-timeline').focus();
      await page.keyboard.press('End');
      await frame(page);
      s = await st(page);
      assert.equal(s.button, 'replay'); assert.equal(s.complete, null, 'scrubbing to the end is not a completed run');
      await page.keyboard.press('Home');
      await frame(page);
      s = await st(page);
      assert.equal(s.button, 'play'); assert.equal(s.phase, 'ready');
      await page.waitForTimeout(300);
      assert.equal((await said(page)).phase.length, phaseSaid, 'scrubbing is quiet for screen readers');
      assert.equal((await said(page)).complete.length, 1, 'and announces no completion');

      // Replay from the end: starts over and plays.
      await page.keyboard.press('End');
      await frame(page);
      await page.locator('[data-ui="spaceport-play"]').click();
      await page.waitForTimeout(300);
      s = await st(page);
      assert.equal(s.playing, true); assert.ok(s.time < 3, `Replay starts over (${s.time.toFixed(2)})`); assert.equal(s.button, 'pause');
      sameRect(s.rect, start.rect, 'Replay → Pause');

      // Close: back to the ground view and to Launch Preview.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#spaceport-view').open);
      await frame(page);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.ui), 'spaceport-entry');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('a 👍 held across the end of the run never starts a replay; a seen release and a fresh 👍 do (injected frames)', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview('desk', 'my');
  try {
    await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 60000; });
    const feed = (ms, o) => page.evaluate(({ ms, pose, pointer, thumbsUp }) => {
      const a = window.__app; a.__t ??= 100000;
      for (let i = 0; i <= ms; i += 50) {
        a.__t += 50; a.gestures.ui = { pose, action: null, pointer, hoverId: null, progress: 0 };
        a.gestures.lastObs = pose === null ? null : { pose, thumbsUp, center: pointer ?? { x: 0.5, y: 0.5 }, fingers: { thumb: thumbsUp, index: pose === 'point', middle: false, ring: false, pinky: false } };
        a.trackingFrame(a.__t);
      }
    }, { ms, pointer: null, thumbsUp: false, ...o });
    const at = await page.evaluate(() => { const b = document.querySelector('[data-ui="spaceport-play"]').getBoundingClientRect(); return { x: (b.left + b.width / 2) / innerWidth, y: (b.top + b.height / 2) / innerHeight }; });
    await page.evaluate((t) => window.__app.spaceport.viewer.seek(t), END - 1);
    await feed(100, { pose: 'none' });
    await feed(600, { pose: 'point', pointer: at });           // 450 ms dwell arms Play
    assert.equal(await page.evaluate(() => window.__app.spaceport.owner.hand.armed), 'spaceport-play:');
    await feed(700, { pose: 'fist', thumbsUp: true });          // 500 ms hold: Play
    let s = await st(page);
    assert.equal(s.playing, true, '👍 started the run');
    // Keep the same 👍 up while the run reaches its end and Play turns into Replay.
    while ((await st(page)).playing) { await feed(100, { pose: 'fist', thumbsUp: true }); await page.waitForTimeout(150); }
    await feed(1500, { pose: 'fist', thumbsUp: true });
    await frame(page);
    s = await st(page);
    assert.equal(s.button, 'replay'); assert.equal(s.playing, false, 'the held 👍 did not start a replay');
    assert.ok(s.time >= END - 0.01);
    assert.equal(await page.evaluate(() => window.__app.spaceport.owner.hand.armed), 'spaceport-play:', 'Replay is still the armed target');
    // A seen release, then a fresh 👍: Replay.
    await feed(150, { pose: 'none' });
    await feed(700, { pose: 'fist', thumbsUp: true });
    await frame(page);
    s = await st(page);
    assert.equal(s.playing, true, 'a fresh 👍 after a seen release replays'); assert.ok(s.time < 3);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('reduced motion: the completion status appears without animation; the final frame and Replay are the same', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview('portrait', 'ja', 'reduce');
  try {
    await page.evaluate((t) => window.__app.spaceport.viewer.seek(t), END - 0.6);
    await page.locator('[data-ui="spaceport-play"]').tap();
    await page.waitForFunction(() => !window.__app.spaceport.viewer.playing, null, { timeout: 60000 });
    await frame(page);
    const s = await st(page);
    assert.equal(s.button, 'replay'); assert.ok(s.complete);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-ui="spaceport-complete"]')).animationName), 'none');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// Owner review 2026-11-21: seeking to the end while the run is playing must not count as the run finishing. The
// timeline's input handler stops playback and seeks; completion must come only from playback advancing to the end.
async function startVisiblyPlaying(page) {
  await page.evaluate(() => window.__app.spaceport.viewer.seek(5));
  await page.locator('[data-ui="spaceport-play"]').click();
  await page.waitForFunction(() => window.__app.spaceport.viewer.playing && window.__app.spaceport.viewer.time > 5.2, null, { timeout: 10000 });
  assert.equal((await st(page)).button, 'pause', 'the run is visibly playing');
}
async function assertNoCompletion(page, how) {
  await page.waitForTimeout(800); await frame(page);
  const s = await st(page);
  assert.ok(s.time >= END - 0.01, `${how}: at the end`); assert.equal(s.playing, false);
  assert.equal(s.button, 'replay', `${how}: Replay shows`);
  assert.equal(s.complete, null, `${how}: no completion message`);
  assert.deepEqual((await said(page)).complete, [], `${how}: nothing announced`);
}
for (const [viewport, lang] of [['desk', 'my'], ['landscape', 'en']]) {
  test(`${viewport} · ${lang}: End on the focused timeline while playing → Replay, no completion message or announcement`, { timeout: 300000 }, async () => {
    const { context, page, errors } = await openPreview(viewport, lang);
    try {
      await startVisiblyPlaying(page);
      await page.locator('#spaceport-timeline').focus();
      await page.keyboard.press('End');
      await assertNoCompletion(page, 'End while playing');
      // Seeking back clears Replay; a fresh Replay still finishes normally and announces once.
      await page.keyboard.press('Home'); await frame(page);
      assert.equal((await st(page)).button, 'play');
      await page.evaluate((t) => window.__app.spaceport.viewer.seek(t), END - 0.8);
      await page.locator('[data-ui="spaceport-play"]').click();
      await page.waitForFunction(() => !window.__app.spaceport.viewer.playing, null, { timeout: 60000 });
      await frame(page);
      assert.ok((await st(page)).complete, 'a natural finish shows the message');
      await page.waitForTimeout(400);
      assert.equal((await said(page)).complete.length, 1, 'and announces it once');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
for (const [viewport, lang] of [['desk', 'ja'], ['portrait', 'my']]) {
  test(`${viewport} · ${lang}: dragging the timeline to the end while playing → Replay, no completion message or announcement`, { timeout: 300000 }, async () => {
    const { context, page, errors } = await openPreview(viewport, lang);
    try {
      await startVisiblyPlaying(page);
      const box = await page.locator('#spaceport-timeline').boundingBox();
      const thumbX = box.x + box.width * (await page.evaluate(() => window.__app.spaceport.viewer.time / (479 / 24)));
      await page.mouse.move(thumbX, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
      await assertNoCompletion(page, 'drag from the thumb to the end while playing');
      // Pressing on the track's end while playing (the first input is already the end), then dragging past it.
      await page.keyboard.press('Home'); await frame(page);
      await startVisiblyPlaying(page);
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
      await assertNoCompletion(page, 'press at the end of the track while playing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
