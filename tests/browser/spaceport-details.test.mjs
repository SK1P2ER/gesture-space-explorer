// Item 3: the short-landscape place card (name, short summary, Details) and its details panel, in the real app.
//   node --test --test-concurrency=1 tests/browser/spaceport-details.test.mjs
// Dev server. Hand frames are INJECTED through the dev-only window.__app (synthetic observations, not a camera), as in
// spaceport-gestures.test.mjs. Touch, keyboard and the preview's gesture controls all open and close the panel.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const LANDSCAPE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true };
let server, browser, url;
before(async () => {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  await warmUp(chromium, url);
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function openPreview(lang, device = LANDSCAPE, reducedMotion = 'reduce') {
  const context = await browser.newContext({ reducedMotion, deviceScaleFactor: 1, ...device });
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
  await page.locator('[data-ui="spaceport-phase-marker"][data-phase="ready"]').click();
  return { context, page, errors };
}

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
const at = (page, ui) => page.evaluate((ui) => {
  const b = document.querySelector(`[data-ui="${ui}"]`).getBoundingClientRect();
  return { x: (b.left + b.width / 2) / innerWidth, y: (b.top + b.height / 2) / innerHeight };
}, ui);
const point = async (page, ui, ms) => feed(page, ms, { pose: 'point', pointer: await at(page, ui) });
const thumb = (page, ms) => feed(page, ms, { pose: 'fist', thumbsUp: true });
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const state = async (page) => { await frame(page); return page.evaluate(() => {
  const panel = document.querySelector('[data-ui="spaceport-details-panel"]');
  const box = (sel) => { const e = document.querySelector(sel); if (!e || e.closest('[hidden]')) return null; const b = e.getBoundingClientRect(); return b.width ? b : null; };
  const dock = box('[data-ui="spaceport-dock"]'), card = box('[data-ui="spaceport-place-card"]');
  const a = document.activeElement;
  return {
    panel: !!panel && !panel.hidden,
    card: !!card,
    focus: a?.dataset?.ui ?? a?.tagName,
    dockInert: document.querySelector('[data-ui="spaceport-dock"]').closest('[inert]') !== null,
    cardOverDock: !!(card && dock && card.bottom > dock.top + 1),
    armed: window.__app.spaceport.owner.hand.armed,
    focusTarget: window.__app.spaceport.owner.hand.focus,
    open: document.querySelector('#spaceport-view').open,
  };
}); };
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? '', sel);
const fits = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1; }, sel);
const size = (page, ui) => page.evaluate((ui) => { const b = document.querySelector(`[data-ui="${ui}"]`).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }, ui);

