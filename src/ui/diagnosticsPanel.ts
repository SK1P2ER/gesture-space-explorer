// The debug diagnostics panel (?debug → 🩺 Diagnostics). Loaded on demand with the recorder; debug text is English.
// The tester runs the phone; this records and exports. Nothing is uploaded: the report leaves the page only through
// the share sheet, a download, or the text box, each started by the tester.
import { DiagnosticsController, pageInfo, type DiagnosticsContext, type ExportDeps } from '../performance/diagnostics';

export interface DiagnosticsHost {
  appVersion: string;
  entryChunk: string | null;
  /** Hands the frame loop its per-frame and tracking hooks while a session records, and null when it stops. */
  setHooks(hooks: { frame(t: number, context: () => DiagnosticsContext): void; timing(t: number, detectMs: number, processingMs: number): void } | null): void;
}

const SCENARIOS = ['free', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'P1 explorer, camera off', 'P2 camera on, hand visible', 'P3 Japan ground', 'P4 launch and travel', 'P5 landing'];
const fileName = (url: string) => new URL(url).pathname.split('/').pop() || null;
/** Same-origin script and style file names already loaded: names only, no query strings. */
function loadedAssets(): string[] {
  const names = performance.getEntriesByType('resource')
    .map((e) => new URL(e.name, location.href))
    .filter((u) => u.origin === location.origin && /\/assets\/[^/]+\.(js|css)$/.test(u.pathname))
    .map((u) => u.pathname.split('/').pop()!);
  return [...new Set(names)].slice(0, 50);
}

let panel: Panel | null = null;

export function toggleDiagnostics(host: DiagnosticsHost) {
  panel ??= new Panel(host);
  panel.toggle();
}

class Panel {
  private readonly controller: DiagnosticsController;
  private readonly root = document.createElement('section');
  private readonly bar = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly json = document.createElement('textarea');
  private readonly scenario = document.createElement('select');
  private readonly notes = document.createElement('textarea');
  private readonly fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  private readonly buttons: Record<string, HTMLButtonElement> = {};
  private timer = 0;

  constructor(private readonly host: DiagnosticsHost) {
    this.controller = new DiagnosticsController((scenario) => ({
      scenario, now: () => performance.now(), wallNow: () => Date.now(), doc: document, win: window,
      build: { appVersion: host.appVersion, entryChunk: host.entryChunk, diagnosticsChunk: fileName(import.meta.url), loadedAssets: loadedAssets() },
      page: pageInfo(new URL(location.href)),
      device: { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio },
    }));
    this.build();
  }

  private build() {
    const r = this.root;
    r.id = 'diagnostics-panel';
    r.setAttribute('aria-label', 'Diagnostics');
    r.style.cssText = 'position:fixed;z-index:2000;left:50%;bottom:calc(8px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(420px,calc(100vw - 16px));max-height:70vh;overflow:auto;padding:10px 12px;font:12px/1.4 system-ui,sans-serif;color:#e8eefc;background:rgba(8,12,24,.95);border:1px solid #445;border-radius:10px;';
    const h = document.createElement('h2');
    h.textContent = 'Diagnostics (debug)';
    h.style.cssText = 'margin:0 0 6px;font-size:13px;';
    const hint = document.createElement('p');
    hint.style.cssText = 'margin:0 0 8px;opacity:.8;';
    hint.textContent = 'Fill in the device first: it is read at Stop. Camera checks: after coming back, wait 10 s before 🖐 Turn on hand control; after a restart, stay 15 s. Nothing is uploaded; reload loses an unexported session.';
    for (const s of SCENARIOS) this.scenario.append(new Option(s, s.split(' ')[0]));
    this.scenario.id = 'diagnostics-scenario';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;margin-bottom:6px;';
    const add = (label: string, el: HTMLElement) => { const l = document.createElement('label'); l.textContent = label; grid.append(l, el); };
    add('Scenario', this.scenario);
    for (const [key, label] of [['model', 'Device model'], ['os', 'OS version'], ['browser', 'Browser']] as const) {
      const input = Object.assign(document.createElement('input'), { type: 'text', maxLength: 80 });
      this.fields[key] = input;
      add(label, input);
    }
    for (const [key, label] of [['lowPower', 'Low Power Mode'], ['charging', 'Charging'], ['screenRecording', 'Screen recording']] as const) {
      const select = document.createElement('select');
      for (const v of ['unknown', 'yes', 'no']) select.append(new Option(v, v));
      this.fields[key] = select;
      add(label, select);
    }
    this.notes.placeholder = 'What you saw (stutters, the camera dot, layout): no names';
    this.notes.maxLength = 2000;
    this.notes.rows = 3;
    this.notes.style.cssText = 'width:100%;box-sizing:border-box;';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px;';
    for (const [id, label, run] of [
      ['start', '● Start', () => this.start()],
      ['export', '⤴ Export report', () => void this.export()],
      ['show-json', 'Show JSON', () => this.showJson()],
      ['discard', 'Discard', () => this.discard()],
      ['close', 'Close', () => this.toggle()],
    ] as const) {
      const b = Object.assign(document.createElement('button'), { type: 'button', id: `diagnostics-${id}`, textContent: label });
      b.addEventListener('click', run);
      this.buttons[id] = b;
      actions.append(b);
    }
    this.status.id = 'diagnostics-status';
    this.status.setAttribute('role', 'status');
    this.status.style.margin = '4px 0';
    this.json.id = 'diagnostics-json';
    this.json.readOnly = true;
    this.json.rows = 8;
    this.json.hidden = true;
    this.json.style.cssText = 'width:100%;box-sizing:border-box;font:11px monospace;';
    r.append(h, hint, grid, this.notes, actions, this.status, this.json);

    // While recording, only a small bar stays on screen, at the left edge: the app stays usable around it.
    this.bar.id = 'diagnostics-rec';
    this.bar.hidden = true;
    this.bar.setAttribute('role', 'status');
    this.bar.style.cssText = 'position:fixed;z-index:2000;left:calc(4px + env(safe-area-inset-left));top:50%;transform:translateY(-50%);display:flex;gap:6px;align-items:center;padding:6px 8px;font:12px system-ui,sans-serif;color:#fff;background:rgba(160,20,30,.92);border-radius:8px;';
    const clock = document.createElement('span');
    clock.id = 'diagnostics-clock';
    const stop = Object.assign(document.createElement('button'), { type: 'button', id: 'diagnostics-stop', textContent: '■ Stop' });
    stop.addEventListener('click', () => this.stop());
    this.bar.append(clock, stop);
    r.hidden = true; // toggle() opens it
    document.body.append(r, this.bar);
    this.sync();
  }

