# Japan / Guided app: review snapshot for the team

**Development review only. Not a release, and not a replacement for `main`.**

A standalone snapshot of the Japan/Guided line, exported from the private development repository
without its history: source commit `ef512a4d6a1eef4c7c68c323f667c66d9d3da4d1` (baseline before the camera
fix: `b0962a2d9b0f88fcb5bd3f1fdc09654c0b97000a`). `export-manifest.json` lists the imported export's
SHA-256 hashes and export-only edits. `review-manifest.json` records the public documentation/license
changes made after import and hashes the final review files (excluding itself).

**Code: MIT / 3D assets: CC BY 4.0**, with separate CC0, OFL and other third-party
licenses as documented in [ASSETS.md](../ASSETS.md).

**It differs from `main`.** It has no booking or boarding code (`src/shell/`, `src/travel/`); that work
has its own owner and is not being removed from `main`. To debug this app, **create a new branch from this
one**. Do not merge it into `main`, and do not rebase existing team branches onto it.

## Run it (Node.js 22)

```
npm ci
npm run dev                      # http://localhost:5173
npm run typecheck && npm test    # unit tests
npm run build                    # runs the spaceport asset check first
npm run test:smoke               # SMOKE_PREVIEW=1 for the built app
npm run test:camera-lifecycle    # built app; CAMERA_LIFECYCLE_DEV=1 for the dev server
node --test --test-concurrency=1 tests/browser/guided.test.mjs
```

Browser suites need Chromium: `npx playwright-core install chromium`.

## Guided mode and the camera

- Guided: `/?flags=astrolife,guided`, optionally `&base=jezero` or `&base=cape`, `&lang=en|ja|my`. Without both flags, `/` is the plain explorer.
- The camera needs HTTPS or `localhost`. Touch and keyboard controls are also available.
- A hidden page (another tab or app, the lock screen) releases the camera and does **not** reopen it. Press **🖐 Turn on hand control** to restart.
- In Guided mode a 👍 held for 0.5 s confirms a step; the on-screen button does the same.

## Units and coordinates: this is a presentation, not a simulation

| Part | What it really uses |
|---|---|
| Scene (Three.js) | Right-handed, y up, ecliptic in x–z, Sun at the origin. **Scene units, compressed** (`src/data/scale.ts`): radius ∝ diameter^0.38, orbits log-compressed. No single factor converts them to km. |
| Ephemeris | AU, J2000 **ecliptic** (`src/data/bodies.ts`, valid 1800–2050). No velocities. `routeKm()` in `src/sim/route.ts` gives real distances in km for the HUD. |
| Time | Simulated date in epoch ms (UTC); rate in simulated s per real s (`src/sim/clock.ts`). Frame `dt` is real seconds clamped to 0–0.1 (`src/app/frameLoop.ts`). No fixed step. |
| Travel | A cinematic Bézier arc in scene units (`src/sim/travel.ts`): no forces, masses or physical velocities. "Fuel" is a 0–1 share of a tank. |
| Landing | A deterministic game in **pad radii** and pad radii per second (`src/sim/docking.ts`). Gravity only scales descent and gusts. |
| Spaceport site | `public/spaceport/site.json` is in the model's own authoring coordinates. Its placement and scale in the scene were not traced for this note. |

**Physics bridge** (`docs/physics-bridge.md`, `src/physics/contracts.ts` on `feature/physics-bridge-interface`):
that contract is SI in a local inertial frame (m, kg, s; ICRF origin in km and km/s; TDB epoch). Nothing in
this snapshot produces or consumes those values, and the Jolt/WASM backend is not built or connected here.
A state source (ephemeris → frame) and a renderer adapter (local state → scene) are both new work.

## Where to change things

- Input: every key, touch and gesture becomes an `Intent` (`src/intents.ts`), applied in `src/app/intentHandler.ts`.
- Mission flow and HUD numbers: `src/app/mission.ts`. Guided flow: `src/app/guidedSession.ts`, `src/app/guidedMission.ts`.
- Camera and tracking lifetime: `src/app/tracking.ts`.
- Booking handoff: team-owned and not in this snapshot; its interface is still to be agreed.

## Tested, and not

Tested on the exported files with Node 22.23.4 and Chromium (a **fake camera**; the 👍 in the camera test is **injected**): typecheck, unit tests, production build, production smoke, camera-lifecycle and Guided suites.

**Not run:** real iPhone or Android, Safari, GitHub Actions on this branch.

## Known limitations

- Guided portrait: the destination list can be clipped, and the base panel can overlap it.
- No "turn the camera off" control while the page is visible.
- Scripts for re-exporting assets, profiling and rebuilding the native module are not in this snapshot; `native/README.md` still mentions them.
