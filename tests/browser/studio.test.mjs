// Experimental Planet Selection Studio (?flags=picker3d,studio): free mode's screens 2–3 drawn as a view of their own
// by the app's existing renderer and loop.
//   node --test --test-concurrency=1 tests/browser/studio.test.mjs
// Dev server. State is read and hand frames are INJECTED through the dev-only window.__app (synthetic observations,
// not a camera, not a hand). Desktop Chromium with the camera refused: nothing here is phone or real-hand evidence.
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

const STUDIO = 'flags=picker3d,studio';
async function open(path, { width = 1280, height = 800, lang = 'en' } = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height } });
  await context.addInitScript((lang) => {
    localStorage.setItem('gse.quality', 'low');
    localStorage.setItem('gse.lang', lang);
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
    // Raw counters: draw calls per WebGL context, the contexts created, listeners on window and document.
    const draws = new Map(), contexts = new Set(), listeners = { window: 0, document: 0 };
    for (const fn of ['drawElements', 'drawArrays', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = WebGL2RenderingContext.prototype[fn];
      WebGL2RenderingContext.prototype[fn] = function (...a) { draws.set(this, (draws.get(this) ?? 0) + 1); return original.apply(this, a); };
    }
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) { const c = getContext.call(this, type, ...a); if (c && /webgl/.test(type)) contexts.add(c); return c; };
    const name = (c) => c.canvas.id || c.canvas.parentElement?.id || 'canvas';
    window.__draws = () => Object.fromEntries([...contexts].map((c) => [name(c), draws.get(c) ?? 0]));
    window.__drawsReset = () => draws.clear();
    window.__contexts = () => contexts.size;
    for (const [label, target] of [['window', window], ['document', document]]) {
      const add = target.addEventListener, remove = target.removeEventListener;
      target.addEventListener = function (...a) { listeners[label]++; return add.apply(this, a); };
      target.removeEventListener = function (...a) { listeners[label]--; return remove.apply(this, a); };
    }
    window.__listeners = () => ({ ...listeners });
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + path);
  await page.waitForFunction(() => window.__app?.mission && window.__app.trackingFrame && document.querySelector('#status')?.dataset.kind === 'keyboard');
  return { context, page, errors };
}
const frames = (page, n = 20) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
/** Which WebGL contexts drew during n frames (true / false per canvas). */
const drew = async (page, n = 20) => { await frames(page, 3); await page.evaluate(() => window.__drawsReset()); await frames(page, n); return page.evaluate(() => Object.fromEntries(Object.entries(window.__draws()).map(([k, v]) => [k, v > 0]))); };
const entryShown = (page) => page.waitForFunction(() => window.__app.picker && !document.querySelector('#picker-entry').hidden);
const shown = (page) => page.waitForFunction(() => window.__app.picker && !document.querySelector('#destination-picker').hidden && window.__app.picker.view.currentTargets.length > 0);
const openStudio = async (page) => { await entryShown(page); await page.locator('#picker-open').click(); await shown(page); await frames(page, 6); };
const target = (id) => `#destination-picker .picker-target[data-base="${id}"]`;
const pose = (page, which) => page.evaluate((which) => { const a = window.__app, c = which === 'rig' ? a.rig.camera : a.localSpaceport.camera; return [...c.position.toArray(), ...c.quaternion.toArray(), c.fov, c.zoom, JSON.stringify(c.view)]; }, which);
/** Position, quaternion, fov and zoom within 1e-9, and the same view offset (when given). */
const samePose = (p, q) => p.slice(0, 9).every((v, i) => Math.abs(v - q[i]) < 1e-9) && p[9] === q[9];
const ui = (page) => page.evaluate(() => {
  const a = window.__app, vis = (s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const group = a.picker.view.object3d;
  return { mode: a.modes.mode, base: a.mission.base?.base.id ?? null, destination: a.mission.destination?.base.id ?? null,
    flow: a.flow.screen, preview: a.flow.preview, confirmed: a.flow.confirmed,
    studio: a.studio?.active ?? null, studioClass: document.body.classList.contains('studio-view'), flowClass: document.body.classList.contains('destination-flow'),
    orbsIn: group.parent === a.studio?.scene ? 'studio' : group.parent === a.system.scene ? 'system' : 'other',
    ground: a.localSpaceport.active, groundHidden: a.localSpaceport.host.hidden, groundStatus: a.localSpaceport.status,
    targets: a.picker.view.currentTargets.map((t) => t.baseId), hover: a.picker.logic.hover, progress: a.picker.logic.confirmProgress, waitingRelease: a.picker.logic.waitingRelease,
    charge: Number(document.querySelector('#destination-picker .picker-card')?.style.getPropertyValue('--charge') || 0),
    state: document.querySelector('#destination-picker .picker-state')?.textContent ?? '', chip: vis('#destination-picker .picker-confirmed'),
    entry: vis('#picker-entry'), hudTitle: vis('header.hud.top h1'), missionHud: vis('#mission-hud'), timebar: vis('#timebar'), basePanel: vis('#base-panel'),
    labels: getComputedStyle(document.querySelector('#labels')).visibility, focus: document.activeElement?.id || document.activeElement?.className || '',
    details: a.picker.view.detailsOpen, paused: a.clock.paused, clock: a.clock.time };
});
/** INJECTED hand frames, 50 ms apart (the method of destination-picker.test.mjs). */
function feed(page, ms, { pose, pointer = null, thumbsUp = false }) {
  return page.evaluate(({ ms, pose, pointer, thumbsUp }) => {
    const a = window.__app;
    a.__t ??= 100000;
    for (let i = 0; i <= ms; i += 50) {
      a.__t += 50;
      a.gestures.ui = { pose, action: null, pointer, hoverId: null, progress: 0 };
      a.gestures.lastObs = pose === null ? null : { pose, thumbsUp, center: pointer ?? { x: 0.5, y: 0.5 }, fingers: { thumb: thumbsUp, index: pose === 'point', middle: false, ring: false, pinky: false } };
      a.trackingFrame(a.__t);
    }
  }, { ms, pose, pointer, thumbsUp });
}
const thumbFor = (page, ms) => feed(page, ms, { pose: 'fist', thumbsUp: true });
const showHand = (page) => feed(page, 100, { pose: 'fist', thumbsUp: false });
const noHand = (page, ms) => feed(page, ms, { pose: null });
const orb = (page, id) => page.evaluate((id) => { const t = window.__app.picker.view.currentTargets.find((x) => x.baseId === id); return { x: t.x / innerWidth, y: t.y / innerHeight }; }, id);
const resources = (page) => page.evaluate(() => {
  const a = window.__app, i = a.renderer.info;
  return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length, orbObjects: a.picker.view.object3d.children.length,
    studioScene: a.studio.scene.children.length, systemScene: a.system.scene.children.length, pickerDom: document.querySelectorAll('#destination-picker *').length,
    canvases: document.querySelectorAll('canvas').length, contexts: window.__contexts(), listeners: window.__listeners() };
});

