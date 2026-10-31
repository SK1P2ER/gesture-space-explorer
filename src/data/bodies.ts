// Scene sizes and orbits are derived from the real diameters and distances
// (see scale.ts for how they're compressed). The `facts` are real values.
import { ATMOSPHERE_SHELL, logInterpolate, moonRadius, SCALE, sceneMoonOrbits, sceneOrbits, sceneRadius } from './scale';

export type Lang = 'en' | 'my' | 'ja';

/** The order `L` cycles through. */
export const LANGS: Lang[] = ['en', 'my', 'ja'];

export type TextureTier = '1k' | '2k' | '4k';

/**
 * Image files in public/textures/<tier>/, built by scripts/build-textures.mjs
 * from Solar System Scope (CC BY 4.0). Maps that only exist up to 2K say so
 * in planets/surface.ts; `maxTier` caps the rest.
 */
export interface BodyTextures {
  map: string;
  normal?: string;
  bump?: string;
  /** City lights, shown on the night side only. */
  night?: string;
  /** Cloud cover (white = cloud), on its own slowly drifting layer. */
  clouds?: string;
  /** Glossy (dark) to matte (light), e.g. shiny oceans. */
  roughness?: string;
  /** Ring color + alpha, u = inner → outer edge. */
  ring?: string;
  /** Color to multiply a grayscale map by (the USGS mosaics of Europa, Callisto and Titan are gray). */
  tint?: number;
  maxTier: TextureTier;
}

// Sources for the orbit and rotation data below:
// - Orbits: E. M. Standish, "Keplerian Elements for Approximate Positions of the
//   Major Planets", JPL Solar System Dynamics, Table 1 (mean ecliptic and
//   equinox of J2000; valid 1800–2050, a slow extrapolation outside).
//   https://ssd.jpl.nasa.gov/planets/approx_pos.html — Earth is the Earth–Moon barycenter.
// - Poles and prime meridians: Archinal et al., "Report of the IAU Working Group
//   on Cartographic Coordinates and Rotational Elements: 2015", Celestial
//   Mechanics and Dynamical Astronomy 130 (2018). Constant terms only.
// - Pluto: JPL Table 1 as above; Halley's Comet: JPL Small-Body Database, orbit 75
//   (https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=1P), period tuned to the 2061 return.
//   Positions of both checked against JPL Horizons in the tests.
// - Moons: positions from mean longitudes fitted to JPL Horizons (1950–2100; see
//   ephemeris.ts), sizes and surface gravity (GM/R²) from JPL's Planetary Satellite
//   Physical Parameters, https://ssd.jpl.nasa.gov/sats/phys_par/ — the Moon's gravity
//   from the NASA Moon Fact Sheet.
// - Surface gravity: NASA Planetary Fact Sheet ("Surface Gravity", equatorial, at the
//   1-bar level for the gas giants), https://nssdc.gsfc.nasa.gov/planetary/factsheet/ —
//   the Sun from the NASA Sun Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html

/** Keplerian elements: [value at J2000, change per Julian century]. Angles in degrees. */
export interface OrbitElements {
  a: [number, number]; // semi-major axis, AU
  e: [number, number]; // eccentricity
  i: [number, number]; // inclination
  L: [number, number]; // mean longitude
  peri: [number, number]; // longitude of perihelion
  node: [number, number]; // longitude of the ascending node
}

export type BodyKind = 'star' | 'planet' | 'dwarf' | 'moon' | 'comet';

/** A moon's path around its planet (see ephemeris.ts: moonAngle, moonDirection). */
export interface MoonOrbit {
  /** Mean distance from the planet's center, km (only its order and ratios matter on screen). */
  aKm: number;
  /**
   * 'equator': a circle in the planet's equatorial plane, at mean longitude L0 + n·days,
   * measured from the node of that plane on Earth's equator (like the IAU spin angle).
   * 'lunar': Earth's Moon, from Meeus' series (ephemeris.ts).
   */
  model: 'equator' | 'lunar';
  /** Mean longitude at J2000, degrees (equator model). */
  L0?: number;
  /** Mean motion, degrees per day. */
  n: number;
  /** Equation of the center for an eccentric orbit: + amplitude·sin(L − ϖ), ϖ = peri0 + periRate·years. Degrees. */
  center?: { amplitude: number; peri0: number; periRate: number };
}

