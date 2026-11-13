// The camera and a really hidden tab. Raw DevTools protocol, without Playwright: Playwright's focus emulation keeps every page
// "visible", so a backgrounded page there proves nothing. Each hide asserts a trusted visibilitychange and document.hidden, and
// fails the case if the tab never really went hidden.
//   npm run build; npm run test:camera-lifecycle          # the built app (vite preview)
//   CAMERA_LIFECYCLE_DEV=1 npm run test:camera-lifecycle  # the dev server; adds the Guided case, which needs the dev-only window.__app
//   CAMERA_LIFECYCLE_ONLY=<regex>: only the matching cases. CAMERA_LIFECYCLE_ARTIFACTS=<folder>: screenshots of the changed controls,
//   and how the documents loaded for a case that failed or hit a failed load.
// EVIDENCE LABELS: every camera here is Chromium's FAKE camera (--use-fake-device-for-media-stream), and the Guided case's 👍 is an
// INJECTED observation, not a hand. A hidden tab in desktop Chromium is not an iPhone in the background: phones need checking by hand.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { warmUp } from './helpers/warmup.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
const only = process.env.CAMERA_LIFECYCLE_ONLY ? new RegExp(process.env.CAMERA_LIFECYCLE_ONLY) : null;
const artifacts = process.env.CAMERA_LIFECYCLE_ARTIFACTS;
const dev = process.env.CAMERA_LIFECYCLE_DEV === '1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PORTRAIT_430 = { width: 430, height: 739, css: 'html { --sab: 34px !important; --sat: 47px !important; }' };
let server, baseURL;

/** Runs in the page, before the app: every stream it gets, every stop, and which visibility events were real. */
function installWatch({ hold, css }) {
  localStorage.setItem('gse.quality', 'low');
  if (css) addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: css })));
  const w = window.__camera = { calls: 0, streams: [], stops: 0, realHidden: 0, realVisible: 0, mocked: 0, hold, releases: [] };
  const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    w.calls++;
    if (w.hold) await new Promise((resolve) => w.releases.push(resolve)); // the camera hasn't answered yet
    const stream = await acquire(constraints);
    w.streams.push(stream);
    return stream;
  };
  const stop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function () { w.stops++; return stop.call(this); };
  document.addEventListener('visibilitychange', (e) => {
    if (!e.isTrusted) w.mocked++;
    else if (document.hidden) w.realHidden++;
    else w.realVisible++;
  });
  addEventListener('pageshow', (e) => sessionStorage.setItem('__pageshow', String(e.persisted)));
  w.tracks = () => w.streams.flatMap((s) => s.getTracks());
  w.state = () => {
    const status = document.querySelector('#status');
    const control = document.querySelector('#hand-control');
    const preview = document.querySelector('#preview');
    const video = preview?.querySelector('video');
    return {
      visibility: document.visibilityState,
      calls: w.calls,
      streams: w.streams.length,
      live: w.tracks().filter((t) => t.readyState === 'live').length,
      ended: w.tracks().filter((t) => t.readyState === 'ended').length,
      stops: w.stops,
      realHidden: w.realHidden,
      status: status?.dataset.kind,
      statusText: status?.textContent,
      statusTitle: status?.title,
      control: control ? !control.hidden && getComputedStyle(control).display !== 'none' && getComputedStyle(control).visibility === 'visible' : false,
      preview: preview ? !preview.hidden : false,
      attached: video?.srcObject != null,
      current: video?.srcObject != null && video.srcObject === w.streams.at(-1),
      immersive: document.body.classList.contains('immersive'),
    };
  };
  /** Where a touch on this would land, and what it would really hit. */
  w.point = (sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility !== 'visible') return null;
    const r = el.getBoundingClientRect();
    const [x, y] = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    const hit = document.elementFromPoint(x, y);
    return { x, y, ok: hit === el || el.contains(hit), by: hit ? hit.id || String(hit.className) || hit.tagName : 'nothing' };
  };
}