test('studio from the globe view: only the studio is drawn; Back restores the view, camera pose, controls, focus and mission', async () => {
  const { context, page, errors } = await open(`/?base=cape&${STUDIO}`);
  await entryShown(page);
  await page.evaluate(() => window.__app.bus.emit({ type: 'togglePause' })); // the app's own Pause: a still camera to compare
  await frames(page, 20);
  const before = { ui: await ui(page), pose: await pose(page, 'rig'), res: await resources(page) };
  assert.equal(before.ui.studio, false);
  await openStudio(page);
  const inside = await ui(page);
  assert.deepEqual({ studio: inside.studio, cls: inside.studioClass, orbsIn: inside.orbsIn, flow: inside.flow, labels: inside.labels }, { studio: true, cls: true, orbsIn: 'studio', flow: 'select', labels: 'hidden' });
  assert.deepEqual(await drew(page), { scene: true });
  // The rig keeps its position, orientation and lens. (Its view offset follows the page's panels, which the flow hides,
  // with or without the studio; it is compared after Back, below.)
  assert.ok(samePose(before.pose.slice(0, 9), (await pose(page, 'rig')).slice(0, 9)), 'the studio moved the rig camera');
  assert.equal(await page.evaluate(() => window.__app.studio.scene.children.length), 1, 'the studio scene holds the orb group only');
  await page.locator('#destination-picker .picker-back').click();
  await entryShown(page);
  await frames(page, 20);
  const after = { ui: await ui(page), pose: await pose(page, 'rig'), res: await resources(page) };
  assert.deepEqual({ studio: after.ui.studio, cls: after.ui.studioClass, flowCls: after.ui.flowClass, orbsIn: after.ui.orbsIn, flow: after.ui.flow, entry: after.ui.entry },
    { studio: false, cls: false, flowCls: false, orbsIn: 'system', flow: 'closed', entry: true });
  assert.ok(samePose(before.pose, after.pose), 'the rig camera pose changed across the studio');
  for (const k of ['hudTitle', 'missionHud', 'timebar', 'basePanel', 'labels', 'mode', 'base', 'destination', 'paused']) assert.equal(after.ui[k], before.ui[k], k);
  assert.equal(after.ui.focus, 'picker-open');
  // The first opening makes the picker's orbs and labels (counted in the repeated-cycles test); the page's canvases,
  // WebGL contexts and scenes are as they were.
  for (const k of ['canvases', 'contexts', 'studioScene', 'systemScene']) assert.equal(after.res[k], before.res[k], k);
  assert.deepEqual(errors, []);
  await context.close();
});

