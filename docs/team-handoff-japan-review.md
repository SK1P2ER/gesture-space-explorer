# Japan / Guided app: review snapshot for the team

**Development review only. Not a release, and not a replacement for `main`.**

## Source of truth

- **`review/japan-app` is the integration branch for all Japan/Guided work.** Start feature branches from it and open pull requests against it.
- **`main` stays the production line.** Draft PR #3 (`review/japan-app` → `main`) exists for review and CI only; it is not approval to merge this snapshot into `main`.
- The private development branches this snapshot came from are kept as reference only: not deleted, not rewritten, and no longer developed in parallel.
- Booking/boarding integration and physics adapters are separate work with their own owners and agreements; they are not part of this branch.
- Nothing in this document triggers or authorizes a deployment.
- Existing assets keep the licenses in [ASSETS.md](../ASSETS.md). Any new asset needs the same checks before it is committed: who made it and under what license, and no personal data (user names, local paths, emails), including inside binary and compressed files such as `.blend`.

## Where it came from

A standalone snapshot of the Japan/Guided line, exported from the private development repository
without its history: source commit `ef512a4d6a1eef4c7c68c323f667c66d9d3da4d1` (baseline before the camera
fix: `b0962a2d9b0f88fcb5bd3f1fdc09654c0b97000a`). The two manifests are historical records of the import,
kept unchanged:

