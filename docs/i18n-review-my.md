# Burmese strings to review (v2.5)

**Status: not yet reviewed.** Every Burmese (my) string the app has that the native-speaker review on 2026-10-24 didn't confirm: **104 strings**, grouped by the screen they're on. Generated on 2026-10-29 from the source. Claude wrote them, not a native speaker.

- **65 were in the app at the review but not in its file.** That file listed only strings added or changed since v1.1.1, and missed a few later ones too (for example `trueScale`, `launchHint`). They include the planets, the status line and the gesture hints.
- **16 are new since the review:** `handControlStart`, `qualityAuto`, `goldenHour`, `noSunset`, the 12 experimental camera-view strings.
- **113 more are new in v2.6**, all in AstroLife 2126 (`?flags=astrolife`): the last section.
- **23 were reviewed but have changed since.** `help` gained `K တည်ဆောက်` (K build). The others were changed on 2026-10-29 to follow the two decisions in the glossary: the landing-pad word, and the spoken style. Under each table is the text that was reviewed.

The 198 strings confirmed on 2026-10-24 aren't repeated here. That file is in git: `git show f9e0fa4:docs/i18n-review-my.md`.

**How to review:** correct the Burmese column in place, or add a note after it. Keep anything in `{braces}` exactly as it is: the app fills in a name, number or date there. Check the glossary first, so the same thing has the same word everywhere. The key is where the string lives: `src/ui/i18n.ts` for UI strings, `src/data/bodies.ts` for planets, `src/ui/gestureHud.ts` for gesture hints.

**On purpose, and worth a second opinion** (as in the last review):

- Technical terms stay in English (Hand tracking, texture, Keyboard mode, Credits, Zoom, HD), as Burmese software UIs often do.
- The app writes numbers in Myanmar digits itself (၂၆.၄ kg). Digits in these strings are part of the text.

## Glossary

The Burmese the app uses now for these terms. Confirm or correct each one; corrections then apply to every string that uses the term.

| Term | Burmese now | Notes | Used in |
|---|---|---|---|
| base | စခန်း | Used the same way everywhere. | `help`, `theme.dome`, `theme.shore`, `noBaseThere`, `currentBase`, `passportCount`, `baseFull`, `tranquility.name` |
| rocket | ဒုံးပျံ | Only in the Cape's name (`Cape ဒုံးပျံလွှတ်စခန်း`). The rest of the UI talks about launching (လွှတ်တင်), not the rocket. | `cape.name` |
| habitat | နေထိုင်ရာ | The same root everywhere. The camera view spells it out as နေထိုင်ရာအဆောက်အအုံများ (habitat buildings). | `cinematic.habitats`, `theme.crater`, `build.habitat`, `buildInfo.greenhouse`, `greenhouseIdle` |
| solar array | နေရောင်ခြည်ပြား | Used once, in Build. | `build.solar` |
| oxygen plant | အောက်ဆီဂျင် စက်ရုံ | Used once, in Build. စက်ရုံ reads as "factory"; is that right for a small plant module? | `build.oxygen` |
| passport | ပတ်စ်ပို့ | Used the same way everywhere. | `help`, `passport`, `newStamp` |
| landing (to land) | ဆင်းသက် | Used the same way everywhere (`autoLand`, `landedOn`, the help line). | `cinematic.landing`, `help`, `dockHint`, `blocked.pad`, `autoLand`, `landedOn`, `tranquility.blurb` |
| landing pad | ဆင်းသက်ကွင်း | **Decided 2026-10-29: this word everywhere**, instead of ပြင် or ဆင်းသက်ပြင်. The Cape's launch pad is a different thing: လွှတ်တင်ရေးကွင်း. | `cinematic.landing`, `dockHint`, `blocked.pad`, `missedPad` |

**Style (decided 2026-10-29):**

- **Sentences use the spoken polite style:** they end in …ပါတယ်, …ပါ or …ပါပြီ, and use the spoken particles နဲ့, မှာ, ရဲ့, ကို and ကနေ. Not the written style: …သည်, နှင့်, တွင်, ၏, သို့, မှ.
- **Short button labels stay plain:** a noun, or a verb with ရန်, without …ပါ. For example `photo` ဓာတ်ပုံ, `save` သိမ်းရန်, `launch` လွှတ်တင်ရန်.

Both rules now apply to every string. Say if any string reads wrong under them.

## Starting up: the status line and hand control (14)

Top of the screen while the app starts, and the hand-control status and its errors.

| Key | English | Burmese | Status |
|---|---|---|---|
| `loading` | Loading hand tracking… | Hand tracking ဖွင့်နေပါတယ်… | not in the last review |
| `loadingTextures` | Loading textures | Texture ဖွင့်နေပါတယ် | not in the last review |
| `loadingHd` | Loading HD textures… | HD texture ဖွင့်နေပါတယ်… | not in the last review |
| `tracking` | Hand control on | လက်ဟန် ထိန်းချုပ်မှု ဖွင့်ထားပါတယ် | not in the last review |
| `handControlStart` | Turn on hand control | လက်ဟန် ထိန်းချုပ်မှု ဖွင့်ရန် | new since the review |
| `keyboardOnly` | Keyboard mode | Keyboard mode | not in the last review |
| `err.denied` | Camera permission denied | Camera ခွင့်ပြုချက် မရပါ | not in the last review |
| `err.not-found` | No camera found | Camera မတွေ့ပါ | not in the last review |
| `err.insecure` | Camera needs HTTPS or localhost | Camera က HTTPS / localhost မှာပဲ ရပါတယ် | not in the last review |
| `err.unsupported` | This browser has no camera support | ဒီ browser က camera မထောက်ပံ့ပါ | not in the last review |
| `err.unknown` | Could not start the camera | Camera ဖွင့်လို့ မရပါ | not in the last review |
| `err.tracker` | Hand tracking failed to load | Hand tracking load မရပါ | not in the last review |
| `err.tracking-stopped` | Hand tracking stopped working | Hand tracking ရပ်သွားပါတယ် | not in the last review |
| `err.disconnected` | Camera disconnected | Camera ချိတ်ဆက်မှု ပြတ်သွားပါတယ် | not in the last review |

