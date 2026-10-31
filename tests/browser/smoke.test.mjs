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
    window.__cameraAsks = 0; // every request, granted or not
    const acquire = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__cameraAsks++;
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
/** Waits for the AstroLife shell's screen heading to match. */
const heading =(pattern) => page.waitForFunction((source) => new RegExp(source).test(document.querySelector('#shell h2')?.textContent ?? ''), pattern.source);

test('starts in keyboard mode without a camera, with its version and no errors', async () => {
  const requested = [];
  await open({ setup: (p) => p.on('request', (r) => requested.push(new URL(r.url()).pathname)) });
  await statusKind('keyboard');
  assert.match(await text('#status'), /Keyboard mode/);
  assert.equal(await text('#version'), `v${version}`);
  assert.equal(await page.locator('#hand-control').isVisible(), true); // the camera can be retried
  // Without ?flags=astrolife the AstroLife shell is neither on the page nor downloaded.
  assert.equal(await page.locator('#shell, #to-hub').count(), 0);
  assert.deepEqual(requested.filter((path) => /\/shell[.-]/.test(path)), []);
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
  assert.match(await text('#status'), /Camera permission denied/);
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

test('first visit for user tests: ?reset forgets what this app saved, before the app reads it', async () => {
  // Saved here: a fixed Low (the suite's default), passport stamps, a weight, and another site's key.
  await open({ path: '/?reset&body=saturn', storage: { 'gse.weightKg': '70', 'other.key': 'kept' } });
  await statusKind('keyboard');
  assert.match(await text('#quality'), /Auto/); // not the saved fixed Low
  assert.equal(new URL(page.url()).search, '?body=saturn'); // a reload keeps the tester's progress
  assert.deepEqual(await page.evaluate(() => ['gse.quality', 'gse.passport', 'gse.weightKg', 'other.key'].map((k) => localStorage.getItem(k))),
    [null, null, null, 'kept']);
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

test('debug report: ?debug shows its lines without a camera, and Copy report copies the link and lines', async () => {
  await open({ path: '/?debug&base=jezero', permissions: ['clipboard-read', 'clipboard-write'] });
  await statusKind('keyboard');
  await atJezero();
  await page.waitForFunction(() => /quality /.test(document.querySelector('#debug-stats').textContent));
  assert.equal(await page.locator('#debug-stats').isVisible(), true, 'the stats show even with the camera denied');
  await page.locator('#preview .debug-copy').click();
  await page.waitForFunction(() => document.querySelector('#preview .debug-copy').textContent.includes('Copied'));
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /debug report/);
  assert.match(report, /^link\s+.*\?debug&base=jezero/m);
  assert.match(report, /^res\s+/m);
  assert.match(report, /^quality\s+/m);
});

test('AstroLife (?flags=astrolife): the hub opens first, and the camera waits for the explorer and stops for the hub', async () => {
  await open({ path: '/?flags=astrolife', camera: 'fake' });
  await page.locator('#shell h2').waitFor();
  assert.match(await text('#shell h2'), /Where to next/);
  assert.match(await text('#shell .shell-notice'), /fictional simulation/);
  // Behind the shell the scene takes no shortcuts: → would change the planet, V would fly to a base.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('v');
  await frames(10);
  assert.equal(await page.evaluate(() => window.__cameraAsks), 0, 'no camera request before the explorer opens');
  await page.getByRole('button', { name: 'Open the explorer' }).click();
  await page.waitForFunction(() => document.querySelector('#shell').hidden && window.__cameraAsks === 1);
  assert.equal(await text('#focus'), 'Mars'); // the hub's world, and no base entered by the V behind the shell
  assert.equal(await page.locator('#base-panel').isVisible(), false);
  await sceneFocus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#focus').textContent === 'Jupiter');
  // Back to the hub: the camera stops, and the address names no view (a reload opens the hub).
  await page.locator('#to-hub').click();
  await page.locator('#shell h2').waitFor();
  await page.waitForFunction(() => window.__cameraStreams.length > 0 && window.__cameraStreams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')));
  await page.waitForFunction(() => location.search === '?flags=astrolife');
});

test('AstroLife: the hub, a destination and the list on a phone, in every language, then on to a base', async () => {
  await open({ path: '/?flags=astrolife', viewport: { width: 390, height: 844 }, phone: true });
  await heading(/Where to next/);
  await page.getByRole('button', { name: 'See the journey' }).click();
  await heading(/^Jezero Dome$/);
  const facts = await text('#shell .al-facts');
  assert.match(facts, /fictional/); // the 2126 timetable is made up, and says so
  assert.match(facts, /real/); // the distance today is not
  await page.keyboard.press('Escape'); // back a screen
  await heading(/Where to next/);
  await page.getByRole('button', { name: 'Destinations', exact: true }).click();
  await heading(/^Destinations$/);
  assert.equal(await page.locator('#shell [data-destination]').count(), 4);
  for (const lang of ['my', 'ja', 'en']) {
    await page.locator('#shell .shell-bar button').click();
    await page.waitForFunction((lang) => document.documentElement.lang === lang, lang);
    assert.equal(await page.locator('#shell-panel').evaluate((p) => p.scrollWidth <= p.clientWidth), true, `no sideways scroll in ${lang}`);
  }
  await page.getByRole('button', { name: 'Explore in 3D: Tranquility Base' }).click();
  await page.waitForFunction(() => document.querySelector('#shell').hidden && /Tranquility/.test(document.querySelector('#base-panel:not([hidden]) h2')?.textContent ?? ''));
});

test('AstroLife: book Cape → Jezero once, keep it across a reload, then cancel it', async () => {
  await open({ path: '/?flags=astrolife' });
  await heading(/Where to next/);
  await page.getByRole('button', { name: 'See the journey' }).click();
  await page.getByRole('button', { name: 'Book this journey' }).click();
  await heading(/Who.s travelling/);
  await page.getByRole('button', { name: 'Continue' }).click(); // no name yet
  await page.waitForFunction(() => /Enter a nickname/.test(document.querySelector('#al-name-error:not([hidden])')?.textContent ?? ''));
  assert.equal(await page.locator('#al-name').getAttribute('aria-invalid'), 'true');
  await page.locator('#al-name').fill('  Ada   Lovelace ');
  await page.getByRole('radio', { name: 'Avatar 3' }).check();
  await page.keyboard.press('Enter'); // the form submits from the keyboard too
  await heading(/Departure and cabin/);
  await page.getByRole('radio', { name: /AL216/ }).check();
  await page.getByRole('radio', { name: /Observation suite/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await heading(/Check and confirm/);
  const review = await text('#shell .al-facts');
  for (const part of [/🌍 Ada Lovelace/, /AL216/, /Observation suite/, /21,000 credits/, /fictional/]) assert.match(review, part);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await heading(/Your journey/);
  assert.match(await text('#shell [role="status"]'), /Booking confirmed/);
  const ref = await text('#shell .al-ref');
  assert.match(ref, /^AL-[0-9A-HJKMNP-TV-Z]{5}$/);
  await page.keyboard.press('Escape'); // back goes home, not to the confirm step
  await heading(/Where to next/);
  assert.equal(await page.locator(`#shell [data-booking="${ref}"]`).count(), 1);
  await page.reload({ waitUntil: 'domcontentloaded' }); // kept on the device
  await page.locator(`#shell [data-booking="${ref}"]`).waitFor();
  await page.getByRole('button', { name: 'View booking' }).click();
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await page.getByRole('button', { name: /Press again to confirm/ }).click();
  await page.waitForFunction(() => document.querySelector('#shell .al-status')?.textContent === 'Cancelled');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gse.astrolife')));
  assert.deepEqual(saved.bookings.map((b) => [b.ref, b.status, b.traveller.name]), [[ref, 'cancelled', 'Ada Lovelace']]);
  await page.getByRole('button', { name: 'Destinations', exact: true }).click();
  await page.getByRole('button', { name: 'Details: Jezero Dome' }).click();
  await page.getByRole('button', { name: 'Book this journey' }).waitFor(); // nothing under way: Jezero can be booked again
});

test('AstroLife: check in, the pass’s souvenir link opens as a keepsake, and a hostile link is ignored', async () => {
  const booking = {
    ref: 'AL-9NH92', attempt: 'smoke-attempt-01', traveller: { name: 'Ada', avatar: 'a2' }, from: 'cape', to: 'jezero',
    departure: 'AL216', cabin: 'suite', status: 'confirmed', createdAt: Date.UTC(2026, 9, 30),
  };
  await open({
    path: '/?flags=astrolife', permissions: ['clipboard-read', 'clipboard-write'],
    storage: { 'gse.astrolife': JSON.stringify({ v: 1, traveller: booking.traveller, bookings: [booking] }) },
  });
  await page.getByRole('button', { name: 'View booking' }).click();
  await page.getByRole('button', { name: 'Check in' }).click();
  await page.waitForFunction(() => document.querySelector('#shell .al-status')?.textContent === 'Checked in');
  assert.equal(await page.getByRole('button', { name: 'Check in' }).count(), 0); // checked in once, and no button to do it again
  assert.equal(await page.locator('#shell .al-pass svg.al-qr title').textContent(), 'Souvenir QR code: opens this pass as a keepsake on any phone');
  await page.getByRole('button', { name: 'Copy souvenir link' }).click();
  await page.waitForFunction(() => /Copied/.test(document.querySelector('#shell .al-pass .al-actions')?.textContent ?? ''));
  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(link.search, '?flags=astrolife'); // the pass is only after the #, which never reaches a server
  assert.deepEqual(Object.fromEntries(new URLSearchParams(link.hash.slice(1))), { souvenir: '1', ref: 'AL-9NH92', nick: 'Ada', av: 'a2', fl: 'AL216', cab: 'suite' });

  await page.goto(link.href); // only the # changes: the open shell picks it up
  await heading(/^Ada’s journey to Jezero Dome$/);
  assert.match(await text('#shell .al-pass'), /🛸 Ada/);
  await page.getByRole('button', { name: 'Plan your own journey' }).click();
  await heading(/Where to next/);
  assert.equal(await page.evaluate(() => location.hash), ''); // a reload won't bring the souvenir back

  // Markup in a link is never markup: the whole souvenir is refused, and nothing runs or appears.
  const hostile = `${baseURL}/?flags=astrolife#souvenir=1&ref=AL-9NH92&nick=${encodeURIComponent('<img src=x onerror="window.__pwned=1">')}&av=a3&fl=AL216&cab=suite`;
  await page.goto(hostile);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await heading(/Where to next/);
  assert.deepEqual(await page.evaluate(() => [window.__pwned, document.querySelectorAll('img').length, document.querySelector('#shell').textContent.includes('onerror')]), [undefined, 0, false]);
});

test('AstroLife: board, fly Cape → Jezero on the 2127 departure, land, earn the stamp once; free roam gets its date back', async () => {
  const booking = {
    ref: 'AL-J0RNY', attempt: 'smoke-attempt-02', traveller: { name: 'Ada', avatar: 'a4' }, from: 'cape', to: 'jezero',
    departure: 'AL216', cabin: 'window', status: 'checkedIn', createdAt: Date.UTC(2026, 9, 30), checkedInAt: Date.UTC(2026, 9, 30, 1),
  };
  await open({
    path: '/?flags=astrolife',
    storage: { 'gse.astrolife': JSON.stringify({ v: 1, traveller: booking.traveller, bookings: [booking] }), 'gse.autoLand': '1' },
  });
  const year = () => page.evaluate(() => /\b(\d{4})\b/.exec(document.querySelector('#timebar .date').textContent)?.[1]);
  await heading(/Where to next/); // drawn: the time bar has its date
  const before = await year();
  assert.match(before, /^20\d\d$/);
  await page.getByRole('button', { name: 'View booking' }).click();
  await page.getByRole('button', { name: 'Begin journey' }).click();
  // The explorer, at the spaceport, with Jezero chosen and the clock on the departure: fiction, and labelled so.
  await page.waitForFunction(() => document.querySelector('#shell').hidden && /Cape Launch Center/.test(document.querySelector('#base-panel:not([hidden]) h2')?.textContent ?? ''));
  assert.match(await text('#journey-banner'), /^Simulation AL-J0RNY · Cape Launch Center → Jezero Dome · ready/);
  assert.equal(await year(), '2127');
  await page.locator('#base-panel .launch').click();
  await page.waitForFunction(() => /Jezero/.test(document.querySelector('#mission-overlay')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForFunction(() => /on the way to Jezero Dome/.test(document.querySelector('#journey-banner').textContent));
  await sceneFocus();
  await page.keyboard.press('Enter'); // skip ahead to the approach; auto-land takes it down
  await page.waitForFunction(() => /arrived at Jezero Dome · journey stamp collected/.test(document.querySelector('#journey-banner').textContent), null, { timeout: 90000 });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('gse.astrolife')).bookings[0]);
  const done = await saved();
  assert.equal(done.status, 'completed');
  assert.ok(done.departedAt <= done.completedAt);
  // Free roam: leaving the base ends the journey, and the visitor's own date comes back.
  await sceneFocus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#journey-banner').hidden);
  assert.equal(await year(), before);
  // AstroLife opens on the completed journey; the stamp was earned once.
  await page.locator('#to-hub').click();
  await page.waitForFunction(() => /Journey complete/.test(document.querySelector('#shell .al-stamp')?.textContent ?? ''));
  assert.equal((await saved()).completedAt, done.completedAt);
});

test('AstroLife: the passport holds the journey stamp, the postcard is a PNG of it, and Forget deletes everything', async () => {
  const done = {
    ref: 'AL-P0STC', attempt: 'smoke-attempt-03', traveller: { name: 'Ada', avatar: 'a4' }, from: 'cape', to: 'jezero',
    departure: 'AL216', cabin: 'suite', status: 'completed', createdAt: Date.UTC(2026, 9, 30),
    checkedInAt: Date.UTC(2026, 9, 30, 1), departedAt: Date.UTC(2026, 9, 30, 2), completedAt: Date.UTC(2026, 9, 30, 3),
  };
  await open({ path: '/?flags=astrolife', storage: { 'gse.astrolife': JSON.stringify({ v: 1, traveller: done.traveller, bookings: [done] }) } });
  await heading(/Where to next/);
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  await heading(/^🚀 Ada$/);
  assert.match(await text('#shell .al-lead'), /1 of 4 destinations stamped/);
  assert.equal(await page.locator('#shell [data-stamp="jezero"]').count(), 1);
  assert.match(await text('#shell [data-stamp="jezero"]'), /Arrived Mar 15, 2127/); // departure + the 9-day crossing (fiction)
  await page.locator('#shell [data-stamp="jezero"] button').click();
  await page.waitForFunction(() => /Journey complete/.test(document.querySelector('#shell .al-stamp')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Make a postcard' }).click();
  await page.waitForFunction(() => document.querySelector('#shell .al-postcard img')?.naturalWidth === 1600);
  assert.equal(await page.locator('#shell .al-postcard img').getAttribute('alt'), 'Postcard from Jezero Dome');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save postcard' }).click()]);
  assert.equal(download.suggestedFilename(), 'astrolife-postcard-AL-P0STC.png');
  const png = await readFile(await download.path());
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const { width, height } = await sharp(png).metadata();
  assert.deepEqual([width, height], [1600, 1000]);
  // Forget: everything AstroLife kept on this device goes.
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  await page.getByRole('button', { name: 'Forget AstroLife on this device' }).click();
  await page.getByRole('button', { name: /Press again to confirm/ }).click();
  await heading(/Where to next/);
  assert.equal(await page.evaluate(() => localStorage.getItem('gse.astrolife')), null);
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  assert.match(await text('#shell .al-empty'), /No stamps yet/);
});

test('AstroLife accessibility basics: every screen, in every language, has a heading and only named controls', async () => {
  await open({ path: '/?flags=astrolife', viewport: { width: 390, height: 844 }, phone: true });
  await heading(/Where to next/);
  const audit = () => page.evaluate(() => {
    const shell = document.querySelector('#shell');
    const name = (el) => (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || '').trim();
    const unnamed = [...shell.querySelectorAll('button, a[href], input, [role="img"]')]
      .filter((el) => !(name(el) || el.querySelector('title')?.textContent)).map((el) => el.outerHTML.slice(0, 80));
    const panel = document.querySelector('#shell-panel');
    return {
      unnamed,
      title: document.getElementById(shell.getAttribute('aria-labelledby'))?.textContent ?? null,
      lang: document.documentElement.lang,
      sideways: panel.scrollWidth > panel.clientWidth,
    };
  });
  // Every screen that needs no booking: hub, destinations, a destination, the three booking steps, the passport.
  const screens = [
    async () => {},
    async () => page.locator('#shell .shell-tabs button').nth(1).click(),
    async () => page.locator('#shell [data-destination="jezero"] button').first().click(),
    async () => page.locator('#shell .al-actions button.primary').first().click(), // book
    async () => { await page.locator('#al-name').fill('Ada'); await page.keyboard.press('Enter'); },
    async () => page.locator('#shell form button[type="submit"]').click(),
    async () => page.locator('#shell .shell-tabs button').nth(2).click(),
  ];
  for (const [i, lang] of ['en', 'my', 'ja'].entries()) {
    if (i) {
      await page.locator('#shell .shell-tabs button').first().click();
      await page.locator('#shell .shell-bar button').click();
      await page.waitForFunction((lang) => document.documentElement.lang === lang, lang);
    }
    for (const [n, go] of screens.entries()) {
      await go();
      await frames(2);
      const a = await audit();
      assert.deepEqual(a.unnamed, [], `${lang} screen ${n}: unnamed controls`);
      assert.ok(a.title?.trim(), `${lang} screen ${n}: the dialog has a title`);
      assert.equal(a.lang, lang);
      assert.equal(a.sideways, false, `${lang} screen ${n}: sideways scroll`);
    }
  }
});
