// Ground View → Launch Preview → Ground View, and the eased camera presets inside the preview, in the real app.
//   node --test --test-concurrency=1 tests/browser/spaceport-camera.test.mjs
// Dev server. No camera: mouse, keyboard and touch. Hand frames, where used, are INJECTED through the dev-only
// window.__app (synthetic observations), as in spaceport-gestures.test.mjs.
// Headless WebGL renders slowly (a few frames a second), so moves are checked by time and by their start pose, not
// by counting frames; and OrbitControls' damping (per frame) keeps a dragged ground camera gliding for seconds.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
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
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { args: ['--use-gl=angle', '--use-angle=d3d11'] } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });

async function openGround(viewport, lang, { reducedMotion = 'no-preference', slowPreview = 0 } = {}) {
  const context = await browser.newContext({ reducedMotion, deviceScaleFactor: 1, ...VIEWPORTS[viewport] });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (slowPreview) await page.route('**/spaceport/**', async (route) => { await new Promise(r => setTimeout(r, slowPreview)); await route.continue(); });
  await page.goto(`${url}/?site=ground&base=tanegashima&lang=${lang}`);
  await page.waitForFunction(() => window.__app?.localSpaceport?.active && window.__app.trackingFrame && document.querySelector('#status')?.dataset.kind === 'keyboard');
  await page.waitForTimeout(500);
  return { context, page, errors };
}
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const groundPose = (page) => page.evaluate(() => JSON.stringify(window.__app.localSpaceport.viewPose()));
const previewOpen = (page) => page.evaluate(() => !!document.querySelector('#spaceport-view')?.open);
const focused = (page) => page.evaluate(() => document.activeElement?.dataset?.ui ?? document.activeElement?.tagName);
const viewer = (page, js) => page.evaluate(js);
/** Drags the ground camera. With settle, waits until it stops gliding (to 0.1 unit); without, returns mid-glide. */
async function dragGround(page, { settle = true } = {}) {
  const g = await page.locator('#local-spaceport canvas').boundingBox();
  await page.mouse.move(g.x + g.width * 0.5, g.y + g.height * 0.5); await page.mouse.down();
  await page.mouse.move(g.x + g.width * 0.36, g.y + g.height * 0.45, { steps: 6 }); await page.mouse.up();
  if (settle) await page.waitForFunction(() => {
    const p = JSON.stringify(window.__app.localSpaceport.viewPose().eye.map(v => Math.round(v * 10)));
    const same = p === window.__lastGround; window.__lastGround = p; return same;
  }, null, { polling: 400, timeout: 60000 });
}
/** Opens with Enter on Launch Preview; returns the ground pose at that keydown (what the app saves). */
async function openByKeyboard(page) {
  await page.keyboard.press('Shift');
  await page.locator('[data-ui="spaceport-entry"]').focus();
  await page.evaluate(() => addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__atOpen = JSON.stringify(window.__app.localSpaceport.viewPose()); }, { capture: true, once: true }));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__app.spaceport.ownsHand && document.querySelector('#spaceport-view .spaceport-status')?.hidden);
  return page.evaluate(() => window.__atOpen);
}
const press = async (page, sel, touch) => { const l = page.locator(sel); if (touch) await l.tap(); else await l.click(); };
/** The dock's and bar's control rectangles, to show camera motion never moves them. */
const controls = (page) => page.evaluate(() => {
  const out = {};
  for (const e of document.querySelectorAll('#spaceport-view button[data-ui]')) {
    if (e.closest('[hidden]')) continue; const b = e.getBoundingClientRect(); if (!b.width) continue;
    out[`${e.dataset.ui}:${e.dataset.view ?? e.dataset.landmark ?? e.dataset.phase ?? ''}`] = [b.left, b.top, b.width, b.height].map(v => v.toFixed(1)).join(',');
  }
  return out;
});
/** Same rectangles, give or take sub-pixel text rounding (under 1 px). */
function sameLayout(a, b, what) {
  const off = (x, y) => !x || !y || x.split(',').some((v, i) => Math.abs(Number(v) - Number(y.split(',')[i])) >= 1);
  assert.deepEqual(Object.keys({ ...a, ...b }).filter(k => off(a[k], b[k])).map(k => `${k}: ${a[k]} → ${b[k]}`), [], what);
}
/** Clicks in the page; returns where the camera was at that moment and where the move it started begins. */
const startMove = (page, sel) => page.evaluate((sel) => {
  const v = window.__app.spaceport.viewer, at = v.camera.position.toArray(), t = performance.now();
  document.querySelector(sel).click();
  const from = v.transition ? [v.transition.tween.fromEye.x, v.transition.tween.fromEye.y, v.transition.tween.fromEye.z] : null;
  return { at, from, t };
}, sel);
/** The preview camera's eye each frame for `ms`. */
const sample = (page, ms) => page.evaluate((ms) => new Promise((resolve) => {
  const v = window.__app.spaceport.viewer, out = [], end = performance.now() + ms;
  const tick = () => { out.push({ eye: v.camera.position.toArray(), moving: v.moving, t: performance.now() }); if (performance.now() < end) requestAnimationFrame(tick); else resolve(out); };
  requestAnimationFrame(tick);
}), ms);
/** The same ground pose, to float rounding (1e-6). */
function samePose(a, b, what) {
  const x = JSON.parse(a), y = JSON.parse(b), flat = (p) => [...p.eye, ...p.target];
  assert.ok(flat(x).every((v, i) => Math.abs(v - flat(y)[i]) < 1e-6), `${what}: ${a} vs ${b}`);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const eyeNow = (page) => viewer(page, () => window.__app.spaceport.viewer.camera.position.toArray());
/** Where a preset finishes (its pose, constrained like the instant switch), without moving the camera. */
const presetEye = (page, view) => page.evaluate((view) => {
  const v = window.__app.spaceport.viewer, eye = v.camera.position.clone(), target = v.controls.target.clone();
  v.presetPose(view, eye, target);
  return (v.collision ? v.collision.constrain(eye, eye.clone()) : eye).toArray();
}, view);

for (const viewport of Object.keys(VIEWPORTS)) for (const lang of ['ja', 'my']) {
  test(`${viewport} · ${lang}: ground → preview (Launch Pad, drag mid-move) → close restores the ground camera and focus`, { timeout: 300000 }, async () => {
    const touch = viewport !== 'desk';
    const { context, page, errors } = await openGround(viewport, lang);
    try {
      // The entry is the card's primary action (amber); its name is the label alone; a 44 px+ target.
      const entry = await page.evaluate(() => { const b = document.querySelector('[data-ui="spaceport-entry"]'); const r = b.getBoundingClientRect(); return { h: r.height, name: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor }; });
      assert.ok(entry.h >= 44, `entry height ${entry.h}`); assert.ok(entry.name.length > 0); assert.equal(entry.bg, 'rgb(240, 180, 108)');

      await dragGround(page, { settle: false });               // open while the ground camera is still gliding
      const ground = await openByKeyboard(page);
      assert.ok(ground && ground !== 'null');
      const dock = await controls(page);
      await press(page, '[data-ui="spaceport-view"][data-view="pad"]', touch);
      assert.equal(await viewer(page, () => window.__app.spaceport.viewer.moving), true, 'Launch Pad starts an eased move');
      sameLayout(await controls(page), dock, 'controls stay put while the camera moves');
      // A drag part-way through hands the camera back to the user.
      const s = await page.locator('.spaceport-stage canvas').boundingBox();
      await page.mouse.move(s.x + s.width * 0.5, s.y + s.height * 0.35); await page.mouse.down();
      assert.equal(await viewer(page, () => window.__app.spaceport.viewer.moving), false, 'pointer down stops the move');
      await page.mouse.move(s.x + s.width * 0.4, s.y + s.height * 0.33, { steps: 5 }); await page.mouse.up();
      await page.waitForFunction(() => document.querySelector('[data-ui="spaceport-view"][data-view="pad"]').getAttribute('aria-pressed') === 'false');
      assert.equal(await page.locator('.spaceport-cameras [aria-pressed="true"]').count(), 0, 'manual orbit clears the preset cue');
      sameLayout(await controls(page), dock, 'after the drag');
      await press(page, '[data-ui="spaceport-close"]', touch);
      await page.waitForFunction(() => !document.querySelector('#spaceport-view').open);
      await frame(page); await frame(page);
      samePose(await groundPose(page), ground, 'the ground camera is back (angle, zoom, target)');
      await page.waitForTimeout(1000);
      samePose(await groundPose(page), ground, 'and stays there: the glide from before opening is spent, not resumed');
      assert.equal(await focused(page), 'spaceport-entry', 'focus is back on Launch Preview');

      // Repeated: open and close twice more, once with Escape; the ground stays where it was left.
      for (const how of ['escape', 'close']) {
        samePose(await openByKeyboard(page), ground, `${how}: the ground was where it was left`);
        await press(page, '[data-ui="spaceport-view"][data-view="launch"]', touch);
        if (how === 'escape') await page.keyboard.press('Escape'); else await press(page, '[data-ui="spaceport-close"]', touch);
        await page.waitForFunction(() => !document.querySelector('#spaceport-view').open);
        await frame(page); await frame(page);
        samePose(await groundPose(page), ground, `${how}: ground camera`);
        assert.equal(await focused(page), 'spaceport-entry', `${how}: focus`);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('closed while loading: the late load takes neither focus nor the camera', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openGround('desk', 'ja', { slowPreview: 2500 });
  try {
    await dragGround(page, { settle: false });
    await page.keyboard.press('Shift');
    await page.locator('[data-ui="spaceport-entry"]').focus();
    await page.evaluate(() => addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__atOpen = JSON.stringify(window.__app.localSpaceport.viewPose()); }, { capture: true, once: true }));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#spaceport-view')?.open && !document.querySelector('#spaceport-view .spaceport-status').hidden);
    const ground = await page.evaluate(() => window.__atOpen);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#spaceport-view').open);
    await page.waitForTimeout(5000);                         // the delayed asset arrives meanwhile
    assert.equal(await previewOpen(page), false);
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer), null, 'no viewer came back');
    samePose(await groundPose(page), ground);
    assert.equal(await focused(page), 'spaceport-entry');
    // The ground camera is the user's again: a drag still moves it.
    await dragGround(page);
    assert.notEqual(await groundPose(page), ground);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('presets: eased moves of about 400 ms, drag and wheel interrupt, switching starts from the current pose, Reset and Close cancel, Follow during playback', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openGround('desk', 'my');
  try {
    await openByKeyboard(page);
    const dock = await controls(page);
    // One eased move to Launch Pad: it starts exactly where the camera was, passes through in-between poses, takes
    // about the preset time (frame-quantized) and ends on the preset.
    const padEye = await presetEye(page, 'pad');
    let move = await startMove(page, '[data-ui="spaceport-view"][data-view="pad"]');
    assert.deepEqual(move.from, move.at, 'the move starts exactly where the camera was');
    const frames = await sample(page, 1500);
    const end = frames.find(f => !f.moving);
    assert.ok(end, 'the move ends');
    const took = end.t - move.t;
    assert.ok(took >= 300 && took < 1500, `it takes about the preset time (${Math.round(took)} ms)`);
    assert.ok(frames.some(f => f.moving && dist(f.eye, move.at) > 1 && dist(f.eye, padEye) > 1), 'the camera passes through in-between poses');
    assert.ok(dist(frames.at(-1).eye, padEye) < 2, 'it ends on the preset');
    sameLayout(await controls(page), dock, 'after the move');

    // Wheel zoom mid-move stops it.
    await page.locator('[data-ui="spaceport-view"][data-view="overview"]').click();
    const s = await page.locator('.spaceport-stage canvas').boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.wheel(0, -200);
    await frame(page);
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer.moving), false, 'wheel stops the move');

    // Rapid switching: Launch Pad → Follow → Overview; each starts from where the camera is; it ends on Overview.
    await page.locator('[data-ui="spaceport-view"][data-view="pad"]').click();
    await page.waitForTimeout(120);
    move = await startMove(page, '[data-ui="spaceport-view"][data-view="launch"]');
    assert.deepEqual(move.from, move.at, 'Follow starts from the current pose');
    await page.waitForTimeout(100);
    const overviewEye = await presetEye(page, 'overview');
    move = await startMove(page, '[data-ui="spaceport-view"][data-view="overview"]');
    assert.deepEqual(move.from, move.at, 'the next switch starts from the current pose, mid-move');
    await page.waitForFunction(() => !window.__app.spaceport.viewer.moving, null, { timeout: 5000 });
    await frame(page);
    assert.ok(dist(await eyeNow(page), overviewEye) < 2);
    assert.equal(await page.evaluate(() => document.querySelector('[data-ui="spaceport-view"][aria-pressed="true"]').dataset.view), 'overview');

    // Reset mid-move: the preset move is replaced by Reset's own flight (overview, time 0).
    await page.locator('[data-ui="spaceport-view"][data-view="pad"]').click();
    await page.waitForTimeout(100);
    await page.locator('[data-ui="spaceport-reset"]').click();
    await page.waitForFunction(() => !window.__app.spaceport.viewer.moving, null, { timeout: 5000 });
    await frame(page);
    assert.ok(dist(await eyeNow(page), overviewEye) < 2);
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer.time), 0);

    // Follow during playback: eases onto the rocket, then tracks it as before.
    await page.locator('[data-ui="spaceport-play"]').click();
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer.view), 'launch');
    await page.waitForFunction(() => !window.__app.spaceport.viewer.moving, null, { timeout: 5000 });
    const follow = await viewer(page, () => { const v = window.__app.spaceport.viewer; return { following: v.following, target: v.controls.target.toArray() }; });
    assert.equal(follow.following, true); assert.equal(follow.target[0], 0); assert.equal(follow.target[2], 0);
    const track = await sample(page, 800);
    assert.ok(dist(track[0].eye, track.at(-1).eye) > 0 || track.length < 2, 'the camera keeps tracking the launch');
    sameLayout(await controls(page), dock, 'controls stay put through playback and camera moves');
    await page.locator('[data-ui="spaceport-play"]').click();

    // Close mid-move: no error, nothing left running.
    await page.locator('[data-ui="spaceport-view"][data-view="pad"]').click();
    await page.locator('[data-ui="spaceport-close"]').click();
    await page.waitForFunction(() => !document.querySelector('#spaceport-view').open);
    await page.waitForTimeout(500);
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer), null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('reduced motion: presets switch directly and keep the selected-view cue', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openGround('desk', 'ja', { reducedMotion: 'reduce' });
  try {
    await openByKeyboard(page);
    const padEye = await presetEye(page, 'pad');
    await page.locator('[data-ui="spaceport-view"][data-view="pad"]').click();
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer.moving), false);
    await frame(page);
    assert.ok(dist(await eyeNow(page), padEye) < 2);
    assert.equal(await page.evaluate(() => document.querySelector('[data-ui="spaceport-view"][data-view="pad"]').getAttribute('aria-pressed')), 'true');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('injected gestures choose a preset; the move leaves the 👆 targets where they were', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openGround('landscape', 'my');
  try {
    await openByKeyboard(page);
    await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 60000; });
    const feed = (ms, o) => page.evaluate(({ ms, pose, pointer, thumbsUp }) => {
      const a = window.__app; a.__t ??= 100000;
      for (let i = 0; i <= ms; i += 50) {
        a.__t += 50; a.gestures.ui = { pose, action: null, pointer, hoverId: null, progress: 0 };
        a.gestures.lastObs = pose === null ? null : { pose, thumbsUp, center: pointer ?? { x: 0.5, y: 0.5 }, fingers: { thumb: thumbsUp, index: pose === 'point', middle: false, ring: false, pinky: false } };
        a.trackingFrame(a.__t);
      }
    }, { ms, pointer: null, thumbsUp: false, ...o });
    await feed(100, { pose: 'none' });
    const targets = await controls(page);
    const at = await page.evaluate(() => { const b = document.querySelector('[data-ui="spaceport-view"][data-view="pad"]').getBoundingClientRect(); return { x: (b.left + b.width / 2) / innerWidth, y: (b.top + b.height / 2) / innerHeight }; });
    await feed(600, { pose: 'point', pointer: at });
    assert.equal(await viewer(page, () => window.__app.spaceport.owner.hand.armed), 'spaceport-view:pad');
    await feed(700, { pose: 'fist', thumbsUp: true });
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer.view), 'pad');
    assert.equal(await viewer(page, () => window.__app.spaceport.viewer.moving), true, 'the chosen preset eases in');
    sameLayout(await controls(page), targets, 'gesture targets stay put while the camera moves');
    await page.waitForFunction(() => !window.__app.spaceport.viewer.moving, null, { timeout: 5000 });
    sameLayout(await controls(page), targets, 'and after it');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