## Hand-gesture hints (9)

Shown next to the hand while a gesture is held (hand control on).

| Key | English | Burmese | Status |
|---|---|---|---|
| `flash.switch` | ✌️ detected → switching to {name} | ✌️ → {name} ကို ပြောင်းနေပါတယ် | changed since the review |
| `gesture.rotate` | ✋ Rotate | ✋ လှည့် | not in the last review |
| `gesture.zoom` | 🤏 Zoom | 🤏 Zoom | not in the last review |
| `gesture.swipe` | ✌️ V detected — hold for next · swipe ← → | ✌️ V — ငြိမ်ထား = နောက် · ← → ဝှေ့ | not in the last review |
| `gesture.point` | ☝️ Point & hold | ☝️ ထိုးပြီး ငြိမ်ထား | not in the last review |
| `gesture.pause` | ✊ Hold to pause | ✊ ဆုပ်ထား = ရပ် | not in the last review |
| `gesture.time` | 🤏🤏 Time speed | 🤏🤏 အချိန်အမြန်နှုန်း | not in the last review |
| `gesture.photo` | 🤘 Hold for a photo | 🤘 ဓာတ်ပုံရိုက်ရန် ငြိမ်ထား | not in the last review |
| `gesture.dial` | 🤙 Time dial — tilt ← → | 🤙 အချိန် dial — ← → စောင်းပါ | not in the last review |

Reviewed on 2026-10-24 as:

- `flash.switch`: ✌️ → {name} သို့ ပြောင်းနေပါတယ်

## Footer, menu and keyboard shortcuts (6)

`help` is the shortcuts line behind the ? button on a computer. `ultraTooSlow` appears when Ultra quality gives way to High.

| Key | English | Burmese | Status |
|---|---|---|---|
| `help` | ← → switch · ↑ ↓ zoom · drag rotate · Enter select · Space pause · [ ] speed · B reverse · N now · M moons · V base · O horizon · K build · A auto-land · J passport · S hand steering · C camera preview · ? shortcuts · P photo · T true scale · G weight · L language · D debug | ← → ဂြိုဟ်ပြောင်း · ↑ ↓ zoom · drag လှည့် · Enter ရွေး · Space ရပ် · [ ] အမြန်နှုန်း · B နောက်ပြန် · N ယခု · M လများ · V စခန်း · O မိုးကုပ်စက်ဝိုင်း · K တည်ဆောက် · A အလိုအလျောက်ဆင်း · J ပတ်စ်ပို့ · S လက်ဖြင့်ထိန်းမှု · C ကင်မရာ အစမ်းကြည့် · ? ဖြတ်လမ်းများ · P ဓာတ်ပုံ · T အမှန်အရွယ် · G ကိုယ်အလေးချိန် · L ဘာသာ · D debug | changed since the review |
| `credits` | Credits | Credits | not in the last review |
| `quality` | Quality | အရည်အသွေး | not in the last review |
| `ultraTooSlow` | Ultra was too slow here: back to High | Ultra က ဒီမှာ နှေးလွန်းလို့ High ကို ပြန်ပြောင်းပါပြီ | changed since the review |
| `qualityAuto` | Auto | အလိုအလျောက် | new since the review |
| `trueScale` | True scale | အမှန်အရွယ်အစား | not in the last review |

Reviewed on 2026-10-24 as:

- `help`: ← → ဂြိုဟ်ပြောင်း · ↑ ↓ zoom · drag လှည့် · Enter ရွေး · Space ရပ် · [ ] အမြန်နှုန်း · B နောက်ပြန် · N ယခု · M လများ · V စခန်း · O မိုးကုပ်စက်ဝိုင်း · A အလိုအလျောက်ဆင်း · J ပတ်စ်ပို့ · S လက်ဖြင့်ထိန်းမှု · C ကင်မရာ အစမ်းကြည့် · ? ဖြတ်လမ်းများ · P ဓာတ်ပုံ · T အမှန်အရွယ် · G ကိုယ်အလေးချိန် · L ဘာသာ · D debug (new in it: `K တည်ဆောက်`)
- `ultraTooSlow`: Ultra သည် ဤနေရာတွင် နှေးလွန်းသဖြင့် High သို့ ပြန်ပြောင်းပါပြီ

## Planet labels and info cards (40)

`name` is on the labels and the card, `facts.day` and `facts.year` are in the card's facts (for a moon, `year` is how long it takes to go round its planet), `blurb` is the card's one-line description. `Diameter`, `Day`, `Year` and `Moons` are the facts' headings.

