// Release smoke tests: one short case per area that must never break, run on every PR (CI).
// They use only what a visitor can see or do (no dev-only window.__app), so the same suite runs
// against the dev server, the production build, or a deployed preview:
//   node --test --test-concurrency=1 tests/browser/smoke.test.mjs                 # dev server
//   npm run build; SMOKE_PREVIEW=1 node --test ... tests/browser/smoke.test.mjs   # the built app
//   SMOKE_URL=https://<preview>.vercel.app node --test ... tests/browser/smoke.test.mjs
//     (with VERCEL_AUTOMATION_BYPASS_SECRET set if the preview has Deployment Protection)
// PLAYWRIGHT_MODULE may point at a playwright-core install; Chromium must already be installed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, test } from 'node:test';
import sharp from 'sharp';
import { warmUp } from './helpers/warmup.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
let server, baseURL, browser, page, problems;

before(async () => {
  if (process.env.SMOKE_URL) {
    baseURL = process.env.SMOKE_URL.replace(/\/$/, '');
    return;
  }
  const vite = await import('vite');
  if (process.env.SMOKE_PREVIEW === '1') {
    server = await vite.preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  } else {
    server = await vite.createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
  }
  baseURL = server.resolvedUrls.local[0].replace(/\/$/, '');
  if (!process.env.SMOKE_PREVIEW) await warmUp(chromium, baseURL); // a built app or a deployment has no cold compile
});
after(() => server?.close()); // dev and preview servers both close their own sockets
afterEach(async () => {
  try { assert.deepEqual(problems, [], 'page errors or failed requests'); }
  finally { await browser?.close(); }
});

/**
 * A fresh browser on the app. `camera`: 'denied' (keyboard mode), or 'fake' (Chromium's fake camera,
 * every stream kept in window.__cameraStreams). Quality starts on Low unless `storage` says otherwise.
 */
async function open({ path = '/', camera = 'denied', viewport = { width: 1100, height: 760 }, phone = false, storage = {}, setup, permissions = [] } = {}) {
  browser = await chromium.launch({ headless: true, args: camera === 'fake' ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [] });
  // A protected Vercel preview lets automation in with its bypass secret (Deployment Protection).
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const context = await browser.newContext({
    viewport, reducedMotion: 'reduce', acceptDownloads: true, permissions: [...(camera === 'fake' ? ['camera'] : []), ...permissions],
    ...(bypass ? { extraHTTPHeaders: { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } } : {}),
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : {}),
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !page.__expectedFailure?.(r.url())) problems.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(({ camera, storage }) => {
    localStorage.setItem('gse.quality', 'low');
    localStorage.setItem('gse.passport', JSON.stringify({ jezero: Date.UTC(2026, 0, 1), tranquility: Date.UTC(2026, 0, 1) }));
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    window.__cameraStreams = [];
    const acquire = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (camera === 'denied') throw new DOMException('Smoke test: camera denied', 'NotAllowedError');
      const stream = await acquire(constraints);
      window.__cameraStreams.push(stream);
      return stream;
    };
  }, { camera, storage });
  await setup?.(page);
  await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
}
const statusKind = (kind) => page.waitForFunction((kind) => document.querySelector('#status')?.dataset.kind === kind, kind, { timeout: 90000 });
const text = (sel) => page.locator(sel).textContent();
const frames = (n = 2) => page.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); }, n);
async function sceneFocus() {
  await page.locator('#scene').evaluate((canvas) => { canvas.tabIndex = -1; canvas.focus(); });
}
const atJezero = () => page.waitForFunction(() => !document.querySelector('#base-panel').hidden && /Jezero/.test(document.querySelector('#base-panel h2')?.textContent ?? ''));

test('starts in keyboard mode without a camera, with its version and no errors', async () => {
  await open();
  await statusKind('keyboard');
  assert.match(await text('#status'), /Keyboard mode/);
  assert.equal(await text('#version'), `v${version}`);
  assert.equal(await page.locator('#hand-control').isVisible(), true); // the camera can be retried
});

