import type { Lang } from '../data/bodies';

const TEXT = {
  settings: { en: 'Settings', my: 'ဆက်တင်များ', ja: '設定' },
  close: { en: 'Close', my: 'ပိတ်ရန်', ja: '閉じる' },
  overview: { en: 'Overview', my: 'အကျဉ်းချုပ်', ja: '概要' },
  travel: { en: 'Travel', my: 'ခရီးစဉ်', ja: 'フライト' },
  chooseDestination: { en: 'Choose a destination', my: 'သွားမည့်နေရာ ရွေးပါ', ja: '目的地を選択' },
  readyToLaunch: { en: 'Ready for departure', my: 'ထွက်ခွာရန် အသင့်ဖြစ်ပါပြီ', ja: '出発の準備完了' },
  cinematic: { en: 'Clean view', my: 'မြင်ကွင်းအပြည့်', ja: 'すっきり表示' },
  exitCinematic: { en: 'Show controls', my: 'ထိန်းချုပ်ခလုတ်များ ပြရန်', ja: '操作パネルを表示' },
  landing: { en: 'Landing approach', my: 'ဆင်းသက်နေပါပြီ', ja: '着陸アプローチ' },
  landingHelp: { en: 'Help', my: 'အကူအညီ', ja: 'ヘルプ' },
  approach: { en: 'Approach progress', my: 'ဆင်းသက်မှု အခြေအနေ', ja: '着陸の進行状況' },
  flightDeck: { en: 'Flight control', my: 'ပျံသန်းမှု ထိန်းချုပ်ရေး', ja: 'フライトコントロール' },
  sceneSettings: { en: 'Scene & display', my: 'မြင်ကွင်းနှင့် ရုပ်ထွက်', ja: 'シーンと表示' },
  tools: { en: 'Tools & information', my: 'ကိရိယာနှင့် အချက်အလက်', ja: 'ツールと情報' },
} as const satisfies Record<string, Record<Lang, string>>;

export function dt(key: keyof typeof TEXT, lang: Lang): string {
  return TEXT[key][lang];
}