for (const lang of ['my', 'ja', 'en']) {
  test(`844×390 · ${lang}: compact card, Details by touch and keyboard, Escape returns focus`, { timeout: 300000 }, async () => {
    const { context, page, errors } = await openPreview(lang);
    try {
      await page.locator('[data-ui="spaceport-place"][data-landmark="control"]').tap();
      let s = await state(page);
      assert.equal(s.card, true); assert.equal(s.cardOverDock, false, 'the card sits above the dock');
      const name = await text(page, '#spaceport-inspection h3');
      const summary = await text(page, '[data-ui="spaceport-place-summary"]');
      assert.ok(name.length > 0 && summary.length > 0, 'name and summary show');
      assert.equal(await fits(page, '#spaceport-inspection'), true, 'the compact card shows everything without scrolling');
      const [w, h] = await size(page, 'spaceport-place-details');
      assert.ok(w >= 44 && h >= 44, `Details is a 44 px target (${w}×${h})`);

      // Touch: Details opens the panel with the full description; focus moves into it; the background is inert.
      await page.locator('[data-ui="spaceport-place-details"]').tap();
      s = await state(page);
      assert.equal(s.panel, true); assert.equal(s.focus, 'spaceport-details-close'); assert.equal(s.dockInert, true);
      const full = await text(page, '[data-ui="spaceport-details-panel"] p');
      assert.ok(full.startsWith(summary.replace(/…$/, '')) && full.length >= summary.length, 'the panel holds the full description');
      assert.equal(await fits(page, '[data-ui="spaceport-details-panel"]'), true, 'the panel has room for the whole description');
      // Escape closes the panel only (not the preview) and returns focus to Details.
      await page.keyboard.press('Escape');
      s = await state(page);
      assert.equal(s.panel, false); assert.equal(s.open, true); assert.equal(s.card, true); assert.equal(s.focus, 'spaceport-place-details');

      // Keyboard: Enter on Details opens; Enter on the panel's close closes; focus returns again.
      await page.keyboard.press('Enter');
      s = await state(page);
      assert.equal(s.panel, true); assert.equal(s.focus, 'spaceport-details-close');
      await page.keyboard.press('Enter');
      s = await state(page);
      assert.equal(s.panel, false); assert.equal(s.focus, 'spaceport-place-details'); assert.equal(s.dockInert, false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('844×390: preview gestures open and close Details; a held 👍 never reaches a control under the panel', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview('my');
  try {
    await page.locator('[data-ui="spaceport-place"][data-landmark="control"]').tap();
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-place-details', 600);
    assert.equal((await state(page)).armed, 'spaceport-place-details:');
    await thumb(page, 700);
    let s = await state(page);
    assert.equal(s.panel, true, '👍 on the armed Details opened the panel');
    assert.equal(s.armed, null, 'nothing stays armed when the panel opens');
    // The same 👍 stays up: nothing under or in the panel acts (observed-release guard).
    await thumb(page, 1500);
    s = await state(page);
    assert.equal(s.panel, true); assert.equal(s.card, true);
    // Background targets are suspended: pointing where the Next zone was focuses nothing.
    await feed(page, 100, { pose: 'none' });
    const next = await page.evaluate(() => { const b = document.querySelector('[data-ui="spaceport-gesture-next"]').getBoundingClientRect(); return { x: (innerWidth - 60) / innerWidth, y: 0.45, w: b.width }; });
    await feed(page, 600, { pose: 'point', pointer: { x: next.x, y: next.y } });
    s = await state(page);
    assert.equal(s.focusTarget, null); assert.equal(s.armed, null);
    // The panel's close: its own dwell and a fresh 👍; focus returns to Details; nothing is left armed.
    await point(page, 'spaceport-details-close', 600);
    assert.equal((await state(page)).armed, 'spaceport-details-close:');
    await thumb(page, 700);
    s = await state(page);
    assert.equal(s.panel, false); assert.equal(s.focus, 'spaceport-place-details'); assert.equal(s.armed, null);
    // That 👍 is still up: it can't act on the card's Details underneath either.
    await thumb(page, 1200);
    assert.equal((await state(page)).panel, false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('844×390: opening Details by touch clears a pending gesture; ✋ home closes the panel', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview('ja');
  try {
    await page.locator('[data-ui="spaceport-place"][data-landmark="pad"]').tap();
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-gesture-next', 600);
    await thumb(page, 250);                                  // a 👍 hold under way on Next
    assert.equal((await state(page)).armed, 'spaceport-gesture-next:');
    await page.locator('[data-ui="spaceport-place-details"]').tap();
    let s = await state(page);
    assert.equal(s.panel, true); assert.equal(s.armed, null, 'the pending confirmation was cleared');
    await thumb(page, 1200);
    s = await state(page);
    assert.equal(s.panel, true, 'the old 👍 did nothing'); assert.equal(await text(page, '#spaceport-inspection h3') !== '', true);
    await feed(page, 100, { pose: 'none' });
    await feed(page, 1100, { pose: 'palm' });
    s = await state(page);
    assert.equal(s.panel, false); assert.equal(s.card, false); assert.equal(s.dockInert, false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('desktop and portrait keep the full description in the card (no Details)', { timeout: 300000 }, async () => {
  for (const device of [{ viewport: { width: 1440, height: 900 } }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
    const { context, page, errors } = await openPreview('my', device);
    try {
      await page.locator('[data-ui="spaceport-place"][data-landmark="control"]').click();
      assert.equal(await page.locator('[data-ui="spaceport-place-details"]').isVisible(), false);
      assert.equal(await page.locator('[data-ui="spaceport-place-summary"]').isVisible(), false);
      assert.ok((await text(page, '#spaceport-inspection [data-ui="spaceport-place-description"]')).length > 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('reduced motion: no card fade and no pulse; otherwise a brief fade and one pulse', { timeout: 300000 }, async () => {
  for (const [motion, fade] of [['reduce', 'none'], ['no-preference', 'spaceport-fade']]) {
    const { context, page, errors } = await openPreview('ja', { viewport: { width: 1440, height: 900 } }, motion);
    try {
      await page.locator('[data-ui="spaceport-place"][data-landmark="control"]').click();
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#spaceport-inspection')).animationName), fade, `${motion}: card`);
      // An accepted action: one pulse (animated without reduced motion, none with it); the outline stays.
      // The hand layer hides 1.5 s after the last detection; injected frames are instant, so keep it up for the checks.
      await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 60000; });
      await feed(page, 100, { pose: 'none' });
      await point(page, 'spaceport-gesture-next', 600);
      // The pulse lasts 450 ms of real time, and injecting 700 ms of frames can take longer than that: record every
      // pulse as it is drawn instead of looking afterwards.
      await page.evaluate(() => {
        window.__pulses = [];
        new MutationObserver((records) => { for (const r of records) {
          const e = r.target;
          if (e.dataset.gesturePulse === 'on') window.__pulses.push({ ui: e.dataset.ui, animation: getComputedStyle(e, '::after').animationName, display: getComputedStyle(e, '::after').display, outline: e.dataset.gesture ?? null });
        } }).observe(document.querySelector('#spaceport-view'), { subtree: true, attributes: true, attributeFilter: ['data-gesture-pulse'] });
      });
      await thumb(page, 700);
      await page.waitForFunction(() => window.__pulses.length > 0, null, { timeout: 5000 });
      await page.waitForTimeout(600); await frame(page);
      const pulses = await page.evaluate(() => window.__pulses);
      assert.equal(pulses.length, 1, `${motion}: exactly one pulse per accepted action`);
      const [pulse] = pulses;
      assert.equal(pulse.ui, 'spaceport-gesture-next');
      if (motion === 'reduce') assert.equal(pulse.display, 'none', 'no decorative pulse with reduced motion');
      else assert.equal(pulse.animation, 'spaceport-pulse');
      assert.equal(pulse.outline, 'armed', 'the armed outline stays through the pulse');
      assert.equal(await page.evaluate(() => document.querySelector('[data-ui="spaceport-gesture-next"]').dataset.gesture), 'armed', 'and after it');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('844×390 · my: Next armed → 👍 hold → release keeps the Close label clear and every control in place', { timeout: 300000 }, async () => {
  // Owner review 2026-11-21: the floating 👍 prompt above an armed Next zone covered the Close label in the bar. In
  // short landscape the hold now fills an inner ring on the target instead.
  const { context, page, errors } = await openPreview('my');
  try {
    await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 60000; });
    const look = () => page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const close = r(document.querySelector('[data-ui="spaceport-close"]'));
      const covering = [...document.querySelectorAll('.spaceport-hand > *:not(.spaceport-zone):not(.spaceport-cursor)')].filter(e => {
        if (getComputedStyle(e).display === 'none' || e.hidden) return false;
        const b = r(e); return b.width && Math.min(b.right, close.right) - Math.max(b.left, close.left) > 0 && Math.min(b.bottom, close.bottom) - Math.max(b.top, close.top) > 0;
      }).map(e => e.className);
      const hold = document.querySelector('.spaceport-ring-hold');
      const layout = {};
      for (const e of document.querySelectorAll('#spaceport-view button[data-ui]')) {
        if (e.closest('[hidden]')) continue; const b = r(e); if (!b.width) continue;
        layout[`${e.dataset.ui}:${e.dataset.view ?? e.dataset.landmark ?? e.dataset.phase ?? ''}`] = [b.left, b.top, b.width, b.height].map(Math.round).join(',');
      }
      return { covering, layout, closeText: document.querySelector('.spaceport-close-label')?.textContent ?? '',
        bubble: getComputedStyle(document.querySelector('.spaceport-thumb')).display,
        holdShown: getComputedStyle(hold).display !== 'none', hold: Number(getComputedStyle(document.querySelector('.spaceport-ring')).getPropertyValue('--hold') || 0),
        ring: getComputedStyle(document.querySelector('.spaceport-ring')).getPropertyValue('--progress').trim(),
        next: document.querySelector('[data-ui="spaceport-gesture-next"]').dataset.gesture ?? null, hint: document.querySelector('[data-ui="spaceport-coach"]').dataset.hint };
    });
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-gesture-next', 600);
    await frame(page);
    const armed = await look();
    assert.equal(armed.next, 'armed'); assert.equal(armed.hint, 'hold'); assert.equal(armed.ring, '1.000');
    await thumb(page, 250);                                   // half the 500 ms hold
    await frame(page);
    const holding = await look();
    assert.equal(holding.bubble, 'none', 'no floating 👍 prompt in short landscape');
    assert.equal(holding.holdShown, true); assert.ok(holding.hold > 0.2 && holding.hold < 1, `the inner ring fills (${holding.hold})`);
    assert.equal(holding.ring, '1.000', 'the dwell ring stays full while 👍 is held');
    await thumb(page, 450);                                   // the action happened; the 👍 is still up
    await frame(page);
    const release = await look();
    assert.equal(release.hint, 'release');
    for (const [name, s] of [['armed', armed], ['hold', holding], ['release', release]]) {
      assert.deepEqual(s.covering, [], `${name}: nothing in the hand layer covers Close`);
      assert.ok(s.closeText.length > 0);
    }
    // Every control present when armed is in the same place while holding and after the release (the card that the
    // accepted Next opens adds its own buttons; those are not compared).
    const moved = Object.keys(armed.layout).filter(k => armed.layout[k] !== holding.layout[k] || armed.layout[k] !== release.layout[k]);
    assert.deepEqual(moved, [], 'no control moved across armed → hold → release');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
