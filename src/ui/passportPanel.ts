import { BASES } from '../data/bases';
import { BODIES, type Lang } from '../data/bodies';
import type { Intent } from '../intents';
import type { Passport } from '../sim/passport';
import { t, tf } from './i18n';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** The passport (J): a stamp for every base you've visited, with the date. Everything it does goes out as Intents. */
export class PassportPanel {
  private readonly root = $('#passport-panel');
  private readonly button = $<HTMLButtonElement>('#passport');
  private last = '';

  constructor(emit: (intent: Intent) => void) {
    this.button.addEventListener('click', () => emit({ type: 'togglePassport' }));
    $('#passport-panel .close').addEventListener('click', () => emit({ type: 'togglePassport', open: false }));
  }

  render(open: boolean, passport: Passport, lang: Lang, levels: Record<string, number> = {}) {
    const count = Object.keys(passport).length;
    const key = JSON.stringify([open, passport, lang, levels]);
    if (key === this.last) return;
    this.last = key;
    this.button.textContent = `🛂 ${t('passport', lang)} ${count}/${BASES.length}`;
    this.button.setAttribute('aria-expanded', String(open));
    this.root.hidden = !open;
    if (!open) return;
    $('#passport-title').textContent = `🛂 ${t('passport', lang)}`;
    const date = new Intl.DateTimeFormat(lang === 'my' ? 'my-MM' : lang, { dateStyle: 'medium' });
    $('#passport-panel .stamps').replaceChildren(...BASES.map((b) => {
      const li = document.createElement('li');
      const ms = passport[b.id];
      li.className = ms === undefined ? 'stamp empty' : 'stamp';
      const name = document.createElement('strong');
      name.textContent = b.name[lang];
      const body = document.createElement('span');
      body.textContent = BODIES.find((x) => x.id === b.body)!.name[lang];
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = ms === undefined ? t('notYet', lang) : `✅ ${date.format(ms)}${levels[b.id] ? ` · 🏅 ${tf('baseLevel', lang, { n: String(levels[b.id]) })}` : ''}`;
      li.append(name, body, when);
      return li;
    }));
    $('#passport-panel .hint').textContent = tf('passportCount', lang, { n: String(count), total: String(BASES.length) });
  }
}