- [`export-manifest.json`](https://github.com/SK1P2ER/gesture-space-explorer/blob/5a6154cba880c9aa5980c48310e59ab1bcd365e3/export-manifest.json): the imported export's SHA-256 hashes and export-only edits.
- [`review-manifest.json` at `5a6154c`](https://github.com/SK1P2ER/gesture-space-explorer/blob/5a6154cba880c9aa5980c48310e59ab1bcd365e3/review-manifest.json): the documentation/license changes made after import, and the hashes of the review files at that commit (excluding itself). It describes `5a6154c` only: later edits, including this document's, are not reflected in it.

**Code: MIT / 3D assets: CC BY 4.0**, with separate CC0, OFL and other third-party
licenses as documented in [ASSETS.md](../ASSETS.md).

**It differs from `main`.** It has no booking or boarding code (`src/shell/`, `src/travel/`); that work
has its own owner and is not being removed from `main`. To debug this app, **create a new branch from this
one**. Do not merge it into `main`, and do not rebase existing team branches onto it.

## Team workflow

```
git clone https://github.com/SK1P2ER/gesture-space-explorer.git
cd gesture-space-explorer
git switch review/japan-app             # already cloned: git fetch origin && git switch review/japan-app && git pull --ff-only
git switch -c feature/<topic>           # one topic per branch
# … change, then run the checks below …
git push -u origin feature/<topic>
gh pr create --base review/japan-app --draft   # or on GitHub: base = review/japan-app, not main
```

CI (typecheck, unit tests, build, browser smoke) runs on every pull request, whatever its base branch.

## Run it (Node.js 22)

Use Node.js 22 (`package.json` pins `22.x`) and install from the lockfile:

```
node -v                          # v22.x
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

GitHub Actions: [run 43378596719](https://github.com/SK1P2ER/gesture-space-explorer/actions/runs/43378596719) (pull request #3) passed both jobs, *check (typecheck, unit tests, build)* and *smoke (browser, production build)*, on `5a6154cba880c9aa5980c48310e59ab1bcd365e3`. The camera-lifecycle and Guided suites are not in CI.

**Not run:** real iPhone or Android, and Safari. See the device checklist below.

## Lab deployment and device checklist

The existing Lab deployment for device tests (not a production release; no new deployment is needed):

| | |
|---|---|
| Project | `space-travel-lab` (`prj_wbxWuniHO751JtDPgVmxJdYXjQdH`) |
| Deployment | `dpl_DBKd3KdiQVQ3H5m9vaDiZNyCFSkm`, created 2026-11-13 06:58 UTC with the Vercel CLI |
| Immutable URL (use this one) | https://space-travel-a6cqlhvsa-sk1p2ers-projects.vercel.app/ |
| Alias | https://space-travel-lab-six.vercel.app/ (it can be moved to another deployment later) |
| Access | Vercel Authentication on all deployments: testers need a Vercel login with access to the project. GitHub access does not grant it. |

**Which source it was built from.** The project has no Git integration, so the deployment has none of Vercel's
Git metadata (no Git commit SHA or Git source). What it has is **custom metadata set at deploy time**:
`sourceCommit` `5a6154cba880c9aa5980c48310e59ab1bcd365e3`, `sourceTree` `f831ab9ed9913791485ddc4a4aab01d58f77cb44` and
`reviewManifestSHA256` `3bad15291c4517f25e2f652ac80fac7666b3cc3331f5dfa93001bfafeb220a46`. All three equal the
values of commit `5a6154c`. Custom metadata is written by whoever deploys, so it is a claim, not proof: on
2026-11-13 the deployment's 265 uploaded files were compared with the `5a6154c` tree and all matched by SHA-1 (the
files not uploaded are excluded by `.vercelignore` and Vercel's defaults). The **served** build has not been checked
against a local build, and the app has no on-screen build identifier, so a device result names the deployment, not a bundle hash.

Record one row per case and device. Results:

- **PASS**: done, as expected, with evidence (screenshot, screen recording or the `?debug` → Copy report text).
- **FAIL**: done, not as expected; attach the evidence and the steps.
- **BLOCKED**: could not be done (no camera, permission refused by policy, no Vercel access, the page would not load); say why.
- **NOT RUN**: not attempted yet.

**Starting state.** Do not clear site data or delete anything on a tester's device. Use a disposable session: a
private/incognito window, or a separate browser profile kept for testing. If the app offers a saved mission, choose
**Start fresh**: it discards only that saved journey.

**C2, C3 and C4 are independent.** Before each one, start from a working camera session (C1's state: hand control
on, the system camera indicator on). If the camera is off from the previous case, press **🖐 Turn on hand control**
once and confirm it is working first. Each of them includes coming back: the camera must have been released and
must not restart by itself.

| Device | Model | OS | Browser | URL | Deployment | Source SHA | Tester, date |
|---|---|---|---|---|---|---|---|
| A: iPhone, Safari | | | | | | | |
| B: Android, Chrome | | | | | | | |

| Case | What to do | Expected |
|---|---|---|
| C1 Permission | Open `/?flags=astrolife,guided&lang=en`, allow the camera. | Hand control on; the system camera indicator on. |
| C2 Hidden: tab | From a working camera session, switch to another browser tab for 10 s; come back, wait 3 s, tap only empty space. | Indicator off while away. Back: camera still off, keyboard/touch mode, **🖐 Turn on hand control** shown. |
| C3 Hidden: app | From a working camera session, switch to another app for 10 s; come back, wait 3 s, tap only empty space. | As C2. |
| C4 Hidden: lock | From a working camera session, lock the screen for 10 s; unlock, wait 3 s, tap only empty space. | Indicator off while locked; back, as C2. |
| C5 No later restart | After C4, leave the page visible for 60 s without pressing **🖐 Turn on hand control**. | The camera stays off for the whole minute. |
| C6 Restart | Tap **🖐 Turn on hand control** once. | One working session: hand control on, no second permission loop, one indicator. |
| C7 Gesture journey | Guided: choose a destination, confirm with a held 👍, launch, land. | Each step confirms once; no step skipped by a held hand. |
| C8 Touch fallback | With the camera off, do C7 with the on-screen buttons only. | The journey completes by touch. |
| C9 Layout | Portrait and landscape, in `lang=en`, `ja` and `my`, at a base and during flight. | Nothing clipped or overlapping that blocks a control; record any finding. |

| Case | Device | Orientation, language | Result (PASS / FAIL / BLOCKED / NOT RUN) | Evidence | Notes |
|---|---|---|---|---|---|
| C1 | A | | NOT RUN | | |
| C2 | A | | NOT RUN | | |
| C3 | A | | NOT RUN | | |
| C4 | A | | NOT RUN | | |
| C5 | A | | NOT RUN | | |
| C6 | A | | NOT RUN | | |
| C7 | A | | NOT RUN | | |
| C8 | A | | NOT RUN | | |
| C9 | A | | NOT RUN | | |
| C1 | B | | NOT RUN | | |
| C2 | B | | NOT RUN | | |
| C3 | B | | NOT RUN | | |
| C4 | B | | NOT RUN | | |
| C5 | B | | NOT RUN | | |
| C6 | B | | NOT RUN | | |
| C7 | B | | NOT RUN | | |
| C8 | B | | NOT RUN | | |
| C9 | B | | NOT RUN | | |

## Known limitations

- Guided portrait: the destination list can be clipped, and the base panel can overlap it.
- No "turn the camera off" control while the page is visible.
- Scripts for re-exporting assets, profiling and rebuilding the native module are not in this snapshot; `native/README.md` still mentions them.