/** A browser of its own, driven directly. */
async function launch({ deny = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'camera-lifecycle-'));
  const browser = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--use-fake-device-for-media-stream', deny ? '--use-fake-ui-for-media-stream=deny' : '--use-fake-ui-for-media-stream', '--window-size=1100,760', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let text = '';
    browser.stderr.on('data', (d) => { text += d; const m = text.match(/ws:\/\/\S+/); if (m) resolve(m[0]); });
    setTimeout(() => reject(new Error(`no DevTools address: ${text.slice(0, 200)}`)), 30000).unref();
  });
  let ws;
  for (let attempt = 0; ; attempt++) {
    try {
      ws = await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.addEventListener('open', () => resolve(socket), { once: true });
        socket.addEventListener('error', () => reject(new Error('DevTools socket refused')), { once: true });
      });
      break;
    } catch (e) {
      if (attempt >= 20) throw e;
      await delay(250);
    }
  }
  let id = 0;
  const waiting = new Map();
  const errors = [];
  // Every document the app's tab was sent to and what came of it, so a page that never loads can say why.
  const started = Date.now();
  const documents = [];
  const seen = (entry) => documents.push({ at: Date.now() - started, ...entry });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) seen({ event: 'committed', url: m.params.frame.url, ...(m.params.frame.unreachableUrl ? { unreachable: m.params.frame.unreachableUrl } : {}) });
    if (m.method === 'Network.responseReceived' && m.params.type === 'Document') seen({ event: 'response', url: m.params.response.url, status: m.params.response.status });
    if (m.method === 'Network.loadingFailed' && m.params.type === 'Document') seen({ event: 'load failed', errorText: m.params.errorText, canceled: Boolean(m.params.canceled) });
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    waiting.set(i, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const open = async () => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    return { targetId, sessionId };
  };
  return {
    send, open, errors, documents, seen,
    async close() {
      await send('Browser.close').catch(() => {});
      ws.close();
      browser.kill();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
    },
  };
}

