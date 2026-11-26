// SPCE-LINE arrival framing (Tanegashima → Jezero only): while the arrival card shows, Mars and the Jezero base are
// framed in the space the card leaves free (the camera rig's existing view insets; chrome measures the card like the
// other covering panels). Reduced motion: a cut; otherwise a short ease. Direct Jezero visits are unchanged.
//   node --test --test-concurrency=1 tests/browser/journey-framing.test.mjs
// Dev server; the mission is driven through the dev-only window.__app (bus intents, flight shortened, auto-land).
// Synthetic: no camera, no real hand. Chromium, a fresh profile per test.
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

const VIEWPORTS = { desk: { width: 1280, height: 800 }, phone: { width: 390, height: 844 }, land: { width: 844, height: 390 } };

async function open(query, viewport, reducedMotion = 'reduce') {
  const touch = viewport.width < 900;
  const context = await browser.newContext({ reducedMotion, viewport, hasTouch: touch, isMobile: touch });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?${query}`);
  await page.waitForFunction(() => window.__app?.mission && window.__app.journey && document.querySelector('#status')?.dataset.kind === 'keyboard');
  return { context, page, errors };
}

/** Tanegashima → Jezero, flight shortened, auto-land; resolves when the arrival card is up. */
async function arrive(page) {
  await page.evaluate(() => window.__app.bus.emit({ type: 'enterBase', baseId: 'cape' }));
  await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'cape');
  await page.evaluate(() => { window.__app.bus.emit({ type: 'chooseDestination', baseId: 'jezero' }); window.__app.bus.emit({ type: 'launch' }); });
  await page.waitForFunction(() => window.__app.modes.mode === 'travel' && window.__app.mission.trip);
  await page.evaluate(() => { const t = window.__app.mission.trip; t.elapsed = t.seconds - 0.01; });
  await page.waitForFunction(() => window.__app.modes.mode === 'docking');
  await page.evaluate(() => window.__app.bus.emit({ type: 'select' }));
  await page.waitForFunction(() => window.__app.journey.phase === 'arrived' && !document.querySelector('#journey-arrival').hidden);
}

/**
 * Where the Jezero base (pad centre: the rig's target) and Mars's centre land on screen with the camera as drawn,
 * plus the card's rect, the rig's insets and what it currently shows.
 */
const probe = (page) => page.evaluate(() => {
  const a = window.__app, cam = a.rig.camera;
  const mars = a.system.nodes.find((n) => n.body.id === 'mars');
  const toScreen = (obj) => {
    const v = obj.getWorldPosition(obj.position.clone());
    const ndc = v.clone().project(cam);
    return { x: (ndc.x + 1) / 2 * innerWidth, y: (1 - ndc.y) / 2 * innerHeight, front: ndc.z < 1 };
  };
  cam.updateMatrixWorld();
  const card = document.querySelector('#journey-arrival');
  const r = card && !card.hidden && card.getClientRects().length ? card.getBoundingClientRect() : null;
  return {
    base: toScreen(a.mission.base.group), mars: toScreen(mars.mesh),
    card: r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    insets: { ...a.rig.viewInsets }, shown: { ...a.rig.shown }, width: innerWidth, height: innerHeight,
  };
});
const inside = (p, r) => !!r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
const settled = (page) => page.waitForFunction(() => {
  const r = window.__app.rig;
  return ['top', 'right', 'bottom', 'left'].every((k) => Math.abs(r.shown[k] - r.viewInsets[k]) < 0.003);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name}: with the arrival card up, the Jezero base is in view and clear of the card${name === 'land' ? ', on the left half' : ''}`, async () => {
    const { page, context, errors } = await open('lang=my', viewport);
    try {
      await arrive(page);
      await page.waitForTimeout(400); // chrome's measure + any card placement settle
      await settled(page);
      const p = await probe(page);
      const msg = JSON.stringify(p);
      assert.ok(p.card, `card shown ${msg}`);
      assert.ok(p.base.front && p.base.x >= 0 && p.base.x <= p.width && p.base.y >= 0 && p.base.y <= p.height, `base in view ${msg}`);
      assert.ok(!inside(p.base, p.card), `base clear of the card ${msg}`);
      assert.ok(p.mars.front, `Mars in front of the camera ${msg}`);
      // The card counts as covering UI: some inset reserves its side.
      assert.ok(Object.values(p.insets).some((v) => v > 0.05), `insets reserve the card ${msg}`);
      if (name === 'land') {
        // Worker C's landscape card sits on the right; Mars then favours the left. Only asserted once that holds.
        if (p.card.left > p.width / 2 - 1) assert.ok(p.base.x < p.width / 2, `landscape: base on the left half ${msg}`);
        else console.log(`# landscape card not on the right yet (left ${Math.round(p.card.left)}): left-half rule not asserted`);
      }
      if (name === 'phone' && p.card.top > p.height / 2) assert.ok(p.base.y < p.card.top, `portrait: base above the card ${msg}`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('reduced motion: the card\'s framing is a cut (shown = insets as soon as measured); otherwise it eases', async () => {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const { page, context, errors } = await open('lang=en', VIEWPORTS.desk, reducedMotion);
    try {
      await page.evaluate(() => window.__app.bus.emit({ type: 'enterBase', baseId: 'cape' }));
      await page.waitForFunction(() => window.__app.modes.mode === 'baseView' && window.__app.mission.base?.base.id === 'cape');
      await page.evaluate(() => { window.__app.bus.emit({ type: 'chooseDestination', baseId: 'jezero' }); window.__app.bus.emit({ type: 'launch' }); });
      await page.waitForFunction(() => window.__app.modes.mode === 'travel' && window.__app.mission.trip, null, { timeout: 120000 });
      await page.evaluate(() => { const t = window.__app.mission.trip; t.elapsed = t.seconds - 0.01; });
      await page.waitForFunction(() => window.__app.modes.mode === 'docking');
      await page.evaluate(() => window.__app.bus.emit({ type: 'select' }));
      // Sample every frame from the card's first frame until the card's inset is in.
      const samples = await page.evaluate(() => new Promise((resolve) => {
        const out = [];
        const tick = () => {
          const a = window.__app, card = document.querySelector('#journey-arrival');
          if (a.journey.phase === 'arrived' && !card.hidden) {
            out.push({ insets: { ...a.rig.viewInsets }, shown: { ...a.rig.shown } });
            if (out.length >= 30) return resolve(out);
          }
          requestAnimationFrame(tick);
        };
        tick();
      }));
      const gap = (s) => Math.max(...['top', 'right', 'bottom', 'left'].map((k) => Math.abs(s.shown[k] - s.insets[k])));
      // The first sample after the card's inset appeared (insets changed from the pre-card value).
      const first = samples.findIndex((s, i) => i > 0 && JSON.stringify(s.insets) !== JSON.stringify(samples[0].insets));
      const changedAt = first === -1 ? 0 : first;
      const afterChange = samples.slice(changedAt + 1, changedAt + 3);
      if (reducedMotion === 'reduce') {
        assert.ok(afterChange.every((s) => gap(s) < 0.003), `reduced: shown equals insets right away ${JSON.stringify(samples.slice(0, changedAt + 3))}`);
      } else {
        assert.ok(samples.slice(changedAt, changedAt + 3).some((s) => gap(s) > 0.003), `animated: the framing eases ${JSON.stringify(samples.slice(0, changedAt + 4))}`);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('the card\'s inset goes when exploring (horizon) and is not back on return; a direct Jezero visit has none', async () => {
  const { page, context, errors } = await open('lang=en', VIEWPORTS.desk);
  try {
    await arrive(page);
    await page.waitForTimeout(400);
    const withCard = await probe(page);
    await page.locator('#journey-explore').click();
    await page.waitForFunction(() => window.__app.mission.horizon !== null && document.querySelector('#journey-arrival').hidden);
    await page.evaluate(() => window.__app.bus.emit({ type: 'toggleHorizon' }));
    await page.waitForFunction(() => window.__app.mission.horizon === null);
    await page.waitForTimeout(500);
    const back = await probe(page);
    assert.equal(back.card, null);
    // Without the card, the top inset (desktop card is near the top) shrinks back.
    assert.ok(back.insets.top < withCard.insets.top || withCard.insets.top === 0, `card inset released ${JSON.stringify({ withCard: withCard.insets, back: back.insets })}`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  // Direct visit: no journey, no card, same framing rules as before (no card in the covering set's rects).
  for (const viewport of Object.values(VIEWPORTS)) {
    const { page, context, errors } = await open('base=jezero&lang=my', viewport);
    try {
      await page.waitForFunction(() => window.__app.mission.base?.base.id === 'jezero' && window.__app.modes.mode === 'baseView' && window.__app.showcases.get('jezero'));
      await page.waitForTimeout(800);
      const p = await probe(page);
      assert.equal(p.card, null);
      assert.equal(await page.evaluate(() => window.__app.journey.phase), null);
      assert.ok(p.base.front && p.base.x >= 0 && p.base.x <= p.width && p.base.y >= 0 && p.base.y <= p.height, `direct: base in view ${JSON.stringify(p)}`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
