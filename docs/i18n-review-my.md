# Burmese strings (v1.2 – v2.2)

**Status: reviewed by a native speaker on 2026-10-24 — all strings confirmed correct, no changes needed.** New strings added after v2.2 go below and need a new review.

Every Burmese (my) string added or changed since v1.1.1, for a native speaker to check. They were written by Claude, not a native speaker.

**How to review:** correct the Burmese column in place (or add a note after it). Keep anything in `{braces}` exactly as it is: the app fills in a name, number or date there. Keys are where the string lives (`src/ui/i18n.ts` for UI strings, `src/data/bodies.ts` for planet and moon text).

**On purpose, and worth a second opinion:**

- Technical terms stay in English (Hand tracking, texture, Watermark, public domain, data, kg), as Burmese software UIs often do. Say if any of these read better in Burmese.
- Numbers are written with Myanmar digits by the app (၂၆.၄ kg, ၂၀၂၆), not in these strings, except where a number is part of the text itself.
- Dates in Burmese use the format `၂၀၂၆ အောက် ၂၃` (year, short month, day) and 24-hour time `၁၄:၀၅`, following CLDR's Burmese data. Month names are in the last table.

## UI strings (64)

| Key | English | Burmese | Since |
|---|---|---|---|
| `help` | ← → switch · ↑ ↓ zoom · drag rotate · Enter select · Space pause · [ ] speed · B reverse · N now · M moons · P photo · G weight · L language · D debug | ← → ဂြိုဟ်ပြောင်း · ↑ ↓ zoom · drag လှည့် · Enter ရွေး · Space ရပ် · [ ] အမြန်နှုန်း · B နောက်ပြန် · N ယခု · M လများ · P ဓာတ်ပုံ · G ကိုယ်အလေးချိန် · L ဘာသာ · D debug | changed in 1.3 |
| `credits.hand` | Hand tracking | Hand tracking | new in 1.3 |
| `credits.graphics` | 3D graphics | 3D ဂရပ်ဖစ် | new in 1.3 |
| `credits.planetTextures` | Planet textures and the Moon | ဂြိုဟ်တွေနဲ့ လ ရဲ့ texture | new in 1.3 |
| `credits.moonTextures` | Io, Europa, Ganymede, Callisto, Titan and Pluto | အိုင်အို၊ ယူရိုပါ၊ ဂန်နီမိဒ်၊ ကယ်လစ်စတို၊ တိုက်တန်နဲ့ ပလူတို | new in 1.3 |
| `credits.sky` | The Milky Way and the stars | နဂါးငွေ့တန်းနဲ့ ကြယ်တွေ | new in 1.3 |
| `credits.positions` | Orbits, positions and rotation | ပတ်လမ်း၊ တည်နေရာနဲ့ လည်ပတ်မှု | new in 1.3 |
| `credits.facts` | Facts and surface gravity | အချက်အလက်နဲ့ မျက်နှာပြင် ဆွဲအား | new in 1.3 |
| `credits.resized` | resized and converted | အရွယ်အစားပြောင်းပြီး ပုံစံပြောင်းထားပါတယ် | new in 1.3 |
| `credits.publicDomain` | public domain | public domain | new in 1.3 |
| `credits.data` | published data | ထုတ်ပြန်ထားတဲ့ data | new in 1.3 |
| `credits.privacy` | Hand tracking runs on this device. No video is uploaded or stored. | Hand tracking ကို ဒီစက်ပေါ်မှာပဲ လုပ်ပါတယ်။ ဗီဒီယိုကို upload မလုပ်သလို မသိမ်းလည်း မသိမ်းပါဘူး။ | new in 1.3 |
| `on` | On | ဖွင့် | new in 1.2 |
| `off` | Off | ပိတ် | new in 1.2 |
| `photo` | Photo | ဓာတ်ပုံ | new in 1.2 |
| `solarSystem` | Solar System | နေအဖွဲ့အစည်း | new in 1.2 |
| `watermark` | Watermark | Watermark | new in 1.2 |
| `photoSaved` | 📸 Photo saved | 📸 ဓာတ်ပုံ သိမ်းပြီးပါပြီ | new in 1.2 |
| `photoReady` | 📸 Photo ready | 📸 ဓာတ်ပုံ ရပါပြီ | new in 1.2 |
| `share` | Share | မျှဝေရန် | new in 1.2 |
| `now` | Now | ယခု | new in 1.2 |
| `realTime` | 1× (real time) | ၁× (အချိန်အမှန်) | new in 1.2 |
| `timeSpeed` | Time speed | အချိန်အမြန်နှုန်း | new in 1.2 |
| `pauseTime` | Pause | ရပ်ရန် | new in 1.2 |
| `resumeTime` | Resume | ပြန်စရန် | new in 1.2 |
| `timeLimit` | That’s the edge of the supported dates (1000–3000) | ထောက်ပံ့ထားတဲ့ ရက်စွဲ (၁၀၀၀–၃၀၀၀) ရဲ့ အစွန်းကို ရောက်ပါပြီ | new in 1.2 |
| `unit.second.one` | {n} second/s | {n} စက္ကန့်/စက္ကန့် | new in 1.2 |
| `unit.second.other` | {n} seconds/s | {n} စက္ကန့်/စက္ကန့် | new in 1.2 |
| `unit.minute.one` | {n} minute/s | {n} မိနစ်/စက္ကန့် | new in 1.2 |
| `unit.minute.other` | {n} minutes/s | {n} မိနစ်/စက္ကန့် | new in 1.2 |
| `unit.hour.one` | {n} hour/s | {n} နာရီ/စက္ကန့် | new in 1.2 |
| `unit.hour.other` | {n} hours/s | {n} နာရီ/စက္ကန့် | new in 1.2 |
| `unit.day.one` | {n} day/s | {n} ရက်/စက္ကန့် | new in 1.2 |
| `unit.day.other` | {n} days/s | {n} ရက်/စက္ကန့် | new in 1.2 |
| `unit.week.one` | {n} week/s | {n} ပတ်/စက္ကန့် | new in 1.2 |
| `unit.week.other` | {n} weeks/s | {n} ပတ်/စက္ကန့် | new in 1.2 |
| `unit.month.one` | {n} month/s | {n} လ/စက္ကန့် | new in 1.2 |
| `unit.month.other` | {n} months/s | {n} လ/စက္ကန့် | new in 1.2 |
| `unit.year.one` | {n} year/s | {n} နှစ်/စက္ကန့် | new in 1.2 |
| `unit.year.other` | {n} years/s | {n} နှစ်/စက္ကန့် | new in 1.2 |
| `save` | Save | သိမ်းရန် | new in 1.2 |
| `weightButton` | Weight | ကိုယ်အလေးချိန် | new in 1.2 |
| `weightTitle` | Your weight on other worlds | တခြားကမ္ဘာတွေပေါ်မှာ သင့်ကိုယ်အလေးချိန် | new in 1.2 |
| `weightInput` | Your weight on Earth | ကမ္ဘာပေါ်မှာ သင့်ကိုယ်အလေးချိန် | new in 1.2 |
| `weightInvalid` | Enter a number from 1 to 500 | ၁ မှ ၅၀၀ အထိ ဂဏန်း ထည့်ပါ | new in 1.2 |
| `weightHint` | What a bathroom scale would read there. The gas giants have no surface, so theirs is at the cloud tops. Saved only in this browser. | အဲဒီမှာ ကိုယ်အလေးချိန်စက်က ပြမယ့် တန်ဖိုးပါ။ ဓာတ်ငွေ့ဂြိုဟ်ကြီးတွေမှာ မြေပြင် မရှိလို့ တိမ်ထိပ်မှာ တွက်ထားပါတယ်။ ဒီ browser ထဲမှာပဲ သိမ်းထားပါတယ်။ | new in 1.2 |
| `close` | Close | ပိတ်ရန် | new in 1.2 |
| `sheet.toggle` | Show or hide details | အသေးစိတ်ကို ပြရန် သို့မဟုတ် ဝှက်ရန် | new in 1.3 |
| `yourWeight` | Your weight | သင့်ကိုယ်အလေးချိန် | new in 1.2 |
| `enterWeight` | Enter yours | ထည့်ရန် | new in 1.2 |
| `lightFromSun` | Sunlight travel time | နေရောင် ရောက်ရန်ကြာချိန် | new in 1.2 |
| `duration.minSec` | {m} min {s} s | {m} မိနစ် {s} စက္ကန့် | new in 1.2 |
| `duration.hourMin` | {h} h {m} min | {h} နာရီ {m} မိနစ် | new in 1.2 |
| `kind.moon` | moon of {parent} | {parent} ရဲ့ လ | new in 1.3 |
| `kind.dwarf` | dwarf planet | ဂြိုဟ်ပု | new in 1.3 |
| `kind.comet` | comet | ကြယ်တံခွန် | new in 1.3 |
| `nextVisit` | Next visit ({date}) | နောက်တစ်ကြိမ် ({date}) | new in 1.3 |
| `orbitsIn` | Orbits {parent} in | {parent} ကို တစ်ပတ်ပတ်ချိန် | new in 1.3 |
| `visitMoons` | Its moons here | ဒီမှာ ပြထားတဲ့ လများ | new in 1.3 |
| `noMoons` | {name}: no moons to visit | {name}: သွားကြည့်စရာ လ မရှိပါ | new in 1.3 |
| `flash.switch` | ✌️ detected → switching to {name} | ✌️ → {name} သို့ ပြောင်းနေပါတယ် | new in 1.2 |
| `flash.select` | ☝️ selected → {name} | ☝️ ရွေးပြီး → {name} | new in 1.2 |
| `flash.paused` | ✊ → paused | ✊ → ရပ်ထား | new in 1.2 |
| `flash.resumed` | ✊ → resumed | ✊ → ပြန်စ | new in 1.2 |

