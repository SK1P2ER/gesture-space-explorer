import type { Lang } from '../data/bodies';
import { t, type StringKey } from './i18n';

export interface Credit {
  /** What it's for (translated). */
  what: StringKey;
  /** Who made it: names stay as they are, linked where there's a page. */
  who: { name: string; href?: string }[];
  /** The license: a translated word, or a license name with its link. */
  license: StringKey | { name: string; href: string };
  /** A note after the license (translated), e.g. "resized and converted". */
  note?: StringKey;
}

/** Everything the app uses that someone else made. README "Credits & license" says the same. */
export const CREDITS: Credit[] = [
  { what: 'credits.hand', who: [{ name: 'MediaPipe', href: 'https://github.com/google-ai-edge/mediapipe' }], license: { name: 'Apache 2.0', href: 'https://www.apache.org/licenses/LICENSE-2.0' } },
  { what: 'credits.graphics', who: [{ name: 'Three.js', href: 'https://threejs.org/' }], license: { name: 'MIT', href: 'https://github.com/mrdoob/three.js/blob/dev/LICENSE' } },
  {
    what: 'credits.planetTextures',
    who: [{ name: 'Solar System Scope', href: 'https://www.solarsystemscope.com/textures/' }],
    license: { name: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' },
    note: 'credits.resized',
  },
  {
    what: 'credits.moonTextures',
    who: [{ name: 'U.S. Geological Survey', href: 'https://astrogeology.usgs.gov' }, { name: 'NASA/JPL' }, { name: 'NASA/JHUAPL/SwRI' }],
    license: 'credits.publicDomain',
    note: 'credits.resized',
  },
  {
    what: 'credits.sky',
    who: [{ name: 'NASA/Goddard Space Flight Center Scientific Visualization Studio', href: 'https://svs.gsfc.nasa.gov/4851' }, { name: 'ESA/Gaia/DPAC' }],
    license: 'credits.publicDomain',
  },
  {
    what: 'credits.positions',
    who: [
      { name: 'JPL', href: 'https://ssd.jpl.nasa.gov/' },
      { name: 'IAU WGCCRE 2015' },
      { name: 'J. Meeus, Astronomical Algorithms' },
    ],
    license: 'credits.data',
  },
  { what: 'credits.facts', who: [{ name: 'NASA', href: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/' }], license: 'credits.data' },
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function link(text: string, href?: string) {
  if (!href) return document.createTextNode(text);
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

/** The Credits dialog, in the current language (re-rendered if the language changes while it's open). */
export class CreditsDialog {
  private readonly dialog = $<HTMLDialogElement>('#credits');
  private lang: Lang | null = null;

  open(lang: Lang) {
    this.render(lang);
    this.dialog.showModal();
  }

  /** Every frame: follows a language change (L) while it's open. */
  update(lang: Lang) {
    if (this.dialog.open && lang !== this.lang) this.render(lang);
  }

  private render(lang: Lang) {
    this.lang = lang;
    $('#credits h2').textContent = t('credits', lang);
    $('#credits .privacy').textContent = t('credits.privacy', lang);
    $('#credits form button').textContent = t('close', lang);
    $('#credits ul').replaceChildren(
      ...CREDITS.map((c) => {
        const ja = lang === 'ja'; // full-width punctuation in Japanese
        const li = document.createElement('li');
        li.append(`${t(c.what, lang)}${ja ? '：' : ': '}`);
        c.who.forEach((w, i) => li.append(...(i ? [', '] : []), link(w.name, w.href)));
        li.append(' — ', typeof c.license === 'string' ? t(c.license, lang) : link(c.license.name, c.license.href));
        if (c.note) li.append(ja ? `（${t(c.note, lang)}）` : ` (${t(c.note, lang)})`);
        return li;
      }),
    );
  }
}
