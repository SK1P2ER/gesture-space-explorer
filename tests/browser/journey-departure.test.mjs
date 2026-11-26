// Sprint 2 · readable departure (Tanegashima → Jezero Dome): the mission's launch presentation frames the pad and
// rocket together until the rocket really rises, then follows it, and hands over to the flight shortly after.
//   node --test --test-concurrency=1 tests/browser/journey-departure.test.mjs
// Dev server; mission state is read and driven through the dev-only window.__app. Synthetic: no camera, no hand.
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

const ROUTE = '/?site=ground&base=tanegashima&lang=en';

async function open(reducedMotion = 'no-preference') {
  const context = await browser.newContext({ reducedMotion, viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + ROUTE);
  await page.waitForFunction(() => window.__app?.mission && window.__app.spaceport && window.__app.mission.base?.base.id === 'cape');
  return { context, page, errors };
}

/** The real mission: Jezero chosen, the countdown started (handled by the mission itself, as Launch does). */
const launchMission = (page) => page.evaluate(() => {
  const m = window.__app.mission;
  m.handle({ type: 'chooseDestination', baseId: 'jezero' });
  m.handle({ type: 'launch' });
  return { mode: window.__app.modes.mode, countdown: !!m.countdown, destination: m.destination?.base.id };
});

/** Starts sampling the departure every animation frame (window.__departure). */
const sample = (page) => page.evaluate(() => {
  const out = window.__departure = { samples: [], startedAt: null, endedAt: null };
  const tick = () => {
    const v = window.__app.spaceport.owner?.preview;
    const open = !!window.__app.spaceport.owner?.missionLaunch;
    if (v && open && v.departureShot) {
      out.startedAt ??= performance.now();
      out.samples.push({ t: v.time, lifted: v.liftedOff, shot: v.departureShot, liftoffAt: v.liftoffAt, easing: v.easing });
    } else if (out.startedAt !== null && out.endedAt === null) out.endedAt = performance.now();
    if (out.endedAt === null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/** Is everything in `points` (world) inside the camera's view (NDC, with a little margin)? */
const inFrame = (page) => page.evaluate(() => {
  const v = window.__app.spaceport.owner.preview;
  const cam = v.camera;
  cam.updateMatrixWorld();
  const P = cam.position.constructor;
  const corners = [];
  // The Launch Pad subjects (padFraming.ts PAD_SUBJECTS hero + deck), i.e. the rocket stack, gantry and pad slab.
  for (const [min, max] of [[[-12, 8.5, -24], [35, 68, 22]], [[-22, 6, -24], [35, 10, 24]]])
    for (let i = 0; i < 8; i++) corners.push(new P(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]));
  const rocket = v.rocket.getWorldPosition(new P());
  const ndc = [...corners, rocket].map((p) => p.clone().project(cam));
  return { ok: ndc.every((p) => Math.abs(p.x) <= 1.02 && Math.abs(p.y) <= 1.02 && p.z < 1), rocket: ndc.at(-1) };
});

test('departure: pad and rocket framed together until the rocket rises, Follow only after liftoff, brief, then the flight', async () => {
  const { context, page, errors } = await open();
  try {
    assert.deepEqual(await launchMission(page), { mode: 'launch', countdown: true, destination: 'jezero' });
    await sample(page);
    // The countdown runs (3 s), then the presentation opens on the pad.
    await page.waitForFunction(() => window.__app.spaceport.owner?.preview?.departureShot === 'pad' && window.__app.spaceport.owner.preview.playing, null, { timeout: 180000 });
    const first = await page.evaluate(() => { const v = window.__app.spaceport.owner.preview; return { shot: v.departureShot, lifted: v.liftedOff, time: v.time, view: v.activePreset }; });
    assert.equal(first.shot, 'pad'); assert.equal(first.lifted, false); assert.equal(first.view, 'pad');
    assert.ok(first.time >= 5 && first.time < 9, `starts shortly before liftoff, got ${first.time}`);
    const framed = await inFrame(page);
    assert.ok(framed.ok, `pad and rocket in frame before liftoff: ${JSON.stringify(framed.rocket)}`);
    assert.match(await page.locator('#spaceport-view h2').textContent(), /Jezero|Mars/);
    // The flight takes over by itself.
    await page.waitForFunction(() => window.__departure.endedAt !== null && window.__app.modes.mode === 'travel', null, { timeout: 180000 });
    const d = await page.evaluate(() => window.__departure);
    assert.ok(d.samples.length > 5, 'sampled frames');
    for (const s of d.samples) if (!s.lifted && s.liftoffAt === null) assert.equal(s.shot, 'pad', `follow before liftoff at t=${s.t}`);
    const liftoff = d.samples.find((s) => s.shot === 'follow');
    assert.ok(liftoff, 'Follow began');
    assert.ok(liftoff.lifted, 'Follow began on an observed liftoff');
    assert.ok(liftoff.liftoffAt >= 8.5 && liftoff.liftoffAt <= 10, `liftoff at the animation's rise, got ${liftoff.liftoffAt}`);
    const last = d.samples.at(-1);
    assert.ok(last.t - first.time <= 10.5, `presentation ≤ ~10 s of launch time, got ${(last.t - first.time).toFixed(2)}`);
    assert.ok(last.t < 479 / 24 - 1, 'ends before the authored end');
    assert.ok((d.endedAt - d.startedAt) / 1000 < 60, `wall time bounded (headless): ${((d.endedAt - d.startedAt) / 1000).toFixed(1)} s`);
    assert.equal(await page.evaluate(() => window.__app.mission.trip?.to.base.id), 'jezero');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('departure: Escape during the presentation cancels the launch; the mission is back on the base with Jezero kept', async () => {
  const { context, page, errors } = await open();
  try {
    await launchMission(page);
    await page.waitForFunction(() => window.__app.spaceport.owner?.preview?.departureShot === 'pad', null, { timeout: 180000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && !window.__app.mission.presentingLaunch);
    const s = await page.evaluate(() => ({ destination: window.__app.mission.destination?.base.id, base: window.__app.mission.base?.base.id, dialog: !!window.__app.spaceport.owner?.active, countdown: !!window.__app.mission.countdown, trip: !!window.__app.mission.trip }));
    assert.deepEqual(s, { destination: 'jezero', base: 'cape', dialog: false, countdown: false, trip: false });
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.__app.modes.mode), 'baseView', 'nothing relaunched by itself');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('departure, reduced motion: one still of the pad (no camera move), the destination title shown, then a cut to the flight', async () => {
  const { context, page, errors } = await open('reduce');
  try {
    // Mission.liftoff does not present in reduced motion today; the presentation itself is checked directly.
    await page.evaluate(() => {
      window.__done = null;
      const sp = window.__app.spaceport;
      sp.render('en', true, true);
      sp.startLaunch('Jezero Dome', () => { window.__done = { kind: 'complete', at: performance.now() }; }, () => { window.__done = { kind: 'cancel', at: performance.now() }; });
    });
    await page.waitForFunction(() => window.__app.spaceport.owner?.preview?.departureShot === 'pad', null, { timeout: 180000 });
    const at = await page.evaluate(() => performance.now());
    const still = await page.evaluate(() => { const o = window.__app.spaceport.owner, v = o.preview; return { motion: o.departureMotion, playing: v.playing, easing: v.easing, view: v.activePreset }; });
    assert.deepEqual(still, { motion: 'reduced', playing: false, easing: false, view: 'pad' });
    assert.match(await page.locator('#spaceport-view h2').textContent(), /Jezero Dome/);
    assert.ok((await inFrame(page)).ok, 'pad and rocket in the still');
    await page.waitForFunction(() => window.__done !== null, null, { timeout: 30000 });
    const done = await page.evaluate(() => window.__done);
    assert.equal(done.kind, 'complete');
    assert.ok(done.at - at < 6000, `brief hold, got ${Math.round(done.at - at)} ms`);
    assert.equal(await page.evaluate(() => window.__app.spaceport.owner.active), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