## Planets, moons, Pluto and Halley's Comet (32)

`name` is shown on labels and cards, `day` and `year` in the facts (for a moon, `year` is how long it takes to go round its planet), `blurb` is the one-line description.

| Key | English | Burmese | Since |
|---|---|---|---|
| `moon.name` | Moon | လ | new in 1.3 |
| `moon.day` | 27.3 days | ၂၇.၃ ရက် | new in 1.3 |
| `moon.year` | 27.3 days | ၂၇.၃ ရက် | new in 1.3 |
| `moon.blurb` | The only other world people have walked on. It always shows Earth the same face. | လူသားတွေ လမ်းလျှောက်ဖူးတဲ့ တစ်ခုတည်းသော တခြားကမ္ဘာပါ။ ကမ္ဘာကို မျက်နှာတစ်ဖက်တည်းကိုပဲ အမြဲ ပြပါတယ်။ | new in 1.3 |
| `io.name` | Io | အိုင်အို | new in 1.3 |
| `io.day` | 1.8 days | ၁.၈ ရက် | new in 1.3 |
| `io.year` | 1.8 days | ၁.၈ ရက် | new in 1.3 |
| `io.blurb` | The most volcanic world in the Solar System, kneaded by Jupiter’s gravity. | ကြာသပတေးရဲ့ ဆွဲအားကြောင့် နေအဖွဲ့အစည်းမှာ မီးတောင် အများဆုံး ကမ္ဘာပါ။ | new in 1.3 |
| `europa.name` | Europa | ယူရိုပါ | new in 1.3 |
| `europa.day` | 3.6 days | ၃.၆ ရက် | new in 1.3 |
| `europa.year` | 3.6 days | ၃.၆ ရက် | new in 1.3 |
| `europa.blurb` | Under its ice lies a salty ocean holding more water than all of Earth’s oceans. | ရေခဲအောက်မှာ ကမ္ဘာ့ သမုဒ္ဒရာအားလုံးထက် ရေပိုများတဲ့ ဆားငန်ရေ သမုဒ္ဒရာ ရှိပါတယ်။ | new in 1.3 |
| `ganymede.name` | Ganymede | ဂန်နီမိဒ် | new in 1.3 |
| `ganymede.day` | 7.2 days | ၇.၂ ရက် | new in 1.3 |
| `ganymede.year` | 7.2 days | ၇.၂ ရက် | new in 1.3 |
| `ganymede.blurb` | The largest moon in the Solar System: bigger than Mercury, with its own magnetic field. | နေအဖွဲ့အစည်းမှာ အကြီးဆုံး လပါ။ ဗုဒ္ဓဟူးထက် ကြီးပြီး ကိုယ်ပိုင် သံလိုက်စက်ကွင်း ရှိပါတယ်။ | new in 1.3 |
| `callisto.name` | Callisto | ကယ်လစ်စတို | new in 1.3 |
| `callisto.day` | 16.7 days | ၁၆.၇ ရက် | new in 1.3 |
| `callisto.year` | 16.7 days | ၁၆.၇ ရက် | new in 1.3 |
| `callisto.blurb` | One of the most cratered surfaces known, barely changed in 4 billion years. | သိထားသမျှထဲမှာ ချိုင့်ခွက် အများဆုံး မျက်နှာပြင်တွေထဲက တစ်ခုပါ။ နှစ်ပေါင်း သန်း ၄,၀၀၀ လောက် မပြောင်းလဲသေးပါ။ | new in 1.3 |
| `titan.name` | Titan | တိုက်တန် | new in 1.3 |
| `titan.day` | 15.9 days | ၁၅.၉ ရက် | new in 1.3 |
| `titan.year` | 15.9 days | ၁၅.၉ ရက် | new in 1.3 |
| `titan.blurb` | The only moon with a thick atmosphere, and lakes of liquid methane under its orange haze. | လေထုထူတဲ့ တစ်ခုတည်းသော လဖြစ်ပြီး လိမ္မော်ရောင် မြူအောက်မှာ အရည် မီသိန်း ရေကန်တွေ ရှိပါတယ်။ | new in 1.3 |
| `pluto.name` | Pluto | ပလူတို | new in 1.3 |
| `pluto.day` | 6.4 days | ၆.၄ ရက် | new in 1.3 |
| `pluto.year` | 248 years | ၂၄၈ နှစ် | new in 1.3 |
| `pluto.blurb` | Called a dwarf planet since 2006. Its heart-shaped plain is a glacier of nitrogen ice. | ၂၀၀၆ ခုနှစ်ကစပြီး ဂြိုဟ်ပုလို့ ခေါ်ပါတယ်။ နှလုံးပုံ လွင်ပြင်က နိုက်ထရိုဂျင် ရေခဲ ရေခဲမြစ်ပါ။ | new in 1.3 |
| `halley.name` | Halley’s Comet | ဟေလီ ကြယ်တံခွန် | new in 1.3 |
| `halley.day` | ~2.2 days | ~၂.၂ ရက် | new in 1.3 |
| `halley.year` | ~76 years | ~၇၆ နှစ် | new in 1.3 |
| `halley.blurb` | Seen every ~76 years since at least 240 BC. Next close to the Sun in July 2061. | ဘီစီ ၂၄၀ ကတည်းက နှစ် ၇၆ နှစ်လောက်မှာ တစ်ခါ မြင်ခဲ့ကြပါတယ်။ နောက်တစ်ခါ ၂၀၆၁ ဇူလိုင်မှာ နေနားကို ပြန်ရောက်ပါမယ်။ | new in 1.3 |