| Key | English | Burmese | Status |
|---|---|---|---|
| `diameter` | Diameter | အချင်း | not in the last review |
| `day` | Day | တစ်ရက် | not in the last review |
| `year` | Year | တစ်နှစ် | not in the last review |
| `moons` | Moons | လ | not in the last review |
| `sun.name` | Sun | နေ | not in the last review |
| `sun.facts.day` | ~27 days | ~၂၇ ရက် | not in the last review |
| `sun.facts.year` | — | — | not in the last review |
| `sun.blurb` | The Sun holds 99.8% of the Solar System’s mass. | နေအဖွဲ့အစည်းရဲ့ ဒြပ်ထု ၉၉.၈% ကို နေတစ်ခုတည်းက ပိုင်ပါတယ်။ | not in the last review |
| `mercury.name` | Mercury | ဗုဒ္ဓဟူး | not in the last review |
| `mercury.facts.day` | 59 days | ၅၉ ရက် | not in the last review |
| `mercury.facts.year` | 88 days | ၈၈ ရက် | not in the last review |
| `mercury.blurb` | The smallest planet and the closest to the Sun. | နေနဲ့ အနီးဆုံးနဲ့ အသေးဆုံး ဂြိုဟ်ပါ။ | not in the last review |
| `venus.name` | Venus | သောကြာ | not in the last review |
| `venus.facts.day` | 243 days | ၂၄၃ ရက် | not in the last review |
| `venus.facts.year` | 225 days | ၂၂၅ ရက် | not in the last review |
| `venus.blurb` | The hottest planet. It spins backwards, and its day is longer than its year. | အပူဆုံး ဂြိုဟ်ပါ။ ပြောင်းပြန်လည်ပြီး တစ်ရက်က တစ်နှစ်ထက် ရှည်ပါတယ်။ | not in the last review |
| `earth.name` | Earth | ကမ္ဘာ | not in the last review |
| `earth.facts.day` | 23.9 hours | ၂၃.၉ နာရီ | not in the last review |
| `earth.facts.year` | 365 days | ၃၆၅ ရက် | not in the last review |
| `earth.blurb` | The only planet known to host life. | အသက်ရှိကြောင်း သိရတဲ့ တစ်ခုတည်းသော ဂြိုဟ်ပါ။ | not in the last review |
| `mars.name` | Mars | အင်္ဂါ | not in the last review |
| `mars.facts.day` | 24.6 hours | ၂၄.၆ နာရီ | not in the last review |
| `mars.facts.year` | 687 days | ၆၈၇ ရက် | not in the last review |
| `mars.blurb` | Home to Olympus Mons, the tallest volcano in the Solar System. | နေအဖွဲ့အစည်းရဲ့ အမြင့်ဆုံးတောင် Olympus Mons ရှိပါတယ်။ | not in the last review |
| `jupiter.name` | Jupiter | ကြာသပတေး | not in the last review |
| `jupiter.facts.day` | 9.9 hours | ၉.၉ နာရီ | not in the last review |
| `jupiter.facts.year` | 11.9 years | ၁၁.၉ နှစ် | not in the last review |
| `jupiter.blurb` | The largest planet. Its Great Red Spot is a storm bigger than Earth. | အကြီးဆုံး ဂြိုဟ်ပါ။ Great Red Spot မုန်တိုင်းက ကမ္ဘာထက် ကြီးပါတယ်။ | not in the last review |
| `saturn.name` | Saturn | စနေ | not in the last review |
| `saturn.facts.day` | 10.7 hours | ၁၀.၇ နာရီ | not in the last review |
| `saturn.facts.year` | 29.4 years | ၂၉.၄ နှစ် | not in the last review |
| `saturn.blurb` | Less dense than water — it would float. | ရေထဲထည့်ရင် ပေါ်နေမယ့်လောက် သိပ်သည်းဆ နည်းပါတယ်။ | not in the last review |
| `uranus.name` | Uranus | ယူရေးနပ်စ် | not in the last review |
| `uranus.facts.day` | 17.2 hours | ၁၇.၂ နာရီ | not in the last review |
| `uranus.facts.year` | 84 years | ၈၄ နှစ် | not in the last review |
| `uranus.blurb` | It rolls around the Sun on its side (98° tilt). | ဘေးစောင်းပြီး လှိမ့်လည်နေတဲ့ ဂြိုဟ်ပါ (၉၈°)။ | not in the last review |
| `neptune.name` | Neptune | နက်ပကျွန်း | not in the last review |
| `neptune.facts.day` | 16.1 hours | ၁၆.၁ နာရီ | not in the last review |
| `neptune.facts.year` | 165 years | ၁၆၅ နှစ် | not in the last review |
| `neptune.blurb` | The windiest planet, with winds over 2,000 km/h. | လေတိုက်နှုန်း အမြန်ဆုံး ဂြိုဟ်ပါ (၂,၀၀၀ km/h ကျော်)။ | not in the last review |

## Base panel (3)

The panel at a base: choosing where to fly, and golden hour.

| Key | English | Burmese | Status |
|---|---|---|---|
| `launchHint` | Or: ← → or point at a world to choose, then Enter, or hold up 3, 2, then 1 fingers. | ဒါမှမဟုတ် ← → သို့မဟုတ် ကမ္ဘာတစ်ခုကို လက်ညှိုးထိုးပြီး ရွေးပါ၊ ပြီးရင် Enter နှိပ်ပါ၊ ဒါမှမဟုတ် လက်ချောင်း ၃၊ ၂၊ ၁ ချောင်း အစဉ်လိုက် ထောင်ပါ။ | not in the last review |
| `goldenHour` | Golden hour | ရွှေရောင်နာရီ | new since the review |
| `noSunset` | The Sun doesn’t set here in the next few days | နောက်ရက်အနည်းငယ်အတွင်း ဒီမှာ နေမဝင်ပါ | new since the review |

## Launch and landing (4)

The countdown, the flight, and steering onto the landing pad.

| Key | English | Burmese | Status |
|---|---|---|---|
| `liftoff` | 🚀 Liftoff! | 🚀 လွှတ်တင်ပါပြီ! | changed since the review |
| `dockHint` | Steer onto the pad: move your hand, the mouse, or ← → ↑ ↓ · Enter: land for me | ဆင်းသက်ကွင်းပေါ်ကို ထိန်းပါ- လက်၊ မောက်စ် ဒါမှမဟုတ် ← → ↑ ↓ · Enter: အလိုအလျောက် ဆင်းရန် | changed since the review |
| `missedPad` | Missed the pad — try again | ဆင်းသက်ကွင်းကို လွဲသွားပါပြီ — ထပ်ကြိုးစားပါ | changed since the review |
| `landedOn` | Touchdown at {name}! | {name} မှာ ဆင်းသက်ပါပြီ! | changed since the review |

