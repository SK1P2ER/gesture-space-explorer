import { BASES } from '../data/bases';
import { BODIES, type Lang } from '../data/bodies';
import type { Intent } from '../intents';
import type { Passport } from '../sim/passport';
import { t, tf } from './i18n';
import { dateLabel } from './timeFormat';

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
    // Earned stamps first, newest first (the one just earned leads, marked Latest); then the bases still to visit, in
    // their usual order. Each stamp reads "Base · World" on one line, so "Jezero Dome · Mars" is found at a glance.
    const earned = BASES.filter((b) => passport[b.id] !== undefined).sort((a, b) => passport[b.id]! - passport[a.id]!);
    const latest = earned[0]?.id ?? null;
    const ordered = [...earned, ...BASES.filter((b) => passport[b.id] === undefined)];
    $('#passport-panel .stamps').replaceChildren(...ordered.map((b) => {
      const li = document.createElement('li');
      const ms = passport[b.id];
      li.className = ms === undefined ? 'stamp empty' : 'stamp';
      li.dataset.base = b.id;
      const name = document.createElement('strong');
      name.className = 'stamp-name';
      const world = document.createElement('span');
      world.className = 'stamp-world';
      world.textContent = ` · ${BODIES.find((x) => x.id === b.body)!.name[lang]}`;
      name.append(b.name[lang], world);
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = ms === undefined ? t('notYet', lang) : `✅ ${dateLabel(ms, Infinity, lang)}${levels[b.id] ? ` · 🏅 ${tf('baseLevel', lang, { n: String(levels[b.id]) })}` : ''}`;
      li.append(name, when);
      if (b.id === latest) {
        li.classList.add('latest');
        const badge = document.createElement('span');
        badge.className = 'stamp-latest';
        badge.textContent = t('latestStamp', lang);
        li.prepend(badge);
      }
      return li;
    }));
    $('#passport-panel .hint').textContent = tf('passportCount', lang, { n: String(count), total: String(BASES.length) });
  }
}