## Month names in dates (12)

Abbreviated, from CLDR's Burmese data (`src/ui/timeFormat.ts`, `MY_MONTHS`); used in the time bar (`၂၀၂၆ အောက် ၂၃`) and the comet's "Next visit" button.

| Month | English | Burmese |
|---|---|---|
| 1 | Jan | ဇန် |
| 2 | Feb | ဖေ |
| 3 | Mar | မတ် |
| 4 | Apr | ဧ |
| 5 | May | မေ |
| 6 | Jun | ဇွန် |
| 7 | Jul | ဇူ |
| 8 | Aug | ဩ |
| 9 | Sep | စက် |
| 10 | Oct | အောက် |
| 11 | Nov | နို |
| 12 | Dec | ဒီ |

## v2.0 – v2.0.1: bases, rockets, landing

### UI strings (39)

| Key | English | Burmese | Since |
|---|---|---|---|
| `visitBase` | Visit {name} | {name} ကို သွားရန် | new in 2.0 |
| `leaveBase` | Back to orbit | ပတ်လမ်းကို ပြန်ရန် | new in 2.0 |
| `baseOn` | On {body} | {body} ပေါ်မှာ | new in 2.0 |
| `gravityHere` | Surface gravity | မျက်နှာပြင် ဆွဲအား | new in 2.0 |
| `theme.launch` | launch center | လွှတ်တင်ရေးစခန်း | new in 2.0 |
| `theme.crater` | surface habitat | မျက်နှာပြင် နေထိုင်ရာ | new in 2.0 |
| `theme.dome` | dome base | အမိုးခုံးစခန်း | new in 2.0 |
| `theme.ice` | under-ice station | ရေခဲအောက် စခန်း | new in 2.0 |
| `theme.shore` | shore base | ကမ်းခြေစခန်း | new in 2.0 |
| `flyTo` | Fly to | ပျံသန်းမည့်နေရာ | new in 2.0 |
| `launch` | Launch | လွှတ်တင်ရန် | new in 2.0 |
| `chooseFirst` | Choose where to fly first | ဘယ်ကို ပျံမလဲ အရင်ရွေးပါ | new in 2.0 |
| `noBaseThere` | {name}: no base to fly to | {name}: ပျံသွားစရာ စခန်း မရှိပါ | new in 2.0 |
| `countdownByHand` | Now 2 fingers, then 1 · Esc aborts | အခု လက်ချောင်း ၂ ချောင်း၊ ပြီးရင် ၁ ချောင်း · Esc ဖျက်ရန် | new in 2.0 |
| `countdownAbort` | Esc aborts | Esc ဖျက်ရန် | new in 2.0 |
| `launchAborted` | Launch aborted | လွှတ်တင်မှု ဖျက်လိုက်ပါပြီ | new in 2.0 |
| `liftoff` | 🚀 Liftoff! | 🚀 လွှတ်တင်ပြီ! | new in 2.0 |
| `flyingTo` | Flying to {name} | {name} ကို ပျံသန်းနေပါတယ် | new in 2.0 |
| `skip` | Skip ⏭ | ကျော်ရန် ⏭ | new in 2.0 |
| `dockHint` | Steer onto the pad: move your hand, the mouse, or ← → ↑ ↓ · Enter: land for me | ပြင်ပေါ်သို့ ထိန်းပါ- လက်၊ မောက်စ် သို့မဟုတ် ← → ↑ ↓ · Enter: အလိုအလျောက် ဆင်းရန် | new in 2.0 |
| `currentBase` | Base | စခန်း | new in 2.0 |
| `fuel` | Fuel | လောင်စာ | new in 2.0 |
| `distance` | Distance | အကွာအဝေး | new in 2.0 |
| `eta` | ETA | ရောက်ရန် | new in 2.0 |
| `miniMap` | Map of the Solar System | နေအဖွဲ့အစည်း မြေပုံ | new in 2.0 |
| `passport` | Passport | ပတ်စ်ပို့ | new in 2.0 |
| `notYet` | Not yet visited | မရောက်ဖူးသေး | new in 2.0 |
| `passportCount` | {n} of {total} bases visited | စခန်း {total} ခုအနက် {n} ခု ရောက်ဖူးပြီ | new in 2.0 |
| `newStamp` | 🛂 New passport stamp: {name}! | 🛂 ပတ်စ်ပို့ တံဆိပ်အသစ်- {name}! | new in 2.0 |
| `steerSensitivity` | Hand steering | လက်ဖြင့် ထိန်းမှု | new in 2.0 |
| `sens.low` | Low | နိမ့် | new in 2.0 |
| `sens.normal` | Normal | ပုံမှန် | new in 2.0 |
| `sens.high` | High | မြင့် | new in 2.0 |
| `autoLand` | Auto-land | အလိုအလျောက် ဆင်းသက် | new in 2.0 |
| `altitude` | Altitude | အမြင့် | new in 2.0 |
| `missedPad` | Missed the pad — try again | ပြင်ကို လွဲသွားပါပြီ — ထပ်ကြိုးစားပါ | new in 2.0 |
| `landedOn` | Touchdown at {name}! | {name} တွင် ဆင်းသက်ပြီ! | new in 2.0 |
| `arrived` | Arrived at {name} | {name} ကို ရောက်ပါပြီ | new in 2.0 |
| `help` | ← → switch · ↑ ↓ zoom · drag rotate · Enter select · Space pause · [ ] speed · B reverse · N now · M moons · V base · A auto-land · J passport · S hand steering · P photo · T true scale · G weight · L language · D debug | ← → ဂြိုဟ်ပြောင်း · ↑ ↓ zoom · drag လှည့် · Enter ရွေး · Space ရပ် · [ ] အမြန်နှုန်း · B နောက်ပြန် · N ယခု · M လများ · V စခန်း · A အလိုအလျောက်ဆင်း · J ပတ်စ်ပို့ · S လက်ဖြင့်ထိန်းမှု · P ဓာတ်ပုံ · T အမှန်အရွယ် · G ကိုယ်အလေးချိန် · L ဘာသာ · D debug | changed in 2.0 |

