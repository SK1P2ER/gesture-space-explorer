// Launch preview: the timeline explains the phase, one hint explains the next hand step, and neither moves a control.
//   node --test --test-concurrency=1 tests/browser/spaceport-timeline.test.mjs
// Dev server. Hand frames are INJECTED through the dev-only window.__app (synthetic observations, not a camera), as in
// spaceport-gestures.test.mjs. TIMELINE_SHOTS=<dir> also saves review screenshots with the 3D scene (not compared).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
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
const SHOTS = process.env.TIMELINE_SHOTS;
let server, browser, url;
before(async () => {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  await warmUp(chromium, url);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { args: ['--use-gl=angle', '--use-angle=d3d11'] } : {}) });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function openPreview(viewport, lang, reducedMotion = 'reduce') {
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
  await page.waitForFunction(() => window.__app?.trackingFrame && document.querySelector('#status')?.dataset.kind === 'keyboard');
  await page.locator('[data-ui="spaceport-entry"]').click();
  await page.waitForFunction(() => window.__app.spaceport.ownsHand && document.querySelector('#spaceport-view .spaceport-status')?.hidden);
  if (SHOTS) await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 60000; });
  await marker(page, 'ready');
  return { context, page, errors };
}

/** INJECTED hand frames, 50 ms apart (as in spaceport-gestures.test.mjs). */
function feed(page, ms, { pose, pointer = null, thumbsUp = false }) {
  return page.evaluate(({ ms, pose, pointer, thumbsUp }) => {
    const a = window.__app;
    a.__t ??= 100000;
    for (let i = 0; i <= ms; i += 50) {
      a.__t += 50;
      a.gestures.ui = { pose, action: null, pointer, hoverId: null, progress: 0 };
      a.gestures.lastObs = pose === null ? null : { pose, thumbsUp, center: pointer ?? { x: 0.5, y: 0.5 },
        fingers: { thumb: thumbsUp, index: pose === 'point', middle: false, ring: false, pinky: false } };
      a.trackingFrame(a.__t);
    }
  }, { ms, pose, pointer, thumbsUp });
}
const centre = (page, ui) => page.evaluate((ui) => {
  const b = document.querySelector(`[data-ui="${ui}"]`).getBoundingClientRect();
  return { x: (b.left + b.width / 2) / innerWidth, y: (b.top + b.height / 2) / innerHeight };
}, ui);
const point = async (page, ui, ms) => feed(page, ms, { pose: 'point', pointer: await centre(page, ui) });
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const marker = async (page, phase) => { await page.locator(`[data-ui="spaceport-phase-marker"][data-phase="${phase}"]`).click(); await frame(page); };