/**
 * A comet's orbit (JPL Small-Body Database, J2000 ecliptic): perihelion distance q (AU),
 * angles in degrees, perihelion time tp (Julian date, TDB). A plain two-body orbit can't
 * follow Halley's real one, which Jupiter and Saturn stretch differently each time round,
 * so the period (and q, between its 1986 and 2061 values) is tuned to pass both of those
 * perihelia. Other returns drift by months (1910's is ~4 months late).
 */
export interface CometElements {
  q: number;
  periodDays: number;
  i: number;
  node: number;
  peri: number;
  tp: number;
}

export interface Body {
  id: string;
  kind: BodyKind;
  /** Moons: the planet they orbit. */
  parent?: string;
  /** Moons: their orbit around the parent. */
  moon?: MoonOrbit;
  /** Comets: their orbit around the Sun. */
  comet?: CometElements;
  name: Record<Lang, string>;
  color: number;
  radius: number; // scene units, from facts.diameterKm
  orbitRadius: number; // scene units: from the Sun (from orbitAU), or for moons from the planet; 0 = the Sun
  orbitAU: number; // real mean distance from the Sun (moons: their planet's)
  /** Axial tilt relative to the orbit, for reference (the scene uses `pole`; a test checks they agree). */
  tiltDeg: number;
  atmosphere?: { color: number; strength: number }; // limb haze + halo
  /** Where the planet is on a given date (none for the Sun). */
  orbit?: OrbitElements;
  /** North pole direction, J2000 equatorial (right ascension, declination), degrees. */
  pole: { ra: number; dec: number };
  /** Prime meridian angle W = w0 + degPerDay × days since J2000 (negative = retrograde). */
  spin: { w0: number; degPerDay: number };
  /** Surface gravity, m/s² (at the cloud tops for the gas giants). */
  gravity: number;
  ring?: { inner: number; outer: number }; // × radius
  textures: BodyTextures;
  facts: {
    diameterKm: number;
    day: Record<Lang, string>;
    year: Record<Lang, string>;
    moons: string;
  };
  blurb: Record<Lang, string>;
}

type BodyData = Omit<Body, 'radius' | 'orbitRadius'>;

