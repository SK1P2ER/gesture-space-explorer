import type { Lang, MoonOrbit } from './bodies';

// Moons seen only in a base's sky (v2.1), not bodies you can visit or select:
// Mars' Phobos and Deimos. Circles in Mars' equatorial plane like the other
// moons' 'equator' model (ephemeris.ts), with L0 and n fitted to JPL Horizons
// (hourly vectors in January 2020 and January 2035). Checked against held-out
// Horizons positions 2024–2032: within 3.2° (Phobos, whose orbit is slightly
// eccentric and tilted) and 1.9° (Deimos). Good for 2020–2035; Phobos drifts
// further outside that (tidal decay isn't modelled).

export interface SkyMoon {
  id: string;
  /** The planet whose sky it's in. */
  parent: string;
  orbit: MoonOrbit;
  radiusKm: number;
  name: Record<Lang, string>;
  /** Years the position is good for; outside them it's shown as approximate. */
  validYears?: [number, number];
}

export const SKY_MOONS: readonly SkyMoon[] = [
  {
    id: 'phobos',
    parent: 'mars',
    orbit: { aKm: 9376, model: 'equator', L0: 214.623, n: 1128.8449529 },
    radiusKm: 11.1,
    validYears: [2020, 2035],
    name: { en: 'Phobos', my: 'ဖိုဘော့စ်', ja: 'フォボス' },
  },
  {
    id: 'deimos',
    parent: 'mars',
    orbit: { aKm: 23463, model: 'equator', L0: 259.701, n: 285.1618125 },
    radiusKm: 6.2,
    name: { en: 'Deimos', my: 'ဒိုင်မို့စ်', ja: 'ダイモス' },
  },
];
