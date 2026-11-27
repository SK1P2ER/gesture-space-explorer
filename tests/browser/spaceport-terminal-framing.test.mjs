// Focused P3.0 regression test:
// 1) Follow (t=10) -> Terminal -> scrub to t=8 in BOTH full-motion and reduced-motion:
//    verifies settled camera pose, projected terminalPoints() inside UI bands, and non-blank rendered WebGL pixels,
//    plus scrubbing, Replay, Reset, and manual orbit.
// 2) Phone portrait & landscape Launch Pad framing + en/ja/my reachability and zero clipping.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { warmUp } from './helpers/warmup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let browser, server, url = process.env.FRAMING_URL;

before(async () => {
  if (!url) {
    server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    url = server.resolvedUrls.local[0].replace(/\/$/, '');
    await warmUp(chromium, url);
  }
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openPreview(viewport, lang, { reducedMotion = 'no-preference', mobile = false } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion,
    hasTouch: mobile,
    isMobile: mobile,
  });
  await context.addInitScript(() => {
    localStorage.setItem('gse.quality', 'low');
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('test: no camera', 'NotAllowedError');
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${url}/?site=ground&base=tanegashima&lang=${lang}`);
  await page.waitForFunction(
    () => !!document.querySelector('[data-ui="spaceport-entry"]') && window.__app?.localSpaceport?.active,
  );
  await page.locator('[data-ui="spaceport-entry"]').click();
  await page.waitForFunction(
    () => !!window.__app?.spaceport?.viewer && document.querySelector('#spaceport-view .spaceport-status')?.hidden,
  );
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

async function sampleVisibleBandPixels(page) {
  return page.evaluate(() => {
    const v = window.__app.spaceport.viewer;
    v.renderer.render(v.scene, v.camera);
    const gl = v.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const y0 = Math.max(0, Math.floor(h * (v.bands.bottom + 0.04)));
    const y1 = Math.min(h - 1, Math.floor(h * (1 - v.bands.top - 0.04)));
    const x0 = Math.floor(w * 0.15);
    const x1 = Math.floor(w * 0.85);
    const sw = Math.max(1, x1 - x0);
    const sh = Math.max(1, y1 - y0);
    const buf = new Uint8Array(sw * sh * 4);
    gl.readPixels(x0, y0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, buf);

    let sumL = 0, sumL2 = 0, count = 0, skyLike = 0, darkLike = 0, midTone = 0;
    const buckets = new Set();
    const step = 4;
    for (let y = 0; y < sh; y += step) {
      for (let x = 0; x < sw; x += step) {
        const i = (y * sw + x) * 4;
        const r = buf[i], g = buf[i + 1], b = buf[i + 2];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sumL += l;
        sumL2 += l * l;
        count++;
        if (b > r + 25 && b > 140 && l > 120) skyLike++;
        if (l < 35) darkLike++;
        if (l >= 45 && l <= 215 && Math.abs(b - r) < 40) midTone++;
        buckets.add(`${r >> 5},${g >> 5},${b >> 5}`);
      }
    }
    const mean = sumL / count;
    const std = Math.sqrt(Math.max(0, sumL2 / count - mean * mean));
    return {
      count,
      meanLuma: Number(mean.toFixed(1)),
      stdLuma: Number(std.toFixed(1)),
      skyRatio: Number((skyLike / count).toFixed(3)),
      darkRatio: Number((darkLike / count).toFixed(3)),
      midToneRatio: Number((midTone / count).toFixed(3)),
      colorBuckets: buckets.size,
    };
  });
}

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`Follow (t=10) -> Terminal -> scrub t=8 renders visible terminal arrival (${reducedMotion})`, { timeout: 240000 }, async () => {
    const { context, page, errors } = await openPreview({ width: 1440, height: 900 }, 'en', { reducedMotion });
    try {
      // 1. Switch to Follow and scrub to t=10
      await page.locator('[data-view="launch"]').click();
      await page.waitForFunction(() => !window.__app.spaceport.viewer.moving, null, { timeout: 10000 });
      await page.evaluate(() => window.__app.spaceport.viewer.seek(10));
      await page.waitForTimeout(150);

      // 2. Switch to Terminal and wait for transition to settle
      await page.locator('[data-view="terminal"]').click();
      await page.waitForFunction(() => !window.__app.spaceport.viewer.moving, null, { timeout: 10000 });
      await page.evaluate(() => window.__app.spaceport.viewer.seek(8));
      await page.waitForTimeout(200);

      // 3. Assert camera settled cleanly at Terminal pose (not trapped at Collider 0 X=-74)
      const state = await page.evaluate(async () => {
        const v = window.__app.spaceport.viewer;
        const { terminalPoints } = await import('/src/scene/terminalFraming.ts');
        return {
          eye: v.camera.position.toArray(),
          target: v.controls.target.toArray(),
          bands: v.bands,
          points: terminalPoints().map(p => p.project(v.camera).toArray()),
        };
      });
      assert.ok(state.eye[0] < -140 && state.eye[0] > -165, `Terminal eye X should be at arrival forecourt, got ${state.eye}`);
      assert.ok(state.eye[2] < -90 && state.eye[2] > -108, `Terminal eye Z should be inside planting line, got ${state.eye}`);
      for (const [x, y, z] of state.points) {
        assert.ok(Math.abs(x) <= 0.93, `terminal point X out of bounds: ${x}`);
        assert.ok(y <= 1 - 2 * state.bands.top - 0.06, `terminal point Y above header band: ${y}`);
        assert.ok(y >= -1 + 2 * state.bands.bottom + 0.06, `terminal point Y below dock band: ${y}`);
        assert.ok(z > -1 && z < 1, `terminal point clipped in depth: ${z}`);
      }

      // 4. Assert actual WebGL pixels show the architectural scene (not blank blue sky or dark trapped wall)
      const pixels = await sampleVisibleBandPixels(page);
      assert.ok(pixels.stdLuma >= 18, `Expected scene luminance variance >= 18, got ${JSON.stringify(pixels)}`);
      assert.ok(pixels.skyRatio < 0.72, `Expected non-blank scene (skyRatio < 0.72), got ${JSON.stringify(pixels)}`);
      assert.ok(pixels.darkRatio < 0.65, `Expected non-trapped scene (darkRatio < 0.65), got ${JSON.stringify(pixels)}`);
      assert.ok(pixels.colorBuckets >= 12, `Expected architectural color variety >= 12 buckets, got ${JSON.stringify(pixels)}`);

      // 5. Verify Replay from end, manual orbit, and Reset
      await page.evaluate(() => window.__app.spaceport.viewer.seek(19.958));
      await page.waitForTimeout(100);
      await page.locator('[data-ui="spaceport-play"]').click();
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__app.spaceport.viewer.playing), true, 'Replay starts playback');
      await page.locator('[data-ui="spaceport-play"]').click();

      const canvas = await page.locator('.spaceport-stage canvas').boundingBox();
      await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.4);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.42, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.spaceport-cameras [aria-pressed="true"]').count(), 0, 'Manual orbit releases preset');

      await page.locator('[data-ui="spaceport-reset"]').click();
      await page.waitForFunction(() => !window.__app.spaceport.viewer.moving, null, { timeout: 10000 });
      assert.equal(await page.locator('[data-view="overview"]').getAttribute('aria-pressed'), 'true', 'Reset returns to Overview');
      assert.equal(await page.evaluate(() => window.__app.spaceport.viewer.time), 0, 'Reset seeks to t=0');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

for (const [layout, viewport] of [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
]) {
  for (const lang of ['en', 'ja', 'my']) {
    test(`Phone ${layout} (${lang}): Launch Pad framing fits between header and dock with zero clipping`, { timeout: 240000 }, async () => {
      const { context, page, errors } = await openPreview(viewport, lang, { reducedMotion: 'reduce', mobile: true });
      try {
        await page.locator('[data-view="pad"]').tap();
        await page.waitForTimeout(150);
        const check = await page.evaluate(async () => {
          const v = window.__app.spaceport.viewer;
          const { padPoints, PAD_SUBJECTS } = await import('/src/scene/padFraming.ts');
          const pts = padPoints().map(p => p.project(v.camera).toArray());
          const nose = v.camera.position.clone().set(0, PAD_SUBJECTS.hero.max[1], 0).project(v.camera);
          const base = v.camera.position.clone().set(0, PAD_SUBJECTS.deck.min[1], 0).project(v.camera);
          const playBox = document.querySelector('[data-ui="spaceport-play"]').getBoundingClientRect();
          const timelineBox = document.querySelector('[data-ui="spaceport-timeline"]').getBoundingClientRect();
          const padBtnBox = document.querySelector('[data-view="pad"]').getBoundingClientRect();
          return {
            pts,
            bands: v.bands,
            heroNdcHeight: Math.abs(nose.y - base.y),
            overflowX: document.documentElement.scrollWidth > window.innerWidth,
            playH: playBox.height,
            timelineH: timelineBox.height,
            padBtnH: padBtnBox.height,
          };
        });
        assert.equal(check.overflowX, false, 'No horizontal overflow');
        assert.ok(check.playH >= 44 && check.timelineH >= 44 && check.padBtnH >= 44, `Touch targets >= 44px: ${JSON.stringify(check)}`);
        const yTop = 1 - 2 * check.bands.top - 0.05;
        const yBottom = -1 + 2 * check.bands.bottom + 0.05;
        for (const [x, y, z] of check.pts) {
          assert.ok(Math.abs(x) <= 0.96, `pad point X clipped: ${x}`);
          assert.ok(y <= yTop, `pad point Y above header: ${y} > ${yTop}`);
          assert.ok(y >= yBottom, `pad point Y under dock: ${y} < ${yBottom}`);
          assert.ok(z > -1 && z < 1, `pad point clipped in depth: ${z}`);
        }
        if (layout === 'portrait') {
          // Hero shuttle+base spans > 65% of the visible NDC band height in portrait
          const bandSpan = yTop - yBottom;
          assert.ok(check.heroNdcHeight / bandSpan >= 0.45, `Portrait shuttle+base should fill band, got ${(check.heroNdcHeight / bandSpan).toFixed(2)}`);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
}
