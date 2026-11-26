// Screenshot guardrail (owner, 2026-11-20): 5 screens × 3 languages × 3 viewports (844×390 landscape added 2026-11-21).
//   node --test --test-concurrency=1 tests/browser/screens.test.mjs              # dev server
//   SCREENS_PREVIEW=1 (after npm run build) uses the built app; UPDATE_SCREENS=1 rewrites the baselines.
// Every 3D canvas is hidden while shooting, so the comparison covers the interface only. The clock is fixed, the camera is refused
// (keyboard mode) and motion is reduced. Baselines are per platform (fonts differ): tests/browser/__screens__/<platform>/.
// A missing baseline is written and reported, not failed. Each screen also fails when a visible [data-ui] element,
// or text inside one, is wider or taller than its box, or leaves the viewport sideways.
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { warmUp } from './helpers/warmup.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseDir = fileURLToPath(new URL(`./__screens__/${process.platform}/`, import.meta.url));
const outDir = fileURLToPath(new URL('./__screens__/_out/', import.meta.url));
const update = process.env.UPDATE_SCREENS === '1';
/** SCREENS_SHOW_3D=1: review shots with the 3D scene visible, written to _out/3d/ only (no baseline, no comparison). */
const show3d = process.env.SCREENS_SHOW_3D === '1';
const FIXED_TIME = new Date('2026-11-20T10:00:00+09:00');
const VIEWPORTS = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844 }, land: { width: 844, height: 390 } };
const LANGS = ['ja', 'my', 'en'];
/** A pixel counts as changed above this channel difference; a screen fails above this share of changed pixels. */
const CHANNEL = 40, SHARE = 0.003;
/** The 3D scene and everything projected from it: not interface, so not compared. */
const SCENE_HIDDEN = 'canvas, #labels, #sky-labels, #japan-site-marker, .active-vehicle-label { visibility: hidden !important; }';
let server, baseURL, browser;
const report = [];

before(async () => {
  mkdirSync(baseDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
  const vite = await import('vite');
  if (process.env.SCREENS_PREVIEW === '1') server = await vite.preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  else { server = await vite.createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await server.listen(); }
  baseURL = server.resolvedUrls.local[0].replace(/\/$/, '');
  if (process.env.SCREENS_PREVIEW !== '1') await warmUp(chromium, baseURL);
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close(); await server?.close();
  writeFileSync(`${outDir}report.json`, JSON.stringify(report, null, 1));
});

async function newPage(viewport, lang) {
  const phone = viewport !== 'desk';
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport], deviceScaleFactor: 1, reducedMotion: 'reduce', locale: { ja: 'ja-JP', my: 'my-MM', en: 'en-US' }[lang],
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
  });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Screens suite: no camera', 'NotAllowedError'); };
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  page.setDefaultTimeout(60000);
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`); });
  return { context, page, problems };
}

/** Visible [data-ui] elements (and text inside them) that overflow their box or leave the viewport sideways. */
const overflow = page => page.evaluate(() => {
  const found = [], width = innerWidth;
  for (const element of document.querySelectorAll('[data-ui]')) {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden') continue;
    const ui = element.dataset.ui + (element.dataset.view ? `:${element.dataset.view}` : '') + (element.dataset.landmark ? `:${element.dataset.landmark}` : '') + (element.dataset.phase ? `:${element.dataset.phase}` : '');
    const text = (element.textContent || '').trim().slice(0, 60);
    const scrolls = ['auto', 'scroll'].includes(getComputedStyle(element).overflowX) || ['auto', 'scroll'].includes(getComputedStyle(element).overflowY);
    if (!scrolls && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) && element.tagName !== 'DIALOG')
      found.push({ ui, text, problem: `content ${element.scrollWidth}×${element.scrollHeight} in ${element.clientWidth}×${element.clientHeight}` });
    for (const child of element.querySelectorAll('span,h2,h3,p,dt,dd')) {
      const style = getComputedStyle(child);
      if (style.position === 'absolute' && style.clipPath !== 'none') continue; // visually hidden label
      if (style.textOverflow === 'ellipsis' && child.scrollWidth > child.clientWidth + 1) found.push({ ui, text: (child.textContent || '').trim().slice(0, 60), problem: 'truncated with an ellipsis' });
    }
    const inScroller = element.closest('.spaceport-landmarks');
    if (!inScroller && (box.left < -1 || box.right > width + 1)) found.push({ ui, text, problem: `outside the viewport (${Math.round(box.left)}…${Math.round(box.right)} of ${width})` });
  }
  // A scrolling row must keep every item reachable: nothing may start left of the row while it is scrolled to 0.
  for (const row of document.querySelectorAll('.spaceport-landmarks')) {
    const left = row.getBoundingClientRect().left, saved = row.scrollLeft; row.scrollLeft = 0;
    for (const item of row.children) if (item.getBoundingClientRect().left < left - 1) found.push({ ui: item.dataset.ui ?? 'item', text: (item.textContent || '').trim().slice(0, 60), problem: 'starts left of its scrolling row: unreachable' });
    row.scrollLeft = saved;
  }
  // Floating panels must not cover each other (a two-line title once covered the place card on a phone).
  const panels = ['spaceport-title', 'spaceport-place-card', 'spaceport-about', 'spaceport-dock'].flatMap(ui => {
    const element = document.querySelector(`[data-ui="${ui}"]`); const box = element?.getBoundingClientRect();
    return element && box.width && box.height && !element.closest('[hidden]') ? [{ ui, box }] : [];
  });
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i].box, b = panels[j].box;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 2 && h > 2) found.push({ ui: `${panels[i].ui} × ${panels[j].ui}`, text: '', problem: `overlap ${Math.round(w)}×${Math.round(h)}` });
  }
  return found;
});

async function compare(name, png) {
  const file = `${baseDir}${name}.png`;
  writeFileSync(`${outDir}${name}.png`, png);
  if (update || !existsSync(file)) { writeFileSync(file, png); return { name, baseline: update ? 'updated' : 'written (none existed)' }; }
  const [a, b] = await Promise.all([sharp(readFileSync(file)).raw().toBuffer({ resolveWithObject: true }), sharp(png).raw().toBuffer({ resolveWithObject: true })]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { name, changed: 1, failed: true, why: 'size changed' };
  let changed = 0; const ch = a.info.channels;
  for (let i = 0; i < a.data.length; i += ch) {
    let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    if (d > CHANNEL) changed++;
  }
  const share = changed / (a.data.length / ch);
  return { name, changed: +share.toFixed(5), failed: share > SHARE };
}

async function shoot(page, name) {
  await page.waitForTimeout(600);
  if (show3d) {
    mkdirSync(`${outDir}3d/`, { recursive: true });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}3d/${name}.png`, animations: 'disabled', caret: 'hide' });
    const over = await overflow(page);
    report.push({ name, view: '3d', overflow: over });
    return { diff: { name, changed: 0, failed: false }, over };
  }
  // Full-bleed canvases sit under the interface, so a mask (drawn on top) would hide it: hide the canvases instead,
  // with the labels pinned to the 3D scene (they move a few pixels with it between runs).
  const png = await page.screenshot({ style: SCENE_HIDDEN, animations: 'disabled', caret: 'hide' });
  const diff = await compare(name, png);
  const over = await overflow(page);
  report.push({ ...diff, overflow: over });
  return { diff, over };
}