const DATA: BodyData[] = [
  {
    id: 'sun',
    kind: 'star',
    name: { my: 'နေ', en: 'Sun', ja: '太陽' },
    color: 0xffc845,
    textures: { map: 'sun.jpg', maxTier: '4k' },
    orbitAU: 0,
    pole: { ra: 286.13, dec: 63.87 },
    spin: { w0: 84.176, degPerDay: 14.1844 },
    tiltDeg: 7.25,
    gravity: 274.0,
    atmosphere: { color: 0xffb347, strength: 1.2 },
    facts: { diameterKm: 1_392_700, day: { my: '~၂၇ ရက်', en: '~27 days', ja: '約27日' }, year: { my: '—', en: '—', ja: '—' }, moons: '—' },
    blurb: {
      my: 'နေအဖွဲ့အစည်းရဲ့ ဒြပ်ထု ၉၉.၈% ကို နေတစ်ခုတည်းက ပိုင်ပါတယ်။',
      en: 'The Sun holds 99.8% of the Solar System’s mass.', ja: '太陽系の質量の99.8%を太陽が占めています。',
    },
  },
  {
    id: 'mercury',
    kind: 'planet',
    name: { my: 'ဗုဒ္ဓဟူး', en: 'Mercury', ja: '水星' },
    color: 0x9e9a94,
    textures: { map: 'mercury.jpg', maxTier: '4k' },
    orbitAU: 0.387,
    orbit: {
      a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], i: [7.00497902, -0.00594749],
      L: [252.2503235, 149472.67411175], peri: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081],
    },
    pole: { ra: 281.0103, dec: 61.4155 },
    spin: { w0: 329.5988, degPerDay: 6.1385108 },
    tiltDeg: 0.03,
    gravity: 3.7,
    facts: { diameterKm: 4_879, day: { my: '၅၉ ရက်', en: '59 days', ja: '59日' }, year: { my: '၈၈ ရက်', en: '88 days', ja: '88日' }, moons: '0' },
    blurb: { my: 'နေနဲ့ အနီးဆုံးနဲ့ အသေးဆုံး ဂြိုဟ်ပါ။', en: 'The smallest planet and the closest to the Sun.', ja: '最も小さく、太陽に最も近い惑星です。' },
  },
  {
    id: 'venus',
    kind: 'planet',
    name: { my: 'သောကြာ', en: 'Venus', ja: '金星' },
    color: 0xe3c07b,
    textures: { map: 'venus.jpg', maxTier: '4k' },
    orbitAU: 0.723,
    orbit: {
      a: [0.72333566, 0.0000039], e: [0.00677672, -0.00004107], i: [3.39467605, -0.0007889],
      L: [181.9790995, 58517.81538729], peri: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418],
    },
    pole: { ra: 272.76, dec: 67.16 },
    spin: { w0: 160.2, degPerDay: -1.4813688 },
    tiltDeg: 2.6,
    gravity: 8.9,
    atmosphere: { color: 0xffd060, strength: 0.9 },
    facts: { diameterKm: 12_104, day: { my: '၂၄၃ ရက်', en: '243 days', ja: '243日' }, year: { my: '၂၂၅ ရက်', en: '225 days', ja: '225日' }, moons: '0' },
    blurb: {
      my: 'အပူဆုံး ဂြိုဟ်ပါ။ ပြောင်းပြန်လည်ပြီး တစ်ရက်က တစ်နှစ်ထက် ရှည်ပါတယ်။',
      en: 'The hottest planet. It spins backwards, and its day is longer than its year.', ja: '最も熱い惑星です。逆向きに自転し、1日が1年より長いのが特徴です。',
    },
  },
  {
    id: 'earth',
    kind: 'planet',
    name: { my: 'ကမ္ဘာ', en: 'Earth', ja: '地球' },
    color: 0x3f7fd9,
    textures: {
      map: 'earth_day.jpg',
      normal: 'earth_normal.jpg',
      night: 'earth_night.jpg',
      clouds: 'earth_clouds.jpg',
      roughness: 'earth_roughness.jpg',
      maxTier: '4k',
    },
    orbitAU: 1.0,
    orbit: {
      a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], i: [-0.00001531, -0.01294668],
      L: [100.46457166, 35999.37244981], peri: [102.93768193, 0.32327364], node: [0, 0],
    },
    pole: { ra: 0, dec: 90 },
    spin: { w0: 190.147, degPerDay: 360.9856235 },
    tiltDeg: 23.4,
    gravity: 9.8,
    atmosphere: { color: 0x4f9dff, strength: 1.1 },
    facts: { diameterKm: 12_742, day: { my: '၂၃.၉ နာရီ', en: '23.9 hours', ja: '23.9時間' }, year: { my: '၃၆၅ ရက်', en: '365 days', ja: '365日' }, moons: '1' },
    blurb: { my: 'အသက်ရှိကြောင်း သိရတဲ့ တစ်ခုတည်းသော ဂြိုဟ်ပါ။', en: 'The only planet known to host life.', ja: '生命の存在が確認されている唯一の惑星です。' },
  },
  {
    id: 'moon',
    kind: 'moon',
    parent: 'earth',
    name: { en: 'Moon', my: 'လ', ja: '月' },
    color: 0x9a9a9a,
    textures: { map: 'moon.jpg', maxTier: '4k' },
    orbitAU: 1.0,
    moon: { aKm: 384_400, model: 'lunar', n: 13.176358 },
    pole: { ra: 269.9949, dec: 66.5392 },
    spin: { w0: 38.3213, degPerDay: 13.17635815 },
    tiltDeg: 6.7,
    gravity: 1.62,
    facts: { diameterKm: 3_475, day: { en: '27.3 days', my: '၂၇.၃ ရက်', ja: '27.3日' }, year: { en: '27.3 days', my: '၂၇.၃ ရက်', ja: '27.3日' }, moons: '—' },
    blurb: {
      en: 'The only other world people have walked on. It always shows Earth the same face.',
      my: 'လူသားတွေ လမ်းလျှောက်ဖူးတဲ့ တစ်ခုတည်းသော တခြားကမ္ဘာပါ။ ကမ္ဘာကို မျက်နှာတစ်ဖက်တည်းကိုပဲ အမြဲ ပြပါတယ်။',
      ja: '人類が歩いたことのある唯一の地球外の天体です。いつも同じ面を地球に向けています。',
    },
  },
  {
    id: 'mars',
    kind: 'planet',
    name: { my: 'အင်္ဂါ', en: 'Mars', ja: '火星' },
    color: 0xc1440e,
    textures: { map: 'mars.jpg', bump: 'mars_bump.jpg', maxTier: '4k' },
    orbitAU: 1.524,
    orbit: {
      a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], i: [1.84969142, -0.00813131],
      L: [-4.55343205, 19140.30268499], peri: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343],
    },
    pole: { ra: 317.269202, dec: 54.432516 },
    spin: { w0: 176.049863, degPerDay: 350.891982443297 },
    tiltDeg: 25.2,
    gravity: 3.7,
    atmosphere: { color: 0xff7a3a, strength: 0.6 },
    facts: { diameterKm: 6_779, day: { my: '၂၄.၆ နာရီ', en: '24.6 hours', ja: '24.6時間' }, year: { my: '၆၈၇ ရက်', en: '687 days', ja: '687日' }, moons: '2' },
    blurb: {
      my: 'နေအဖွဲ့အစည်းရဲ့ အမြင့်ဆုံးတောင် Olympus Mons ရှိပါတယ်။',
      en: 'Home to Olympus Mons, the tallest volcano in the Solar System.', ja: '太陽系で最も高い火山、オリンポス山があります。',
    },
  },
  {
    id: 'jupiter',
    kind: 'planet',
    name: { my: 'ကြာသပတေး', en: 'Jupiter', ja: '木星' },
    color: 0xd8a878,
    textures: { map: 'jupiter.jpg', maxTier: '4k' },
    orbitAU: 5.203,
    orbit: {
      a: [5.202887, -0.00011607], e: [0.04838624, -0.00013253], i: [1.30439695, -0.00183714],
      L: [34.39644051, 3034.74612775], peri: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106],
    },
    pole: { ra: 268.056595, dec: 64.495303 },
    spin: { w0: 284.95, degPerDay: 870.536 },
    tiltDeg: 3.1,
    gravity: 23.1,
    atmosphere: { color: 0xf3d9b0, strength: 0.5 },
    facts: { diameterKm: 139_820, day: { my: '၉.၉ နာရီ', en: '9.9 hours', ja: '9.9時間' }, year: { my: '၁၁.၉ နှစ်', en: '11.9 years', ja: '11.9年' }, moons: '95+' },
    blurb: { my: 'အကြီးဆုံး ဂြိုဟ်ပါ။ Great Red Spot မုန်တိုင်းက ကမ္ဘာထက် ကြီးပါတယ်။', en: 'The largest planet. Its Great Red Spot is a storm bigger than Earth.', ja: '最も大きな惑星です。大赤斑は地球より大きな嵐です。' },
  },
  {
    id: 'io',
    kind: 'moon',
    parent: 'jupiter',
    name: { en: 'Io', my: 'အိုင်အို', ja: 'イオ' },
    color: 0xd8c060,
    textures: { map: 'io.jpg', maxTier: '4k' },
    orbitAU: 5.203,
    moon: { aKm: 421_800, model: 'equator', L0: 19.98, n: 203.4889554 },
    pole: { ra: 268.05, dec: 64.5 },
    spin: { w0: 200.39, degPerDay: 203.4889538 },
    tiltDeg: 0,
    gravity: 1.796,
    facts: { diameterKm: 3_643, day: { en: '1.8 days', my: '၁.၈ ရက်', ja: '1.8日' }, year: { en: '1.8 days', my: '၁.၈ ရက်', ja: '1.8日' }, moons: '—' },
    blurb: {
      en: 'The most volcanic world in the Solar System, kneaded by Jupiter’s gravity.',
      my: 'ကြာသပတေးရဲ့ ဆွဲအားကြောင့် နေအဖွဲ့အစည်းမှာ မီးတောင် အများဆုံး ကမ္ဘာပါ။',
      ja: '木星の重力にもまれる、太陽系で最も火山活動が活発な天体です。',
    },
  },
  {
    id: 'europa',
    kind: 'moon',
    parent: 'jupiter',
    name: { en: 'Europa', my: 'ယူရိုပါ', ja: 'エウロパ' },
    color: 0xd9cbb0,
    textures: { map: 'europa.jpg', tint: 0xf2e4c8, maxTier: '4k' },
    orbitAU: 5.203,
    moon: { aKm: 671_100, model: 'equator', L0: 214.51, n: 101.3747246 },
    pole: { ra: 268.08, dec: 64.51 },
    spin: { w0: 36.022, degPerDay: 101.3747235 },
    tiltDeg: 0.1,
    gravity: 1.315,
    facts: { diameterKm: 3_122, day: { en: '3.6 days', my: '၃.၆ ရက်', ja: '3.6日' }, year: { en: '3.6 days', my: '၃.၆ ရက်', ja: '3.6日' }, moons: '—' },
    blurb: {
      en: 'Under its ice lies a salty ocean holding more water than all of Earth’s oceans.',
      my: 'ရေခဲအောက်မှာ ကမ္ဘာ့ သမုဒ္ဒရာအားလုံးထက် ရေပိုများတဲ့ ဆားငန်ရေ သမုဒ္ဒရာ ရှိပါတယ်။',
      ja: '氷の下には、地球の海すべてより多くの水をたたえた塩水の海があります。',
    },
  },
  {
    id: 'ganymede',
    kind: 'moon',
    parent: 'jupiter',
    name: { en: 'Ganymede', my: 'ဂန်နီမိဒ်', ja: 'ガニメデ' },
    color: 0x9a8f80,
    textures: { map: 'ganymede.jpg', maxTier: '4k' },
    orbitAU: 5.203,
    moon: { aKm: 1_070_400, model: 'equator', L0: 221.77, n: 50.3176092 },
    pole: { ra: 268.2, dec: 64.57 },
    spin: { w0: 44.064, degPerDay: 50.3176081 },
    tiltDeg: 0.2,
    gravity: 1.428,
    facts: { diameterKm: 5_268, day: { en: '7.2 days', my: '၇.၂ ရက်', ja: '7.2日' }, year: { en: '7.2 days', my: '၇.၂ ရက်', ja: '7.2日' }, moons: '—' },
    blurb: {
      en: 'The largest moon in the Solar System: bigger than Mercury, with its own magnetic field.',
      my: 'နေအဖွဲ့အစည်းမှာ အကြီးဆုံး လပါ။ ဗုဒ္ဓဟူးထက် ကြီးပြီး ကိုယ်ပိုင် သံလိုက်စက်ကွင်း ရှိပါတယ်။',
      ja: '太陽系最大の衛星です。水星より大きく、自前の磁場を持っています。',
    },
  },
  {
    id: 'callisto',
    kind: 'moon',
    parent: 'jupiter',
    name: { en: 'Callisto', my: 'ကယ်လစ်စတို', ja: 'カリスト' },
    color: 0x6f655a,
    textures: { map: 'callisto.jpg', tint: 0xd2c2aa, maxTier: '4k' },
    orbitAU: 5.203,
    moon: { aKm: 1_882_700, model: 'equator', L0: 80.99, n: 21.571071 },
    pole: { ra: 268.72, dec: 64.83 },
    spin: { w0: 259.51, degPerDay: 21.5710715 },
    tiltDeg: 0.3,
    gravity: 1.236,
    facts: { diameterKm: 4_821, day: { en: '16.7 days', my: '၁၆.၇ ရက်', ja: '16.7日' }, year: { en: '16.7 days', my: '၁၆.၇ ရက်', ja: '16.7日' }, moons: '—' },
    blurb: {
      en: 'One of the most cratered surfaces known, barely changed in 4 billion years.',
      my: 'သိထားသမျှထဲမှာ ချိုင့်ခွက် အများဆုံး မျက်နှာပြင်တွေထဲက တစ်ခုပါ။ နှစ်ပေါင်း သန်း ၄,၀၀၀ လောက် မပြောင်းလဲသေးပါ။',
      ja: '知られている中で最もクレーターの多い表面の一つで、40億年ほとんど変わっていません。',
    },
  },
  {
    id: 'saturn',
    kind: 'planet',
    name: { my: 'စနေ', en: 'Saturn', ja: '土星' },
    color: 0xe8d29a,
    textures: { map: 'saturn.jpg', ring: 'saturn_ring.png', maxTier: '4k' },
    orbitAU: 9.537,
    orbit: {
      a: [9.53667594, -0.0012506], e: [0.05386179, -0.00050991], i: [2.48599187, 0.00193609],
      L: [49.95424423, 1222.49362201], peri: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794],
    },
    pole: { ra: 40.589, dec: 83.537 },
    spin: { w0: 38.9, degPerDay: 810.7939024 },
    tiltDeg: 26.7,
    gravity: 9.0,
    atmosphere: { color: 0xf0e0b0, strength: 0.45 },
    ring: { inner: 1.18, outer: 2.33 }, // C ring inner edge → A ring outer edge, matching the texture
    facts: { diameterKm: 116_460, day: { my: '၁၀.၇ နာရီ', en: '10.7 hours', ja: '10.7時間' }, year: { my: '၂၉.၄ နှစ်', en: '29.4 years', ja: '29.4年' }, moons: '274' },
    blurb: { my: 'ရေထဲထည့်ရင် ပေါ်နေမယ့်လောက် သိပ်သည်းဆ နည်းပါတယ်။', en: 'Less dense than water — it would float.', ja: '水よりも密度が小さく、水に浮くほどです。' },
  },
  {
    id: 'titan',
    kind: 'moon',
    parent: 'saturn',
    name: { en: 'Titan', my: 'တိုက်တန်', ja: 'タイタン' },
    color: 0xd99a40,
    textures: { map: 'titan.jpg', tint: 0xf0b060, maxTier: '2k' },
    orbitAU: 9.537,
    moon: { aKm: 1_221_900, model: 'equator', L0: 7.57, n: 22.576975, center: { amplitude: 3.3, peri0: 204, periRate: 0.52 } },
    pole: { ra: 39.4827, dec: 83.4279 },
    spin: { w0: 186.5855, degPerDay: 22.5769768 },
    tiltDeg: 0.3,
    gravity: 1.354,
    atmosphere: { color: 0xf0a040, strength: 1.4 },
    facts: { diameterKm: 5_150, day: { en: '15.9 days', my: '၁၅.၉ ရက်', ja: '15.9日' }, year: { en: '15.9 days', my: '၁၅.၉ ရက်', ja: '15.9日' }, moons: '—' },
    blurb: {
      en: 'The only moon with a thick atmosphere, and lakes of liquid methane under its orange haze.',
      my: 'လေထုထူတဲ့ တစ်ခုတည်းသော လဖြစ်ပြီး လိမ္မော်ရောင် မြူအောက်မှာ အရည် မီသိန်း ရေကန်တွေ ရှိပါတယ်။',
      ja: '厚い大気を持つ唯一の衛星で、オレンジ色のもやの下には液体メタンの湖があります。',
    },
  },
  {
    id: 'uranus',
    kind: 'planet',
    name: { my: 'ယူရေးနပ်စ်', en: 'Uranus', ja: '天王星' },
    color: 0x9fd8e0,
    textures: { map: 'uranus.jpg', maxTier: '2k' },
    orbitAU: 19.19,
    orbit: {
      a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], i: [0.77263783, -0.00242939],
      L: [313.23810451, 428.48202785], peri: [170.9542763, 0.40805281], node: [74.01692503, 0.04240589],
    },
    pole: { ra: 257.311, dec: -15.175 },
    spin: { w0: 203.81, degPerDay: -501.1600928 },
    tiltDeg: 97.8,
    gravity: 8.7,
    atmosphere: { color: 0x9ff0ff, strength: 0.8 },
    facts: { diameterKm: 50_724, day: { my: '၁၇.၂ နာရီ', en: '17.2 hours', ja: '17.2時間' }, year: { my: '၈၄ နှစ်', en: '84 years', ja: '84年' }, moons: '28+' },
    blurb: { my: 'ဘေးစောင်းပြီး လှိမ့်လည်နေတဲ့ ဂြိုဟ်ပါ (၉၈°)။', en: 'It rolls around the Sun on its side (98° tilt).', ja: '横倒しのまま太陽の周りを回っています（自転軸の傾きは98°）。' },
  },
  {
    id: 'neptune',
    kind: 'planet',
    name: { my: 'နက်ပကျွန်း', en: 'Neptune', ja: '海王星' },
    color: 0x3d5fd6,
    textures: { map: 'neptune.jpg', maxTier: '2k' },
    orbitAU: 30.07,
    orbit: {
      a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], i: [1.77004347, 0.00035372],
      L: [-55.12002969, 218.45945325], peri: [44.96476227, -0.32241464], node: [131.78422574, -0.00508664],
    },
    pole: { ra: 299.36, dec: 43.46 },
    spin: { w0: 249.978, degPerDay: 541.1397757 },
    tiltDeg: 28.3,
    gravity: 11.0,
    atmosphere: { color: 0x6f8fff, strength: 0.9 },
    facts: { diameterKm: 49_244, day: { my: '၁၆.၁ နာရီ', en: '16.1 hours', ja: '16.1時間' }, year: { my: '၁၆၅ နှစ်', en: '165 years', ja: '165年' }, moons: '16' },
    blurb: { my: 'လေတိုက်နှုန်း အမြန်ဆုံး ဂြိုဟ်ပါ (၂,၀၀၀ km/h ကျော်)။', en: 'The windiest planet, with winds over 2,000 km/h.', ja: '風が最も強い惑星で、風速は時速2,000kmを超えます。' },
  },
  {
    id: 'pluto',
    kind: 'dwarf',
    name: { en: 'Pluto', my: 'ပလူတို', ja: '冥王星' },
    color: 0xc8b49a,
    textures: { map: 'pluto.jpg', tint: 0xecd8c0, maxTier: '4k' },
    orbitAU: 39.48,
    orbit: {
      a: [39.48211675, -0.00031596], e: [0.2488273, 0.0000517], i: [17.14001206, 0.00004818],
      L: [238.92903833, 145.20780515], peri: [224.06891629, -0.04062942], node: [110.30393684, -0.01183482],
    },
    pole: { ra: 132.993, dec: -6.163 },
    spin: { w0: 302.695, degPerDay: 56.3625225 },
    tiltDeg: 119.6, // from this IAU pole and orbit; 122.5° is also quoted
    gravity: 0.62,
    facts: { diameterKm: 2_377, day: { en: '6.4 days', my: '၆.၄ ရက်', ja: '6.4日' }, year: { en: '248 years', my: '၂၄၈ နှစ်', ja: '248年' }, moons: '5' },
    blurb: {
      en: 'Called a dwarf planet since 2006. Its heart-shaped plain is a glacier of nitrogen ice.',
      my: '၂၀၀၆ ခုနှစ်ကစပြီး ဂြိုဟ်ပုလို့ ခေါ်ပါတယ်။ နှလုံးပုံ လွင်ပြင်က နိုက်ထရိုဂျင် ရေခဲ ရေခဲမြစ်ပါ။',
      ja: '2006年から準惑星とされています。ハート形の平原は窒素の氷でできた氷河です。',
    },
  },
  {
    id: 'halley',
    kind: 'comet',
    name: { en: 'Halley’s Comet', my: 'ဟေလီ ကြယ်တံခွန်', ja: 'ハレー彗星' },
    color: 0x4a4540,
    // An 11 km nucleus is a dark speck: no image, just its color. What you see is the coma and tails (scene/comet.ts).
    textures: { map: '', tint: 0x4a4540, maxTier: '1k' },
    orbitAU: 17.86,
    comet: { q: 0.59, periodDays: 27_563.8, i: 162.1905300, node: 59.0989472, peri: 112.2414315, tp: 2_446_469.9736 },
    pole: { ra: 0, dec: 90 },
    spin: { w0: 0, degPerDay: 163.6 },
    tiltDeg: 0,
    gravity: 0.0005,
    facts: { diameterKm: 11, day: { en: '~2.2 days', my: '~၂.၂ ရက်', ja: '約2.2日' }, year: { en: '~76 years', my: '~၇၆ နှစ်', ja: '約76年' }, moons: '0' },
    blurb: {
      en: 'Seen every ~76 years since at least 240 BC. Next close to the Sun in July 2061.',
      my: 'ဘီစီ ၂၄၀ ကတည်းက နှစ် ၇၆ နှစ်လောက်မှာ တစ်ခါ မြင်ခဲ့ကြပါတယ်။ နောက်တစ်ခါ ၂၀၆၁ ဇူလိုင်မှာ နေနားကို ပြန်ရောက်ပါမယ်။',
      ja: '少なくとも紀元前240年から、約76年ごとに観測されてきました。次に太陽に近づくのは2061年7月です。',
    },
  },
];