Reviewed on 2026-10-24 as:

- `liftoff`: 🚀 လွှတ်တင်ပြီ!
- `dockHint`: ပြင်ပေါ်သို့ ထိန်းပါ- လက်၊ မောက်စ် သို့မဟုတ် ← → ↑ ↓ · Enter: အလိုအလျောက် ဆင်းရန်
- `missedPad`: ပြင်ကို လွဲသွားပါပြီ — ထပ်ကြိုးစားပါ
- `landedOn`: {name} တွင် ဆင်းသက်ပြီ!

## Passport (1)

The passport panel (J).

| Key | English | Burmese | Status |
|---|---|---|---|
| `passportCount` | {n} of {total} bases visited | စခန်း {total} ခုအနက် {n} ခု ရောက်ဖူးပါပြီ | changed since the review |

Reviewed on 2026-10-24 as:

- `passportCount`: စခန်း {total} ခုအနက် {n} ခု ရောက်ဖူးပြီ

## Build at Jezero (only with `?flags=build`) (15)

The Build panel: what each module does, why a cell is blocked, the power and oxygen check.

| Key | English | Burmese | Status |
|---|---|---|---|
| `modelNoteDetail` | The power, storage and oxygen numbers are chosen to make a fair puzzle, not engineering values. The Sun's daily path, the seasons and the dust season are real. | လျှပ်စစ်၊ သိုလှောင်မှုနဲ့ အောက်ဆီဂျင် ကိန်းဂဏန်းတွေက ဂိမ်းအတွက် ရွေးထားတာဖြစ်ပြီး အင်ဂျင်နီယာ တန်ဖိုးတွေ မဟုတ်ပါဘူး။ နေရဲ့ နေ့စဉ်လမ်းကြောင်း၊ ရာသီတွေနဲ့ ဖုန်ရာသီကတော့ အမှန်ပါ။ | changed since the review |
| `buildInfo.habitat` | Home for the crew: uses 1 kW and 1 O₂. | အဖွဲ့သားတွေ နေထိုင်ရာ- 1 kW နဲ့ O₂ 1 သုံးပါတယ်။ | changed since the review |
| `buildInfo.solar` | Up to 4 kW in full sunlight; none at night, less in dusty weather. | နေရောင်အပြည့်မှာ 4 kW အထိ ရပါတယ်၊ ညမှာ မရပါဘူး၊ ဖုန်ထူချိန်မှာ လျော့ပါတယ်။ | changed since the review |
| `buildInfo.battery` | Stores 20 kWh of daytime power for the night. | နေ့ဘက် လျှပ်စစ် 20 kWh ကို ညအတွက် သိုလှောင်ပါတယ်။ | changed since the review |
| `buildInfo.oxygen` | Makes 2 O₂ from the CO₂ air (like MOXIE): uses 1.5 kW. | CO₂ လေထုကနေ O₂ 2 ထုတ်ပါတယ် (MOXIE လိုမျိုး)- 1.5 kW သုံးပါတယ်။ | changed since the review |
| `buildInfo.greenhouse` | Grows food and makes 1 O₂ with a habitat within 2 cells: uses 0.5 kW. | ကွက် ၂ ကွက်အတွင်းမှာ နေထိုင်ရာ ရှိရင် အစားအစာ စိုက်ပြီး O₂ 1 ထုတ်ပါတယ်- 0.5 kW သုံးပါတယ်။ | changed since the review |
| `poweredAllSol` | ✅ Powered all sol | ✅ တစ်ရက်လုံး လျှပ်စစ် ရှိပါတယ် | changed since the review |
| `powerShort` | ⚠️ Power runs out {hours} | ⚠️ {hours} မှာ လျှပ်စစ် ကုန်ပါတယ် | changed since the review |
| `oxygenOk` | ✅ +{n} to spare | ✅ +{n} ပိုပါတယ် | changed since the review |
| `greenhouseIdle` | ⚠️ A greenhouse needs a habitat within 2 cells | ⚠️ ဖန်လုံအိမ်က ကွက် ၂ ကွက်အတွင်းမှာ နေထိုင်ရာ လိုပါတယ် | changed since the review |
| `levelReached` | 🏅 Jezero reached level {n}! | 🏅 Jezero အဆင့် {n} ရောက်ပါပြီ! | changed since the review |
| `blocked.outside` | too far out | ဝေးလွန်းပါတယ် | changed since the review |
| `blocked.pad` | too close to the landing pad | ဆင်းသက်ကွင်းနဲ့ နီးလွန်းပါတယ် | changed since the review |
| `blocked.building` | a building is there | အဆောက်အအုံ ရှိနေပါတယ် | changed since the review |
| `blocked.path` | on a rover or walking path | ရိုဗာ (သို့) လမ်းလျှောက်လမ်းပေါ်မှာ | changed since the review |

Reviewed on 2026-10-24 as:

- `modelNoteDetail`: လျှပ်စစ်၊ သိုလှောင်မှုနှင့် အောက်ဆီဂျင် ကိန်းဂဏန်းများသည် ဂိမ်းအတွက် ရွေးထားခြင်းဖြစ်ပြီး အင်ဂျင်နီယာ တန်ဖိုးများ မဟုတ်ပါ။ နေ၏ နေ့စဉ်လမ်းကြောင်း၊ ရာသီများနှင့် ဖုန်ရာသီမှာ အမှန်ဖြစ်သည်။
- `buildInfo.habitat`: အဖွဲ့သားများ နေထိုင်ရာ- 1 kW နှင့် O₂ 1 သုံးသည်။
- `buildInfo.solar`: နေရောင်အပြည့်တွင် 4 kW အထိ၊ ညတွင် မရ၊ ဖုန်ထူချိန် လျော့သည်။
- `buildInfo.battery`: နေ့ဘက် လျှပ်စစ် 20 kWh ကို ညအတွက် သိုလှောင်သည်။
- `buildInfo.oxygen`: CO₂ လေထုမှ O₂ 2 ထုတ်သည် (MOXIE ကဲ့သို့)- 1.5 kW သုံးသည်။
- `buildInfo.greenhouse`: ကွက် ၂ ကွက်အတွင်း နေထိုင်ရာ ရှိလျှင် အစားအစာ စိုက်ပြီး O₂ 1 ထုတ်သည်- 0.5 kW သုံးသည်။
- `poweredAllSol`: ✅ တစ်ရက်လုံး လျှပ်စစ် ရှိသည်
- `powerShort`: ⚠️ {hours} တွင် လျှပ်စစ် ကုန်သည်
- `oxygenOk`: ✅ +{n} ပိုသည်
- `greenhouseIdle`: ⚠️ ဖန်လုံအိမ်သည် ကွက် ၂ ကွက်အတွင်း နေထိုင်ရာ လိုသည်
- `levelReached`: 🏅 Jezero အဆင့် {n} ရောက်ပြီ!
- `blocked.outside`: အလွန် ဝေးသည်
- `blocked.pad`: ဆင်းသက်ပြင်နှင့် နီးလွန်းသည်
- `blocked.building`: အဆောက်အအုံ ရှိနေသည်
- `blocked.path`: ရိုဗာ (သို့) လမ်းလျှောက်လမ်းပေါ်တွင်

## Camera views at Jezero (experimental, only with `?flags=cinematic`) (12)

Not shown to visitors yet. Review last.

| Key | English | Burmese | Status |
|---|---|---|---|
| `cinematic.title` | Camera views (experimental) | ကင်မရာမြင်ကွင်းများ (စမ်းသပ်ဆဲ) | new since the review |
| `cinematic.view` | Camera viewpoint | ကင်မရာရှုထောင့် | new since the review |
| `cinematic.manual` | Manual camera | ကင်မရာကို ကိုယ်တိုင်ထိန်းချုပ်ရန် | new since the review |
| `cinematic.overview` | Colony overview | စခန်းတစ်ခုလုံး မြင်ကွင်း | new since the review |
| `cinematic.habitats` | Habitat inspection | နေထိုင်ရာအဆောက်အအုံများကို ကြည့်ရန် | new since the review |
| `cinematic.landing` | Landing platform reveal | ဆင်းသက်ကွင်းကို ကြည့်ရန် | new since the review |
| `cinematic.garage` | Rover garage inspection | Rover ကားရုံကို ကြည့်ရန် | new since the review |
| `cinematic.panorama` | Golden hour panorama | နေဝင်ချိန် မြင်ကွင်းကျယ် | new since the review |
| `cinematic.flyover` | Start flyover | အပေါ်မှ လှည့်လည်ကြည့်ရန် | new since the review |
| `cinematic.skip` | Skip animation | လှုပ်ရှားမှုကို ကျော်ရန် | new since the review |
| `cinematic.exit` | Exit cinematic mode | ကင်မရာမြင်ကွင်းမုဒ်မှ ထွက်ရန် | new since the review |
| `cinematic.active` | Camera view active — use Manual camera to return. | ကင်မရာမြင်ကွင်း ဖွင့်ထားပါတယ်။ ပြန်ထွက်ဖို့ ကိုယ်တိုင်ထိန်းချုပ်မှုကို ရွေးပါ။ | new since the review |

## AstroLife 2126 (only with `?flags=astrolife`) (113)

Added in v2.6, 2026-10-30: the travel app's screens (`src/shell/strings.ts`), the destinations' taglines (`src/travel/destinations.ts`) and the explorer's "Hand control paused" (`src/ui/i18n.ts`). Not shown to visitors without the flag. Claude wrote them in the spoken polite style the glossary asks for; none has been read by a native speaker.

New terms, to settle first (each is used the same way throughout):

| Term | Burmese now | Notes |
|---|---|---|
| nickname | နာမည်ပြောင် | The field is "Nickname" on purpose: it appears in a shareable link (`docs/decisions.md`, entry 22). |
| destinations | ခရီးဆုံးများ | The tab and its screen. |
| boarding pass, booking, check-in, souvenir link | (English) | Kept in English, like other technical terms. Should any be Burmese? |
| spaceport | အာကာသဆိပ် | In the journey hint only. |
| journey stamp | ခရီးစဉ် တံဆိပ် | The passport's word for stamp is တံဆိပ်, as in the explorer's passport. |
| fictional / real | စိတ်ကူးယဉ် / တကယ့်တန်ဖိုး | Tags beside made-up and real numbers. |