test('privacy: a model that fails after the camera is granted stops the camera', async () => {
  await open({
    camera: 'fake',
    setup: async (p) => {
      p.__expectedFailure = (url) => url.includes('/models/hand_landmarker');
      await p.route('**/models/hand_landmarker.v1.task', async (route) => {
        await p.waitForFunction(() => window.__cameraStreams.length && document.querySelector('#preview video').readyState >= 2, null, { timeout: 60000 });
        await route.fulfill({ status: 503, body: 'Smoke test: model unavailable' });
      });
    },
  });
  await statusKind('keyboard');
  assert.match(await text('#status'), /Hand tracking failed to load/);
  problems = problems.filter((p) => !/Failed to load resource/.test(p));
  assert.deepEqual(await page.evaluate(() => ({
    states: window.__cameraStreams.flatMap((s) => s.getTracks().map((t) => t.readyState)),
    detached: document.querySelector('#preview video').srcObject === null,
  })), { states: ['ended'], detached: true });
});

test('Turn on hand control retries the camera without a reload', async () => {
  await open();
  await statusKind('keyboard');
  await page.locator('#hand-control').click();
  await page.waitForFunction(() => ['loading', 'keyboard'].includes(document.querySelector('#status').dataset.kind));
  await statusKind('keyboard'); // denied again, but asked again: no reload needed
  assert.match(await page.locator('#status').getAttribute('title'), /Camera permission denied/);
});

test('planets: arrows switch the focused body, Enter opens its card, Escape closes it', async () => {
  await open({ path: '/?body=venus' });
  await statusKind('keyboard');
  await page.waitForFunction(() => document.querySelector('#focus').textContent === 'Venus');
  await sceneFocus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#focus').textContent === 'Earth');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#info').hidden && /Earth/.test(document.querySelector('#info').textContent));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#info').hidden);
});

test('languages: L cycles English → Burmese → Japanese → English', async () => {
  await open();
  await statusKind('keyboard');
  await sceneFocus();
  const langs = [];
  for (let n = 0; n < 3; n++) {
    await page.keyboard.press('l');
    await frames();
    langs.push(await page.evaluate(() => document.documentElement.lang));
  }
  assert.deepEqual(langs, ['my', 'ja', 'en']);
});

test('deep links: a shared link opens that base, view, language and moment (paused); the address follows', async () => {
  await open({ path: '/?base=jezero&view=horizon&lang=ja&date=2061-07-28T12:00Z' });
  await statusKind('keyboard');
  await page.waitForFunction(() => document.body.classList.contains('horizon')); // standing at Jezero
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ja');
  assert.match(await text('#timebar .date'), /2061/);
  assert.equal(await text('#timebar .pause'), '▶'); // paused at the shared moment
  // Leaving the horizon view and the base: the address follows (no reload, no new history entries).
  const history = await page.evaluate(() => history.length);
  await sceneFocus();
  await page.keyboard.press('o');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('view') === null && !document.body.classList.contains('horizon'));
  assert.equal(new URL(page.url()).searchParams.get('base'), 'jezero');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('body') === 'mars');
  assert.equal(new URL(page.url()).searchParams.get('date'), '2061-07-28T12:00Z'); // still that moment
  assert.equal(await page.evaluate(() => history.length), history);
  await page.keyboard.press('Space'); // time moves on: the date drops out of the address
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('date'));
});