test('studio from the ground view: the ground renderer is kept but not drawn; Back restores the ground view and its camera', async () => {
  const { context, page, errors } = await open(`/?${STUDIO}`);
  await page.waitForFunction(() => window.__app.localSpaceport.active);
  await entryShown(page);
  await frames(page, 20);
  const before = { ui: await ui(page), pose: await pose(page, 'ground'), res: await resources(page), drew: await drew(page) };
  const groundCanvas = Object.keys(before.drew).find((k) => k !== 'scene');
  assert.deepEqual(before.drew, { scene: false, [groundCanvas]: true });
  await openStudio(page);
  const inside = await ui(page);
  assert.deepEqual({ studio: inside.studio, ground: inside.ground, hidden: inside.groundHidden, status: inside.groundStatus, orbsIn: inside.orbsIn }, { studio: true, ground: false, hidden: true, status: 'ready', orbsIn: 'studio' });
  assert.deepEqual(await drew(page), { scene: true, [groundCanvas]: false });
  // The mission clock is not stopped for the studio.
  const c0 = inside.clock;
  await page.waitForFunction((c0) => window.__app.clock.time > c0, c0);
  await page.locator('#destination-picker .picker-back').click();
  await page.waitForFunction(() => window.__app.localSpaceport.active);
  await entryShown(page);
  await frames(page, 20);
  const after = { ui: await ui(page), pose: await pose(page, 'ground'), res: await resources(page), drew: await drew(page) };
  assert.deepEqual({ studio: after.ui.studio, ground: after.ui.ground, hidden: after.ui.groundHidden, flow: after.ui.flow, orbsIn: after.ui.orbsIn, base: after.ui.base, destination: after.ui.destination },
    { studio: false, ground: true, hidden: false, flow: 'closed', orbsIn: 'system', base: 'cape', destination: null });
  assert.deepEqual(after.drew, { scene: false, [groundCanvas]: true });
  assert.ok(samePose(before.pose, after.pose), 'the ground camera pose changed across the studio');
  assert.equal(after.ui.focus, 'picker-open');
  assert.equal(after.res.canvases, before.res.canvases);
  assert.equal(after.res.contexts, before.res.contexts);
  assert.deepEqual(errors, []);
  await context.close();
});

