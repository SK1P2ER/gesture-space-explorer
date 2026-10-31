# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## 2.6.0 — 2026-10-31

AstroLife 2126 behind `?flags=astrolife`, and the polish and upkeep prepared as 2.5.0. 2.5.0 was prepared but not released; its changes ship here.

### Added

- `?reset`, for user tests: forgets everything the app saved on this device (settings, quality and Auto's memory, passport, weight, Build layouts), so a tester starts as a first-time visitor. Nothing is sent or shown; `reset` drops out of the address.

### Changed

- Burmese: the landing pad is ဆင်းသက်ကွင်း everywhere, and sentences use the spoken polite style (…ပါတယ် / …ပါ), as most of the app already did. Build, landing and a few messages were in the written style (…သည်).
- Development: the three.js fix for graphics resets is applied by `patch-package` on install, and its tests run in CI; the frame loop runs in named phases, in the same order as before (no change in behavior).

### Performance

- The Builder (`?flags=build`) and the camera views (`?flags=cinematic`) load only with their flag: about 7 kB less JavaScript to parse without flags (0.3 kB gzipped; textures remain the real startup cost).

### Experimental (behind `?flags=`)

- `?flags=astrolife`: **AstroLife 2126**, a fictional space-travel app around the explorer (`docs/decisions.md`, entry 21). It opens on its own hub over the live scene, with four destinations to read about and explore, and a booking for Cape → Jezero (nickname, departure, cabin, confirm; a booking can be cancelled, and one journey is under way at a time). Checking in issues a boarding pass whose QR code is a souvenir link: the pass travels after the `#`, so it never reaches a server, and any phone opens it as a keepsake. Boarding opens the explorer at the spaceport on the departure date (from the next real Earth–Mars launch window: March 2127), labelled "Simulation"; landing at Jezero completes the journey and earns its stamp, once, and leaving the journey gives back your own date and speed. The passport holds one stamp per completed journey; a completed journey makes a postcard (a 1600 × 1000 PNG of the scene, the greeting and the stamp) to save or share; and the passport can forget everything AstroLife keeps on the device. Fares and timetables are fiction, and nothing is paid; the camera is asked for only when the explorer opens, and stopped again on the way back to the hub. Everything stays on the device. Without the flag nothing of it is downloaded.

## 2.4.0 — 2026-10-29

### Added

- **Jezero, rebuilt (Mars Base 2.0, first part):** redesigned habitat modules with more detail, a more detailed landing platform, and upgraded rovers, garage, solar field and communications. On by default.
- **`?debug` report:** the debug lines now show without a camera too, with a 📋 Copy report button that copies the link, the device and the lines (local only; nothing is sent).
- **Auto quality** (the new default): capable phones now get High, so they see the v2.2/v2.3 visuals, while weak devices stay smooth. Phones start on Low and try High when there's headroom, keeping it unless more than ~5% of frames come late for the screen's refresh rate; High is watched the same way on every device. Auto never picks Ultra, changes tier only in the overview, a body or a base at rest, and remembers what it learned per device and app version. The Quality button cycles Auto → Low → High → Ultra (desktop) → Auto; a saved fixed choice stays fixed.
- **Resolution scaling:** the render resolution follows the frame rate under the chosen Quality tier, aiming for the display's refresh rate (never below 60 fps): down in 10% steps to 60% of the tier's pixel ratio when frames stay slow, back up when there is headroom, and a step that doesn't help is undone. Resolution only (no texture, shader or effect changes); desktop never goes below 1× its monitor. `?debug` shows the live scale.
- **Deep links:** `?body=saturn`, `?base=jezero&view=horizon`, `&date=2061-07-28` (opens paused at that moment) and `&lang=ja` open a view directly, and the address bar follows as you explore (without filling Back), so copying it shares what's on screen; the photo Share sheet includes the link. Anything unknown is ignored.
- **CI release gate:** every PR runs typecheck, unit tests, the build and 14 browser smoke tests on the built app; Vercel previews get the same smoke tests (`docs/ci.md`).

### Fixed

- After the browser resets its graphics (a WebGL context loss), the scene recovers without textures or uploads left over from the lost context.
- No stale planet textures or texture requests after quality changes; Jezero's sky and borrowed maps are released and refreshed correctly.
- Jezero's shadows and shader warm-up stay correct across quality changes.
- On phones, the base panel and the Builder's controls stay usable beside the footer.
- Debug shortcuts respect keyboard ownership like the scene's shortcuts.
- Ultra no longer drops to High after a tab switch or on the stall of switching to Ultra itself.
- An impossible base view (no base) recovers to SolarView once, reported in the console and `?debug`, instead of throwing from every frame.
- The base panel updates in place, so focus, scrolling and taps survive its minute tick, and screen readers no longer re-read it every minute.
- An unreferenced 2.4 MB video no longer ships.

### Performance

- Build mode reads the Build panel's size with a `ResizeObserver`: one style recalculation fewer per frame, about 0.2 ms of a ~2.2 ms median frame on an RTX 4060 laptop.

### Experimental (behind `?flags=`)

- `?flags=cinematic`: a cinematic camera at Jezero (presets, a flyover, a golden-hour panorama).
- `?flags=operations`: lightweight base operations at Jezero (moving rovers, doors, panels).
- `?flags=build`: the Builder, as before.

## 2.3.1 — 2026-10-29

A maintenance release: the webcam is always released when hand tracking fails, and six reported defects are fixed.

### Added

- **🖐 Turn on hand control:** in keyboard mode the status pill offers a button that starts the camera and hand tracking again, after back/forward navigation, a disconnect, a denied or missing camera, or a tracker failure, so a reload is never needed. It isn't shown without HTTPS or camera support, and the camera is never reopened without it.

### Fixed

- **Privacy:** the webcam stays on no longer. When the hand-tracking model fails to load, detection fails, or startup is cancelled or replaced, every camera track is stopped and the preview is detached. Leaving the page (pagehide) releases the camera too.
- A camera disconnected during startup is no longer reported as "Hand control on": the late detector is closed and never started.
- **M** at Jezero no longer leaves the app stuck in the base view without a base; Mars still says it has no moons to visit, and Escape and **V** keep working.
- Space and Enter activate a focused button, link or form control (Quality, Credits, the new hand control button) instead of triggering scene shortcuts, and scene shortcuts stay off behind an open dialog.
- The immersive fade no longer hides an open planet card or base panel while you read it.
- Builder: the grid's material is reused when the layout changes and disposed once when the grid goes, instead of a new one leaking each time.

## 2.3.0 — 2026-10-24

Jezero in real light: its own Sun, shadows, sky reflections and materials that look built, not toy-like.

### Added

- **The base's own Sun** (High, Ultra): Jezero is drawn in a second render pass, before bloom, lit by a directional Sun from its real local sky, while the planets keep their single Sun. Night is simply the Sun below the horizon.
- **Shadows** (High 2048 px, Ultra 4096 px), drawn only when something changes: the Sun moves more than 0.5°, the rocket moves, or the Build layout changes. They soften and lighten in the dust season, when the hazy sky lights them.
- **Sky reflections:** a small environment cube of the base's own sky (64 px High, 128 px Ultra), redrawn only when the sky changes, so glass and metal pick up the butterscotch day and the blue sunset.
- **Materials:** curved modules smooth-shaded, boxes flat; fabric, ribbed-metal and solar-cell textures generated in code, with normal maps; dust grime on the windward (northwest) lower third of every module.
- **Contact shadows** under modules, rovers and astronauts, on every quality.
- **🌅 Golden hour** in the base card: jumps to just before the next local sunset (the Sun 6° up) and opens the horizon view, looking across the light.

### Changed

- **Low** keeps the v2.2 look and night handling, plus contact shadows: a second pass cost 1.4 ms of CPU there, too much for phones.
- The base Sun matches the planet's brightness. A realistic 43% at the base alone left a dark island on a bright Mars, since the app lights every planet alike.

### Performance

RTX 4060 laptop, 1600×900, each version measured alone, Jezero in daylight:

| View (CPU / GPU, ms) | v2.2 High | v2.3 High | v2.2 Low | v2.3 Low |
|---|---|---|---|---|
| BaseView | 2.5–2.6 / 2.5–2.6 | 4.0–4.5 / 3.3–3.5 | 2.5–2.7 / 1.0–1.5 | 2.6–2.7 / 0.9–1.8 |
| Horizon view | 2.4–2.5 / 2.5–2.7 | 3.1–4.1 / 2.8–3.4 | 2.2–2.6 / 0.5–0.7 | 2.2–2.3 / 0.6–1.4 |
| Landing | 2.9–3.0 / 2.7–2.9 | 4.1–4.3 / 3.7–4.1 | 2.4–2.6 / 1.3–1.4 | 2.6–3.5 / 0.7–2.1 |

High: +0.7–1.2 ms GPU (budget +2 ms) and about +1.5 ms CPU (a second render call plus the base's draws with shadow uniforms; merging draw calls is a planned follow-up). Low: unchanged within noise.

## 2.2.0 — 2026-10-24

Sharper on big screens, a new rocket, and engines you can see: flames, dust and stage separation.

### Added

- **Ultra quality** (desktop only, never picked by itself): pixel ratio up to 3 for 4K screens, 8× MSAA through bloom, 1024 px generated textures. The Quality button cycles Low → High → Ultra on desktop (Low ⇄ High on phones and tablets; a saved Ultra opens as High there). If Ultra can't hold ~55 fps for 3 s it steps down to High once, and says so.
- **A new rocket**, built in code with no image files: a two-stage launcher with a crew capsule, five engine bells, grid fins, and generated paint (panel seams and rivets in a normal map on High, red bands, soot, a mission patch, lit cabin windows).
- **The upper stage is the lander.** A base visited with `V` has a full stack on the pad; at 35% of a trip the booster separates, and the camera looks back for ~1.5 s as it tumbles away (skippable with Enter; just gone with reduced motion). The upper stage lands on its own legs, which open from 40% of the descent, and makes later hops alone.
- **Engine flames** coloured by the air: blue-white and wide in vacuum, pale on Mars, orange and narrow in thick air; shock diamonds on High; steady (no flicker) with reduced motion.
- **Pad dust** at liftoff and landing: rust on Mars, haze on Titan, steam on Earth, a little frost on Europa, none on the Moon. Fewer puffs on Low; none with reduced motion.
- A small camera shake at liftoff (none with reduced motion).

### Fixed

- Right after liftoff the chase camera was inside the planet (since v2.0); it now stays above ground.
- Portrait phones: the countdown and landing controls overlapped the mission HUD's mini-map; they now sit low, above the footer.

### Performance

- **Antialiasing under bloom** was checked and already on (4× MSAA, half-float target): nothing to repair. Before/after at Jezero, simulated 3× screen, RTX 4060 laptop: High 3200×1800 with 4× MSAA, 2.2 ms CPU / 4.0 ms GPU; **Ultra** 4800×2700 with 8× MSAA, 2.3 ms CPU / 11.6 ms GPU (inside a 60 fps frame).
- **Rocket and effects:** 6 draw calls and 2.5k triangles on High (1.2k on Low), dust 1 call; ~19 µs of CPU per frame. Whole-frame GPU at Jezero and during Travel is unchanged from v2.1 within run-to-run noise (±0.5 ms on this machine).

## 2.1.0 — 2026-10-24

The Mars showcase: Jezero becomes a living base with a real day and sky, and you can stand on the ground.

### Added

- **Jezero showcase base:** three inflatable habitats joined by tunnels, a glowing greenhouse, a solar field, a rover garage, a comms antenna and a flag, from a data-driven layout (`data/baseLayouts/jezero.ts`) checked by tests (nothing on the pad, no overlaps, tunnels and paths clear). Two rovers drive loops, four astronauts walk between modules, the antenna blinks, a dust devil crosses now and then (never with reduced motion). Everything stands on the curved ground, on a patch in the planet's own texture that fades out at its rim. Built only while Mars is in focus (or a rocket is headed there) and freed after; BaseView frames the bigger base.
- **A real day at the bases:** local solar time, sunrise and sunset in every base's card, from the ephemeris (checked on Earth: solar noon at Greenwich, 6/18 on the equator, London's midsummer day, Tromsø's midnight sun and polar night). At Jezero, windows and the greenhouse light up at dusk, sunlit walls go dark after sunset, and the solar panels track the Sun.
- **Horizon view** (`O`, or 🌄 in the base card): stand on the ground at Jezero. Butterscotch sky by day, a blue glow round the setting Sun, and at night the real stars with **Phobos** (lit, in its phase), **Deimos** and **Earth** as a bright star, at their real positions and labelled. Drag or the open hand looks around, `↑` `↓` step closer or farther, `Esc` or `O` stands up. Phobos and Deimos are fitted to JPL Horizons for 2020–2035 (within 3.2° and 1.9° of held-out positions); outside those years Phobos is marked "approximate". True scale draws them at their real size.
- **Experimental: base building at Jezero**, hidden behind `?flags=build` and off by default. Five modules on a grid, power over a whole sol (hour by hour, with the Martian dust season), batteries, oxygen, levels 1–3 kept in the passport once earned, ghost preview with the power/oxygen change, undo/redo, hand (pinch-and-hold), mouse and touch. A simplified game model, not engineering values.

### Changed

- The time pill on phones truncates long dates instead of running into the title or a side panel; the landscape mission HUD clears the status line.
- `Ctrl`/`⌘` + a letter no longer triggers the app's one-letter shortcuts (copy, reload and the like are left to the browser).

### Performance

BaseView at Jezero: CPU unchanged (2.0–2.2 ms High, 1.8–1.9 ms Low); GPU lower than v2.0.2 because the new framing shows less of Mars' surface, not because the showcase is free (it adds 15 meshes / 4.8k triangles on High). Horizon view: 3.9–4.2 ms GPU on High, 0.6–1.0 ms on Low. Details in the README.

## 2.0.2 — 2026-10-24

A mobile layout pass: on phones (portrait and landscape) the UI no longer hides the planet.

### Changed

- **The camera keeps the focused body clear of every panel**, measured from the panels' real positions: the info card (side or bottom sheet), the base panel, the mission HUD, the weight panel and the time bar. Before, only the phone bottom sheet was taken into account.
- **Phones (≤ 640 px wide, or ≤ 500 px tall, so landscape too):**
  - The time bar is a small pill (📅 date · speed, and pause) in a corner; tap it for the full slider. It folds back after 4 s without a touch.
  - The footer shows 📷 and ☰; Watermark, True scale, Weight, Passport, Quality, Language and Credits are in the menu.
  - A smaller title ("🪐 Space Explorer") and a smaller camera preview.
  - In landscape, panels sit at the side, top to bottom, and scroll.
- **Keyboard shortcuts** are hidden on touch screens; on desktop they're behind a **?** button (or `?` / `H`), remembered.
- **Camera preview:** tap its × to tuck it away into a 📷 button (or `C`), remembered.

### Added

- **Immersive mode** (phones and tablets): after 3 s without input (touch, keys, or a hand gesture), the UI fades and only the hand-status dot remains; any input brings it back. Not during launches, trips and landings, or while a menu, panel, the full time bar or a dialog is open.
- **Install as an app:** a web manifest and icons, so "Add to Home Screen" opens full screen without the browser bars; the layout respects the notch and home bar (safe areas).
- A **Language** button (in the menu on phones), alongside the `L` key.

## 2.0.1 — 2026-10-24

### Changed

- **Landing camera:** behind and above the rocket, with the pad's "up" as the screen's up, so the rocket always stands upright over the pad, never sideways-on, whatever side of the world the base is on. Steering follows the screen in the same frame.
- **Phones:** in BaseView the camera keeps the base above the base panel (bottom sheet), like the info sheet does.

### Added

- **Hand-steering sensitivity** for landings: Low / Normal / High (`S`, or the button on the landing screen), remembered.
- **Landing replays:** a `?debug` recording (`R`) now stores the app's mode with every frame and the landing's settings (base, gravity, sensitivity, auto-land); `sim/landingReplay.ts` replays it through the gesture engine and the docking sim, so a real recording can become a test.
- The v2.0 Burmese strings are in `docs/i18n-review-my.md`.

## 2.0.0 — 2026-10-24

Space bases and rocket travel: visit five bases, fly between them, land by hand, collect passport stamps.

### Added

- **Bases:** Cape Launch Center (Earth), Tranquility Base (the Moon), Jezero Dome (Mars), Conamara Ice Station (Europa) and Kraken Shore (Titan), at their real latitude and longitude, built in code (no assets) with a landing pad and blinking lights, turning with their world and hidden from far away. `V`, **Visit** on a card, or pointing at an already-selected world flies down; a panel tells you about the base. Time runs at real speed while you're there.
- **Rocket travel:** pick a destination (`←` `→`, point at a world, or the panel's list), then launch with `Enter`, the 🚀 button, or a 3 → 2 → 1 finger countdown (`Esc` aborts). The rocket follows a curved arc between the worlds with a chase camera and warp streaks (none with reduced motion); `Enter` or **Skip** jumps to the approach.
- **Docking mini-game:** steer the rocket onto the pad with your palm, the mouse or the arrow keys. Heavier worlds mean a faster descent and stronger gusts. Miss and you try again. **Auto-land** for accessibility: `Enter` lands for you this time, `A` (or the button) every time, remembered.
- **Mission HUD:** current base, fuel, the real distance left and the ETA, and a mini-map of the system with your route.
- **Passport** (`J`): a dated stamp for each base you reach, kept in this browser.

### Changed

- `main.ts` is split into modules under `src/app/`, with an explicit mode machine (SolarView → Focus → BaseView → Launch → Travel → Docking) that decides which intents each mode takes.

## 1.3.1 — 2026-10-24

Polish before merge: a bigger overview, the info card as a bottom sheet on phones, smaller rocks up close, translated credits.

### Changed

- **Overview boost:** as the camera pulls back, planets grow (inner planets and Jupiter ~1.7×, Saturn and the outer planets ~1.2×, each capped so no two ever touch) and moons fade out; true size up close. It follows the zoom distance smoothly (not a flight's pull-back), so nothing swells during fly-ins. Labels, picking and moon orbits follow the drawn size. **True scale** (`T`, footer button, remembered) turns it off. This more than makes up for the ~9% the moons cost in 1.3.0.
- **Info card on phones is a bottom sheet** and never covers the focused body: the camera re-centers it in the space above the sheet (and pulls back if needed). Swipe down to collapse it to the title and moon buttons, again to close; swipe up or tap the handle to expand. Collapsed, the time bar sits on top of it; expanded, the time bar and footer step aside. The card also has a ✕ on every screen size.
- **Asteroids up close:** rocks shrink as the camera gets near (full size from 60 units out), so seen from a nearby planet they're small debris instead of boulders, and none can fill the view. The overview, where the nearest rock is ~200 units away, looks the same.
- **Credits dialog in English, Burmese and Japanese**, and complete again: it now also credits the moon and Pluto maps (USGS, NASA), the sky (NASA SVS, ESA/Gaia/DPAC) and the orbit data (JPL, IAU, Meeus). It follows a language change while open.

## 1.3.0 — 2026-10-24

A fuller Solar System: six moons, Pluto, Halley's Comet, the asteroid belt and a Kuiper belt hint, and the real Milky Way behind it all, plus CPU and GPU frame times in `?debug` to measure what it costs (High: +0.4–0.7 ms per frame on an RTX 4060 laptop; Low: no measurable change).

### Added

- **Moons:** Earth's Moon, Io, Europa, Ganymede, Callisto and Titan, at their real positions on the shown date (fitted to JPL Horizons; the Moon from Meeus, so phases and eclipses land on the right days) and always facing their planet. With a planet focused, `M` steps through its moons, and its moons can be pointed at (☝️) or clicked; the info card lists them as buttons. Labels and cards say "moon of Jupiter". Moon textures come from USGS mosaics of NASA data (public domain) and load only once their planet is visited; 4K only for the moon in focus.
- **The Milky Way and shooting stars:** NASA's Deep Star Maps 2020 (Gaia; public domain) behind everything, oriented to the real sky; 4K on High, 2K on Low, drawn on a camera-centered sphere that looks up each pixel's right ascension and declination (no cube-map conversion, no mipmaps). A shooting star every 6–15 s, never with reduced motion. ESO's panorama, as first proposed, was dropped: its terms aren't clearly open.
- **Pluto and Halley's Comet:** on their real tilted, eccentric orbits, placed in 3D at their real distance mapped like the planets'. Pluto is labeled "dwarf planet"; the comet grows a coma, a straight ion tail pointing away from the Sun and a curved dust tail inside ~4 AU. Its card has a **Next visit** button (July 2061, a month before perihelion, at a day per second). ← → now continue to Pluto and the comet. Pluto's texture: USGS mosaic of New Horizons data (public domain). Weights under 1 kg show in grams (3.6 g on Halley).
- **Asteroid belt and a Kuiper belt hint:** one instanced mesh each (6,000 and 1,500 rocks on High, 1,500 and 400 on Low), moved in the vertex shader on real Kepler periods, with the Kirkwood gaps left empty. The asteroid belt fills the clear band between Mars and Jupiter's moons; the Kuiper belt sits just outside Neptune.
- Clicking or tapping a planet (or a moon of the focused planet) flies there and opens its card.
- **CPU and GPU frame times in `?debug`**, under the FPS counter: the mean and 95th percentile over the last second. GPU time uses WebGL timer queries where the browser has them and shows *n/a* elsewhere, so phones still get the CPU number.

### Changed

- Planet spacing makes room for moon systems, so a moon never touches a neighbouring planet: Earth and Mars move out slightly, Saturn, Uranus and Neptune by 10–12 units. The overview still fits every planet's orbit, but planets look ~9% smaller in it.
- The weight panel lists the moons under their planet.

## 1.2.0 — 2026-10-23

Fun features: photo mode, real planet positions with time controls and a 🤙 time dial, your weight on other worlds, and Japanese as a third language.

### Added

- **Japanese** as a third app language: every UI string and the planet names, facts and descriptions. `L` now cycles English → Burmese → Japanese. The gesture confirmations ("✌️ detected → switching to …") are now translated too; they were English-only.
- **Photo mode:** 🤘 held ~0.8 s, `P`, or the 📷 button hides the UI, flashes, plays a shutter sound and saves a PNG of the scene. An "app + planet" watermark can be turned off (`W`, remembered). On phones that can share files, a Share button opens the system share sheet (a Save button downloads instead). The shot is copied right after a frame is drawn, so the renderer doesn't need `preserveDrawingBuffer`.
- **Real positions and time controls:** planets are placed by date from JPL's Keplerian elements and spin about their IAU rotation axes, so Earth shows the right seasons and sunlit side. A time bar shows the date and has a speed slider from 1 year/s backward, through stopped and real time, to 1 year/s forward (default 1 week/s), plus **Now** and pause. `B` reverses time and `N` jumps to now; `[` `]` and the two-hand pinch still scale the speed. Dates are kept between the years 1000 and 3000.
- **🤙 time dial:** thumb and pinky out, held still for ~0.3 s, then tilt the hand: right is faster, left is slower and then backward, the same with either hand. An on-screen dial shows the speed while it's active. 🤘 photos are blocked while the dial is active and for 0.5 s after it ends.
- **Your weight on other worlds:** ⚖️ in the footer or `G` opens a panel: enter your weight in kg and see what a scale would read on each body, using NASA's surface gravity (cloud tops for the gas giants; 274 m/s² for the Sun). Full-width and Myanmar digits are accepted. The weight stays in this browser. A planet's info card shows your weight there and the light travel time from the Sun on the shown date (Earth: 8 min 11 s in January, 8 min 27 s in July).

### Changed

- Orbit positions are no longer random on each load. ✊ and `Space` now pause the simulated time (orbits and spin).
- The speed readout next to the planet name is replaced by the time bar.
- `Esc` closes the weight panel first, then the info card.
- Burmese numbers and dates (time bar, weights, light times) use Myanmar digits and Burmese month names in every browser. Chrome has no Burmese locale data and showed an English date with Latin digits.
- Footer buttons wrap onto a second row on narrow screens instead of overflowing, and the time bar stays above the footer however tall it gets.

## 1.1.1 — 2026-10-23

Follow-up to 1.1.0, before the first merge: licensing, a reproducible texture build, smoother quality switching, the full system on portrait screens, and on-device performance measurement.

### Added

- MIT `LICENSE` file, matching what the README already stated.
- `npm run textures:build` rebuilds `public/textures/`: it downloads the source images once into the git-ignored `.texture-sources/`, then builds every tier.
- **FPS counter in production with `?debug`**, so performance can be measured on a phone: the stats.js panel appears right away (tap it to cycle FPS / ms / MB), and `F` toggles it. Without `?debug`, production builds never load it.

### Changed

- `sharp` is now a dev dependency (0.35.5, which fixes the high-severity libvips / libheif / librsvg advisories in earlier versions), so the texture build is reproducible from a clean install.
- **README** (English and Japanese): a new Performance section with the measured numbers, the techniques behind them (4K for the focused planet only, off-thread decoding and sliced uploads, the shader-computed ring shadow, shader pre-compilation), how to measure on your own device with `?debug`, and known limitations, including older Safari and Firefox.

### Fixed

- **No more stutter on the first Low → High switch.** Bloom's own shaders (and the output pass) are now compiled in the background while the browser is idle after startup, and production builds turn off three.js's shader error checks, which cost a synchronous GPU round trip per program on first use. Worst frame on that switch, production build, emulated iPhone on a 60 Hz display: 33–150 ms before, 17–18 ms after in 4 of 5 runs (one missed frame, 33 ms, in the fifth).
- **Portrait screens show every orbit in the overview.** The framing now fits the full width on any aspect ratio (it used to crop the outermost orbits on phones), and it re-fits when the viewport changes shape, e.g. a phone rotated between portrait and landscape, keeping any zoom you applied.

## 1.1.0 — 2026-10-23

The visual upgrade: planets look sharp and realistic up close, with gesture controls unchanged.

### Added

- **Planet textures** from Solar System Scope (CC BY 4.0) in 1K / 2K / 4K, built by `scripts/build-textures.mjs`. Every body loads 2K; the focused body switches to 4K once it is too large on screen for 2K to stay sharp, and releases it when you zoom out or move on.
- **Texture cross-fades** for every change (first load, 2K ⇄ 4K, quality switch), done in the shader, with no pop-in.
- **Surface detail:** Earth normal map, Mars relief map.
- **Atmospheres:** a back-side halo shell plus a matching limb haze on the planet (Earth blue, Mars orange, Venus yellow, subtle on the gas giants). They're lit on the day side, with a bright ring when backlit.
- **Earth:** a separate, drifting cloud layer; city lights on the night side only; glossy oceans from the specular map.
- **Saturn:** ring texture with transparency, and the planet's shadow on the ring.
- **Sun:** bloom (`UnrealBloomPass`) and limb darkening.
- **Camera fly-in:** a 1.5 s ease-in-out flight to a close orbit view on every planet switch. Rotating still works during the flight; zooming ends it. With `prefers-reduced-motion`, it cuts instead.
- **Quality setting** (Low / High) in the footer, remembered between visits. Low is picked automatically on phones and tablets. Switching is live, without a reload.
- **Loading indicator** for textures. Nothing waits for them: bodies show their base color until the images arrive.
- **Version label** (`v1.1.0`) in the top-right corner.
- **Recovery from WebGL context loss** (e.g. when a phone backgrounds the tab): image textures are reloaded from the browser cache and fade back in.
- **Dev tools:** a stats.js FPS counter toggled with `F`, and exposure and bloom settings in the debug config panel (dev builds and debug mode only).
- **Tests:** 39 new tests (93 in total) for scale, camera, texture tiers, quality detection, and that every texture file a planet can request exists.

### Changed

- **Rendering:** ACES filmic tone mapping, explicit sRGB output, and maximum anisotropic filtering on textures. Spheres use 128 segments for the focused planet and fewer for distant ones.
- **Scale:** planet radius ∝ diameter^0.38 (was ^0.6; Earth is now 2 units instead of 1). Orbits are log-scaled from real distances with a minimum clearance. In the overview, at 900 px tall, Earth grows from 7.7 to 10.5 px in radius and Mercury from 4.3 to 7.3 px.
- **Overview framing:** every orbit, including the near side that v1.0 cut off, now fits the screen. On portrait screens the overview starts from a steeper angle.
- **After arriving,** the camera now moves with the orbiting planet instead of trailing behind it.
- **Code structure:** mesh building moved out of `scene/` into a new `planets/` module. Planet data stays in `data/bodies.ts`; sizes and orbits are now computed from real diameters and distances in `data/scale.ts`.
- **README** is now in English and Japanese.

### Fixed

- Large texture uploads no longer stall frames (the worst frame while a 4K set loads went from 69 ms to 14 ms): decoding happens off the main thread without `imageOrientation: 'flipY'`, and uploads are split into ~2 MB slices, one per frame.
- Switching quality no longer stalls ~0.5 s on shader compilation: the other render path is compiled in the background.

### Performance

Measured on a Windows 11 laptop with an RTX 4060 Laptop GPU, Chrome, a 144 Hz display, and hand tracking running:

- **High quality:** steady 144 fps at 1600×900 and 3200×1800, with 3.8–4.8 ms GPU time per frame (median).
- **Low quality:** 0.5–1.0 ms GPU time per frame.

### Known issues

- **Phones:** not yet measured on a real phone. Low quality is designed for mid-range phones, but the 30 fps target is unverified.
- **First Low → High switch:** the first switch in a session costs one ~40–60 ms frame while bloom's shaders compile. Later switches are smooth.
- **Browser support:** older Safari (< 17) and Firefox (< 98) decode textures on the main thread, so 4K loads can hitch there.
- **Narrow portrait screens:** the overview crops the outermost orbits slightly.

Changes before 1.1.0 were not tracked in a changelog.