/** The app's tab, and a second one to put in front of it. */
async function openApp(b, path, { hold = false, phone = null, hiddenFromStart = false } = {}) {
  const tab = await b.open();
  const other = await b.open();
  const sid = tab.sessionId;
  await b.send('Page.enable', {}, sid);
  await b.send('Runtime.enable', {}, sid);
  await b.send('Network.enable', {}, sid);
  if (phone) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: phone.width, height: phone.height, deviceScaleFactor: 2, mobile: true }, sid);
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sid);
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] }, sid);
    await b.send('Emulation.setUserAgentOverride', { userAgent: IPHONE }, sid);
  }
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installWatch})(${JSON.stringify({ hold, css: phone?.css ?? '' })})` }, sid);
  const evaluate = async (fn, arg) => {
    const r = await b.send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg ?? null)})`, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (fn, arg, what, timeout = 60000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await evaluate(fn, arg).catch(() => false);
      if (value) return value;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(await evaluate(() => window.__camera?.state()).catch(() => null))} at ${JSON.stringify(await evaluate(() => [location.href, document.readyState]).catch((err) => err.message))}; documents: ${JSON.stringify(b.documents)}`);
      await delay(100);
    }
  };
  const activate = (target) => b.send('Target.activateTarget', { targetId: target.targetId });
  const app = {
    sid, evaluate, until, state: () => evaluate(() => window.__camera.state()),
    goto: async (url) => {
      // A server that never answers leaves Page.navigate open: without a limit the case would only hit its own timeout, with nothing recorded.
      const answered = new AbortController();
      const noAnswer = delay(60000, null, { ref: false, signal: answered.signal }).then(() => {
        b.seen({ event: 'no answer', url });
        throw new Error(`no answer navigating to ${url}; documents: ${JSON.stringify(b.documents)}`);
      });
      const { errorText } = await Promise.race([b.send('Page.navigate', { url: `${baseURL}${url}` }, sid), noAnswer]).finally(() => answered.abort());
      b.seen({ event: 'navigate', url, ...(errorText ? { errorText } : {}) });
    },
    tracking: () => until(() => document.querySelector('#status')?.dataset.kind === 'tracking', null, 'tracking', 120000),
    keyboard: () => until(() => document.querySelector('#status')?.dataset.kind === 'keyboard', null, 'keyboard mode'),
    /** Another tab in front. Fails if this one didn't really go hidden, with a trusted event. */
    async hide() {
      const before = await evaluate(() => window.__camera.realHidden);
      await activate(other);
      await until((n) => document.hidden && document.visibilityState === 'hidden' && window.__camera.realHidden > n, before, 'a really hidden tab', 10000);
    },
    async show() {
      await activate(tab);
      await until(() => !document.hidden && document.visibilityState === 'visible', null, 'a visible tab', 10000);
    },
    bare: { activateOther: () => activate(other), activateApp: () => activate(tab) },
    async click(sel) {
      const p = await evaluate((s) => window.__camera.point(s), sel);
      assert.ok(p, `${sel} isn't on screen`);
      assert.ok(p.ok, `a click on ${sel} hits ${p.by}`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await b.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, sid);
      }
    },
    async touch(sel) {
      const p = await evaluate((s) => window.__camera.point(s), sel);
      assert.ok(p, `${sel} isn't on screen`);
      assert.ok(p.ok, `a touch on ${sel} hits ${p.by}`);
      await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }, sid);
      await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
    },
    /** A finger down at a spot, held, then up. */
    async press({ x, y }, holdMs) {
      await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }, sid);
      await delay(holdMs);
      await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
    },
    /** `text` makes it a typed key, which is what activates a focused button. */
    async key(key, code, keyCode, text) {
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) }, sid);
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }, sid);
    },
    /** Real Tab presses until the control has focus: it has to be reachable the way a keyboard user reaches it. */
    async tabTo(sel) {
      for (let i = 0; i < 40; i++) {
        await app.key('Tab', 'Tab', 9);
        if (await evaluate((s) => document.activeElement === document.querySelector(s), sel)) return i + 1;
      }
      assert.fail(`40 Tab presses never reached ${sel}; focus is on ${await evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);
    },
    async cancelledPress({ x, y }, holdMs) {
      await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }, sid);
      await delay(holdMs);
      await b.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }, sid);
    },
    /** What the changed controls look like (Chromium's fake camera: a test pattern, no real image). */
    async shot(name) {
      if (!artifacts) return;
      const { data } = await b.send('Page.captureScreenshot', { format: 'png' }, sid);
      await writeFile(join(artifacts, `${dev ? 'dev' : 'prod'}-${name}.png`), Buffer.from(data, 'base64'));
    },
  };
  if (hiddenFromStart) await app.bare.activateOther();
  else await activate(tab);
  await app.goto(path);
  return app;
}

const off = (s, where) => {
  assert.equal(s.live, 0, `${where}: live camera tracks`);
  assert.equal(s.attached, false, `${where}: the video still holds a stream`);
};
/** Off, with the way back on: nothing restarted, the status says so, the control and no empty preview. */
async function offAndOffered(app, calls, where) {
  await app.until(() => document.querySelector('#status')?.dataset.kind === 'keyboard' && !document.querySelector('#hand-control').hidden, null, `${where}: the restart control`);
  await delay(2500); // long enough for anything that would restart by itself
  const s = await app.state();
  off(s, where);
  assert.equal(s.calls, calls, `${where}: the camera was asked for again`);
  assert.equal(s.status, 'keyboard', where);
  assert.match(s.statusText, /disconnected/i, where);
  assert.equal(s.control, true, `${where}: no restart control`);
  assert.equal(s.preview, false, `${where}: an empty camera preview is showing`);
}
async function restartedOnce(app, calls, where) {
  await app.tracking();
  const s = await app.state();
  assert.equal(s.calls, calls, `${where}: calls`);
  assert.equal(s.live, 1, `${where}: live camera tracks`);
  assert.equal(s.current, true, `${where}: the video shows the newest stream`);
  assert.equal(s.control, false, `${where}: the restart control should go`);
  assert.equal(s.preview, true, `${where}: the preview should be back`);
  const before = await app.evaluate(() => document.querySelector('#preview video').currentTime);
  await app.until((t) => document.querySelector('#preview video').currentTime > t, before, `${where}: camera frames`, 10000);
}
/** How the documents loaded, in the case's log and its artifacts, when the case failed or a load did. It changes no result. */
async function recordDocuments(t, b, name, failed) {
  if (!failed && !b.documents.some((d) => d.errorText || d.status >= 400)) return;
  t.diagnostic(`documents: ${JSON.stringify(b.documents)}`);
  if (artifacts) await writeFile(join(artifacts, `${dev ? 'dev' : 'prod'}-${name.replace(/[^\w-]+/g, '-').slice(0, 80)}-documents.json`), JSON.stringify(b.documents, null, 1));
}

/** One case, with a browser of its own. `skip` is a reason: the case is reported as skipped, never silently left out. */
function lifecycle(name, options, body) {
  if (only && !only.test(name)) return;
  test(name, { timeout: 240000, skip: options.skip ?? false }, async (t) => {
    const b = await launch(options);
    let failed = true;
    try {
      await body(b);
      assert.deepEqual(b.errors, [], 'uncaught errors in the page');
      failed = false;
    } finally {
      await recordDocuments(t, b, name, failed);
      await b.close();
    }
  });
}

before(async () => {
  if (artifacts) await mkdir(artifacts, { recursive: true });
  const vite = await import('vite');
  if (dev) {
    server = await vite.createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    baseURL = server.resolvedUrls.local[0].replace(/\/$/, '');
    await warmUp(chromium, baseURL);
    return;
  }
  server = await vite.preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  baseURL = server.resolvedUrls.local[0].replace(/\/$/, '');
});
after(() => server?.close());

lifecycle('a really hidden tab holds no live camera track, detector frames or preview', {}, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  const visible = await app.state();
  assert.equal(visible.visibility, 'visible');
  assert.equal(visible.live, 1, 'the camera should be on before the tab hides');
  await app.hide();
  const hidden = await app.state();
  assert.equal(hidden.visibility, 'hidden');
  assert.equal(hidden.realHidden, 1, 'a real, trusted visibilitychange');
  off(hidden, 'hidden');
  assert.equal(hidden.ended, 1);
  assert.equal(hidden.stops, 1, 'each track stopped once');
  assert.equal(hidden.calls, 1);
  assert.equal(hidden.preview, false, 'hidden: the preview is still showing');
  // Nothing comes back on later, however long it stays hidden.
  await delay(5000);
  off(await app.state(), 'hidden, 5 s later');
});

lifecycle('coming back restarts nothing, and offers a working control', {}, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  await app.shot('desktop-1-tracking');
  await app.hide();
  await app.show();
  await offAndOffered(app, 1, 'back');
  await app.shot('desktop-2-back-camera-off');
  await app.click('#hand-control');
  await restartedOnce(app, 2, 'restarted');
  await app.shot('desktop-3-restarted');
});

lifecycle('hide, return and restart, three times over: one stream at a time', {}, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  for (let round = 1; round <= 3; round++) {
    await app.hide();
    assert.equal((await app.state()).live, 0, `round ${round}, hidden`);
    await app.show();
    await app.keyboard();
    await app.until(() => !document.querySelector('#hand-control').hidden, null, 'the restart control');
    await app.click('#hand-control');
    await restartedOnce(app, round + 1, `round ${round}`);
  }
  const s = await app.state();
  assert.deepEqual([s.streams, s.live, s.ended, s.stops], [4, 1, 3, 3]);
});

lifecycle('a double press on the control asks for one camera', {}, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  await app.hide();
  await app.show();
  await app.until(() => !document.querySelector('#hand-control').hidden, null, 'the restart control');
  await app.evaluate(() => { const c = document.querySelector('#hand-control'); c.click(); c.click(); });
  await restartedOnce(app, 2, 'double press');
});

lifecycle('a camera answering while the tab is hidden is released at once', {}, async (b) => {
  const app = await openApp(b, '/?lang=en', { hold: true });
  await app.until(() => window.__camera?.releases.length === 1, null, 'the camera request');
  await app.hide();
  assert.equal((await app.state()).streams, 0, 'nothing has answered yet');
  await app.evaluate(() => { window.__camera.hold = false; window.__camera.releases.forEach((r) => r()); });
  await app.until(() => window.__camera.streams.length === 1, null, 'the late stream');
  await app.until(() => window.__camera.tracks().every((t) => t.readyState === 'ended'), null, 'the late stream ending', 5000);
  off(await app.state(), 'hidden, after the late answer');
  await app.show();
  await offAndOffered(app, 1, 'back');
  await app.click('#hand-control');
  await restartedOnce(app, 2, 'restarted');
});

lifecycle('hidden, back, and only then the camera answers: still off', {}, async (b) => {
  const app = await openApp(b, '/?lang=en', { hold: true });
  await app.until(() => window.__camera?.releases.length === 1, null, 'the camera request');
  await app.hide();
  await app.show();
  await app.evaluate(() => { window.__camera.hold = false; window.__camera.releases.forEach((r) => r()); });
  await app.until(() => window.__camera.streams.length === 1, null, 'the late stream');
  await app.until(() => window.__camera.tracks().every((t) => t.readyState === 'ended'), null, 'the late stream ending', 5000);
  await offAndOffered(app, 1, 'back');
});

lifecycle('hide and show rapidly: off, no duplicates, and it still restarts', {}, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  for (let i = 0; i < 6; i++) {
    await app.bare.activateOther();
    await delay(60);
    await app.bare.activateApp();
    await delay(60);
  }
  await app.show();
  const s = await app.state();
  assert.ok(s.realHidden >= 1, `no real hidden event arrived, so this run proved nothing (${s.realHidden})`);
  await offAndOffered(app, 1, 'after rapid switching');
  assert.equal((await app.state()).stops, 1, 'each track stopped once');
  await app.click('#hand-control');
  await restartedOnce(app, 2, 'restarted');
});

lifecycle('a restart hidden while it is still starting, then restarted again: one live camera', {}, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  await app.hide();
  await app.show();
  await app.until(() => !document.querySelector('#hand-control').hidden, null, 'the restart control');
  await app.evaluate(() => { window.__camera.hold = true; });
  await app.click('#hand-control');
  await app.until(() => window.__camera.releases.length === 1, null, 'the restart asking for the camera');
  await app.hide();
  await app.show();
  await app.until(() => !document.querySelector('#hand-control').hidden, null, 'the restart control again');
  await app.click('#hand-control');
  await app.until(() => window.__camera.releases.length === 2, null, 'the second restart asking');
  // The older request answers first, then the newer one: only the newer may live.
  await app.evaluate(() => { window.__camera.hold = false; window.__camera.releases[0](); });
  await app.until(() => window.__camera.streams.length === 2, null, 'the stale answer');
  await app.until(() => window.__camera.streams[1].getTracks().every((t) => t.readyState === 'ended'), null, 'the stale stream ending', 5000);
  await app.evaluate(() => window.__camera.releases[1]());
  await restartedOnce(app, 3, 'after the race');
  assert.deepEqual((await app.evaluate(() => window.__camera.streams.map((s) => s.getTracks()[0].readyState))), ['ended', 'ended', 'live']);
});

lifecycle('repeated hidden events stop nothing twice, and a mocked one changes nothing', {}, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  // A mocked event on a visible page: the state is what counts, not the event.
  await app.evaluate(() => { for (let i = 0; i < 3; i++) document.dispatchEvent(new Event('visibilitychange')); });
  await delay(500);
  const mocked = await app.state();
  assert.equal(mocked.live, 1, 'a mocked event must not stop the camera');
  assert.equal(mocked.status, 'tracking');
  assert.equal(await app.evaluate(() => window.__camera.mocked), 3);
  await app.hide();
  await app.evaluate(() => { for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('visibilitychange')); });
  await delay(300);
  await app.show();
  await app.hide();
  await app.show();
  const s = await app.state();
  assert.equal(s.stops, 1, 'each track stopped once');
  await offAndOffered(app, 1, 'after repeated events');
});

lifecycle('a page opened in the background asks for no camera until someone asks', {}, async (b) => {
  const app = await openApp(b, '/?lang=en', { hiddenFromStart: true });
  await app.until(() => document.readyState === 'complete' && document.querySelector('#status'), null, 'the app, loading hidden');
  await delay(4000);
  const hidden = await app.state();
  assert.equal(hidden.visibility, 'hidden', 'the tab should load hidden');
  assert.equal(hidden.calls, 0, 'asked for the camera while hidden');
  await app.show();
  await offAndOffered(app, 0, 'first shown');
  await app.click('#hand-control');
  await restartedOnce(app, 1, 'turned on');
});

lifecycle('permission denied: hiding changes nothing, and asking again is safe', { deny: true }, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.keyboard();
  await app.until(() => !document.querySelector('#hand-control').hidden, null, 'the restart control');
  const denied = await app.state();
  assert.deepEqual([denied.calls, denied.streams, denied.live], [1, 0, 0]);
  assert.match(denied.statusTitle, /denied|allow|permission/i);
  await app.hide();
  await app.show();
  await delay(1000);
  const back = await app.state();
  assert.deepEqual([back.calls, back.streams, back.live, back.statusText, back.statusTitle], [1, 0, 0, denied.statusText, denied.statusTitle], 'hiding keeps the reason');
  await app.click('#hand-control');
  await app.until(() => window.__camera.calls === 2, null, 'asking again');
  await app.keyboard();
  await delay(1000);
  const again = await app.state();
  assert.deepEqual([again.streams, again.live, again.status], [0, 0, 'keyboard']);
});

// The dev server's hot-reload socket keeps a page out of the back-forward cache, so only the built app can prove a real restore.
lifecycle('pagehide and a real back-forward restore: released, off, and it restarts', { skip: dev ? 'dev server: the hot-reload socket makes the page ineligible for the back-forward cache; runs against the built app' : false }, async (b) => {
  const app = await openApp(b, '/?lang=en');
  await app.tracking();
  const entry = await b.send('Page.getNavigationHistory', {}, app.sid);
  await app.evaluate(() => sessionStorage.removeItem('__pageshow'));
  await app.goto('/textures/LICENSE.txt');
  await app.until(() => location.pathname === '/textures/LICENSE.txt', null, 'leaving the page');
  await b.send('Page.navigateToHistoryEntry', { entryId: entry.entries[entry.currentIndex].id }, app.sid);
  await app.until(() => location.pathname === '/' && sessionStorage.getItem('__pageshow') !== null, null, 'coming back');
  assert.equal(await app.evaluate(() => sessionStorage.getItem('__pageshow')), 'true', 'not restored from the back-forward cache, so this run proved nothing');
  await offAndOffered(app, 1, 'restored');
  assert.equal((await app.state()).stops, 1, 'leaving stopped the track once');
  await app.click('#hand-control');
  await restartedOnce(app, 2, 'restarted');
});

// Idling hides the restart control. Waking must not put it under a finger that wasn't aimed at it, or move it from under one that was.
// Real touch events at the control's own spot, at three hold lengths: a delay in the stylesheet is not taken on trust.
lifecycle('waking from idle on a phone: a tap that only wakes the page starts no camera, and an aimed touch starts one', {}, async (b) => {
  const app = await openApp(b, '/?lang=en', { phone: PORTRAIT_430 });
  const idle = () => app.until(() => document.body.classList.contains('immersive'), null, 'idling', 20000);
  await app.tracking();
  await app.hide();
  await app.show();
  await app.until(() => window.__camera.point('#hand-control')?.ok, null, 'the restart control');
  await app.shot('phone-430-1-back-camera-off');
  await idle();
  await app.shot('phone-430-2-idle');

  // Back from a hidden tab while idle: the page wakes, and from the moment the control takes a touch it stays where it is.
  await app.bare.activateOther();
  await app.until(() => document.hidden, null, 'hidden while idle', 10000);
  await app.show();
  await app.until(() => !document.body.classList.contains('immersive'), null, 'coming back awake', 3000);
  const spot = await app.until(() => { const p = window.__camera.point('#hand-control'); return p?.ok ? p : null; }, null, 'the restart control after waking', 10000);
  await delay(400);
  const settled = await app.evaluate(() => window.__camera.point('#hand-control'));
  assert.ok(settled?.ok, 'the restart control stopped taking touches');
  assert.deepEqual([Math.round(settled.x), Math.round(settled.y)], [Math.round(spot.x), Math.round(spot.y)], 'the restart control moved after it could be touched');

  // A blind tap at that very spot only wakes the page: short, medium, and longer than the control's own delay.
  for (const holdMs of [150, 400, 700]) {
    await idle();
    assert.equal((await app.evaluate(() => window.__camera.point('#hand-control')))?.ok ?? false, false, 'idle: the restart control still takes touches');
    await app.press(settled, holdMs);
    await app.until(() => !document.body.classList.contains('immersive'), null, 'waking', 3000);
    await delay(1000);
    const blind = await app.state();
    off(blind, `after a ${holdMs} ms tap that only woke the page`);
    assert.equal(blind.calls, 1, `a ${holdMs} ms tap that only woke the page asked for the camera`);
    assert.equal(blind.status, 'keyboard', `after a ${holdMs} ms waking tap`);
  }

  // Then one touch aimed at it starts one session.
  await app.until(() => window.__camera.point('#hand-control')?.ok, null, 'the restart control', 5000);
  await app.touch('#hand-control');
  await restartedOnce(app, 2, 'a touch aimed at it');
  await app.shot('phone-430-3-restarted');
});

// Guided mode. INJECTED 👍 observations through the dev-only window.__app (the fake camera shows no hand), so: dev server only.
// The real tracking loop's "no hand" frames are kept out of GuidedMission.observe, so only the injected ones count.
lifecycle('Guided: a half-held 👍 does not survive the camera stopping; touch still works; a fresh hold is needed after restarting', { skip: dev ? false : 'built app: no window.__app to inject a 👍 through; runs on the dev server' }, async (b) => {
  const app = await openApp(b, '/?flags=astrolife,guided&base=jezero&lang=en', { phone: PORTRAIT_430 });
  await app.tracking();
  await app.until(() => window.__app?.guided && window.__app.modes.mode === 'baseView', null, 'Jezero, guided');
  await app.evaluate(() => {
    const g = window.__app.guided, real = g.observe.bind(g);
    g.observe = (t, obs) => { if (obs?.injected) real(t, obs); };
    window.__thumb = (from, to) => { for (let t = from; t <= to; t += 100) g.observe(t, { thumbsUp: true, pose: 'fist', injected: true }); };
    window.__guided = () => ({ stage: g.session.stage, mode: window.__app.modes.mode, progress: document.querySelector('#guided-mission progress').value, feedback: document.querySelector('#guided-mission .guided-feedback').dataset.state });
  });
  const action = '#guided-mission > button';
  await app.touch(action);
  await app.until(() => window.__app.guided.session.stage !== 'idle', null, 'the guided session starting');
  await app.until((sel) => { if (window.__app.guided.session.stage === 'destination') return true; document.querySelector(sel).click(); return false; }, action, 'the destination step', 20000);
  await app.evaluate(() => document.querySelector('#guided-mission > div button').click());
  await delay(300);

  // Arriving at a step asks for the hand to be released first: one injected frame without a 👍. Then four with it: 300 ms of a 500 ms hold.
  await app.evaluate(() => { window.__app.guided.observe(0, { thumbsUp: false, pose: 'none', injected: true }); window.__thumb(100, 400); });
  const held = await app.evaluate(() => window.__guided());
  assert.deepEqual([held.stage, held.mode], ['destination', 'baseView']);
  assert.ok(Math.abs(held.progress - 0.6) < 0.01, `the injected hold should read 60%: ${held.progress}`);

  await app.hide();
  off(await app.state(), 'hidden in Guided');
  assert.equal((await app.evaluate(() => window.__guided())).progress, 0, 'hidden: the hold bar still shows the cut-off hold');
  await app.show();
  await offAndOffered(app, 1, 'back in Guided');
  const back = await app.evaluate(() => window.__guided());
  assert.deepEqual([back.stage, back.mode, back.progress], ['destination', 'baseView', 0], 'the journey is where it was, with no hold');
  assert.notEqual(back.feedback, 'holding', 'camera off, but the panel still says a hand is holding');
  assert.ok((await app.evaluate((sel) => window.__camera.point(sel), action))?.ok, 'camera off: the Guided button must take a touch');
  await app.shot('guided-430-1-back-camera-off');

  await app.touch('#hand-control');
  await restartedOnce(app, 2, 'restarted in Guided');
  // Two more frames on the old hold's clock would have completed it (300 + 100 + 100 ms) and launched.
  await app.evaluate(() => window.__thumb(500, 600));
  await delay(500);
  const stale = await app.evaluate(() => window.__guided());
  assert.deepEqual([stale.stage, stale.mode], ['destination', 'baseView'], 'a hold from before the stop was finished by the new session');
  assert.ok(stale.progress < 0.5, `only the new session's frames should count: ${stale.progress}`);
  // A whole hold in the new session confirms.
  await app.evaluate(() => window.__thumb(700, 1100));
  await app.until(() => window.__app.modes.mode === 'launch', null, 'the fresh hold confirming', 10000);
  await app.shot('guided-430-2-fresh-hold-confirmed');
});