/** Every control's rectangle (the dock, its controls, the heading buttons, the side zones), rounded to 0.5 px. */
const layout = (page) => page.evaluate(() => {
  const out = {};
  for (const element of document.querySelectorAll('#spaceport-view [data-ui]')) {
    if (element.closest('[hidden]') || ['spaceport-phase', 'spaceport-coach'].includes(element.dataset.ui)) continue;
    const b = element.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const id = [element.dataset.ui, element.dataset.view ?? element.dataset.landmark ?? element.dataset.phase ?? ''].join(':');
    out[id] = [b.left, b.top, b.width, b.height].map(v => Math.round(v * 2) / 2).join(',');
  }
  return out;
});
const rect = (page, ui) => page.evaluate((ui) => {
  const b = document.querySelector(`[data-ui="${ui}"]`).getBoundingClientRect();
  return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 2) / 2).join(',');
}, ui);
const timeline = (page) => page.evaluate(() => {
  const markers = [...document.querySelectorAll('[data-ui="spaceport-phase-marker"]')].map(m => `${m.dataset.phase}:${m.dataset.state}`);
  const readout = document.querySelector('[data-ui="spaceport-phase"]');
  const shown = [...readout.querySelectorAll('[data-for]')].filter(n => getComputedStyle(n).visibility === 'visible').map(n => n.textContent);
  return { markers, phase: readout.dataset.phase, scrub: readout.dataset.scrub, shown, time: Number(document.querySelector('#spaceport-timeline').value) };
});
const hint = async (page) => { await frame(page); return page.evaluate(() => {
  const coach = document.querySelector('[data-ui="spaceport-coach"]');
  const style = getComputedStyle(coach);
  const shown = [...coach.querySelectorAll('[data-hint]')].filter(n => getComputedStyle(n).visibility === 'visible').map(n => n.dataset.hint);
  return { hint: coach.dataset.hint, shown, display: style.display, visibility: style.visibility };
}); };
const covered = (page) => page.evaluate(() => {
  const found = [], box = (e) => e.getBoundingClientRect();
  const dock = box(document.querySelector('[data-ui="spaceport-dock"]'));
  for (const ui of ['spaceport-gesture-prev', 'spaceport-gesture-next', 'spaceport-place-card', 'spaceport-coach', 'spaceport-title']) {
    const e = document.querySelector(`[data-ui="${ui}"]`); if (!e || e.closest('[hidden]')) continue;
    const b = box(e); if (!b.width) continue;
    if (Math.min(b.right, dock.right) - Math.max(b.left, dock.left) > 1 && Math.min(b.bottom, dock.bottom) - Math.max(b.top, dock.top) > 1) found.push(`${ui} overlaps the dock`);
  }
  // The side zones must not overlap the card or the hint either (Item 3 review shots: a landscape card once did).
  const boxes = ['spaceport-gesture-prev', 'spaceport-gesture-next', 'spaceport-place-card', 'spaceport-coach'].map(ui => {
    const e = document.querySelector(`[data-ui="${ui}"]`); const b = e && !e.closest('[hidden]') ? box(e) : null;
    return b && b.width && getComputedStyle(e).visibility !== 'hidden' ? { ui, b } : null;
  }).filter(Boolean);
  for (const zone of boxes.filter(x => x.ui.startsWith('spaceport-gesture'))) for (const other of boxes.filter(x => !x.ui.startsWith('spaceport-gesture'))) {
    const w = Math.min(zone.b.right, other.b.right) - Math.max(zone.b.left, other.b.left), h = Math.min(zone.b.bottom, other.b.bottom) - Math.max(zone.b.top, other.b.top);
    if (w > 1 && h > 1) found.push(`${other.ui} overlaps ${zone.ui}`);
  }
  for (const e of document.querySelectorAll('#spaceport-view button[data-ui]')) {
    if (e.closest('[hidden]') || e.disabled) continue;
    const b = box(e); if (!b.width || b.right > innerWidth || b.left < 0) continue;
    const row = e.closest('.spaceport-landmarks')?.getBoundingClientRect();
    if (row && (b.left < row.left - 0.5 || b.right > row.right + 0.5)) continue; // scrolled out: not a target
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (!hit || !(hit === e || e.contains(hit))) found.push(`${e.dataset.ui}:${e.dataset.phase ?? e.dataset.view ?? e.dataset.landmark ?? ''} covered by ${hit?.className || hit?.tagName}`);
  }
  return found;
});
const shot = async (page, name) => {
  if (!SHOTS) return;
  await frame(page); await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, caret: 'hide' });
};
const same = (a, b, what) => {
  // Sub-pixel text rounding (under 1 px) is not a move; anything 1 px or more is.
  const off = (x, y) => !x || !y || x.split(',').some((v, i) => Math.abs(Number(v) - Number(y.split(',')[i])) >= 1);
  const moved = Object.keys({ ...a, ...b }).filter(k => off(a[k], b[k])).map(k => `${k}: ${a[k]} → ${b[k]}`);
  assert.deepEqual(moved, [], `${what}: controls moved`);
};