### Bases (`src/data/bases.ts`, 10)

| Key | English | Burmese |
|---|---|---|
| `cape name` | Cape Launch Center | Cape ဒုံးပျံလွှတ်စခန်း |
| `cape blurb` | Where every trip starts: a launch pad on Florida’s Atlantic coast, near Cape Canaveral. | ခရီးတိုင်း ဒီကစပါတယ်။ Florida ရဲ့ အတ္တလန္တိတ်ကမ်းခြေ Cape Canaveral အနီးက လွှတ်တင်ရေးကွင်းပါ။ |
| `tranquility name` | Tranquility Base | Tranquility စခန်း |
| `tranquility blurb` | A few modules beside the spot where Apollo 11 landed in 1969, on the Sea of Tranquility. | ၁၉၆၉ မှာ Apollo 11 ဆင်းသက်ခဲ့တဲ့ ငြိမ်သက်ခြင်းပင်လယ်ပြင်နားက modules လေးတွေပါ။ |
| `jezero name` | Jezero Dome | Jezero အမိုးခုံး |
| `jezero blurb` | A pressurized dome on the old river delta where the Perseverance rover looks for signs of ancient life. | Perseverance rover က ရှေးဟောင်း သက်ရှိလက္ခဏာ ရှာနေတဲ့ မြစ်ဝကျွန်းပေါ်ဟောင်းပေါ်က လေဖိအားထိန်း အမိုးခုံးပါ။ |
| `conamara name` | Conamara Ice Station | Conamara ရေခဲစခန်း |
| `conamara blurb` | Drills down through the ice shell of Conamara Chaos toward the ocean beneath. | Conamara Chaos ရဲ့ ရေခဲအခွံကို ဖောက်ပြီး အောက်က သမုဒ္ဒရာဆီ တူးနေပါတယ်။ |
| `kraken name` | Kraken Shore | Kraken ကမ်းခြေ |
| `kraken blurb` | On the shore of Kraken Mare, the largest sea of liquid methane on Titan. | တိုက်တန်ပေါ်က အကြီးဆုံး အရည်မီသိန်း ပင်လယ် Kraken Mare ရဲ့ ကမ်းခြေမှာပါ။ |