test('Jezero: V enters the base, M (no moons) keeps it, Escape leaves', async () => {
  await open({ path: '/?body=mars' }); // V itself is under test here, so only the body comes from a link
  await statusKind('keyboard');
  await sceneFocus();
  await page.keyboard.press('v');
  await atJezero();
  await page.keyboard.press('m');
  await page.waitForFunction(() => /no moons/i.test(document.querySelector('#gesture-flash').textContent));
  assert.equal(await page.locator('#base-panel').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#base-panel').hidden);
});

test('missions: choose a destination and launch from the base panel', async () => {
  await open({ path: '/?base=jezero' });
  await statusKind('keyboard');
  await atJezero();
  await page.locator('#base-tab-travel').click();
  await page.locator('#base-panel .destinations button').filter({ hasText: 'Tranquility Base' }).click();
  await page.locator('#base-panel .launch').click();
  // The countdown, then the trip: the mission overlay says where the rocket is going.
  await page.waitForFunction(() => /Tranquility/.test(document.querySelector('#mission-overlay')?.textContent ?? ''), null, { timeout: 60000 });
});

test('Builder (?flags=build): opens at Jezero and closes again', async () => {
  await open({ path: '/?flags=build&base=jezero' });
  await statusKind('keyboard');
  await atJezero();
  await page.locator('#base-panel .build').click();
  await page.waitForFunction(() => !document.querySelector('#build-panel').hidden);
  await sceneFocus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#build-panel').hidden && !document.querySelector('#base-panel').hidden);
});

test('controls keep their keys: Space on Quality changes quality, not the scene', async () => {
  await open();
  await statusKind('keyboard');
  await page.locator('#menu').click();
  const before = await text('#quality');
  await page.locator('#quality').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction((before) => document.querySelector('#quality').textContent !== before, before);
  assert.equal(await page.evaluate(() => localStorage.getItem('gse.quality')), 'high');
  assert.equal(await page.locator('#info').isHidden(), true);
});

test('photo: the camera button saves a PNG of the scene', async () => {
  await open();
  await statusKind('keyboard');
  const received = page.waitForEvent('download');
  await page.locator('#photo').click();
  const png = await readFile(await (await received).path());
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
});

test('phone: the base panel is readable and the footer menu reaches Quality', async () => {
  await open({ path: '/?base=jezero', phone: true, viewport: { width: 390, height: 844 } });
  await statusKind('keyboard');
  await atJezero();
  assert.equal(await page.locator('#base-panel').isVisible(), true);
  await page.locator('#menu').tap();
  await page.locator('#quality').waitFor({ state: 'visible' });
  assert.match(await text('#quality'), /Quality/);
});

test('Mars with every flag off: Jezero shows only the finished redesigns, draws, and its horizon view works', async () => {
  await open({ path: '/?base=jezero' }); // no ?flags: cinematic, operations and Build stay off
  await statusKind('keyboard');
  await atJezero();
  assert.equal(await page.locator('#base-panel .build').count(), 0, 'no Build without ?flags=build');
  assert.equal(await page.locator('#cinematic-panel').isVisible(), false, 'no cinematic camera without ?flags=cinematic'); // always built, shown only with the flag
  await frames(10);
  // Something is drawn: the base view is not a flat colour.
  const shot = await sharp(await page.locator('#scene').screenshot()).greyscale().stats();
  assert.ok(shot.channels[0].stdev > 8, `the scene is drawn (stdev ${shot.channels[0].stdev.toFixed(1)})`);
  await sceneFocus();
  await page.keyboard.press('o');
  await page.waitForFunction(() => document.body.classList.contains('horizon'));
  await page.keyboard.press('o');
  await page.waitForFunction(() => !document.body.classList.contains('horizon') && !document.querySelector('#base-panel').hidden);
});

for (const debugPath of ['/?debug&base=jezero', '/?debug=&base=jezero']) {
test(`debug report: ${debugPath} shows its lines without a camera, and Copy report copies the link and lines`, async () => {
  await open({ path: debugPath, permissions: ['clipboard-read', 'clipboard-write'] });
  await statusKind('keyboard');
  await atJezero();
  await page.waitForFunction(() => /quality /.test(document.querySelector('#debug-stats').textContent));
  assert.equal(await page.locator('#debug-stats').isVisible(), true, 'the stats show even with the camera denied');
  await page.locator('#preview .debug-copy').click();
  await page.waitForFunction(() => document.querySelector('#preview .debug-copy').textContent.includes('Copied'));
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /debug report/);
  const linkLine = report.match(/^link\s+(\S+)$/m);
  assert.ok(linkLine, 'the copied report contains a link');
  const reportURL = new URL(linkLine[1]);
  assert.equal(reportURL.href, page.url(), 'the copied link matches the current address');
  assert.equal(reportURL.origin, new URL(baseURL).origin);
  assert.equal(reportURL.pathname, '/');
  // URLSearchParams serializes the empty ?debug flag as ?debug= when views update the URL.
  assert.deepEqual([...reportURL.searchParams.entries()].sort(), [['base', 'jezero'], ['debug', '']]);
  assert.match(report, /^res\s+/m);
  assert.match(report, /^quality\s+/m);
});
}

test('guided prototype: Burmese passenger review, destination and automatic launch remain visible', async () => {
  await open({path:'/?flags=astrolife,guided&base=jezero&lang=my',viewport:{width:390,height:844}});
  await statusKind('keyboard');
  await page.waitForFunction(()=>!document.querySelector('#base-panel').hidden);
  const action=page.locator('#guided-mission>button');
  await action.click();await action.click();
  await page.locator('#guided-mission>div button').first().click();
  await action.click();
  await page.locator('#mission-overlay.is-flight').waitFor({state:'visible',timeout:60000});
  assert.equal(await page.locator('#guided-mission').isVisible(),true);
  const gap=await page.evaluate(()=>document.querySelector('#mission-hud').getBoundingClientRect().top-document.querySelector('header.hud').getBoundingClientRect().bottom);
  assert.ok(gap>=0,`guided header overlaps mission HUD by ${-gap}px`);
});