async function openPreview(page) {
  await page.locator('[data-ui="spaceport-entry"]').click();
  await page.waitForFunction(() => document.querySelector('#spaceport-view')?.open && document.querySelector('#spaceport-view .spaceport-status')?.hidden, null, { timeout: 120000 });
  await page.locator('[data-ui="spaceport-phase-marker"][data-phase="ready"]').click();
}

for (const viewport of Object.keys(VIEWPORTS)) for (const lang of LANGS) {
  test(`screens · ${viewport} · ${lang}`, { timeout: 600000 }, async () => {
    const { context, page, problems } = await newPage(viewport, lang);
    const results = [];
    try {
      await page.goto(`${baseURL}/?site=ground&base=tanegashima&lang=${lang}`);
      await page.locator('#spaceport-ground-canvas').waitFor({ state: 'visible', timeout: 120000 });
      await page.waitForTimeout(2500);
      results.push(await shoot(page, `ground-${lang}-${viewport}`));

      await openPreview(page);
      results.push(await shoot(page, `preview-${lang}-${viewport}`));
      await page.locator('[data-ui="spaceport-place"][data-landmark="control"]').click();
      await page.locator('#spaceport-inspection').waitFor({ state: 'visible' });
      results.push(await shoot(page, `preview-place-${lang}-${viewport}`));
      await page.locator('[data-ui="spaceport-place-card-close"]').click();
      await page.locator('[data-ui="spaceport-phase-marker"][data-phase="ignition"]').click();
      results.push(await shoot(page, `preview-ignition-${lang}-${viewport}`));
      await page.locator('[data-ui="spaceport-close"]').click();

      await page.goto(`${baseURL}/?body=earth&lang=${lang}`);
      await page.waitForFunction(() => document.querySelector('#status')?.dataset.kind === 'keyboard', null, { timeout: 120000 });
      await page.waitForTimeout(2500);
      results.push(await shoot(page, `orbit-${lang}-${viewport}`));
    } finally { await context.close(); }
    const failed = results.filter(r => r.diff.failed).map(r => `${r.diff.name}: ${r.diff.why ?? `${(r.diff.changed * 100).toFixed(2)}% pixels changed`}`);
    const overflowing = results.flatMap(r => r.over.map(o => `${r.diff.name}: ${o.ui} "${o.text}" ${o.problem}`));
    assert.deepEqual(problems, [], 'page errors');
    assert.deepEqual(overflowing, [], 'labels overflow their targets');
    assert.deepEqual(failed, [], 'screens differ from their baselines (UPDATE_SCREENS=1 after an intended change)');
  });
}
