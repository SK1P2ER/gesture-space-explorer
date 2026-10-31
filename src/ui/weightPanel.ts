import { BODIES, type Lang } from '../data/bodies';
import { gravityRatio, parseWeight, weightOn } from '../data/weight';
import type { Intent } from '../intents';
import { numberFormat, t } from './i18n';

/** "26.4 kg"; whole kilograms from 100 up ("1,957 kg"); grams under 1 kg (on a comet: "3.6 g"). */
export function kgLabel(kg: number, lang: Lang): string {
  if (kg < 1) return `${numberFormat(lang, { maximumFractionDigits: 1 }).format(kg * 1000)} g`;
  return `${numberFormat(lang, { maximumFractionDigits: kg < 100 ? 1 : 0 }).format(kg)} kg`;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

interface Row {
  li: HTMLElement;
  name: HTMLElement;
  value: HTMLElement;
  ratio: HTMLElement;
}

/** "Your weight on other worlds": type your weight, see it on every body. Everything it does goes out as Intents. */
export class WeightPanel {
  private root = $('#weight-panel');
  private title = $('#weight-title');
  private close = $<HTMLButtonElement>('#weight-panel .close');
  private label = $('#weight-panel .field .label');
  private input = $<HTMLInputElement>('#weight-panel input');
  private error = $('#weight-error');
  private hint = $('#weight-panel .hint');
  private button = $<HTMLButtonElement>('#weight');
  private rows = new Map<string, Row>();
  private open = false;
  private last = '';

  constructor(emit: (intent: Intent) => void) {
    const list = $('#weight-panel .worlds');
    for (const b of BODIES) {
      const li = document.createElement('li');
      const [name, value, ratio] = ['name', 'value', 'ratio'].map((cls) => {
        const span = document.createElement('span');
        span.className = cls;
        return span;
      });
      li.append(name, value, ratio);
      if (b.kind === 'moon') li.classList.add('moon'); // listed under its planet
      list.append(li);
      this.rows.set(b.id, { li, name, value, ratio });
    }

    this.input.addEventListener('input', () => {
      const text = this.input.value;
      const kg = parseWeight(text);
      const invalid = text.trim() !== '' && kg === null;
      this.input.setAttribute('aria-invalid', String(invalid));
      this.error.hidden = !invalid;
      if (!invalid) emit({ type: 'setWeight', kg });
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        emit({ type: 'toggleWeightPanel', open: false });
      }
    });
    this.close.addEventListener('click', () => emit({ type: 'toggleWeightPanel', open: false }));
  }

  render(open: boolean, kg: number | null, currentId: string, lang: Lang) {
    if (open !== this.open) {
      this.open = open;
      this.root.hidden = !open;
      this.button.setAttribute('aria-expanded', String(open));
      if (open) {
        // Start from what's saved, ready to type over.
        this.input.value = kg === null ? '' : String(kg);
        this.input.removeAttribute('aria-invalid');
        this.error.hidden = true;
        this.input.focus();
        this.input.select();
      } else if (this.root.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur(); // keys go back to the scene
      }
    }

    const key = `${open}|${kg}|${currentId}|${lang}`;
    if (key === this.last) return;
    this.last = key;

    this.button.textContent = `⚖️ ${t('weightButton', lang)}`;
    if (!open) return;
    this.title.textContent = `⚖️ ${t('weightTitle', lang)}`;
    this.close.setAttribute('aria-label', t('close', lang));
    this.label.textContent = t('weightInput', lang);
    this.error.textContent = t('weightInvalid', lang);
    this.hint.textContent = t('weightHint', lang);
    const ratio = numberFormat(lang, { maximumFractionDigits: 2 });
    for (const b of BODIES) {
      const row = this.rows.get(b.id)!;
      row.li.classList.toggle('current', b.id === currentId);
      row.name.textContent = b.name[lang];
      row.value.textContent = kg === null ? '—' : kgLabel(weightOn(kg, b.gravity), lang);
      row.ratio.textContent = `×${ratio.format(gravityRatio(b.gravity))}`;
    }
  }
}
