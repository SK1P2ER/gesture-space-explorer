import type { Lang } from '../data/bodies';

// The AstroLife shell's strings, in English, Burmese and Japanese. They live with the shell, not in
// ui/i18n.ts, so visitors without ?flags=astrolife never download them. Same rules as ui/i18n.ts:
// Burmese in the spoken polite style (…ပါတယ် / …ပါ), short button labels as plain nouns or …ရန်,
// technical terms in English (docs/i18n-review-my.md). New Burmese strings await native review.
const STRINGS = {
  'shell.sections': { en: 'AstroLife sections', my: 'AstroLife အပိုင်းများ', ja: 'AstroLife のメニュー' },
  'nav.home': { en: 'Home', my: 'ပင်မ', ja: 'ホーム' },
  'nav.destinations': { en: 'Destinations', my: 'ခရီးဆုံးများ', ja: '行き先' },
  'nav.passport': { en: 'Passport', my: 'ပတ်စ်ပို့', ja: 'パスポート' },
  // The passport: journey stamps (travel/memories.ts), and forgetting everything.
  'passport.kicker': { en: 'Galactic passport', my: 'ဂလက်ဆီ ပတ်စ်ပို့', ja: '銀河パスポート' },
  'passport.title': { en: 'Your passport', my: 'သင့် ပတ်စ်ပို့', ja: 'あなたのパスポート' },
  'passport.count': { en: '{n} of {total} destinations stamped', my: 'ခရီးဆုံး {total} ခုမှာ {n} ခု တံဆိပ်ရပြီး', ja: '{total}か所中{n}か所のスタンプ' },
  'passport.empty': {
    en: 'No stamps yet. Fly a booked journey to the end to earn your first.',
    my: 'တံဆိပ် မရသေးပါ။ Booking လုပ်ထားတဲ့ ခရီးစဉ်ကို အဆုံးထိ ပျံသန်းပြီး ပထမဆုံး တံဆိပ်ကို ရယူပါ။',
    ja: 'まだスタンプはありません。予約した旅を最後まで飛ぶと、最初のスタンプがもらえます。',
  },
  'passport.arrived': { en: 'Arrived {date}', my: '{date} ရောက်ရှိ', ja: '{date} 到着' },
  'passport.forget': { en: 'Forget AstroLife on this device', my: 'ဒီစက်ထဲက AstroLife ကို ဖျက်ရန်', ja: 'この端末のAstroLifeデータを消去' },
  'passport.forgetSure': {
    en: 'Delete every booking, pass and stamp? Press again to confirm.',
    my: 'Booking၊ pass နဲ့ တံဆိပ် အားလုံးကို ဖျက်မလား။ အတည်ပြုဖို့ ထပ်နှိပ်ပါ။',
    ja: 'すべての予約・搭乗券・スタンプを削除しますか？もう一度押すと確定します。',
  },
  'passport.forgetNote': { en: 'Everything AstroLife keeps is on this device only.', my: 'AstroLife က သိမ်းထားတာ အားလုံး ဒီစက်ထဲမှာပဲ ရှိပါတယ်။', ja: 'AstroLifeが保存するものはすべてこの端末の中だけです。' },
  // The postcard (shell/postcard.ts): drawn as an image, never as HTML.
  'postcard.make': { en: 'Make a postcard', my: 'Postcard ပြုလုပ်ရန်', ja: 'ポストカードを作る' },
  'postcard.from': { en: 'Greetings from {place}', my: '{place} က နှုတ်ခွန်းဆက်ပါတယ်', ja: '{place}からこんにちは' },
  'postcard.flew': { en: '{nick} flew {route}', my: '{nick} က {route} ကို ပျံသန်းခဲ့ပါတယ်', ja: '{nick}さんは{route}を飛びました' },
  'postcard.departed': { en: 'Departed {date} · {flight}', my: '{date} ထွက်ခွာ · {flight}', ja: '{date} 出発 · {flight}' },
  'postcard.footer': { en: 'AstroLife 2126 · a fictional simulation', my: 'AstroLife 2126 · စိတ်ကူးယဉ် simulation', ja: 'AstroLife 2126 · 架空のシミュレーション' },
  'postcard.alt': { en: 'Postcard from {place}', my: '{place} က postcard', ja: '{place}からのポストカード' },
  'postcard.save': { en: 'Save postcard', my: 'Postcard သိမ်းရန်', ja: 'ポストカードを保存' },
  'postcard.share': { en: 'Share postcard', my: 'Postcard မျှဝေရန်', ja: 'ポストカードを共有' },
  back: { en: 'Back', my: 'နောက်သို့', ja: '戻る' },
  explore: { en: 'Open the explorer', my: 'Explorer ကို ဖွင့်ရန်', ja: 'エクスプローラーを開く' },
  toHub: { en: 'Back to AstroLife 2126', my: 'AstroLife 2126 သို့ ပြန်ရန်', ja: 'AstroLife 2126に戻る' },
  simNotice: {
    en: 'Every journey, fare and timetable here is a fictional simulation set in 2126. Nothing is booked for real, and it all stays on this device.',
    my: 'ဒီမှာပါတဲ့ ခရီးစဉ်၊ ခရီးစရိတ်နဲ့ အချိန်ဇယား အားလုံးဟာ ၂၁၂၆ ခုနှစ်မှာ ဖြစ်မယ့် စိတ်ကူးယဉ် simulation ပါ။ တကယ် booking မလုပ်ပါဘူး၊ အားလုံး ဒီစက်ထဲမှာပဲ ရှိပါတယ်။',
    ja: 'ここでの旅程・運賃・時刻表はすべて、2126年を舞台にした架空のシミュレーションです。実際の予約は行われず、データはこの端末の中だけに残ります。',
  },
  'hub.kicker': { en: 'Space travel, 2126', my: 'အာကာသခရီး၊ ၂၁၂၆', ja: '宇宙旅行、2126年' },
  'hub.title': { en: 'Where to next?', my: 'နောက်ထပ် ဘယ်ကို သွားမလဲ။', ja: '次はどこへ？' },
  'hub.lead': {
    en: 'Choose a world, book a seat on a fictional liner, fly there in 3D, and keep the stamp.',
    my: 'ကမ္ဘာတစ်ခု ရွေးပါ၊ စိတ်ကူးယဉ် အာကာသယာဉ်မှာ ထိုင်ခုံ booking လုပ်ပါ၊ 3D နဲ့ ပျံသန်းပြီး တံဆိပ်ကို သိမ်းထားပါ။',
    ja: '行き先を選び、架空の定期船の座席を予約して、3Dで飛び、スタンプを手に入れましょう。',
  },
  'hub.featured': { en: 'Featured journey', my: 'အထူးခရီးစဉ်', ja: 'おすすめの旅' },
  'hub.seeJourney': { en: 'See the journey', my: 'ခရီးစဉ်ကို ကြည့်ရန်', ja: 'この旅を見る' },
  'hub.allDestinations': { en: 'All destinations', my: 'ခရီးဆုံး အားလုံး', ja: 'すべての行き先' },
  // Journey times are a fictional 2126 timetable: always shown with 'fictional' beside them.
  hours: { en: '{n} hours', my: '{n} နာရီ', ja: '{n}時間' },
  days: { en: '{n} days', my: '{n} ရက်', ja: '{n}日' },
  journeyBy: { en: '{time} by fusion liner', my: 'Fusion အာကာသယာဉ်နဲ့ {time}', ja: '核融合定期船で{time}' },
  fictional: { en: 'fictional', my: 'စိတ်ကူးယဉ်', ja: '架空' },
  'dest.lead': { en: 'Every journey leaves from {spaceport}, on Earth.', my: 'ခရီးစဉ်တိုင်း ကမ္ဘာပေါ်က {spaceport} ကနေ ထွက်ပါတယ်။', ja: 'すべての旅は地球の{spaceport}から出発します。' },
  'dest.bookable': { en: 'Booking open', my: 'Booking ဖွင့်ထားပါတယ်', ja: '予約受付中' },
  'dest.exploreOnly': { en: 'Explore now · booking later', my: 'အခု လေ့လာနိုင်ပါတယ် · booking နောက်မှ', ja: '今は見学のみ · 予約は後日' },
  'dest.journey': { en: 'Journey from {spaceport}', my: '{spaceport} ကနေ ခရီးချိန်', ja: '{spaceport}からの所要時間' },
  'dest.distance': { en: 'From Earth today', my: 'ဒီနေ့ ကမ္ဘာကနေ အကွာအဝေး', ja: '今日の地球からの距離' },
  'dest.real': { en: 'real', my: 'တကယ့်တန်ဖိုး', ja: '実際の値' },
  'dest.explore': { en: 'Explore in 3D', my: '3D နဲ့ လေ့လာရန်', ja: '3Dで見る' },
  'dest.details': { en: 'Details', my: 'အသေးစိတ်', ja: '詳細' },
  'dest.book': { en: 'Book this journey', my: 'ဒီခရီးစဉ်ကို booking လုပ်ရန်', ja: 'この旅を予約する' },
  // Booking (travel/booking.ts). Nothing is paid: fares are part of the simulation.
  'book.step': { en: 'Step {n} of 3', my: 'အဆင့် {n} / ၃', ja: 'ステップ {n} / 3' },
  'book.traveller': { en: 'Who’s travelling?', my: 'ဘယ်သူ ခရီးသွားမလဲ။', ja: 'どなたが旅行しますか？' },
  // "Nickname", not "name" (decision 22): it is shown in the pass's shareable souvenir link.
  'book.name': { en: 'Nickname', my: 'နာမည်ပြောင်', ja: 'ニックネーム' },
  'book.nameHint': {
    en: 'Shown on your boarding pass and in its souvenir link, so pick a nickname, not your real name. It stays on this device until you share it.',
    my: 'Boarding pass နဲ့ souvenir link မှာ ပြပါမယ်။ ဒါကြောင့် နာမည်အရင်း မဟုတ်ဘဲ နာမည်ပြောင်ကို ရွေးပါ။ မမျှဝေမချင်း ဒီစက်ထဲမှာပဲ ရှိပါတယ်။',
    ja: '搭乗券とお土産リンクに表示されるので、本名ではなくニックネームにしてください。共有しない限り、この端末の中だけに残ります。',
  },
  'book.avatar': { en: 'Avatar', my: 'Avatar', ja: 'アバター' },
  'book.avatarN': { en: 'Avatar {n}', my: 'Avatar {n}', ja: 'アバター{n}' },
  'book.trip': { en: 'Departure and cabin', my: 'ထွက်ခွာချိန်နဲ့ အခန်း', ja: '出発便と客室' },
  'book.departure': { en: 'Departure', my: 'ထွက်ခွာချိန်', ja: '出発便' },
  'book.cabin': { en: 'Cabin', my: 'အခန်း', ja: '客室' },
  'book.window': {
    en: 'Liners leave in the next Earth–Mars launch window, around {date}: real, from the planets’ positions. The {days}-day crossing is fiction.',
    my: 'အာကာသယာဉ်တွေက {date} ဝန်းကျင် နောက်ထပ် ကမ္ဘာ–အင်္ဂါ လွှတ်တင်ချိန်မှာ ထွက်ပါတယ်။ ဒါက ဂြိုဟ်တွေရဲ့ တည်နေရာအရ တကယ့်အချိန်ပါ။ {days} ရက် ခရီးကတော့ စိတ်ကူးယဉ်ပါ။',
    ja: '定期船は次の地球–火星の打ち上げウィンドウ（{date}ごろ）に出発します。惑星の位置から求めた実際の時期です。{days}日間の航行は架空です。',
  },
  'book.review': { en: 'Check and confirm', my: 'စစ်ပြီး အတည်ပြုပါ', ja: '確認して予約' },
  'book.fare': { en: 'Fare', my: 'ခရီးစရိတ်', ja: '運賃' },
  'book.free': { en: 'No payment: fares are part of the simulation.', my: 'ငွေပေးစရာ မလိုပါ။ ခရီးစရိတ်တွေက simulation ရဲ့ အစိတ်အပိုင်းပါ။', ja: '支払いはありません。運賃もシミュレーションの一部です。' },
  'book.next': { en: 'Continue', my: 'ဆက်သွားရန်', ja: '次へ' },
  'book.confirm': { en: 'Confirm booking', my: 'Booking အတည်ပြုရန်', ja: '予約を確定する' },
  'book.active': {
    en: 'You already have a journey booked. Cancel it to book another.',
    my: 'ခရီးစဉ်တစ်ခု booking လုပ်ထားပြီးပါပြီ။ နောက်တစ်ခု လုပ်ဖို့ အရင်ဟာကို ပယ်ဖျက်ပါ။',
    ja: 'すでに予約済みの旅があります。別の旅を予約するには、先にキャンセルしてください。',
  },
  'book.failed': { en: 'That booking couldn’t be made. Check the steps before this one.', my: 'ဒီ booking ကို လုပ်လို့ မရပါ။ အရင်အဆင့်တွေကို ပြန်စစ်ပါ။', ja: 'この予約はできませんでした。前のステップを確認してください。' },
  fare: { en: '{n} credits', my: 'Credit {n}', ja: '{n}クレジット' },
  'err.name.empty': { en: 'Enter a nickname for your boarding pass.', my: 'Boarding pass အတွက် နာမည်ပြောင် ထည့်ပါ။', ja: '搭乗券のニックネームを入力してください。' },
  'err.name.long': { en: 'Use {max} characters or fewer.', my: 'စာလုံး {max} လုံးထက် မပိုပါစေနဲ့။', ja: '{max}文字以内で入力してください。' },
  'err.name.chars': { en: 'Use letters, numbers, emoji, spaces and . ’ - only.', my: 'စာလုံး၊ ဂဏန်း၊ emoji၊ space နဲ့ . ’ - ကိုပဲ သုံးပါ။', ja: '文字・数字・絵文字・スペースと . ’ - だけを使ってください。' },
  // The boarding pass (after check-in) and its souvenir QR code (travel/souvenir.ts).
  'pass.checkIn': { en: 'Check in', my: 'Check-in လုပ်ရန်', ja: 'チェックインする' },
  'pass.checkInHint': { en: 'Checking in issues your boarding pass. Nothing is sent anywhere.', my: 'Check-in လုပ်ရင် boarding pass ရပါမယ်။ ဘာမှ ဘယ်ကိုမှ မပို့ပါဘူး။', ja: 'チェックインすると搭乗券が発行されます。どこにも送信されません。' },
  'pass.title': { en: 'Boarding pass', my: 'Boarding pass', ja: '搭乗券' },
  'pass.qr': { en: 'Souvenir QR code: opens this pass as a keepsake on any phone', my: 'Souvenir QR code: ဘယ်ဖုန်းမှာမဆို ဒီ pass ကို အမှတ်တရအဖြစ် ဖွင့်ပါတယ်', ja: 'お土産QRコード：どのスマホでもこの搭乗券を記念品として開けます' },
  'pass.qrNote': {
    en: 'A keepsake, not a ticket. It holds your nickname, avatar, flight and cabin, nothing else, and anyone you share it with can see them.',
    my: 'လက်မှတ် မဟုတ်ဘဲ အမှတ်တရ ပစ္စည်းပါ။ နာမည်ပြောင်၊ avatar၊ ခရီးစဉ်နဲ့ အခန်းပဲ ပါပြီး မျှဝေလိုက်တဲ့သူတိုင်း မြင်နိုင်ပါတယ်။',
    ja: 'チケットではなく記念品です。ニックネーム・アバター・便・客室だけが含まれ、共有した相手はそれを見られます。',
  },
  'pass.copy': { en: 'Copy souvenir link', my: 'Souvenir link ကူးယူရန်', ja: 'お土産リンクをコピー' },
  'pass.copied': { en: 'Copied', my: 'ကူးယူပြီးပါပြီ', ja: 'コピーしました' },
  'pass.date': { en: 'Departs', my: 'ထွက်ခွာချိန်', ja: '出発' },
  'souvenir.kicker': { en: 'Souvenir boarding pass', my: 'အမှတ်တရ boarding pass', ja: '記念の搭乗券' },
  'souvenir.title': { en: '{nick}’s journey to {to}', my: '{nick} ရဲ့ {to} ခရီးစဉ်', ja: '{nick}さんの{to}への旅' },
  'souvenir.note': {
    en: 'A keepsake from AstroLife 2126, opened from a link. It isn’t a ticket, and nothing about it was sent anywhere.',
    my: 'Link ကနေ ဖွင့်ထားတဲ့ AstroLife 2126 အမှတ်တရပါ။ လက်မှတ် မဟုတ်ပါဘူး၊ ဘာမှ ဘယ်ကိုမှ မပို့ထားပါဘူး။',
    ja: 'リンクから開いたAstroLife 2126の記念品です。チケットではなく、何も送信されていません。',
  },
  // The journey in the explorer (decision 23): the clock jumps to the departure, and back afterwards.
  'journey.begin': { en: 'Begin journey', my: 'ခရီးစဉ် စတင်ရန်', ja: '旅を始める' },
  'journey.resume': { en: 'Resume journey', my: 'ခရီးစဉ် ဆက်ရန်', ja: '旅を再開する' },
  'journey.beginHint': {
    en: 'Opens the explorer at the spaceport. For the journey the clock jumps to your departure, {date}, and when you leave the journey it goes back to where you had it. Dates and flight are a simulation.',
    my: 'အာကာသဆိပ်မှာ explorer ကို ဖွင့်ပါမယ်။ ခရီးစဉ်အတွင်း နာရီက ထွက်ခွာချိန် {date} ဆီ ခုန်ပြီး ခရီးစဉ်က ထွက်တဲ့အခါ အရင်အတိုင်း ပြန်ဖြစ်ပါမယ်။ ရက်စွဲနဲ့ ပျံသန်းမှုက simulation ပါ။',
    ja: '宇宙港でエクスプローラーが開きます。旅の間、時計は出発日時（{date}）に移り、旅を離れると元に戻ります。日付と飛行はシミュレーションです。',
  },
  'journey.sim': { en: 'Simulation', my: 'Simulation', ja: 'シミュレーション' },
  'journey.ready': { en: '{ref} · {route} · ready: {launch} when you are', my: '{ref} · {route} · အသင့်ပါ: အဆင်သင့်ရင် {launch}', ja: '{ref} · {route} · 準備完了：いつでも{launch}' },
  'journey.flying': { en: '{ref} · on the way to {to}', my: '{ref} · {to} ကို သွားနေပါတယ်', ja: '{ref} · {to}へ向かっています' },
  'journey.arrived': { en: '{ref} · arrived at {to} · journey stamp collected', my: '{ref} · {to} ကို ရောက်ပါပြီ · ခရီးစဉ် တံဆိပ် ရပါပြီ', ja: '{ref} · {to}に到着 · 旅のスタンプを獲得' },
  'journey.stamped': { en: 'Journey complete: your {to} stamp is in AstroLife', my: 'ခရီးစဉ် ပြီးပါပြီ: {to} တံဆိပ်က AstroLife မှာ ရှိပါတယ်', ja: '旅が完了：{to}のスタンプはAstroLifeに' },
  'journey.complete': { en: 'Journey complete: stamp collected', my: 'ခရီးစဉ် ပြီးဆုံးပါပြီ: တံဆိပ် ရပါပြီ', ja: '旅が完了しました：スタンプを獲得' },
  'souvenir.start': { en: 'Plan your own journey', my: 'ကိုယ်ပိုင် ခရီးစဉ် စီစဉ်ရန်', ja: '自分の旅を計画する' },
  'cabin.pod': { en: 'Sleeper pod', my: 'အိပ်စင် pod', ja: '寝台ポッド' },
  'cabin.podText': { en: 'Sleep through most of the trip.', my: 'ခရီးအများစုကို အိပ်ပြီး ဖြတ်သန်းပါ။', ja: '旅のほとんどを眠って過ごします。' },
  'cabin.window': { en: 'Window cabin', my: 'ပြတင်းပေါက် အခန်း', ja: '窓側キャビン' },
  'cabin.windowText': { en: 'Your own porthole on the stars.', my: 'ကြယ်တွေကို မြင်ရတဲ့ ကိုယ်ပိုင် ပြတင်းပေါက်။', ja: '星を眺める専用の丸窓付き。' },
  'cabin.suite': { en: 'Observation suite', my: 'ကြည့်ရှုရေး suite', ja: '展望スイート' },
  'cabin.suiteText': { en: 'A dome to watch {world} grow closer.', my: '{world} နီးလာတာကို ကြည့်ဖို့ အမိုးခုံး။', ja: '{world}が近づくのを眺めるドーム。' },
  // A booking (the trip screen).
  'trip.title': { en: 'Your journey', my: 'သင့်ခရီးစဉ်', ja: 'あなたの旅' },
  'trip.confirmed': { en: 'Booking confirmed', my: 'Booking အတည်ပြုပြီးပါပြီ', ja: '予約が確定しました' },
  'trip.ref': { en: 'Booking reference', my: 'Booking နံပါတ်', ja: '予約番号' },
  'trip.traveller': { en: 'Traveller', my: 'ခရီးသည်', ja: '旅行者' },
  'trip.route': { en: 'Route', my: 'လမ်းကြောင်း', ja: 'ルート' },
  'trip.flight': { en: 'Flight', my: 'ခရီးစဉ်', ja: '便' },
  'trip.status': { en: 'Status', my: 'အခြေအနေ', ja: '状態' },
  'trip.view': { en: 'View booking', my: 'Booking ကြည့်ရန်', ja: '予約を見る' },
  'trip.cancel': { en: 'Cancel booking', my: 'Booking ပယ်ဖျက်ရန်', ja: '予約をキャンセル' },
  'trip.cancelSure': { en: 'Cancel this booking? Press again to confirm.', my: 'ဒီ booking ကို ပယ်ဖျက်မလား။ အတည်ပြုဖို့ ထပ်နှိပ်ပါ။', ja: 'この予約をキャンセルしますか？もう一度押すと確定します。' },
  'trip.keep': { en: 'Keep it', my: 'မဖျက်ပါ', ja: 'やめる' },
  'trip.notSaved': {
    en: 'This device didn’t let the booking be saved: it lasts until you close the page.',
    my: 'ဒီစက်က booking ကို သိမ်းခွင့် မပေးပါ။ စာမျက်နှာ ပိတ်တဲ့အထိပဲ ရှိပါမယ်။',
    ja: 'この端末に予約を保存できませんでした。ページを閉じるまで有効です。',
  },
  'status.confirmed': { en: 'Confirmed', my: 'အတည်ပြုပြီး', ja: '予約済み' },
  'status.checkedIn': { en: 'Checked in', my: 'Check-in လုပ်ပြီး', ja: 'チェックイン済み' },
  'status.inJourney': { en: 'On the way', my: 'ခရီးသွားနေဆဲ', ja: '飛行中' },
  'status.completed': { en: 'Arrived', my: 'ရောက်ပါပြီ', ja: '到着済み' },
  'status.cancelled': { en: 'Cancelled', my: 'ပယ်ဖျက်ပြီး', ja: 'キャンセル済み' },
} satisfies Record<string, Record<Lang, string>>;

export type ShellKey = keyof typeof STRINGS;

export const st = (key: ShellKey, lang: Lang) => STRINGS[key][lang];

/** A string with `{placeholders}` filled in. */
export const stf = (key: ShellKey, lang: Lang, vars: Record<string, string>) =>
  st(key, lang).replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);

export const SHELL_KEYS = Object.keys(STRINGS) as ShellKey[];