| Key | English | Burmese | Status |
|---|---|---|---|
| `shell.sections` | AstroLife sections | AstroLife အပိုင်းများ | new in v2.6 |
| `nav.home` | Home | ပင်မ | new in v2.6 |
| `nav.destinations` | Destinations | ခရီးဆုံးများ | new in v2.6 |
| `nav.passport` | Passport | ပတ်စ်ပို့ | new in v2.6 |
| `passport.kicker` | Galactic passport | ဂလက်ဆီ ပတ်စ်ပို့ | new in v2.6 |
| `passport.title` | Your passport | သင့် ပတ်စ်ပို့ | new in v2.6 |
| `passport.count` | {n} of {total} destinations stamped | ခရီးဆုံး {total} ခုမှာ {n} ခု တံဆိပ်ရပြီး | new in v2.6 |
| `passport.empty` | No stamps yet. Fly a booked journey to the end to earn your first. | တံဆိပ် မရသေးပါ။ Booking လုပ်ထားတဲ့ ခရီးစဉ်ကို အဆုံးထိ ပျံသန်းပြီး ပထမဆုံး တံဆိပ်ကို ရယူပါ။ | new in v2.6 |
| `passport.arrived` | Arrived {date} | {date} ရောက်ရှိ | new in v2.6 |
| `passport.forget` | Forget AstroLife on this device | ဒီစက်ထဲက AstroLife ကို ဖျက်ရန် | new in v2.6 |
| `passport.forgetSure` | Delete every booking, pass and stamp? Press again to confirm. | Booking၊ pass နဲ့ တံဆိပ် အားလုံးကို ဖျက်မလား။ အတည်ပြုဖို့ ထပ်နှိပ်ပါ။ | new in v2.6 |
| `passport.forgetNote` | Everything AstroLife keeps is on this device only. | AstroLife က သိမ်းထားတာ အားလုံး ဒီစက်ထဲမှာပဲ ရှိပါတယ်။ | new in v2.6 |
| `postcard.make` | Make a postcard | Postcard ပြုလုပ်ရန် | new in v2.6 |
| `postcard.from` | Greetings from {place} | {place} က နှုတ်ခွန်းဆက်ပါတယ် | new in v2.6 |
| `postcard.flew` | {nick} flew {route} | {nick} က {route} ကို ပျံသန်းခဲ့ပါတယ် | new in v2.6 |
| `postcard.departed` | Departed {date} · {flight} | {date} ထွက်ခွာ · {flight} | new in v2.6 |
| `postcard.footer` | AstroLife 2126 · a fictional simulation | AstroLife 2126 · စိတ်ကူးယဉ် simulation | new in v2.6 |
| `postcard.alt` | Postcard from {place} | {place} က postcard | new in v2.6 |
| `postcard.save` | Save postcard | Postcard သိမ်းရန် | new in v2.6 |
| `postcard.share` | Share postcard | Postcard မျှဝေရန် | new in v2.6 |
| `back` | Back | နောက်သို့ | new in v2.6 |
| `explore` | Open the explorer | Explorer ကို ဖွင့်ရန် | new in v2.6 |
| `toHub` | Back to AstroLife 2126 | AstroLife 2126 သို့ ပြန်ရန် | new in v2.6 |
| `simNotice` | Every journey, fare and timetable here is a fictional simulation set in 2126. Nothing is booked for real, and it all stays on this device. | ဒီမှာပါတဲ့ ခရီးစဉ်၊ ခရီးစရိတ်နဲ့ အချိန်ဇယား အားလုံးဟာ ၂၁၂၆ ခုနှစ်မှာ ဖြစ်မယ့် စိတ်ကူးယဉ် simulation ပါ။ တကယ် booking မလုပ်ပါဘူး၊ အားလုံး ဒီစက်ထဲမှာပဲ ရှိပါတယ်။ | new in v2.6 |
| `hub.kicker` | Space travel, 2126 | အာကာသခရီး၊ ၂၁၂၆ | new in v2.6 |
| `hub.title` | Where to next? | နောက်ထပ် ဘယ်ကို သွားမလဲ။ | new in v2.6 |
| `hub.lead` | Choose a world, book a seat on a fictional liner, fly there in 3D, and keep the stamp. | ကမ္ဘာတစ်ခု ရွေးပါ၊ စိတ်ကူးယဉ် အာကာသယာဉ်မှာ ထိုင်ခုံ booking လုပ်ပါ၊ 3D နဲ့ ပျံသန်းပြီး တံဆိပ်ကို သိမ်းထားပါ။ | new in v2.6 |
| `hub.featured` | Featured journey | အထူးခရီးစဉ် | new in v2.6 |
| `hub.seeJourney` | See the journey | ခရီးစဉ်ကို ကြည့်ရန် | new in v2.6 |
| `hub.allDestinations` | All destinations | ခရီးဆုံး အားလုံး | new in v2.6 |
| `hours` | {n} hours | {n} နာရီ | new in v2.6 |
| `days` | {n} days | {n} ရက် | new in v2.6 |
| `journeyBy` | {time} by fusion liner | Fusion အာကာသယာဉ်နဲ့ {time} | new in v2.6 |
| `fictional` | fictional | စိတ်ကူးယဉ် | new in v2.6 |
| `dest.lead` | Every journey leaves from {spaceport}, on Earth. | ခရီးစဉ်တိုင်း ကမ္ဘာပေါ်က {spaceport} ကနေ ထွက်ပါတယ်။ | new in v2.6 |
| `dest.bookable` | Booking open | Booking ဖွင့်ထားပါတယ် | new in v2.6 |
| `dest.exploreOnly` | Explore now · booking later | အခု လေ့လာနိုင်ပါတယ် · booking နောက်မှ | new in v2.6 |
| `dest.journey` | Journey from {spaceport} | {spaceport} ကနေ ခရီးချိန် | new in v2.6 |
| `dest.distance` | From Earth today | ဒီနေ့ ကမ္ဘာကနေ အကွာအဝေး | new in v2.6 |
| `dest.real` | real | တကယ့်တန်ဖိုး | new in v2.6 |
| `dest.explore` | Explore in 3D | 3D နဲ့ လေ့လာရန် | new in v2.6 |
| `dest.details` | Details | အသေးစိတ် | new in v2.6 |
| `dest.book` | Book this journey | ဒီခရီးစဉ်ကို booking လုပ်ရန် | new in v2.6 |
| `book.step` | Step {n} of 3 | အဆင့် {n} / ၃ | new in v2.6 |
| `book.traveller` | Who’s travelling? | ဘယ်သူ ခရီးသွားမလဲ။ | new in v2.6 |
| `book.name` | Nickname | နာမည်ပြောင် | new in v2.6 |
| `book.nameHint` | Shown on your boarding pass and in its souvenir link, so pick a nickname, not your real name. It stays on this device until you share it. | Boarding pass နဲ့ souvenir link မှာ ပြပါမယ်။ ဒါကြောင့် နာမည်အရင်း မဟုတ်ဘဲ နာမည်ပြောင်ကို ရွေးပါ။ မမျှဝေမချင်း ဒီစက်ထဲမှာပဲ ရှိပါတယ်။ | new in v2.6 |
| `book.avatar` | Avatar | Avatar | new in v2.6 |
| `book.avatarN` | Avatar {n} | Avatar {n} | new in v2.6 |
| `book.trip` | Departure and cabin | ထွက်ခွာချိန်နဲ့ အခန်း | new in v2.6 |
| `book.departure` | Departure | ထွက်ခွာချိန် | new in v2.6 |
| `book.cabin` | Cabin | အခန်း | new in v2.6 |
| `book.window` | Liners leave in the next Earth–Mars launch window, around {date}: real, from the planets’ positions. The {days}-day crossing is fiction. | အာကာသယာဉ်တွေက {date} ဝန်းကျင် နောက်ထပ် ကမ္ဘာ–အင်္ဂါ လွှတ်တင်ချိန်မှာ ထွက်ပါတယ်။ ဒါက ဂြိုဟ်တွေရဲ့ တည်နေရာအရ တကယ့်အချိန်ပါ။ {days} ရက် ခရီးကတော့ စိတ်ကူးယဉ်ပါ။ | new in v2.6 |
| `book.review` | Check and confirm | စစ်ပြီး အတည်ပြုပါ | new in v2.6 |
| `book.fare` | Fare | ခရီးစရိတ် | new in v2.6 |
| `book.free` | No payment: fares are part of the simulation. | ငွေပေးစရာ မလိုပါ။ ခရီးစရိတ်တွေက simulation ရဲ့ အစိတ်အပိုင်းပါ။ | new in v2.6 |
| `book.next` | Continue | ဆက်သွားရန် | new in v2.6 |
| `book.confirm` | Confirm booking | Booking အတည်ပြုရန် | new in v2.6 |
| `book.active` | You already have a journey booked. Cancel it to book another. | ခရီးစဉ်တစ်ခု booking လုပ်ထားပြီးပါပြီ။ နောက်တစ်ခု လုပ်ဖို့ အရင်ဟာကို ပယ်ဖျက်ပါ။ | new in v2.6 |
| `book.failed` | That booking couldn’t be made. Check the steps before this one. | ဒီ booking ကို လုပ်လို့ မရပါ။ အရင်အဆင့်တွေကို ပြန်စစ်ပါ။ | new in v2.6 |
| `fare` | {n} credits | Credit {n} | new in v2.6 |
| `err.name.empty` | Enter a nickname for your boarding pass. | Boarding pass အတွက် နာမည်ပြောင် ထည့်ပါ။ | new in v2.6 |
| `err.name.long` | Use {max} characters or fewer. | စာလုံး {max} လုံးထက် မပိုပါစေနဲ့။ | new in v2.6 |
| `err.name.chars` | Use letters, numbers, emoji, spaces and . ’ - only. | စာလုံး၊ ဂဏန်း၊ emoji၊ space နဲ့ . ’ - ကိုပဲ သုံးပါ။ | new in v2.6 |
| `pass.checkIn` | Check in | Check-in လုပ်ရန် | new in v2.6 |
| `pass.checkInHint` | Checking in issues your boarding pass. Nothing is sent anywhere. | Check-in လုပ်ရင် boarding pass ရပါမယ်။ ဘာမှ ဘယ်ကိုမှ မပို့ပါဘူး။ | new in v2.6 |
| `pass.title` | Boarding pass | Boarding pass | new in v2.6 |
| `pass.qr` | Souvenir QR code: opens this pass as a keepsake on any phone | Souvenir QR code: ဘယ်ဖုန်းမှာမဆို ဒီ pass ကို အမှတ်တရအဖြစ် ဖွင့်ပါတယ် | new in v2.6 |
| `pass.qrNote` | A keepsake, not a ticket. It holds your nickname, avatar, flight and cabin, nothing else, and anyone you share it with can see them. | လက်မှတ် မဟုတ်ဘဲ အမှတ်တရ ပစ္စည်းပါ။ နာမည်ပြောင်၊ avatar၊ ခရီးစဉ်နဲ့ အခန်းပဲ ပါပြီး မျှဝေလိုက်တဲ့သူတိုင်း မြင်နိုင်ပါတယ်။ | new in v2.6 |
| `pass.copy` | Copy souvenir link | Souvenir link ကူးယူရန် | new in v2.6 |
| `pass.copied` | Copied | ကူးယူပြီးပါပြီ | new in v2.6 |
| `pass.date` | Departs | ထွက်ခွာချိန် | new in v2.6 |
| `souvenir.kicker` | Souvenir boarding pass | အမှတ်တရ boarding pass | new in v2.6 |
| `souvenir.title` | {nick}’s journey to {to} | {nick} ရဲ့ {to} ခရီးစဉ် | new in v2.6 |
| `souvenir.note` | A keepsake from AstroLife 2126, opened from a link. It isn’t a ticket, and nothing about it was sent anywhere. | Link ကနေ ဖွင့်ထားတဲ့ AstroLife 2126 အမှတ်တရပါ။ လက်မှတ် မဟုတ်ပါဘူး၊ ဘာမှ ဘယ်ကိုမှ မပို့ထားပါဘူး။ | new in v2.6 |
| `journey.begin` | Begin journey | ခရီးစဉ် စတင်ရန် | new in v2.6 |
| `journey.resume` | Resume journey | ခရီးစဉ် ဆက်ရန် | new in v2.6 |
| `journey.beginHint` | Opens the explorer at the spaceport. For the journey the clock jumps to your departure, {date}, and when you leave the journey it goes back to where you had it. Dates and flight are a simulation. | အာကာသဆိပ်မှာ explorer ကို ဖွင့်ပါမယ်။ ခရီးစဉ်အတွင်း နာရီက ထွက်ခွာချိန် {date} ဆီ ခုန်ပြီး ခရီးစဉ်က ထွက်တဲ့အခါ အရင်အတိုင်း ပြန်ဖြစ်ပါမယ်။ ရက်စွဲနဲ့ ပျံသန်းမှုက simulation ပါ။ | new in v2.6 |
| `journey.sim` | Simulation | Simulation | new in v2.6 |
| `journey.ready` | {ref} · {route} · ready: {launch} when you are | {ref} · {route} · အသင့်ပါ: အဆင်သင့်ရင် {launch} | new in v2.6 |
| `journey.flying` | {ref} · on the way to {to} | {ref} · {to} ကို သွားနေပါတယ် | new in v2.6 |
| `journey.arrived` | {ref} · arrived at {to} · journey stamp collected | {ref} · {to} ကို ရောက်ပါပြီ · ခရီးစဉ် တံဆိပ် ရပါပြီ | new in v2.6 |
| `journey.stamped` | Journey complete: your {to} stamp is in AstroLife | ခရီးစဉ် ပြီးပါပြီ: {to} တံဆိပ်က AstroLife မှာ ရှိပါတယ် | new in v2.6 |
| `journey.complete` | Journey complete: stamp collected | ခရီးစဉ် ပြီးဆုံးပါပြီ: တံဆိပ် ရပါပြီ | new in v2.6 |
| `souvenir.start` | Plan your own journey | ကိုယ်ပိုင် ခရီးစဉ် စီစဉ်ရန် | new in v2.6 |
| `cabin.pod` | Sleeper pod | အိပ်စင် pod | new in v2.6 |
| `cabin.podText` | Sleep through most of the trip. | ခရီးအများစုကို အိပ်ပြီး ဖြတ်သန်းပါ။ | new in v2.6 |
| `cabin.window` | Window cabin | ပြတင်းပေါက် အခန်း | new in v2.6 |
| `cabin.windowText` | Your own porthole on the stars. | ကြယ်တွေကို မြင်ရတဲ့ ကိုယ်ပိုင် ပြတင်းပေါက်။ | new in v2.6 |
| `cabin.suite` | Observation suite | ကြည့်ရှုရေး suite | new in v2.6 |
| `cabin.suiteText` | A dome to watch {world} grow closer. | {world} နီးလာတာကို ကြည့်ဖို့ အမိုးခုံး။ | new in v2.6 |
| `trip.title` | Your journey | သင့်ခရီးစဉ် | new in v2.6 |
| `trip.confirmed` | Booking confirmed | Booking အတည်ပြုပြီးပါပြီ | new in v2.6 |
| `trip.ref` | Booking reference | Booking နံပါတ် | new in v2.6 |
| `trip.traveller` | Traveller | ခရီးသည် | new in v2.6 |
| `trip.route` | Route | လမ်းကြောင်း | new in v2.6 |
| `trip.flight` | Flight | ခရီးစဉ် | new in v2.6 |
| `trip.status` | Status | အခြေအနေ | new in v2.6 |
| `trip.view` | View booking | Booking ကြည့်ရန် | new in v2.6 |
| `trip.cancel` | Cancel booking | Booking ပယ်ဖျက်ရန် | new in v2.6 |
| `trip.cancelSure` | Cancel this booking? Press again to confirm. | ဒီ booking ကို ပယ်ဖျက်မလား။ အတည်ပြုဖို့ ထပ်နှိပ်ပါ။ | new in v2.6 |
| `trip.keep` | Keep it | မဖျက်ပါ | new in v2.6 |
| `trip.notSaved` | This device didn’t let the booking be saved: it lasts until you close the page. | ဒီစက်က booking ကို သိမ်းခွင့် မပေးပါ။ စာမျက်နှာ ပိတ်တဲ့အထိပဲ ရှိပါမယ်။ | new in v2.6 |
| `status.confirmed` | Confirmed | အတည်ပြုပြီး | new in v2.6 |
| `status.checkedIn` | Checked in | Check-in လုပ်ပြီး | new in v2.6 |
| `status.inJourney` | On the way | ခရီးသွားနေဆဲ | new in v2.6 |
| `status.completed` | Arrived | ရောက်ပါပြီ | new in v2.6 |
| `status.cancelled` | Cancelled | ပယ်ဖျက်ပြီး | new in v2.6 |
| `jezero.tagline` | Red-dust sunsets over an ancient river delta. | ရှေးဟောင်း မြစ်ဝကျွန်းပေါ်ပေါ်က နီရဲတဲ့ ဖုန်မှုန့် နေဝင်ချိန်တွေ။ | new in v2.6 |
| `tranquility.tagline` | A weekend on the Sea of Tranquility, with Earth in the sky. | ကောင်းကင်မှာ ကမ္ဘာကို မြင်ရတဲ့ ငြိမ်သက်ခြင်းပင်လယ်ပြင်မှာ စနေ၊ တနင်္ဂနွေ။ | new in v2.6 |
| `conamara.tagline` | Ice cliffs above a hidden ocean, under giant Jupiter. | ကြီးမားတဲ့ ကြာသပတေးအောက်၊ ဝှက်ထားတဲ့ သမုဒ္ဒရာအပေါ်က ရေခဲချောက်ကမ်းပါးတွေ။ | new in v2.6 |
| `kraken.tagline` | Methane seas under an orange sky. | လိမ္မော်ရောင် ကောင်းကင်အောက်က မီသိန်း ပင်လယ်တွေ။ | new in v2.6 |
| `handControlPaused` | Hand control paused | လက်ဟန် ထိန်းချုပ်မှု ခဏရပ်ထားပါတယ် | new in v2.6 |
