import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/data/bodies';
import { CREDITS } from '../src/ui/credits';
import { t } from '../src/ui/i18n';

const names = CREDITS.flatMap((c) => c.who.map((w) => w.name));

describe('the Credits dialog', () => {
  it('credits everything the licenses ask for', () => {
    // CC BY 4.0 requires the credit and a link to the license.
    const sss = CREDITS.find((c) => c.who.some((w) => w.name === 'Solar System Scope'))!;
    expect(sss.license).toEqual({ name: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' });
    // Gaia data: "ESA/Gaia/DPAC"; USGS and NASA ask to be credited even for public-domain work.
    for (const who of ['ESA/Gaia/DPAC', 'U.S. Geological Survey', 'NASA/Goddard Space Flight Center Scientific Visualization Studio', 'MediaPipe', 'Three.js']) {
      expect(names, who).toContain(who);
    }
  });

  it('is in English, Burmese and Japanese', () => {
    for (const c of CREDITS) {
      for (const key of [c.what, ...(typeof c.license === 'string' ? [c.license] : []), ...(c.note ? [c.note] : [])]) {
        for (const lang of LANGS) expect(t(key, lang).trim(), `${key}.${lang}`).not.toBe('');
      }
    }
    for (const lang of LANGS) expect(t('credits.privacy', lang)).not.toBe('');
  });
});
