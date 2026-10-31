// One warm-up request before a dev-server suite's first test (docs/decisions.md, entry 10).
//
// A cold Vite dev server optimizes dependencies and transforms the module graph on the first
// page load: 11–15 s measured on Windows, against the 15 s page budget the suites give each
// test. Paying for that once here keeps it out of whichever test happens to run first. No test's
// own timeout changes; this step has its own allowance, and a warm-up that can't load the app at
// all fails the suite's setup with the reason, rather than the first test.

const WARMUP_MS = 120_000;

/**
 * @param chromium the suite's Playwright chromium
 * @param baseURL the dev server, e.g. http://127.0.0.1:5173
 * @param options `path` to load (default the app); `app: false` waits only for DOMContentLoaded
 *   (for fixture pages that aren't the app)
 */
export async function warmUp(chromium, baseURL, { path = '/', app = true } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); // its own context: nothing it stores reaches the tests
    await page.addInitScript(() => {
      localStorage.setItem('gse.quality', 'low');
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Dev-server warm-up: no camera', 'NotAllowedError'); };
    });
    await page.goto(new URL(path, baseURL).href, { waitUntil: 'domcontentloaded', timeout: WARMUP_MS });
    // Keyboard mode means main.ts ran and the lazy tracker chunk was requested and transformed too.
    if (app) await page.waitForFunction(() => document.querySelector('#status')?.dataset.kind === 'keyboard', null, { timeout: WARMUP_MS });
  } finally {
    await browser.close();
  }
}
