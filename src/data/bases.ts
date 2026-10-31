import type { Lang } from './bodies';

// Space bases (v2.0). Fictional stations at real places: each sits at a real
// latitude/longitude on its body (east-positive longitude, like the texture
// maps), next to something worth visiting.

export type BaseTheme = 'launch' | 'crater' | 'dome' | 'ice' | 'shore';

export interface Base {
  id: string;
  /** The planet or moon it stands on. */
  body: string;
  /** Degrees; longitude east-positive, as on the texture maps. */
  lat: number;
  lon: number;
  theme: BaseTheme;
  name: Record<Lang, string>;
  blurb: Record<Lang, string>;
}

export const BASES: Base[] = [
  {
    id: 'cape',
    body: 'earth',
    lat: 28.5,
    lon: -80.6,
    theme: 'launch',
    name: { en: 'Cape Launch Center', my: 'Cape ဒုံးပျံလွှတ်စခန်း', ja: 'ケープ打ち上げセンター' },
    blurb: {
      en: 'Where every trip starts: a launch pad on Florida’s Atlantic coast, near Cape Canaveral.',
      my: 'ခရီးတိုင်း ဒီကစပါတယ်။ Florida ရဲ့ အတ္တလန္တိတ်ကမ်းခြေ Cape Canaveral အနီးက လွှတ်တင်ရေးကွင်းပါ။',
      ja: 'すべての旅はここから。フロリダの大西洋岸、ケープカナベラル近くの発射台です。',
    },
  },
  {
    id: 'tranquility',
    body: 'moon',
    lat: 0.67,
    lon: 23.47,
    theme: 'crater',
    name: { en: 'Tranquility Base', my: 'Tranquility စခန်း', ja: '静かの基地' },
    blurb: {
      en: 'A few modules beside the spot where Apollo 11 landed in 1969, on the Sea of Tranquility.',
      my: '၁၉၆၉ မှာ Apollo 11 ဆင်းသက်ခဲ့တဲ့ ငြိမ်သက်ခြင်းပင်လယ်ပြင်နားက modules လေးတွေပါ။',
      ja: '1969年にアポロ11号が着陸した「静かの海」のそばにある、小さなモジュール群です。',
    },
  },
  {
    id: 'jezero',
    body: 'mars',
    lat: 18.4,
    lon: 77.6,
    theme: 'dome',
    name: { en: 'Jezero Dome', my: 'Jezero အမိုးခုံး', ja: 'ジェゼロ・ドーム' },
    blurb: {
      en: 'A pressurized dome on the old river delta where the Perseverance rover looks for signs of ancient life.',
      my: 'Perseverance rover က ရှေးဟောင်း သက်ရှိလက္ခဏာ ရှာနေတဲ့ မြစ်ဝကျွန်းပေါ်ဟောင်းပေါ်က လေဖိအားထိန်း အမိုးခုံးပါ။',
      ja: '探査車パーサヴィアランスが古代の生命の痕跡を探す、かつての川の三角州に建つ与圧ドームです。',
    },
  },
  {
    id: 'conamara',
    body: 'europa',
    lat: 9.7,
    lon: 86,
    theme: 'ice',
    name: { en: 'Conamara Ice Station', my: 'Conamara ရေခဲစခန်း', ja: 'コナマラ氷上ステーション' },
    blurb: {
      en: 'Drills down through the ice shell of Conamara Chaos toward the ocean beneath.',
      my: 'Conamara Chaos ရဲ့ ရေခဲအခွံကို ဖောက်ပြီး အောက်က သမုဒ္ဒရာဆီ တူးနေပါတယ်။',
      ja: 'コナマラ・カオスの氷の殻を、その下の海に向かって掘り進めています。',
    },
  },
  {
    id: 'kraken',
    body: 'titan',
    lat: 68,
    lon: 50,
    theme: 'shore',
    name: { en: 'Kraken Shore', my: 'Kraken ကမ်းခြေ', ja: 'クラーケン海岸基地' },
    blurb: {
      en: 'On the shore of Kraken Mare, the largest sea of liquid methane on Titan.',
      my: 'တိုက်တန်ပေါ်က အကြီးဆုံး အရည်မီသိန်း ပင်လယ် Kraken Mare ရဲ့ ကမ်းခြေမှာပါ။',
      ja: 'タイタン最大の液体メタンの海、クラーケン海の岸辺にあります。',
    },
  },
];

export const baseOn = (bodyId: string) => BASES.find((b) => b.body === bodyId) ?? null;
export const baseById = (id: string) => BASES.find((b) => b.id === id)!;

/**
 * A point on the unit sphere for a latitude/longitude, in the body mesh's own
 * frame: the sphere's texture puts longitude 0 at +x (u = 0.5), east toward
 * +z… matching three's SphereGeometry, and north at +y.
 */
export function surfacePoint(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const phi = 2 * Math.PI * (0.5 + lonDeg / 360);
  return [-Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat)];
}

/** Where on the texture map a latitude/longitude is (u, v; v = 0 at the north pole). */
export const mapUv = (latDeg: number, lonDeg: number): [number, number] => [(((0.5 + lonDeg / 360) % 1) + 1) % 1, 0.5 - latDeg / 180];