// ---- The restart control itself: keyboard, a cancelled press, one touch, and what it is to assistive technology. ----
/** Camera on, tab hidden, back: the camera is off and the restart control is offered. */
async function backWithCameraOff(b, options) {
  const app = await openApp(b, '/?lang=en', options);
  await app.tracking();
  await app.hide();
  await app.show();
  await app.until(() => window.__camera.point('#hand-control')?.ok, null, 'the restart control');
  return app;
}

lifecycle('the restart control by keyboard: Tab reaches it, Enter starts one session, and Space starts one after the next stop', {}, async (b) => {
  const app = await backWithCameraOff(b);
  await app.tabTo('#hand-control');
  await app.key('Enter', 'Enter', 13, '\r');
  await restartedOnce(app, 2, 'Enter');
  await app.hide();
  await app.show();
  await app.until(() => window.__camera.point('#hand-control')?.ok, null, 'the restart control again');
  await app.tabTo('#hand-control');
  await app.key(' ', 'Space', 32, ' ');
  await restartedOnce(app, 3, 'Space');
  const s = await app.state();
  assert.deepEqual([s.streams, s.live, s.ended], [3, 1, 2]);
});

lifecycle('a cancelled press, unseen or on the visible control, starts nothing and does not block the next deliberate tap', {}, async (b) => {
  const app = await backWithCameraOff(b, { phone: PORTRAIT_430 });
  const spot = await app.evaluate(() => window.__camera.point('#hand-control'));
  // Unseen: the page is idle, the press wakes it and the system takes the touch away (a call, a gesture, a scroll).
  await app.until(() => document.body.classList.contains('immersive'), null, 'idling', 20000);
  await app.cancelledPress(spot, 700);
  await app.until(() => window.__camera.point('#hand-control')?.ok, null, 'the restart control after the cancelled press', 5000);
  await delay(800);
  assert.deepEqual(await app.evaluate(() => [window.__camera.calls, window.__camera.state().live]), [1, 0], 'a cancelled waking press asked for the camera');
  // Seen: a press on the visible control that is cancelled is not a tap.
  await app.cancelledPress(await app.evaluate(() => window.__camera.point('#hand-control')), 150);
  await delay(800);
  assert.deepEqual(await app.evaluate(() => [window.__camera.calls, window.__camera.state().live]), [1, 0], 'a cancelled press on the control asked for the camera');
  // Neither left it blocked.
  await app.until(() => window.__camera.point('#hand-control')?.ok, null, 'the restart control', 5000);
  await app.touch('#hand-control');
  await restartedOnce(app, 2, 'the deliberate tap after cancelled presses');
});