## v2.0.2: mobile layout

| Key | English | Burmese | Since |
|---|---|---|---|
| `showTimeControls` | Time controls | အချိန် ထိန်းချုပ်မှု | new in 2.0.2 |
| `menu` | Menu | မီနူး | new in 2.0.2 |
| `language` | Language: English | ဘာသာ: မြန်မာ | new in 2.0.2 |
| `shortcuts` | Keyboard shortcuts | ကီးဘုတ် ဖြတ်လမ်းများ | new in 2.0.2 |
| `hidePreview` | Hide camera preview | ကင်မရာ အစမ်းကြည့် ဖျောက်ရန် | new in 2.0.2 |
| `showPreview` | Show camera preview | ကင်မရာ အစမ်းကြည့် ပြရန် | new in 2.0.2 |
| `help` | ← → switch · ↑ ↓ zoom · drag rotate · Enter select · Space pause · [ ] speed · B reverse · N now · M moons · V base · A auto-land · J passport · S hand steering · C camera preview · ? shortcuts · P photo · T true scale · G weight · L language · D debug | ← → ဂြိုဟ်ပြောင်း · ↑ ↓ zoom · drag လှည့် · Enter ရွေး · Space ရပ် · [ ] အမြန်နှုန်း · B နောက်ပြန် · N ယခု · M လများ · V စခန်း · A အလိုအလျောက်ဆင်း · J ပတ်စ်ပို့ · S လက်ဖြင့်ထိန်းမှု · C ကင်မရာ အစမ်းကြည့် · ? ဖြတ်လမ်းများ · P ဓာတ်ပုံ · T အမှန်အရွယ် · G ကိုယ်အလေးချိန် · L ဘာသာ · D debug | changed in 2.0.2 |