/** How far a body reaches out from its center (its rings, or its atmosphere), × radius. */
export const reachFactor = (body: Pick<Body, 'ring'>) => body.ring?.outer ?? ATMOSPHERE_SHELL;

/**
 * Places each body in the scene from its real diameter and distance (see scale.ts):
 * moons around their planet first, so each planet's spacing can make room for them.
 */
function placeInScene(data: BodyData[]): Body[] {
  const placed = new Map<string, Pick<Body, 'radius' | 'orbitRadius'>>();
  const planets = data.filter((b) => b.kind === 'planet');
  const moonReach = planets.map((p) => {
    const moons = data.filter((m) => m.parent === p.id).sort((a, b) => a.moon!.aKm - b.moon!.aKm);
    const radii = moons.map((m) => moonRadius(m.facts.diameterKm));
    const orbits = sceneMoonOrbits(sceneRadius(p.facts.diameterKm) * reachFactor(p), moons.map((m, i) => ({ aKm: m.moon!.aKm, radius: radii[i] })));
    moons.forEach((m, i) => placed.set(m.id, { radius: radii[i], orbitRadius: orbits[i] }));
    return moons.length ? orbits[moons.length - 1] + radii[moons.length - 1] : 0;
  });
  const orbits = sceneOrbits(
    planets.map((p, i) => ({ orbitAU: p.orbitAU, radius: sceneRadius(p.facts.diameterKm), extent: reachFactor(p), moonReach: moonReach[i] })),
  );
  planets.forEach((p, i) => placed.set(p.id, { radius: sceneRadius(p.facts.diameterKm), orbitRadius: orbits[i] }));
  // Pluto and the comet are placed by their real 3D position (SolarSystem); this is their mean distance.
  const anchors = planets.map((p, i) => [p.orbitAU, orbits[i]] as [number, number]);
  for (const b of data.filter((x) => x.kind === 'dwarf' || x.kind === 'comet')) {
    placed.set(b.id, { radius: sceneRadius(b.facts.diameterKm), orbitRadius: logInterpolate(anchors, b.orbitAU) });
  }
  return data.map((b) => ({ ...b, ...(b.kind === 'star' ? { radius: SCALE.sunRadius, orbitRadius: 0 } : placed.get(b.id)!) }));
}

/** How far a planet's system (rings, atmosphere, moons) reaches from its center. */
export function systemReach(body: Body): number {
  const moons = BODIES.filter((m) => m.parent === body.id);
  return Math.max(body.radius * reachFactor(body), ...moons.map((m) => m.orbitRadius + m.radius));
}

/**
 * Scene distance from the Sun for a real one (AU), for small bodies: through every
 * planet's orbit, so 1 AU is on Earth's, log-interpolated between them.
 */
export function sceneDistance(au: number): number {
  return logInterpolate(
    BODIES.filter((b) => b.kind === 'planet').map((p) => [p.orbitAU, p.orbitRadius]),
    au,
  );
}

/** A planet's moons, innermost first. */
export const moonsOf = (id: string) => BODIES.filter((b) => b.parent === id).sort((a, b) => a.orbitRadius - b.orbitRadius);

export const BODIES: Body[] = placeInScene(DATA);
