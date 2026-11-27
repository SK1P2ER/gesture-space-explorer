// Jezero Dome: the Explore card's Landmarks list (jezeroLandmarks.ts, mission.ts, missionOverlay.ts): Habitat Dome,
// Landing Pad and Communications Dish framed by the camera only; Back to overview returns to the pose saved before the
// first landmark; time presets, the clock and leaving Explore stay as they were.
//   node --test --test-concurrency=1 tests/browser/jezero-landmarks.test.mjs
// Dev server; Explore is reached directly (?base=jezero) or from the arrival (Tanegashima → Jezero, flight shortened,
// auto-land); state is read through the dev-only window.__app. Synthetic: camera refused (or a stand-in preview box),
// no real hand. Each test closes its own context (try/finally): node:test's afterEach would also run after subtests.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.env.LANDMARK_SHOTS ?? null;
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
const IDS = ['habitat', 'pad', 'dish'];
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
const atBase = (page) => page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero' && window.__app.modes.mode === 'baseView' && window.__app.showcases.get('jezero'));
/** Direct ?base=jezero: the standard Horizon view opens Explore. */
async function direct(page) {
  await atBase(page);
  await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
  await exploring(page);
}
const exploring = (page) => page.waitForFunction(() => window.__app.mission.horizon !== null && document.querySelector('#mission-overlay')?.classList.contains('explore') && document.querySelector('#explore-time') && document.querySelector('#explore-landmarks'));
const orbiting = (page) => page.waitForFunction(() => window.__app.mission.horizon === null && !document.querySelector('#mission-overlay')?.classList.contains('explore'));
const landmark = (page) => page.evaluate(() => window.__app.mission.landmark ?? null);
const now = (page) => page.evaluate(() => window.__app.clock.time);
const nextFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
const pressedPresets = (page) => page.evaluate(() => [...document.querySelectorAll('#explore-time [data-preset]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.preset));
const pressedLandmarks = (page) => page.evaluate(() => [...document.querySelectorAll('[data-landmark]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.landmark));
const listOpen = (page) => page.evaluate(() => document.querySelector('#explore-landmarks')?.getAttribute('aria-expanded') === 'true');
const overviewShown = (page) => page.locator('#landmark-overview').isVisible();
/** Open the Landmarks list if it is folded (phones start folded). */
async function openList(page, tap = false) {
  if (await listOpen(page)) return;
  await (tap ? page.locator('#explore-landmarks').tap() : page.locator('#explore-landmarks').click());
  await page.waitForFunction(() => document.querySelector('#explore-landmarks').getAttribute('aria-expanded') === 'true');
}
/**
 * The camera in the base's own frame (the planet turns with time; the pose on the ground must not): eye position,
 * unit look direction, field of view / zoom, and the horizon view's yaw / pitch / distance.
 */
const pose = (page) => page.evaluate(() => {
  const a = window.__app, g = a.mission.base.group, c = a.rig.camera;
  g.updateWorldMatrix(true, false);
  c.updateMatrixWorld();
  const eye = g.worldToLocal(c.position.clone());
  const ahead = g.worldToLocal(new c.position.constructor(0, 0, -1).applyQuaternion(c.quaternion).add(c.position)).sub(eye).normalize();
  const h = a.mission.horizon;
  return { eye: [eye.x, eye.y, eye.z], dir: [ahead.x, ahead.y, ahead.z], fov: c.fov, zoom: c.zoom, h: h ? { yaw: h.yaw, pitch: h.pitch, distance: h.distance, height: h.height ?? 0, cx: h.centre?.x ?? 0, cy: h.centre?.y ?? 0, cz: h.centre?.z ?? 0 } : null };
});
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
/** Same camera pose within a tolerance (eye in scene units, direction as a unit vector, horizon numbers). */
function samePose(p, q, msg, tol = 2e-3) {
  assert.ok(dist(p.eye, q.eye) <= tol, `${msg}: eye ${JSON.stringify(p.eye)} vs ${JSON.stringify(q.eye)}`);
  assert.ok(dist(p.dir, q.dir) <= tol, `${msg}: look direction ${JSON.stringify(p.dir)} vs ${JSON.stringify(q.dir)}`);
  assert.ok(Math.abs(p.fov - q.fov) <= 1e-3 && Math.abs(p.zoom - q.zoom) <= 1e-3, `${msg}: fov/zoom ${p.fov}/${p.zoom} vs ${q.fov}/${q.zoom}`);
  if (p.h && q.h) for (const k of ['yaw', 'pitch', 'distance', 'height', 'cx', 'cy', 'cz']) assert.ok(Math.abs(p.h[k] - q.h[k]) <= 1e-4, `${msg}: horizon ${k} ${p.h[k]} vs ${q.h[k]}`);
}
const differs = (p, q) => dist(p.eye, q.eye) > 0.01 || dist(p.dir, q.dir) > 0.02;
/** Wait until the camera stops moving (eye and direction still over 250 ms; headless frames are 100–300 ms). */
async function settle(page, maxMs = 12000) {
  const t0 = Date.now();
  let last = await pose(page);
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(250);
    const p = await pose(page);
    if (dist(p.eye, last.eye) < 2e-5 && dist(p.dir, last.dir) < 2e-5) return p;
    last = p;
  }
  throw new Error(`camera still moving after ${maxMs} ms`);
}
/** Emit an intent and sample the camera eye (base frame) every frame for `ms`, timed in the page. */
const track = (page, intent, ms) => page.evaluate(async ([i, ms]) => {
  const a = window.__app, g = a.mission.base.group;
  const eye = () => { g.updateWorldMatrix(true, false); const p = g.worldToLocal(a.rig.camera.position.clone()); return [p.x, p.y, p.z]; };
  const out = [{ t: 0, p: eye() }];
  const t0 = performance.now();
  a.bus.emit(i);
  while (performance.now() - t0 < ms) { await new Promise((r) => requestAnimationFrame(r)); out.push({ t: performance.now() - t0, p: eye() }); }
  return out;
}, [intent, ms]);
const frame = (page, id) => page.evaluate((i) => window.__app.bus.emit({ type: 'frameLandmark', id: i }), id);
const overview = (page) => page.evaluate(() => window.__app.bus.emit({ type: 'landmarkOverview' }));
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const rects = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => !e.hidden && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }), sel);
const overlaps = (a, b) => !!a && !!b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const inView = (r, vp) => !!r && r.left >= -0.5 && r.top >= -0.5 && r.right <= vp.width + 0.5 && r.bottom <= vp.height + 0.5;

test('(a) switching landmarks keeps the ORIGINAL return pose; Back to overview restores eye, look target and distance; a new round saves afresh', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await direct(page);
    // A look of the person's own first (turned, tilted, stepped closer), so the original is not just the default.
    await page.evaluate(() => { window.__app.bus.emit({ type: 'rotate', dx: 0.6, dy: -0.12 }); window.__app.bus.emit({ type: 'zoom', factor: 0.8 }); });
    const original = await settle(page);
    assert.equal(await landmark(page), null);
    assert.equal(await overviewShown(page), false, 'no Back to overview before a landmark');
    await openList(page);
    const framed = {};
    for (const id of IDS) {
      await page.locator(`#landmark-${id}`).click();
      await page.waitForFunction((i) => window.__app.mission.landmark === i, id);
      framed[id] = await settle(page);
      assert.ok(differs(framed[id], original), `${id}: the camera moved to the landmark`);
      assert.deepEqual(await pressedLandmarks(page), [id], `${id}: the only pressed landmark`);
      assert.ok(await overviewShown(page), `${id}: Back to overview offered`);
    }
    assert.ok(differs(framed.habitat, framed.pad) && differs(framed.pad, framed.dish) && differs(framed.habitat, framed.dish), 'three different framings');
    await page.locator('#landmark-overview').click();
    await page.waitForFunction(() => window.__app.mission.landmark === null);
    samePose(await settle(page), original, 'Back to overview after habitat → pad → dish');
    assert.equal(await overviewShown(page), false, 'Back to overview gone at the overview');
    assert.deepEqual(await pressedLandmarks(page), []);
    assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null, 'still exploring');
    // A new look from the overview, then a landmark: Back returns to THAT pose, not the first one.
    await page.evaluate(() => window.__app.bus.emit({ type: 'rotate', dx: -1.1, dy: 0 }));
    const second = await settle(page);
    assert.ok(differs(second, original));
    await frame(page, 'pad');
    await page.waitForFunction(() => window.__app.mission.landmark === 'pad');
    await settle(page);
    await overview(page);
    await page.waitForFunction(() => window.__app.mission.landmark === null);
    samePose(await settle(page), second, 'second round: the pose saved before its first landmark');
    // Re-framing the landmark already framed changes nothing.
    await frame(page, 'dish');
    const dish = await settle(page);
    await frame(page, 'dish');
    samePose(await settle(page), dish, 'dish again');
    assert.equal(await landmark(page), 'dish');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('(b) reduced motion is a straight cut; standard motion is a short gradual move that passes between the two poses', async () => {
  const results = {};
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const { page, context, errors } = await open('base=jezero&lang=en', { reducedMotion });
    try {
      await direct(page);
      await settle(page);
      const samples = await track(page, { type: 'frameLandmark', id: 'dish' }, 3500);
      const end = (await settle(page)).eye;
      const start = samples[0].p;
      const D = dist(start, end);
      assert.ok(D > 0.02, `${reducedMotion}: the dish framing is somewhere else (moved ${D})`);
      const reachedAt = samples.find((s) => dist(s.p, end) <= 0.01 * D)?.t ?? Infinity;
      const between = samples.filter((s) => dist(s.p, start) > 0.1 * D && dist(s.p, end) > 0.1 * D);
      const frames = samples.slice(1).map((s, i) => s.t - samples[i].t);
      results[reducedMotion] = { D, reachedAt, between: between.length, frames: samples.length, medianFrame: frames.sort((x, y) => x - y)[frames.length >> 1] };
      if (reducedMotion === 'reduce') {
        const idx = samples.findIndex((s) => dist(s.p, end) <= 0.01 * D);
        assert.ok(idx >= 1 && idx <= 2, `reduce: the pose is reached at once (frame ${idx}) ${JSON.stringify(results[reducedMotion])}`);
        assert.equal(between.length, 0, `reduce: no in-between frames ${JSON.stringify(results[reducedMotion])}`);
      } else {
        assert.ok(between.length >= 1, `standard: at least one frame between the poses ${JSON.stringify(results[reducedMotion])}`);
        assert.ok(reachedAt >= 150 && reachedAt <= 3000, `standard: a short move, not a cut or a slow drift (${reachedAt} ms) ${JSON.stringify(results[reducedMotion])}`);
        // No swing past the target or back toward the start.
        for (const s of samples) assert.ok(dist(s.p, end) <= D * 1.05 + 1e-4, `standard: no overshoot at ${s.t} ms`);
      }
      // Back to overview moves the same way.
      const back = await track(page, { type: 'landmarkOverview' }, 3500);
      const home = (await settle(page)).eye;
      const mid = back.filter((s) => dist(s.p, end) > 0.1 * D && dist(s.p, home) > 0.1 * D).length;
      if (reducedMotion === 'reduce') assert.equal(mid, 0, 'reduce: Back to overview is a cut too');
      else assert.ok(mid >= 1, 'standard: Back to overview glides');
      assert.ok(dist(home, start) <= 2e-3, `${reducedMotion}: back where it started`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log('# motion', JSON.stringify(results));
});

test('(c) Day / Golden Hour / Night and Restore keep the landmark pose and the selection; a landmark never moves the clock', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await direct(page);
    const original = await settle(page);
    await page.evaluate(() => window.__app.bus.emit({ type: 'togglePause' }));
    assert.equal(await page.evaluate(() => window.__app.clock.paused), true);
    const t0 = await now(page);
    await openList(page);
    for (const id of IDS) {
      await page.locator(`#landmark-${id}`).click();
      await page.waitForFunction((i) => window.__app.mission.landmark === i, id);
      await settle(page);
      assert.equal(await now(page), t0, `${id}: the clock is untouched`);
    }
    assert.equal(await page.evaluate(() => window.__app.sunsetPreview.state?.original ?? null), null, 'no time snapshot from a landmark');
    const framed = await pose(page);
    for (const [preset, sel] of [['day', '#preset-day'], ['golden', '#horizon-sunset'], ['night', '#preset-night']]) {
      await page.locator(sel).click();
      await page.waitForFunction((p) => document.querySelector(`#explore-time [data-preset="${p}"]`).getAttribute('aria-pressed') === 'true', preset);
      await nextFrames(page);
      samePose(await pose(page), framed, `${preset}: landmark pose kept`, 1e-4);
      assert.equal(await landmark(page), 'dish', `${preset}: selection kept`);
      assert.deepEqual(await pressedLandmarks(page), ['dish']);
      assert.ok(await overviewShown(page), `${preset}: Back to overview still offered`);
    }
    await page.locator('#restore-time').click();
    await page.locator('#restore-time').waitFor({ state: 'hidden' });
    assert.equal(await now(page), t0, 'Restore: exactly the original time');
    await nextFrames(page);
    samePose(await pose(page), framed, 'Restore: landmark pose kept', 1e-4);
    assert.equal(await landmark(page), 'dish');
    // A preset while framed, then Back to overview: the camera goes home, the time stays at the preset.
    await page.locator('#preset-night').click();
    const night = await now(page);
    await page.locator('#landmark-overview').click();
    await page.waitForFunction(() => window.__app.mission.landmark === null);
    samePose(await settle(page), original, 'overview after presets');
    assert.equal(await now(page), night, 'Back to overview leaves the clock alone');
    assert.deepEqual(await pressedPresets(page), ['night'], 'and the active preset');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('(d) leaving Explore mid-transition (Return to orbit, Esc, O) cancels it and clears the selection; re-entering starts fresh', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en', { reducedMotion: 'no-preference' });
  try {
    await direct(page);
    const fresh = await settle(page);
    const exits = {
      'Return to orbit': () => page.locator('#return-orbit').click(),
      'Esc on the card': async () => { await page.locator('#preset-day').focus(); await page.keyboard.press('Escape'); },
      'O key': async () => { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press('o'); },
    };
    for (const [name, leave] of Object.entries(exits)) {
      await frame(page, name === 'O key' ? 'habitat' : 'dish');
      await page.waitForFunction(() => window.__app.mission.landmark !== null);
      await nextFrames(page);
      await leave();
      await orbiting(page);
      assert.equal(await landmark(page), null, `${name}: selection cleared`);
      // The orbit view takes over: no landmark move continues under it, and the ground clip planes are given back.
      await page.waitForTimeout(600);
      assert.equal(await landmark(page), null, `${name}: still cleared`);
      assert.ok(await page.evaluate(() => window.__app.rig.camera.near > 0.002), `${name}: orbit clip planes back`);
      // Back in: no landmark, nothing pressed, no Back to overview, the default Explore pose.
      await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
      await exploring(page);
      assert.equal(await landmark(page), null, `${name}: re-entry starts with no landmark`);
      assert.deepEqual(await pressedLandmarks(page), [], `${name}: nothing pressed`);
      assert.equal(await overviewShown(page), false, `${name}: no stale Back to overview`);
      samePose(await settle(page), fresh, `${name}: re-entry settles on the fresh Explore pose`);
      // And Back to overview has nothing stale to return to: emitting it changes nothing.
      await overview(page);
      await nextFrames(page);
      samePose(await pose(page), fresh, `${name}: overview intent with no landmark is a no-op`);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

/** Explore → Landing Pad → Night → Back to overview → Return to orbit. */
async function padNightFlow(page, label) {
  await openList(page);
  const home = await settle(page);
  await page.locator('#landmark-pad').click();
  await page.waitForFunction(() => window.__app.mission.landmark === 'pad');
  const framed = await settle(page);
  assert.ok(differs(framed, home), `${label}: framed the pad`);
  assert.deepEqual(await pressedLandmarks(page), ['pad']);
  await page.locator('#preset-night').click();
  await page.waitForFunction(() => document.querySelector('#preset-night').getAttribute('aria-pressed') === 'true');
  await nextFrames(page);
  samePose(await pose(page), framed, `${label}: Night keeps the pad framing`, 1e-4);
  assert.equal(await landmark(page), 'pad');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/flow-${label}-pad-night.png` });
  await page.locator('#landmark-overview').click();
  await page.waitForFunction(() => window.__app.mission.landmark === null);
  samePose(await settle(page), home, `${label}: Back to overview`);
  assert.deepEqual(await pressedPresets(page), ['night'], `${label}: still Night`);
  await page.locator('#return-orbit').click();
  await orbiting(page);
  assert.equal(await landmark(page), null);
  assert.equal(await page.evaluate(() => window.__app.modes.mode), 'baseView', `${label}: back over the base`);
}

test('(e) Explore → Landing Pad → Night → Back to overview → Return to orbit: direct ?base=jezero', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en');
  try {
    await direct(page);
    await padNightFlow(page, 'direct');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('(e) the same flow after arriving from Tanegashima (Explore from the arrival card)', async () => {
  const { page, context, errors } = await open('lang=en');
  try {
    await arrive(page);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'journey-explore');
    await page.keyboard.press('Enter');
    await exploring(page);
    await padNightFlow(page, 'arrival');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('(f) keyboard: open the list, pick with Enter, Esc folds the list and keeps Explore with focus on the toggle', async () => {
  const { page, context, errors } = await open('base=jezero&lang=en', { viewport: PHONE });
  try {
    await direct(page);
    assert.equal(await listOpen(page), false, 'phones: the list starts folded');
    await page.locator('#explore-landmarks').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#explore-landmarks').getAttribute('aria-expanded') === 'true');
    assert.ok(await page.locator('#landmark-habitat').isVisible());
    // Tab reaches the landmarks in order; Enter frames the focused one.
    const order = [];
    for (let i = 0; i < 6 && order.at(-1) !== 'pad'; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement?.dataset.landmark ?? document.activeElement?.id ?? null));
    }
    assert.equal(order.at(-1), 'pad', `Tab reaches the Landing Pad (${order.join(' → ')})`);
    assert.ok(order.indexOf('habitat') < order.indexOf('pad'), `habitat before pad (${order.join(' → ')})`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__app.mission.landmark === 'pad');
    assert.equal(await page.locator('#landmark-pad').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'landmark-pad', 'focus stays on the chosen landmark');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#explore-landmarks').getAttribute('aria-expanded') === 'false');
    await nextFrames(page);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'explore-landmarks', 'focus on the toggle');
    assert.notEqual(await page.evaluate(() => window.__app.mission.horizon), null, 'Esc in the list stays in Explore');
    assert.equal(await landmark(page), 'pad', 'and keeps the landmark');
    // Back to overview by keyboard.
    await page.locator('#landmark-overview').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__app.mission.landmark === null);
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement !== document.body), 'focus not dropped to the body');
    // With the list folded, Esc on the card is still the way back to orbit.
    await page.locator('#explore-landmarks').focus();
    await page.keyboard.press('Escape');
    await orbiting(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const [vp, viewport] of [['phone', PHONE], ['land', LAND]]) {
  test(`(g) ${vp} (touch, webcam preview open): Return to orbit, the landmark controls and the time presets on screen and clear — en / my / ja`, async () => {
    for (const lang of ['en', 'my', 'ja']) {
      const { page, context, errors } = await open(`base=jezero&lang=${lang}`, { viewport, hasTouch: true });
      try {
        await direct(page);
        await page.evaluate(() => { const p = document.querySelector('#preview'); p.hidden = false; p.style.display = 'block'; p.style.height = '126px'; });
        const tag = (x) => `${lang} ${vp} ${JSON.stringify(x)}`;
        // Return to orbit is there without any scrolling.
        assert.ok(inView(await rect(page, '#return-orbit'), viewport), `#return-orbit in view on entry ${tag(await rect(page, '#return-orbit'))}`);
        await openList(page, true);
        await page.locator('#landmark-habitat').tap();
        await page.waitForFunction(() => window.__app.mission.landmark === 'habitat');
        await page.locator('#landmark-overview').waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/landmarks-${lang}-${vp}.png` });
        const controls = ['#return-orbit', '#explore-landmarks', '#landmark-habitat', '#landmark-pad', '#landmark-dish', '#landmark-overview', '#preset-day', '#horizon-sunset', '#preset-night'];
        // Controls never overlap one another (measured together: they scroll together in the card). Return to orbit
        // sits on the card's sticky bar: it is checked below, against each control scrolled into view.
        const all = await Promise.all(controls.map((s) => rect(page, s)));
        for (let i = 0; i < controls.length; i++) {
          assert.ok(all[i], `${controls[i]} rendered ${tag(lang)}`);
          if (controls[i] === '#return-orbit') continue;
          for (let j = i + 1; j < controls.length; j++) assert.ok(!overlaps(all[i], all[j]), `${controls[i]} clear of ${controls[j]} ${tag([all[i], all[j]])}`);
        }
        const others = ['#preview', '#gesture-flash', '#timebar', 'header.hud.top', '#clean-view'];
        for (const sel of controls) {
          // Each is reachable on screen (short landscape may scroll the card to it, never the page): focused, as a
          // keyboard or switch user reaches it, so the card's own handling keeps it clear of the sticky bar.
          await page.locator(sel).focus();
          await nextFrames(page);
          const card = await rect(page, '#mission-overlay');
          const r = await rect(page, sel);
          assert.ok(inView(r, viewport), `${sel} in view ${tag(r)}`);
          assert.ok(r.top >= card.top - 0.5 && r.bottom <= card.bottom + 0.5 && r.left >= card.left - 0.5 && r.right <= card.right + 0.5, `${sel} inside the card ${tag([r, card])}`);
          assert.ok(r.height >= 44 && r.width >= 44, `${sel} ≥ 44 px ${tag(r)}`);
          // Scrolled to, a control is not left under the sticky bar (Return to orbit's row).
          if (sel !== '#return-orbit') { const bar = await rect(page, '#mission-overlay .explore-bar'); assert.ok(!overlaps(r, bar), `${sel} clear of the sticky bar ${tag([r, bar])}`); }
          for (const other of others) assert.ok(!overlaps(r, await rect(page, other)), `${sel} clear of ${other} ${tag([r, await rect(page, other)])}`);
          for (const b of await rects(page, 'footer.hud :is(button, a)')) assert.ok(!overlaps(r, b), `${sel} clear of a footer control ${tag([r, b])}`);
        }
        assert.ok(!overlaps(await rect(page, '#mission-overlay'), await rect(page, '#preview')), `card clear of the preview ${tag(lang)}`);
        const clipped = await page.evaluate((sels) => sels.filter((s) => { const e = document.querySelector(s); return e && e.scrollWidth > e.clientWidth + 1; }), controls);
        assert.deepEqual(clipped, [], `${lang}: labels wrap, nothing clipped`);
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'no page scroll');
        await page.locator('#return-orbit').evaluate((e) => e.scrollIntoView({ block: 'nearest' }));
        await page.locator('#return-orbit').tap();
        await orbiting(page);
        assert.equal(await landmark(page), null);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
}