lifecycle('one touch on the restart control is one click, one camera request and one session', {}, async (b) => {
  const app = await backWithCameraOff(b, { phone: PORTRAIT_430 });
  await app.evaluate(() => {
    window.__clicks = [];
    document.addEventListener('click', (e) => { if (e.target.closest?.('#hand-control')) window.__clicks.push({ detail: e.detail, pointerType: e.pointerType, trusted: e.isTrusted }); }, true);
  });
  await app.touch('#hand-control');
  await restartedOnce(app, 2, 'one touch');
  await delay(1500); // a synthesized second click, or a late duplicate request, would have arrived by now
  const s = await app.state();
  const clicks = await app.evaluate(() => window.__clicks);
  assert.equal(clicks.length, 1, `one touch produced ${JSON.stringify(clicks)}`);
  assert.equal(clicks[0].trusted, true);
  assert.deepEqual([s.calls, s.streams, s.live, s.ended], [2, 2, 1, 1], 'one touch: one new request, one live stream');
});

lifecycle('the restart control is a named, focusable button with a visible focus ring, and is out of reach while idle hides it', {}, async (b) => {
  const app = await backWithCameraOff(b);
  const described = await app.evaluate(() => {
    const el = document.querySelector('#hand-control');
    return { tag: el.tagName, role: el.getAttribute('role'), type: el.type, disabled: el.disabled, tabIndex: el.tabIndex, name: (el.getAttribute('aria-label') || el.textContent).trim(),
      ariaHidden: el.closest('[aria-hidden="true"]') !== null, inert: el.closest('[inert]') !== null, inForm: el.form !== null };
  });
  assert.equal(described.tag, 'BUTTON');
  assert.ok(described.role === null || described.role === 'button', `role ${described.role}`);
  assert.equal(described.disabled, false);
  assert.ok(described.tabIndex >= 0, 'not in the tab order');
  assert.match(described.name, /Turn on hand control/);
  assert.deepEqual([described.ariaHidden, described.inert], [false, false], 'hidden from assistive technology');
  assert.ok(described.type === 'button' || !described.inForm, 'a submit button inside a form');
  await app.tabTo('#hand-control');
  const ring = await app.evaluate(() => {
    const el = document.querySelector('#hand-control'), css = getComputedStyle(el);
    return { focusVisible: el.matches(':focus-visible'), outline: css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0, shadow: css.boxShadow !== 'none' };
  });
  assert.equal(ring.focusVisible, true, 'keyboard focus should count as visible focus');
  assert.ok(ring.outline || ring.shadow, `no visible focus indicator: ${JSON.stringify(ring)}`);
  await app.shot('desktop-4-keyboard-focus');
  // Idle hides it, on touch devices only (ui/chrome.ts): it must leave the focus order with it, not sit there invisible and focusable.
  const phone = await backWithCameraOff(b, { phone: PORTRAIT_430 });
  await phone.until(() => document.body.classList.contains('immersive'), null, 'idling', 20000);
  const idle = await phone.evaluate(() => {
    const el = document.querySelector('#hand-control');
    el.focus();
    return { visibility: getComputedStyle(el).visibility, focused: document.activeElement === el };
  });
  assert.deepEqual(idle, { visibility: 'hidden', focused: false }, 'idle: the hidden control can still take focus');
  assert.deepEqual(await phone.evaluate(() => [window.__camera.calls, window.__camera.state().live]), [1, 0]);
});