## v2.1: Mars showcase base — sky and local time

| Key | English | Burmese | Since |
|---|---|---|---|
| `localTime` | Local solar time | ဒေသ နေအချိန် | new in 2.1 |
| `sunriseSunset` | Sunrise {rise} · Sunset {set} | နေထွက် {rise} · နေဝင် {set} | new in 2.1 |
| `polarDay` | The Sun stays up all day | နေ တစ်နေကုန် မဝင်ပါ | new in 2.1 |
| `polarNight` | The Sun stays down all day | နေ တစ်နေကုန် မထွက်ပါ | new in 2.1 |
| `inTheSky` | In the sky | ကောင်းကင်မှာ | new in 2.1 |
| `skyItem` | {name} {deg}° up | {name} {deg}° အမြင့် | new in 2.1 |
| `horizonView` | Horizon view | မိုးကုပ်စက်ဝိုင်း မြင်ကွင်း | new in 2.1 |
| `leaveHorizon` | Back up | အပေါ်ပြန်တက်ရန် | new in 2.1 |
| `horizonHint` | Drag or move your open hand to look around · ↑ ↓ closer / farther · Esc or O to go back up | ပတ်ကြည့်ရန် ဆွဲပါ (သို့) လက်ဖဝါးကို ရွှေ့ပါ · ↑ ↓ နီး / ဝေး · ပြန်တက်ရန် Esc (သို့) O | new in 2.1 |
| `help` | ← → switch · ↑ ↓ zoom · drag rotate · Enter select · Space pause · [ ] speed · B reverse · N now · M moons · V base · O horizon · A auto-land · J passport · S hand steering · C camera preview · ? shortcuts · P photo · T true scale · G weight · L language · D debug | ← → ဂြိုဟ်ပြောင်း · ↑ ↓ zoom · drag လှည့် · Enter ရွေး · Space ရပ် · [ ] အမြန်နှုန်း · B နောက်ပြန် · N ယခု · M လများ · V စခန်း · O မိုးကုပ်စက်ဝိုင်း · A အလိုအလျောက်ဆင်း · J ပတ်စ်ပို့ · S လက်ဖြင့်ထိန်းမှု · C ကင်မရာ အစမ်းကြည့် · ? ဖြတ်လမ်းများ · P ဓာတ်ပုံ · T အမှန်အရွယ် · G ကိုယ်အလေးချိန် · L ဘာသာ · D debug | changed in 2.1 |
| `skyMoons phobos (src/data/skyMoons.ts)` | Phobos | ဖိုဘော့စ် | new in 2.1 |
| `skyMoons deimos (src/data/skyMoons.ts)` | Deimos | ဒိုင်မို့စ် | new in 2.1 |
| `approximate` | approximate | ခန့်မှန်းခြေ | new in 2.1 |

