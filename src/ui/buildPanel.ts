import type { Lang } from '../data/bodies';
import type { Intent } from '../intents';
import { BUILD_KINDS, type BaseStatus, type BuildKind } from '../sim/buildRules';
import { clockLabel } from '../sim/localSky';
import { t, tf, type StringKey } from './i18n';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export const KIND_ICON: Record<BuildKind, string> = { habitat: '🏠', solar: '🔆', battery: '🔋', oxygen: 'O₂', greenhouse: '🌱' };

export interface BuildPanelView {
  kind: BuildKind;
  status: BaseStatus;
  /** Putting the module down at the cursor: why not, or the base after. */
  preview: { blocked: string | null; status: BaseStatus | null } | null;
  /** The level kept in the passport. */
  best: 1 | 2 | 3;
  canUndo: boolean;
  canRedo: boolean;
  /** Sunlight the dust lets through today, 0–1. */
  dust: number;
  /** Show the first-time touch hint. */
  touchHint: boolean;
}

/** "20:00–05:00" ranges from the hours the power runs out. */
export function hourRanges(hours: readonly number[]): string[] {
  if (!hours.length) return [];
  const set = new Set(hours);
  const starts = hours.filter((h) => !set.has((h + 23) % 24));
  if (!starts.length) return ['00:00–24:00'];
  return starts.map((s) => {
    let e = s;
    while (set.has((e + 1) % 24) && (e + 1) % 24 !== s) e = (e + 1) % 24;
    return `${clockLabel(s)}–${clockLabel((e + 1) % 24)}`;
  });
}

const powerLine = (s: BaseStatus, lang: Lang) => (s.powered ? t('poweredAllSol', lang) : tf('powerShort', lang, { hours: hourRanges(s.shortHours).join(', ') }));
const oxygenLine = (s: BaseStatus, lang: Lang) => (s.oxygen >= 0 ? tf('oxygenOk', lang, { n: String(s.oxygen) }) : tf('oxygenShort', lang, { n: String(s.oxygen) }));

/** Build mode's panel: the palette, the base's balance over a sol, the preview, and the tools. All its buttons go out as Intents. */
export class BuildPanel {
  private readonly root = $('#build-panel');
  private last = '';

  constructor(private readonly emit: (intent: Intent) => void) {}

  render(v: BuildPanelView | null, lang: Lang) {
    this.root.hidden = v === null;
    if (!v) return;
    // Preview power arrays vary below display precision as time advances. Only
    // rendered preview facts should replace controls and their native focus.
    const after = v.preview?.status;
    const previewKey = v.preview?.blocked ?? (after && [after.powered, after.shortHours, after.oxygen, after.level, after.idleGreenhouses]);
    const key = JSON.stringify([v.kind, v.status.net.map((n) => n.toFixed(1)), v.status.charge.map((c) => Math.round(c)), v.status.oxygen, v.status.level, previewKey, v.best, v.canUndo, v.canRedo, Math.round(v.dust * 100), v.touchHint, lang]);
    if (key === this.last) return;
    this.last = key;

    const button = (text: string, intent: Intent, opts: { pressed?: boolean; disabled?: boolean; label?: string; cls?: string } = {}) => {
      const b = el('button', text, `chip ${opts.cls ?? ''}`) as HTMLButtonElement;
      b.type = 'button';
      if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
      if (opts.label) b.setAttribute('aria-label', opts.label);
      b.disabled = opts.disabled ?? false;
      b.addEventListener('click', () => {
        this.emit(intent);
        b.blur();
      });
      return b;
    };

    const palette = el('div', '', 'palette');
    for (const k of BUILD_KINDS) palette.append(button(`${KIND_ICON[k]} ${t(`build.${k}` as StringKey, lang)}`, { type: 'buildPick', kind: k }, { pressed: k === v.kind }));

    const s = v.status;
    const facts = document.createElement('dl');
    facts.append(
      el('dt', t('power', lang)), el('dd', powerLine(s, lang), s.powered ? 'ok' : 'warn'),
      el('dt', 'O₂'), el('dd', oxygenLine(s, lang), s.oxygen >= 0 ? 'ok' : 'warn'),
    );
    if (s.idleGreenhouses) facts.append(el('dt', ''), el('dd', t('greenhouseIdle', lang), 'warn'));
    facts.append(el('dt', t('levelLabel', lang)), el('dd', tf('levelNow', lang, { now: String(s.level), best: String(v.best) })));
    facts.append(el('dt', '☀️'), el('dd', tf('sunlightToday', lang, { pct: String(Math.round(v.dust * 100)) }) + (v.dust < 1 ? t('dustSeason', lang) : '')));

    // The batteries over the sol: one bar per hour, red when the power runs out.
    const chart = el('div', '', 'chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `${t('chartLabel', lang)}: ${powerLine(s, lang)}`);
    s.charge.forEach((c, h) => {
      const bar = el('span', '', s.shortHours.includes(h) ? 'short' : '');
      bar.style.height = `${s.capacity ? Math.max(4, (c / s.capacity) * 100) : s.net[h] > 0 ? 50 : 4}%`;
      chart.append(bar);
    });

    const preview = el('p', '', 'preview');
    if (v.preview?.blocked) {
      preview.textContent = tf('cantBuild', lang, { why: t(`blocked.${v.preview.blocked}` as StringKey, lang) });
      preview.className = 'preview warn';
    } else if (v.preview?.status) {
      const after = v.preview.status;
      const idle = after.idleGreenhouses > s.idleGreenhouses ? ` · ${t('greenhouseIdle', lang)}` : '';
      preview.textContent = `${t('withThis', lang)}: ${powerLine(after, lang)} · ${oxygenLine(after, lang)}${after.level > s.level ? ` · 🏅 ${tf('baseLevel', lang, { n: String(after.level) })}` : ''}${idle}`;
      preview.className = `preview ${after.powered && after.oxygen >= 0 && !idle ? 'ok' : 'warn'}`;
    } else {
      preview.textContent = t(`buildInfo.${v.kind}` as StringKey, lang);
    }

    const tools = el('div', '', 'tools');
    tools.append(
      button('⟲', { type: 'buildTurn', dir: 1 }, { label: t('turn', lang) }),
      button('🗑', { type: 'buildDelete' }, { label: t('remove', lang) }),
      button('↶', { type: 'buildUndo' }, { label: t('undo', lang), disabled: !v.canUndo }),
      button('↷', { type: 'buildRedo' }, { label: t('redo', lang), disabled: !v.canRedo }),
      button(t('reset', lang), { type: 'buildReset' }),
      button(`✓ ${t('done', lang)}`, { type: 'toggleBuild' }, { cls: 'done' }),
    );
    // Not engineering values: say so, with the why one tap / hover away.
    const model = document.createElement('details');
    model.className = 'model';
    model.append(el('summary', `ⓘ ${t('modelNote', lang)}`), el('p', t('modelNoteDetail', lang)));
    model.title = t('modelNoteDetail', lang);
    const parts: Node[] = [el('h2', `🛠 ${t('buildTitle', lang)}`)];
    if (v.touchHint) {
      const tip = el('div', '', 'touch-hint');
      tip.setAttribute('role', 'note');
      const close = button('×', { type: 'dismissBuildHint' }, { label: t('close', lang) });
      tip.append(el('span', `👆 ${t('buildTouchHint', lang)}`), close);
      parts.push(tip);
    }
    parts.push(palette, preview, facts, chart, tools, model, el('p', t('buildHint', lang), 'hint'));
    this.root.replaceChildren(...parts);
  }
}

function el(tag: string, text: string, cls?: string) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