  toggle() {
    if (this.controller.recording) return; // the recording bar is the only control while recording
    this.root.hidden = !this.root.hidden;
  }

  private sync() {
    const recording = this.controller.recording;
    const report = this.controller.report;
    if (recording) this.root.hidden = true; // only the recording bar while recording
    this.bar.hidden = !recording;
    this.buttons.start.disabled = recording;
    this.buttons.export.disabled = recording || !report;
    this.buttons['show-json'].disabled = recording || !report;
    this.buttons.discard.disabled = recording || !report;
    if (!report) this.json.hidden = true;
  }

  private start() {
    const ok = this.controller.start(this.scenario.value, () => confirm('Discard the report that was not exported, and start a new session?'));
    if (!ok) return;
    this.host.setHooks({ frame: (t, c) => this.controller.frame(t, c), timing: (t, d, p) => this.controller.timing(t, d, p) });
    const started = performance.now();
    const clock = this.bar.querySelector<HTMLElement>('#diagnostics-clock')!;
    const tick = () => { const s = Math.floor((performance.now() - started) / 1000); clock.textContent = `● DIAG REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    tick();
    this.timer = window.setInterval(tick, 1000);
    this.status.textContent = '';
    this.json.value = '';
    this.sync();
  }

  private stop() {
    this.host.setHooks(null);
    clearInterval(this.timer);
    const entered = Object.fromEntries(Object.entries(this.fields).map(([k, el]) => [k, el.value]));
    const report = this.controller.stop(entered, this.notes.value);
    this.root.hidden = false; // back to the full panel, with the report's actions
    this.sync();
    if (report) {
      const verdicts = report.assertions.map((a) => `${a.id} ${a.verdict}`).join(' · ');
      this.status.textContent = `Stopped: ${report.segments.length} segment(s), ${report.events.length} event(s). ${verdicts}. Export it, or Discard.`;
    }
  }

  private async export() {
    const deps: ExportDeps = {
      share: typeof navigator.canShare === 'function' ? async (name, text) => {
        const file = new File([text], name, { type: 'application/json' });
        if (!navigator.canShare({ files: [file] })) throw new Error('this browser cannot share a file');
        await navigator.share({ files: [file], title: name });
      } : null,
      download: (name, text) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      },
    };
    const outcome = await this.controller.export(deps).catch((e: Error) => e.message);
    this.status.textContent = {
      shared: 'Shared. The report stays here until you Discard it.',
      cancelled: 'Share cancelled: the report is kept. Export again, or Show JSON and copy it.',
      downloaded: 'Downloaded (Safari: Downloads in the Files app). The report stays here until you Discard it.',
      failed: 'Export failed: the report is kept. Show JSON and copy it.',
    }[outcome as string] ?? `Export failed: ${outcome}. The report is kept.`;
  }

  private showJson() {
    const report = this.controller.report;
    if (!report) return;
    this.json.value = JSON.stringify(report, null, 1);
    this.json.hidden = false;
    this.json.select();
  }

  private discard() {
    this.controller.discard();
    this.json.value = '';
    this.status.textContent = 'Discarded.';
    this.sync();
  }
}