## v2.1: base building (prototype, ?flags=build)

| Key | English | Burmese | Since |
|---|---|---|---|
| `build` | Build | တည်ဆောက်ရန် | new in 2.1 |
| `buildTitle` | Build (prototype) | တည်ဆောက်ခြင်း (စမ်းသပ်ဗားရှင်း) | new in 2.1 |
| `buildHint` | Tap a cell to preview, tap again to place (or pinch and hold) · drag a module to move it · drag the ground to pan · Q/E turn · Del remove | ကွက်ကို နှိပ်ပြီး ကြိုကြည့်ပါ၊ ထပ်နှိပ်ပြီး ချပါ (သို့) ညှပ်ပြီး ကိုင်ထားပါ · ရွှေ့ရန် module ကို ဆွဲပါ · မြေပြင်ကို ဆွဲပြီး ရွှေ့ကြည့်ပါ · Q/E လှည့် · Del ဖယ် | new in 2.1 |
| `build.habitat` | Habitat | နေထိုင်ရာ | new in 2.1 |
| `build.solar` | Solar array | နေရောင်ခြည်ပြား | new in 2.1 |
| `build.battery` | Battery | ဘက်ထရီ | new in 2.1 |
| `build.oxygen` | Oxygen plant | အောက်ဆီဂျင် စက်ရုံ | new in 2.1 |
| `build.greenhouse` | Greenhouse | ဖန်လုံအိမ် | new in 2.1 |
| `buildInfo.habitat` | Home for the crew: uses 1 kW and 1 O₂. | အဖွဲ့သားများ နေထိုင်ရာ- 1 kW နှင့် O₂ 1 သုံးသည်။ | new in 2.1 |
| `buildInfo.solar` | Up to 4 kW in full sunlight; none at night, less in dusty weather. | နေရောင်အပြည့်တွင် 4 kW အထိ၊ ညတွင် မရ၊ ဖုန်ထူချိန် လျော့သည်။ | new in 2.1 |
| `buildInfo.battery` | Stores 20 kWh of daytime power for the night. | နေ့ဘက် လျှပ်စစ် 20 kWh ကို ညအတွက် သိုလှောင်သည်။ | new in 2.1 |
| `buildInfo.oxygen` | Makes 2 O₂ from the CO₂ air (like MOXIE): uses 1.5 kW. | CO₂ လေထုမှ O₂ 2 ထုတ်သည် (MOXIE ကဲ့သို့)- 1.5 kW သုံးသည်။ | new in 2.1 |
| `buildInfo.greenhouse` | Grows food and makes 1 O₂ with a habitat within 2 cells: uses 0.5 kW. | ကွက် ၂ ကွက်အတွင်း နေထိုင်ရာ ရှိလျှင် အစားအစာ စိုက်ပြီး O₂ 1 ထုတ်သည်- 0.5 kW သုံးသည်။ | new in 2.1 |
| `turn` | Turn | လှည့်ရန် | new in 2.1 |
| `remove` | Remove | ဖယ်ရှားရန် | new in 2.1 |
| `undo` | Undo | နောက်ပြန် | new in 2.1 |
| `redo` | Redo | ပြန်လုပ် | new in 2.1 |
| `reset` | Reset | အစမှ ပြန်စ | new in 2.1 |
| `done` | Done | ပြီးပြီ | new in 2.1 |
| `power` | Power | လျှပ်စစ် | new in 2.1 |
| `poweredAllSol` | ✅ Powered all sol | ✅ တစ်ရက်လုံး လျှပ်စစ် ရှိသည် | new in 2.1 |
| `powerShort` | ⚠️ Power runs out {hours} | ⚠️ {hours} တွင် လျှပ်စစ် ကုန်သည် | new in 2.1 |
| `oxygenOk` | ✅ +{n} to spare | ✅ +{n} ပိုသည် | new in 2.1 |
| `oxygenShort` | ⚠️ Not enough ({n}) | ⚠️ မလုံလောက်ပါ ({n}) | new in 2.1 |
| `greenhouseIdle` | ⚠️ A greenhouse needs a habitat within 2 cells | ⚠️ ဖန်လုံအိမ်သည် ကွက် ၂ ကွက်အတွင်း နေထိုင်ရာ လိုသည် | new in 2.1 |
| `levelLabel` | Level | အဆင့် | new in 2.1 |
| `levelNow` | {now} now · {best} kept | ယခု {now} · သိမ်းထား {best} | new in 2.1 |
| `levelReached` | 🏅 Jezero reached level {n}! | 🏅 Jezero အဆင့် {n} ရောက်ပြီ! | new in 2.1 |
| `baseLevel` | Level {n} | အဆင့် {n} | new in 2.1 |
| `baseFull` | The base is full ({n} modules) | စခန်း ပြည့်နေပြီ (module {n} ခု) | new in 2.1 |
| `cantBuild` | Can't build here: {why} | ဒီမှာ မဆောက်နိုင်ပါ- {why} | new in 2.1 |
| `blocked.outside` | too far out | အလွန် ဝေးသည် | new in 2.1 |
| `blocked.pad` | too close to the landing pad | ဆင်းသက်ပြင်နှင့် နီးလွန်းသည် | new in 2.1 |
| `blocked.building` | a building is there | အဆောက်အအုံ ရှိနေသည် | new in 2.1 |
| `blocked.path` | on a rover or walking path | ရိုဗာ (သို့) လမ်းလျှောက်လမ်းပေါ်တွင် | new in 2.1 |
| `blocked.occupied` | already taken | နေရာ ယူထားပြီး | new in 2.1 |
| `withThis` | With this | ဒါထည့်လျှင် | new in 2.1 |
| `sunlightToday` | Sunlight today: {pct}% | ယနေ့ နေရောင်- {pct}% | new in 2.1 |
| `dustSeason` |  (dust season) |  (ဖုန်ရာသီ) | new in 2.1 |
| `chartLabel` | Battery charge over one sol | တစ်ရက်အတွင်း ဘက်ထရီ အားသွင်းမှု | new in 2.1 |
| `buildTouchHint` | Tap to preview, tap again to place, drag to move | ကြိုကြည့်ရန် နှိပ်ပါ၊ ချရန် ထပ်နှိပ်ပါ၊ ရွှေ့ရန် ဆွဲပါ | new in 2.1 |
| `modelNote` | Simplified game model | ရိုးရှင်းစေထားသော ဂိမ်း မော်ဒယ် | new in 2.1 |
| `modelNoteDetail` | The power, storage and oxygen numbers are chosen to make a fair puzzle, not engineering values. The Sun's daily path, the seasons and the dust season are real. | လျှပ်စစ်၊ သိုလှောင်မှုနှင့် အောက်ဆီဂျင် ကိန်းဂဏန်းများသည် ဂိမ်းအတွက် ရွေးထားခြင်းဖြစ်ပြီး အင်ဂျင်နီယာ တန်ဖိုးများ မဟုတ်ပါ။ နေ၏ နေ့စဉ်လမ်းကြောင်း၊ ရာသီများနှင့် ဖုန်ရာသီမှာ အမှန်ဖြစ်သည်။ | new in 2.1 |

## v2.2: visuals

| Key | English | Burmese | Since |
|---|---|---|---|
| `qualityUltra` | Ultra | အမြင့်ဆုံး | new in 2.2 |
| `ultraTooSlow` | Ultra was too slow here: back to High | Ultra သည် ဤနေရာတွင် နှေးလွန်းသဖြင့် High သို့ ပြန်ပြောင်းပါပြီ | new in 2.2 |

## v2.3 (new, not yet reviewed)

| Key | English | Burmese | Since |
|---|---|---|---|
| `goldenHour` | Golden hour | ရွှေရောင်နာရီ | new in 2.3 |
| `noSunset` | The Sun doesn’t set here in the next few days | နောက်ရက်အနည်းငယ်အတွင်း ဒီမှာ နေမဝင်ပါ | new in 2.3 |