test('studio: the existing controller drives it (preview, Details, stale charge, destination change, refusal, Confirm, Mission Ready, Launch)', async () => {
  const { context, page, errors } = await open(`/?base=cape&${STUDIO}`);
  await openStudio(page);
  // 👆: under 450 ms nothing; then a preview only.
  await feed(page, 400, { pose: 'point', pointer: await orb(page, 'jezero') });
  let s = await ui(page);
  assert.deepEqual({ preview: s.preview, hover: s.hover }, { preview: null, hover: 'jezero' });
  await feed(page, 150, { pose: 'point', pointer: await orb(page, 'jezero') });
  await frames(page, 3);
  s = await ui(page);
  assert.deepEqual({ preview: s.preview, flow: s.flow, destination: s.destination, confirmed: s.confirmed }, { preview: 'jezero', flow: 'select', destination: null, confirmed: null });
  // Details: opening cancels the charge; a 👍 held through it confirms nothing and owes a release afterwards.
  await showHand(page); await thumbFor(page, 250); await frames(page, 3);
  assert.ok((await ui(page)).charge > 0.3);
  await page.locator('#destination-picker .picker-details').click();
  await frames(page, 3);
  s = await ui(page);
  assert.deepEqual({ details: s.details, progress: s.progress, charge: s.charge }, { details: true, progress: 0, charge: 0 });
  await thumbFor(page, 1500); await frames(page, 3);
  assert.equal((await ui(page)).flow, 'select');
  await page.keyboard.press('Escape');
  await frames(page, 3);
  s = await ui(page);
  assert.equal(s.details, false);
  assert.match(s.focus, /picker-details/);
  await thumbFor(page, 2000); await frames(page, 3);
  s = await ui(page);
  assert.deepEqual({ flow: s.flow, charge: s.charge, waitingRelease: s.waitingRelease }, { flow: 'select', charge: 0, waitingRelease: true });
  // Tracking loss and a camera stop leave no charge.
  await showHand(page); await thumbFor(page, 250); await frames(page, 3);
  assert.ok((await ui(page)).charge > 0.3);
  await noHand(page, 400); await frames(page, 3);
  s = await ui(page);
  assert.deepEqual({ progress: s.progress, charge: s.charge, flow: s.flow }, { progress: 0, charge: 0, flow: 'select' });
  await showHand(page); await thumbFor(page, 250); await frames(page, 3);
  await page.evaluate(() => window.__app.trackingDeps.stopped());
  await frames(page, 3);
  s = await ui(page);
  assert.deepEqual({ progress: s.progress, charge: s.charge, flow: s.flow }, { progress: 0, charge: 0, flow: 'select' });
  // A destination change mid-hold: nothing confirms, a release must be observed (no hand seen is not one).
  await showHand(page); await thumbFor(page, 250);
  await page.locator(target('kraken')).click();
  await thumbFor(page, 2000); await frames(page, 3);
  s = await ui(page);
  assert.deepEqual({ flow: s.flow, preview: s.preview, confirmed: s.confirmed, waitingRelease: s.waitingRelease }, { flow: 'select', preview: 'kraken', confirmed: null, waitingRelease: true });
  await noHand(page, 300); await thumbFor(page, 2000); await frames(page, 3);
  assert.equal((await ui(page)).flow, 'select');
  // The same destination chosen again keeps the hold.
  await showHand(page); await thumbFor(page, 200);
  await page.locator(target('kraken')).click();
  await thumbFor(page, 200); await frames(page, 3);
  assert.ok((await ui(page)).progress > 0.5);
  await showHand(page);
  // A refusal (INJECTED: the mission's own choose() made a no-op) stays on the selection; the held 👍 does not retry.
  await page.evaluate(() => { window.__app.mission.choose = () => {}; });
  await thumbFor(page, 700); await frames(page, 4);
  s = await ui(page);
  assert.deepEqual({ flow: s.flow, confirmed: s.confirmed, destination: s.destination, chip: s.chip, studio: s.studio }, { flow: 'select', confirmed: null, destination: null, chip: false, studio: true });
  assert.ok(s.state.length > 0, 'the refusal is not shown');
  await thumbFor(page, 2000); await frames(page, 3);
  assert.equal((await ui(page)).flow, 'select');
  await page.evaluate(() => { delete window.__app.mission.choose; });
  // A fresh hold: under 500 ms nothing; then Confirm, and Mission Ready once the mission has the destination.
  await showHand(page); await thumbFor(page, 400); await frames(page, 3);
  assert.equal((await ui(page)).flow, 'select');
  await thumbFor(page, 150); await frames(page, 4);
  s = await ui(page);
  assert.deepEqual({ flow: s.flow, confirmed: s.confirmed, destination: s.destination, studio: s.studio }, { flow: 'confirm', confirmed: 'kraken', destination: 'kraken', studio: true });
  // The 👍 that confirmed cannot launch.
  await thumbFor(page, 3000); await frames(page, 4);
  s = await ui(page);
  assert.deepEqual({ mode: s.mode, flow: s.flow }, { mode: 'baseView', flow: 'confirm' });
  assert.ok(s.state.length > 0, 'no release instruction on Mission Ready');
  // Mission Ready: no planet is a control: no hit targets, one disabled name, 👆 and ← → choose nothing.
  assert.deepEqual(s.targets, []);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#destination-picker .picker-target')].filter((b) => !b.hidden).map((b) => [b.dataset.base, b.disabled])), [['kraken', true]]);
  const elsewhere = await page.evaluate(() => { const t = window.__app.picker.view.targets.find((x) => x.baseId === 'jezero'); return { x: t.x / innerWidth, y: t.y / innerHeight }; });
  await showHand(page); await feed(page, 1200, { pose: 'point', pointer: elsewhere });
  await page.keyboard.press('ArrowRight');
  await frames(page, 3);
  s = await ui(page);
  assert.deepEqual({ flow: s.flow, confirmed: s.confirmed, preview: s.preview, hover: s.hover }, { flow: 'confirm', confirmed: 'kraken', preview: 'kraken', hover: null });
  // Back to the selection keeps the confirmation; a held Enter confirms once and is never Launch.
  await page.locator('#destination-picker .picker-back').click();
  await frames(page, 4);
  s = await ui(page);
  assert.deepEqual({ flow: s.flow, confirmed: s.confirmed, studio: s.studio }, { flow: 'select', confirmed: 'kraken', studio: true });
  await page.locator('#destination-picker .picker-confirm').focus();
  for (let i = 0; i < 14; i++) { await page.keyboard.down('Enter'); await frames(page, 2); }
  s = await ui(page);
  await page.keyboard.up('Enter');
  assert.deepEqual({ flow: s.flow, mode: s.mode }, { flow: 'confirm', mode: 'baseView' });
  // A fresh hold launches: the studio ends, the accepted destination stays.
  await showHand(page); await thumbFor(page, 600);
  await page.waitForFunction(() => ['launch', 'travel'].includes(window.__app.modes.mode));
  await frames(page, 6);
  s = await ui(page);
  assert.deepEqual({ studio: s.studio, cls: s.studioClass, orbsIn: s.orbsIn, destination: s.destination }, { studio: false, cls: false, orbsIn: 'system', destination: 'kraken' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('studio: repeated open and close do not add studio objects, DOM, canvases, contexts or listeners', async () => {
  const { context, page, errors } = await open(`/?base=cape&${STUDIO}`);
  const cycle = async (id) => {
    await page.locator('#picker-open').click(); await shown(page);
    await page.locator(target(id)).click(); await frames(page, 4);
    await page.locator('#destination-picker .picker-back').click(); await entryShown(page); await frames(page, 4);
  };
  await entryShown(page);
  // One round first: every orb, label and material the picker makes exists after it.
  for (const id of ['jezero', 'kraken', 'tranquility', 'conamara']) await cycle(id);
  const first = await resources(page);
  for (let i = 0; i < 12; i++) await cycle(['jezero', 'kraken', 'tranquility', 'conamara'][i % 4]);
  assert.deepEqual(await resources(page), first);
  assert.deepEqual(await page.evaluate(() => { const s = window.__app.studio; return { active: s.active, balanced: s.stats.entered === s.stats.exited, entered: s.stats.entered }; }), { active: false, balanced: true, entered: 16 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('studio: without the studio flag, and in Guided, it never activates', async () => {
  { // picker3d alone: the picker as it was
    const { context, page, errors } = await open('/?base=cape&flags=picker3d');
    await entryShown(page); await page.locator('#picker-open').click(); await shown(page); await frames(page, 10);
    assert.deepEqual(await page.evaluate(() => ({ studio: typeof window.__app.studio, cls: document.body.classList.contains('studio-view'), inSystem: window.__app.picker.view.object3d.parent === window.__app.system.scene,
      title: document.querySelector('.picker-studio-title').hidden, layout: document.querySelector('#destination-picker').dataset.studio ?? null })), { studio: 'undefined', cls: false, inSystem: true, title: true, layout: null });
    await page.locator(target('jezero')).click();
    await page.locator('#destination-picker .picker-confirm').click();
    await page.waitForFunction(() => window.__app.flow.screen === 'confirm');
    await frames(page, 10);
    assert.deepEqual(await page.evaluate(() => window.__app.picker.view.currentTargets.map((t) => t.baseId)), ['jezero']);
    assert.deepEqual(errors, []);
    await context.close();
  }
  { // the studio flag without picker3d: nothing
    const { context, page, errors } = await open('/?base=cape&flags=studio');
    await page.waitForTimeout(1000);
    assert.deepEqual(await page.evaluate(() => ({ picker: document.querySelector('#destination-picker'), studio: typeof window.__app.studio })), { picker: null, studio: 'undefined' });
    assert.deepEqual(errors, []);
    await context.close();
  }
  { // Guided's destination step with both flags: Guided's own card, the solar-system scene
    const { context, page, errors } = await open(`/?base=cape&flags=astrolife,guided,picker3d,studio`);
    for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__app.guided.requestConfirm()); await page.waitForTimeout(200); }
    await page.waitForFunction(() => window.__app.guided.session.stage === 'destination');
    await shown(page); await frames(page, 20);
    assert.deepEqual(await page.evaluate(() => { const a = window.__app; return { active: a.studio.active, entered: a.studio.stats.entered, drawn: a.studio.stats.frames, cls: document.body.classList.contains('studio-view'),
      inSystem: a.picker.view.object3d.parent === a.system.scene, title: document.querySelector('.picker-studio-title').hidden, flow: a.flow.screen }; }),
      { active: false, entered: 0, drawn: 0, cls: false, inSystem: true, title: true, flow: 'closed' });
    assert.deepEqual(errors, []);
    await context.close();
  }
});

/** The studio's geometry on the page, and what is wrong with it. */
const look = (page) => page.evaluate(() => {
  const a = window.__app, vw = innerWidth, vh = innerHeight, issues = [];
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const key = (o) => [o.l, o.t, o.r, o.b].map((x) => Math.round(x * 10) / 10).join(',');
  const hit = (p, q) => p.l < q.r - 0.5 && q.l < p.r - 0.5 && p.t < q.b - 0.5 && q.t < p.b - 0.5;
  const inView = (p) => p.l >= -0.5 && p.t >= -0.5 && p.r <= vw + 0.5 && p.b <= vh + 0.5;
  const vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const card = document.querySelector('#destination-picker .picker-card'), cr = R(card), title = document.querySelector('.picker-studio-title');
  const hud = [...document.querySelectorAll('header.hud, footer.hud > *, #mission-hud, #base-panel, #timebar, #info')].filter(vis).map(R).filter((r) => r.r > r.l && r.b > r.t);
  const slots = a.picker.view.targets, labels = [...document.querySelectorAll('#destination-picker .picker-target')].filter(vis).map((e) => ({ id: e.dataset.base, ...R(e) }));
  // each planet as drawn at its largest: selected (× 1.12) with its ring (1.14 r)
  const balls = slots.map((t) => ({ id: t.baseId, x: t.x, y: t.y, rad: t.r, l: t.x - t.r * 1.28, t: t.y - t.r * 1.28, r: t.x + t.r * 1.28, b: t.y + t.r * 1.28 }));
  for (const b of balls) { if (!inView(b)) issues.push(`planet ${b.id} leaves the viewport`); if (hit(b, cr)) issues.push(`planet ${b.id} overlaps the console`); if (hud.some((h) => hit(b, h))) issues.push(`planet ${b.id} overlaps the HUD`); }
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) if (Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y) < 88) issues.push(`planets ${balls[i].id}/${balls[j].id} under 88 px apart`);
  for (const l of labels) {
    if (!inView(l)) issues.push(`label ${l.id} off-screen`);
    if (l.b - l.t < 43.5) issues.push(`label ${l.id} under 44 px`);
    if (hit(l, cr)) issues.push(`label ${l.id} overlaps the console`);
    if (hud.some((h) => hit(l, h))) issues.push(`label ${l.id} overlaps the HUD`);
    for (const b of balls) if (b.id !== l.id && hit(l, { l: b.x - b.rad, t: b.y - b.rad, r: b.x + b.rad, b: b.y + b.rad })) issues.push(`label ${l.id} overlaps planet ${b.id}`);
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (hit(labels[i], labels[j])) issues.push(`labels ${labels[i].id}/${labels[j].id} overlap`);
  if (!inView(cr)) issues.push('console off-screen');
  if (hud.some((h) => hit(cr, h))) issues.push('console overlaps the HUD');
  if (card.scrollHeight > card.clientHeight + 1) issues.push(`console scrolls (${card.scrollHeight} > ${card.clientHeight})`);
  if (!vis(title)) issues.push('title not visible');
  else { const tr = R(title); if (!inView(tr)) issues.push('title off-screen'); if (hud.some((h) => hit(tr, h))) issues.push('title overlaps the HUD'); if (title.scrollWidth > title.clientWidth + 1) issues.push('title clipped'); }
  const back = card.querySelector('.picker-back'), action = card.querySelector('.picker-confirm');
  for (const [k, e] of [['Back', back], ['the action', action]]) {
    if (!vis(e)) { issues.push(`${k} not visible`); continue; }
    const r = R(e);
    if (!inView(r) || r.t < cr.t - 0.5 || r.b > cr.b + 0.5) issues.push(`${k} outside the console`);
    if (r.b - r.t < 43.5) issues.push(`${k} under 44 px`);
    const top = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2);
    if (!(top === e || e.contains(top))) issues.push(`${k} covered`);
  }
  if (document.documentElement.scrollWidth > vw) issues.push('horizontal page scroll');
  return { issues, arrangement: document.querySelector('#destination-picker').dataset.studio, title: title.textContent,
    slots: slots.map((t) => [t.baseId, Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(t.r * 10) / 10].join(':')).join(' '), card: key(cr), action: key(R(action)), back: key(R(back)) };
});
const TITLES = { en: ['Choose a destination', 'Ready for departure'], ja: ['行き先を選ぶ', '出発準備'], my: ['သွားမည့်နေရာ ရွေးရန်', 'ထွက်ခွာရန် အသင့်'] };
for (const [width, height, arrangement] of [[1280, 800, 'arc'], [780, 590, 'arc'], [390, 844, 'arc'], [844, 390, 'row']]) {
  test(`studio layout ${width}×${height} (EN / JA / MY): ${arrangement}; whole, clear of the HUD, and still within each screen`, async () => {
    for (const lang of ['en', 'ja', 'my']) {
      const { context, page, errors } = await open(`/?base=cape&${STUDIO}`, { width, height, lang });
      await openStudio(page);
      // The card's measured height settles once after opening (as outside the studio): wait for two equal looks.
      await page.waitForFunction(() => { const c = document.querySelector('#destination-picker .picker-card'), k = c.dataset.place; const same = window.__place === k; window.__place = k; return same; }, null, { polling: 400 });
      const problems = [];
      const note = (step, s, home, keys = []) => { for (const i of s.issues) problems.push(`${lang} ${step}: ${i}`); for (const k of keys) if (s[k] !== home[k]) problems.push(`${lang} ${step}: ${k} moved (${home[k]} → ${s[k]})`); };
      const within = ['slots', 'card', 'action', 'back'];
      const home = await look(page);
      note('unselected', home);
      assert.equal(home.arrangement, arrangement, lang);
      assert.equal(home.title, TITLES[lang][0]);
      await page.locator(target('jezero')).click(); await page.waitForTimeout(400);
      note('selected', await look(page), home, within);
      await showHand(page); await thumbFor(page, 250); await frames(page, 4);
      note('charging', await look(page), home, within);
      await page.locator(target('kraken')).click(); await thumbFor(page, 600); await frames(page, 4);
      note('release owed', await look(page), home, within);
      await page.evaluate(() => window.__app.trackingDeps.stopped()); await frames(page, 3);
      note('camera stopped', await look(page), home, within);
      await showHand(page); await thumbFor(page, 600);
      await page.waitForFunction(() => window.__app.flow.screen === 'confirm');
      await page.waitForTimeout(400);
      await page.waitForFunction(() => { const c = document.querySelector('#destination-picker .picker-card'), k = c.dataset.place; const same = window.__place3 === k; window.__place3 = k; return same; }, null, { polling: 400 });
      const ready = await look(page);
      note('Mission Ready', ready, home, ['slots']); // the planets keep their slots across the two screens
      assert.equal(ready.title, TITLES[lang][1]);
      await thumbFor(page, 800); await frames(page, 4);
      note('Mission Ready, release owed', await look(page), ready, within);
      await showHand(page); await thumbFor(page, 250); await frames(page, 4);
      note('Mission Ready, charging', await look(page), ready, within);
      assert.deepEqual(problems, []);
      assert.deepEqual(errors, []);
      await context.close();
    }
  });
}