for (const viewport of Object.keys(VIEWPORTS)) for (const lang of ['ja', 'my', 'en']) {
  test(`timeline + hint · ${viewport} · ${lang}`, { timeout: 600000 }, async () => {
    const { context, page, errors } = await openPreview(viewport, lang);
    try {
      const base = await layout(page);
      const dock = await rect(page, 'spaceport-dock');

      // One current phase per marker click; the readout names it; nothing moves.
      for (const [i, phase] of ['ready', 'arms', 'ignition', 'ascent'].entries()) {
        await marker(page, phase);
        const s = await timeline(page);
        assert.equal(s.phase, phase); assert.equal(s.scrub, 'false');
        assert.deepEqual(s.markers, ['ready', 'arms', 'ignition', 'ascent'].map((p, j) => `${p}:${j === i ? 'current' : j < i ? 'past' : 'future'}`));
        assert.equal(s.shown.length, 1, 'exactly one phase name shows');
        same(base, await layout(page), `phase ${phase}`);
      }

      // Keyboard scrubbing: the phase at the scrub position, a scrub treatment, then back to normal.
      await marker(page, 'ready');
      await page.locator('#spaceport-timeline').focus();
      for (let k = 0; k < 30; k++) await page.keyboard.press('PageUp');
      let s = await timeline(page);
      const expected = s.time >= 9 ? 'ascent' : s.time >= 6 ? 'ignition' : s.time >= 3 ? 'arms' : 'ready';
      assert.ok(s.time > 0, 'keyboard scrubbing moved the timeline');
      assert.equal(s.phase, expected); assert.equal(s.scrub, 'true');
      assert.ok(s.markers.includes(`${expected}:scrub`), `scrub marker: ${s.markers}`);
      same(base, await layout(page), 'keyboard scrub');
      await page.waitForFunction(() => document.querySelector('[data-ui="spaceport-phase"]').dataset.scrub === 'false', null, { timeout: 5000 });
      assert.ok((await timeline(page)).markers.includes(`${expected}:current`));

      // Pointer scrubbing: held while dragging, released on pointer up.
      const box = await page.locator('#spaceport-timeline').boundingBox();
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 5 });
      await frame(page);
      s = await timeline(page);
      assert.equal(s.scrub, 'true'); assert.equal(s.phase, s.time >= 6 ? 'ignition' : s.time >= 3 ? 'arms' : 'ready');
      same(base, await layout(page), 'pointer scrub');
      await shot(page, `scrub-drag-${lang}-${viewport}`); // while the pointer is still down: the scrub state shows
      await page.mouse.up(); await frame(page);
      assert.equal((await timeline(page)).scrub, 'false');

      // Playback crosses a phase boundary: the current phase follows it and nothing moves.
      await page.evaluate(() => { const v = window.__app.spaceport.viewer; v.seek(5.6); });
      await page.locator('[data-ui="spaceport-play"]').click();
      await page.waitForFunction(() => document.querySelector('[data-ui="spaceport-phase"]').dataset.phase === 'ignition', null, { timeout: 15000 });
      assert.equal(await page.evaluate(() => window.__app.spaceport.viewer.playing), true);
      same(base, await layout(page), 'playing into ignition');
      // Pause and Close stay clear during ignition: keyboard focus shows a ring with a dark halo.
      await page.keyboard.press('Shift');
      await page.locator('[data-ui="spaceport-play"]').focus();
      const focus = await page.evaluate(() => { const e = document.activeElement, c = getComputedStyle(e); return { state: e.dataset.state, outline: c.outlineStyle, width: c.outlineWidth, halo: c.boxShadow }; });
      assert.equal(focus.state, 'pause'); assert.equal(focus.outline, 'solid'); assert.match(focus.halo, /6px/);
      await page.locator('[data-ui="spaceport-play"]').click();
      await page.locator('[data-ui="spaceport-close"]').focus();
      await shot(page, `ignition-focus-close-${lang}-${viewport}`);
      assert.match(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), /solid/);
      await marker(page, 'ready');

      // Hint area: no camera → it takes no space; camera running → it keeps its place; one hint per state.
      assert.equal((await hint(page)).display, 'none');
      await feed(page, 0, { pose: null });                       // the camera runs, no hand yet
      await frame(page);
      let h = await hint(page);
      assert.equal(h.visibility, 'hidden'); assert.notEqual(h.display, 'none');
      const coachBox = await rect(page, 'spaceport-coach');
      const handBase = await layout(page);                       // with the hint area reserved
      // The hand layer hides 1.5 s (real time) after the last detection; injected frames are instant, and headless
      // software WebGL can take longer than that to open and close a place card (P2.5: the terminal view renders at
      // ~3 fps there). Keep the layer up for the hint steps; the "hand lost" steps below set it explicitly.
      await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 60000; });
      await feed(page, 100, { pose: 'none' });
      h = await hint(page); assert.equal(h.hint, 'point'); assert.deepEqual(h.shown, ['point']); assert.equal(h.visibility, 'visible');
      const zones = await layout(page);                          // the side zones are up now
      await point(page, 'spaceport-gesture-next', 600);
      h = await hint(page); assert.equal(h.hint, 'hold'); assert.deepEqual(h.shown, ['hold']);
      await shot(page, `hint-hold-${lang}-${viewport}`);
      same(zones, await layout(page), 'hint → hold');
      await feed(page, 700, { pose: 'fist', thumbsUp: true });
      h = await hint(page); assert.equal(h.hint, 'release'); assert.deepEqual(h.shown, ['release']);
      await shot(page, `hint-release-${lang}-${viewport}`);
      // Hand mode with a place card open: nothing sits under the dock, and every gesture target is the topmost
      // element at its centre (a zone or card under the dock once took hits meant for dock controls).
      assert.deepEqual(await covered(page), [], 'covered or overlapping in hand mode');
      await page.locator('[data-ui="spaceport-place-card-close"]').click();
      same(zones, await layout(page), 'hint → release');
      assert.equal(await rect(page, 'spaceport-coach'), coachBox, 'the hint area kept its size');
      await feed(page, 100, { pose: 'none' });
      assert.equal((await hint(page)).hint, 'hold');
      await feed(page, 300, { pose: 'fist' });                   // ✊ cancels: back to pointing
      assert.equal((await hint(page)).hint, 'point');
      // Tracking lost: the hint clears with the hand; the area keeps its place while the camera runs.
      await point(page, 'spaceport-gesture-next', 600);
      await feed(page, 400, { pose: null });
      await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 0; }); await frame(page);
      h = await hint(page); assert.equal(h.hint, ''); assert.equal(h.visibility, 'hidden');
      assert.equal(await page.evaluate(() => window.__app.spaceport.owner.hand.armed), null, 'tracking lost: nothing stays armed');
      same(handBase, await layout(page), 'hand lost');
      // Camera stopped: nothing armed, no hint, no reserved area.
      await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 1500; });
      await feed(page, 100, { pose: 'none' }); await point(page, 'spaceport-gesture-next', 600);
      await page.evaluate(() => window.__app.spaceport.trackingStopped()); await frame(page);
      h = await hint(page); assert.equal(h.hint, ''); assert.equal(h.display, 'none');
      assert.equal(await page.evaluate(() => window.__app.spaceport.owner.hand.armed), null, 'camera stopped: nothing stays armed');
      same(base, await layout(page), 'camera stopped');
      assert.equal(await rect(page, 'spaceport-dock'), dock, 'the dock never moved');

      // Touch targets: every control in the preview is at least 44 × 44 px.
      const small = await page.evaluate(() => [...document.querySelectorAll('#spaceport-view button')].filter(b => !b.closest('[hidden]') && b.offsetParent).map(b => {
        const r = b.getBoundingClientRect(); return { ui: `${b.dataset.ui}:${b.dataset.phase ?? b.dataset.view ?? b.dataset.landmark ?? ''}`, w: Math.round(r.width), h: Math.round(r.height) };
      }).filter(r => r.w < 44 || r.h < 44));
      assert.deepEqual(small, [], 'targets under 44 px');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('reduced motion: hint and phase changes are instant; otherwise a brief fade', { timeout: 300000 }, async () => {
  for (const [motion, expected] of [['reduce', '0s'], ['no-preference', '0.15s']]) {
    const { context, page, errors } = await openPreview('desk', 'ja', motion);
    try {
      const d = await page.evaluate(() => ({
        hint: getComputedStyle(document.querySelector('.spaceport-hints > span')).transitionDuration.split(',')[0].trim(),
        marker: getComputedStyle(document.querySelector('.spaceport-marker')).transitionDuration.split(',')[0].trim(),
      }));
      assert.deepEqual(d, { hint: expected, marker: expected }, motion);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

// The hint steps above keep the hand layer up on purpose (slow headless rendering); this checks the product default
// on its own: the layer, the hint and the side zones go 1.5 s after the last detection, not before, and come back
// with the next one.
test('the hand layer hides at the product default, 1.5 s after the last detection, and returns with the next', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview('desk', 'ja');
  try {
    assert.equal(await page.evaluate(() => window.__app.spaceport.owner.handVisibleMs), 1500, 'product default');
    await feed(page, 100, { pose: 'none' });
    const timing = await page.evaluate(() => new Promise((resolve) => {
      // Timed from the view's own record of the last detection (handSeenAt), not from when this check started.
      const dialog = document.querySelector('#spaceport-view'), start = window.__app.spaceport.owner.handSeenAt;
      let lastOn = start;
      const tick = () => {
        const now = performance.now();
        if (dialog.dataset.hand === 'on') { lastOn = now; if (now - start < 10000) requestAnimationFrame(tick); else resolve({ lastOn: lastOn - start, off: null }); }
        else resolve({ lastOn: lastOn - start, off: now - start, hint: document.querySelector('[data-ui="spaceport-coach"]').dataset.hint, zone: getComputedStyle(document.querySelector('[data-ui="spaceport-gesture-next"]')).display });
      };
      requestAnimationFrame(tick);
    }));
    assert.ok(timing.off !== null, 'the hand layer hid');
    assert.ok(timing.off >= 1500, `not before 1.5 s (hid at ${Math.round(timing.off)} ms)`);
    assert.ok(timing.lastOn < 1500 + 50, `still up only while within 1.5 s (last seen up at ${Math.round(timing.lastOn)} ms)`);
    assert.ok(timing.off < 1500 + 3000, `hid within a few slow frames after 1.5 s (${Math.round(timing.off)} ms)`);
    assert.equal(timing.hint, '', 'the hint cleared with the hand'); assert.equal(timing.zone, 'none', 'the side zones went too');
    await feed(page, 50, { pose: 'none' }); await frame(page);
    assert.equal(await page.evaluate(() => document.querySelector('#spaceport-view').dataset.hand), 'on', 'the next detection brings it back');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
