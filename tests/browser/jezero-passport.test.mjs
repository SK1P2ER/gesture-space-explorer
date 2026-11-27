// Jezero Dome — First Exploration: the Jezero stamp is easy to find in the existing Passport after the toast is gone.
//   node --test --test-concurrency=1 tests/browser/jezero-passport.test.mjs
// Dev server, stamps seeded in localStorage (the app's own gse.passport data). Synthetic: no camera, no real hand.
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

const STAMPS = { cape: Date.UTC(2026, 10, 20), tranquility: Date.UTC(2026, 10, 22), jezero: Date.UTC(2026, 10, 26) };
const NAMES = { en: 'Jezero Dome · Mars' };

async function open(lang, viewport, passport = STAMPS) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript((p) => {
    localStorage.setItem('gse.quality', 'low');
    localStorage.setItem('gse.passport', JSON.stringify(p));
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test: no camera', 'NotAllowedError'); };
  }, passport);
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?lang=${lang}`);
  await page.waitForFunction(() => window.__app?.mission && document.querySelector('#status')?.dataset.kind === 'keyboard');
  return { context, page, errors };
}
const list = (page) => page.evaluate(() => [...document.querySelectorAll('#passport-panel .stamp')].map((li) => ({
  base: li.dataset.base, empty: li.classList.contains('empty'), latest: li.classList.contains('latest'),
  name: li.querySelector('.stamp-name')?.textContent, badge: li.querySelector('.stamp-latest')?.textContent ?? null, when: li.querySelector('.when')?.textContent,
})));

test('the newest stamp (Jezero) leads, marked Latest, named "Jezero Dome · Mars"; earned before unvisited; data unchanged', async () => {
  const { page, context, errors } = await open('en', { width: 1280, height: 800 });
  try {
    await page.locator('#passport').click();
    await page.locator('#passport-panel').waitFor({ state: 'visible' });
    const stamps = await list(page);
    assert.deepEqual(stamps.map((s) => s.base).slice(0, 3), ['jezero', 'tranquility', 'cape']);
    assert.equal(stamps[0].name, NAMES.en);
    assert.equal(stamps[0].badge, 'Latest');
    assert.equal(stamps.filter((s) => s.latest).length, 1);
    assert.ok(stamps.slice(3).every((s) => s.empty), 'unvisited bases come after the earned stamps');
    assert.equal(stamps.length, 5);
    assert.match(stamps[0].when, /Nov 26, 2026/);
    assert.equal(await page.locator('#passport').textContent(), '🛂 Passport 3/5');
    // Opening the passport does not change the stamps.
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('gse.passport'))), STAMPS);
    // Escape / Close still work.
    await page.locator('#passport-panel .close').click();
    await page.locator('#passport-panel').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Burmese and Japanese: the Jezero stamp line and a localized date; the panel fits a phone without clipping', async () => {
  for (const [lang, viewport] of [['my', { width: 390, height: 844 }], ['ja', { width: 390, height: 844 }], ['my', { width: 844, height: 390 }]]) {
    const { page, context, errors } = await open(lang, viewport);
    try {
      await page.evaluate(() => window.__app.bus.emit({ type: 'togglePassport', open: true }));
      await page.locator('#passport-panel').waitFor({ state: 'visible' });
      const [first] = await list(page);
      assert.equal(first.base, 'jezero');
      assert.equal(first.name, lang === 'my' ? 'Jezero အမိုးခုံး · အင်္ဂါ' : 'ジェゼロ・ドーム · 火星');
      if (lang === 'my') assert.match(first.when, /[၀-၉]/, `Burmese digits: ${first.when}`);
      else assert.match(first.when, /2026/);
      assert.ok(first.badge && first.badge.length > 0);
      // The first stamp is in view and its text is not clipped (the panel can scroll for the rest).
      const box = await page.evaluate(() => {
        const li = document.querySelector('#passport-panel .stamp'); const r = li.getBoundingClientRect();
        const clipped = [...li.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible');
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, clipped };
      });
      assert.ok(box.top >= 0 && box.left >= 0 && box.right <= viewport.width, JSON.stringify(box));
      assert.ok(box.bottom <= viewport.height, `first stamp in view ${JSON.stringify(box)}`);
      assert.equal(box.clipped, false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('no stamps yet: no Latest tag, every base "Not yet visited", nothing reordered', async () => {
  const { page, context } = await open('en', { width: 1280, height: 800 }, {});
  try {
    await page.evaluate(() => window.__app.bus.emit({ type: 'togglePassport', open: true }));
    await page.locator('#passport-panel').waitFor({ state: 'visible' });
    const stamps = await list(page);
    assert.equal(stamps.filter((s) => s.latest || s.badge).length, 0);
    assert.ok(stamps.every((s) => s.empty && s.when === 'Not yet visited'));
  } finally { await context.close(); }
});
