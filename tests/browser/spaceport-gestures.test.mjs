// Hand control inside the launch preview (item 2, owner 2026-11-21), in the real app.
//   node --test --test-concurrency=1 tests/browser/spaceport-gestures.test.mjs
// Dev server; hand frames are INJECTED through the dev-only window.__app (synthetic observations, not a camera), the
// same way tests/browser/destination-picker.test.mjs does. The engine reports 👍 as a fist with thumbsUp.
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

async function openPreview() {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?site=ground&base=tanegashima&lang=ja`);
  await page.waitForFunction(() => window.__app?.trackingFrame && document.querySelector('#status')?.dataset.kind === 'keyboard');
  await reopen(page);
  return { context, page, errors };
}
async function reopen(page) {
  await page.locator('[data-ui="spaceport-entry"]').click();
  await page.waitForFunction(() => window.__app.spaceport.ownsHand && document.querySelector('#spaceport-view .spaceport-status')?.hidden);
  // Review shots: a capture can outlast the 1.5 s the hand layer stays up, so keep it up while shooting (test only).
  if (process.env.GESTURE_SHOTS) await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 60000; });
}

let lastFeed = null;
/** INJECTED hand frames, 50 ms apart, through main.ts's tracking frame (as the picker test does). */
function feed(page, ms, { pose, pointer = null, thumbsUp = false }) {
  lastFeed = { pose, pointer, thumbsUp };
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
const thumb = (page, ms) => feed(page, ms, { pose: 'fist', thumbsUp: true });
const fist = (page, ms) => feed(page, ms, { pose: 'fist' });
const noHand = (page, ms) => feed(page, ms, { pose: null });
/** Where a 👆 at the centre of a [data-ui] element would point (normalized). */
const centre = (page, ui) => page.evaluate((ui) => {
  const b = document.querySelector(`[data-ui="${ui}"]`).getBoundingClientRect();
  return { x: (b.left + b.width / 2) / innerWidth, y: (b.top + b.height / 2) / innerHeight };
}, ui);
const point = async (page, ui, ms) => feed(page, ms, { pose: 'point', pointer: await centre(page, ui) });
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** GESTURE_SHOTS=<dir>: also save review screenshots of the hand states (not compared). */
// A screenshot can take longer than the 1.5 s the hand layer stays up without detections: afterwards the same gesture
// continues for one more frame (50 ms of the same input), so the states the test reads next are still drawn.
// Review shots only: the same gesture continues for one frame right before the capture (and once after it).
const shot = async (page, name) => {
  if (!process.env.GESTURE_SHOTS) return;
  if (lastFeed) await feed(page, 0, lastFeed);
  await frame(page); await page.screenshot({ path: `${process.env.GESTURE_SHOTS}/${name}.png` });
  if (lastFeed) await feed(page, 0, lastFeed);
};
const state = async (page) => { await frame(page); return page.evaluate(() => ({
  place: document.querySelector('#spaceport-view [data-landmark][aria-pressed="true"]')?.dataset.landmark ?? null,
  card: !document.querySelector('#spaceport-inspection').hidden,
  next: document.querySelector('[data-ui="spaceport-gesture-next"]').dataset.gesture ?? null,
  ring: !document.querySelector('.spaceport-ring').hidden,
  hand: document.querySelector('#spaceport-view').dataset.hand,
  notice: document.querySelector('.spaceport-notice').hidden ? null : document.querySelector('.spaceport-notice').textContent,
  view: window.__app.spaceport.viewer?.view ?? null,
})); };

test('👆 on Next → highlight → dwell → 👍 → exactly one place, then a seen release before the next', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview();
  try {
    await noHand(page, 0); await feed(page, 100, { pose: 'none' }); // a hand appears: hand mode, zones shown
    assert.equal((await state(page)).hand, 'on');
    await point(page, 'spaceport-gesture-next', 200);
    let s = await state(page);
    assert.equal(s.next, 'focus'); assert.equal(s.ring, true); assert.equal(s.place, null);
    await shot(page, '1-dwell-ring-on-next');
    await point(page, 'spaceport-gesture-next', 400);
    assert.equal((await state(page)).next, 'armed');
    await shot(page, '2-armed-glow-thumb-prompt');
    await thumb(page, 250);
    await shot(page, '3-thumb-hold-in-progress');
    await thumb(page, 450);
    await shot(page, '4-acted-place-card');
    s = await state(page);
    assert.equal(s.place, 'assembly'); assert.equal(s.card, true);
    await thumb(page, 1500); // still up: nothing more
    assert.equal((await state(page)).place, 'assembly');
    await feed(page, 150, { pose: 'none' }); // seen release (hand, no 👍)
    await thumb(page, 700); // still armed: a fresh 👍 acts once more
    assert.equal((await state(page)).place, 'control');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a pause in detections longer than the hand layer stays up keeps the 👆 focus on a side zone', { timeout: 300000 }, async () => {
  // Found by the review shots: the zones were measured while still hidden, so the first frame after a pause lost them.
  const { context, page, errors } = await openPreview();
  try {
    await page.evaluate(() => { window.__app.spaceport.owner.handVisibleMs = 1500; }); // the product value, also in shot mode
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-gesture-next', 200);
    await page.waitForFunction(() => document.querySelector('#spaceport-view').dataset.hand === 'off', null, { timeout: 10000 });
    await point(page, 'spaceport-gesture-next', 0);
    assert.equal(await page.evaluate(() => window.__app.spaceport.owner.hand.focus), 'spaceport-gesture-next:');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('regressions: closing the preview, losing the hand, or changing target leaves no charge behind', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview();
  try {
    // Preview closed mid-hold, reopened with the 👍 still up: nothing happens.
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-gesture-next', 600); await thumb(page, 300);
    await page.locator('[data-ui="spaceport-close"]').click();
    await reopen(page);
    await thumb(page, 1200);
    assert.equal((await state(page)).place, null, 'reopened preview: the old 👍 acted');

    // Hand lost mid-hold: the charge is gone; a 👍 after it returns acts nothing (no fresh dwell, no seen release).
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-gesture-next', 600); await thumb(page, 300);
    await noHand(page, 500);
    await thumb(page, 1200);
    assert.equal((await state(page)).place, null, 'hand lost: a leftover charge acted');

    // Target changed mid-hold: Previous starts from zero and needs its own full 👍.
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-gesture-next', 600); await thumb(page, 300);
    await point(page, 'spaceport-gesture-prev', 600);
    await thumb(page, 200);
    assert.equal((await state(page)).place, null, 'target change: the old charge completed the new target');
    await thumb(page, 600);
    // The last place in the dock (P2.5: the landing chip is hidden, so it is the launch complex).
    const lastPlace = await page.evaluate(() => [...document.querySelectorAll('[data-ui="spaceport-place"]')].at(-1).dataset.landmark);
    assert.equal((await state(page)).place, lastPlace, 'Previous from no place opens the last place');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('✊ cancels the armed target; ✋ held 1 s returns to the home view', { timeout: 300000 }, async () => {
  const { context, page, errors } = await openPreview();
  try {
    await feed(page, 100, { pose: 'none' });
    await point(page, 'spaceport-gesture-next', 600);
    assert.equal((await state(page)).next, 'armed');
    await fist(page, 300);
    let s = await state(page);
    assert.equal(s.next, null); assert.match(s.notice ?? '', /✊/);
    await shot(page, '5-fist-cancelled'); // after reading: the notice shows for 1.2 s and a screenshot can take longer
    await thumb(page, 1000);
    assert.equal((await state(page)).place, null, 'a 👍 after ✊ acted');

    await page.locator('[data-ui="spaceport-place"][data-landmark="control"]').click();
    assert.equal((await state(page)).card, true);
    await feed(page, 600, { pose: 'palm' });
    await shot(page, '6-palm-home-progress');
    await feed(page, 500, { pose: 'palm' });
    s = await state(page);
    assert.equal(s.card, false); assert.equal(s.view, 'overview'); assert.match(s.notice ?? '', /✋/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
