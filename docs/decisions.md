# Design decisions

Short records of design decisions, so choices don't live only in chat or commit messages.
Each entry: date, decision, goal, alternatives, why. Newest last. An entry is changed only
to mark it superseded; a new decision gets a new entry.

Entries marked **reconstructed** were written after the fact from the repository (CHANGELOG,
README, code, commits); their goal and alternatives weren't recorded at the time and should be
confirmed.

---

## 1. Bases and rockets are built in code (procedural-assets rule)

- **Date:** 2026-10-24 (in practice since v2.0 bases, `15aab81`; the v2.2 rocket, `9ac6428`). Recorded 2026-10-29. **Reconstructed.**
- **Decision:** Everything at the bases and the rocket is generated in code: geometry (habitats, tunnels, greenhouse, garage, rovers, pads, terrain, rocket) and its textures (fabric, ribbed metal, solar cells, rocket paint and seams, dust grime, contact-shadow and dust-puff sprites). Image files are used only for the Solar System itself: planet, moon and sky maps from public sources, built by `npm run textures:build`. A base borrows its planet's map and never owns it.
- **Goal:** Not recorded. To confirm.
- **Alternatives:** Not recorded (for example imported glTF models, or painted image textures).
- **Why (from the record):** The rocket is "built in code with no image files" (CHANGELOG 2.2.0). Generated texture size follows the Quality tier (`kitTexture` 256 / 512 / 1024 px), and Low / High geometry detail differs per part. The base architecture audit states "All geometry above is procedural… the planet texture is the externally owned asset" (`docs/mars-base-2.0-architecture.md` §4).

## 2. Showcase bases are drawn in a second render pass

- **Date:** 2026-10-24 (v2.3.0, `0b34b09`). Recorded 2026-10-29. **Reconstructed.**
- **Decision:** A showcase base (Jezero), its planet's branch and the rocket are drawn in a second pass over the planets' depth, lit by the base's own directional Sun from its real local sky, while the planets keep their single Sun. On High and Ultra the pass runs before bloom, with shadows (2048 / 4096 px) and a small sky environment cube, both redrawn only when the Sun, the rocket or the layout changes. On Low the same pass goes straight to the screen without bloom (`ScenePipeline.render`).
- **Goal:** Not recorded as such. The v2.3 release goal was "Jezero in real light: its own Sun, shadows, sky reflections and materials that look built, not toy-like."
- **Alternatives:** Not recorded.
- **Why (from the record):** At the Solar System's scale every planet is lit by one point Sun. A base needs a local directional Sun from its own sky, with shadows, and that can't come from the planets' light. The base's Sun matches the planet's brightness, because a realistic 43% left "a dark island on a bright Mars" (CHANGELOG 2.3.0). Low keeps the v2.2 look plus contact shadows, since a full lit pass cost 1.4 ms of CPU there.
- **Note:** The README's "Low is unchanged (it has no second pass)" no longer matches the code. Low draws the base in a second pass, without bloom.

## 3. Hotfixes are cut from the release tag

- **Date:** 2026-10-29. Decided for v2.3.1.
- **Decision:** A maintenance release starts as `hotfix/vX.Y.Z` from the `vX.Y.Z` tag, in its own worktree, never from the development branch.
  - Fixes that already exist elsewhere are cherry-picked with `-x`. Conflicts are resolved minimally, and no development-branch code is brought in.
  - Each fix is one commit with a regression test that fails on the tag and passes after it.
  - The release commit holds the CHANGELOG section and the version bump. The tag waits for an explicit GO.
  - After the release, `main` is fast-forwarded to the tag and the hotfix is merged into the development branch. There, conflicts resolve to the branch's own later versions of the same fixes.
- **Goal:** Ship fixes, the webcam privacy fix first, to users of the released version without shipping unreleased work.
- **Alternatives:** Release the fixes from `feat/v2.4-auto-quality`, which already had them. Rejected: it carries the unreleased Mars v2.5 work and release infrastructure.
- **Why:** v2.3.0 was the shipped line. Every fix stayed small and verifiable against it, and the merge back records the ancestry, so the fixes aren't merged twice.

## 4. Auto-quality, part 1: resolution scaling within the tier

- **Date:** 2026-10-29 (`a81d236`).
- **Decision:** Auto-quality changes render resolution only. It is always on, within the tier the Quality button picks, and holds the display's own refresh rate.
- **Goal:** Asked as "what should it change when frames are slow". The real goal (entry 5) wasn't stated when this was decided.
- **Alternatives offered:**
  - Scope: resolution, then effects (MSAA, then bloom); or resolution, then effects, then tier (High → Low).
  - Control: a new Auto setting on the Quality button.
  - Target: a fixed 60 fps.
- **Why:** Resolution steps never recompile shaders or reload textures, so they never stall. Choosing the tier was left to the user.
- **Implementation choices made without a decision from the user:** a floor of 0.6 × the tier's pixel ratio; never below 1× on desktop; a target never slower than 60 Hz, because slow-from-the-start frames look like a slow display; undoing a step that bought under 5%; keeping the 4K texture switch on the full ratio; full resolution for photos.
- **Status:** Still in force. Entry 5 replaces its "the button picks the tier" part.

## 5. Auto-quality, part 2: Auto picks the tier

- **Date:** 2026-10-29.
- **Goal:** Capable phones should automatically get High, so they see the v2.2 / v2.3 visuals, while weak devices stay smooth. Until now, phones were set to Low by device type and never saw them.
- **Decision:** A new **Auto** Quality setting, the default for anyone who never chose a tier.
  - In Auto, late frames (over 1.5 display intervals) are measured against the detected refresh rate.
  - When Low has headroom (≤ 1% late frames and the app's CPU work under half a frame, over 5 s), High is tried. It rolls back to Low if more than ~5% of frames are late, judged over 8 s after a 3 s settle.
  - High stays watched the same way, so a weak desktop also ends on Low.
  - Auto never picks Ultra.
  - Tier changes happen only in SolarView, Focus or an idle BaseView (no horizon view, countdown or cinematic camera).
  - The result is remembered per device (`gse.autoTier`, per app version, for 14 days).
  - The Quality button cycles Auto → Low → High → Ultra (desktop) → Auto. A saved Low / High / Ultra stays a fixed choice.
  - Resolution scaling (entry 4) keeps working inside whichever tier is active.
- **Alternatives:** Entry 4's tier-from-the-button-only model; stepping only High → Low (the tier option offered in entry 4, which never tried phones on High).
- **Why:** Device type can't tell a capable phone from a weak one; frames on the device can. Trying, then rolling back, with the result remembered, gives a capable phone High from its first visit onward and costs a weak phone one 8-second trial per app version.

## 6. CI is the release gate

- **Date:** 2026-10-29. Scope set for v2.4.
- **Decision:** Every PR must pass GitHub Actions CI before merging: typecheck, unit tests, a production build, and about 10 browser smoke tests on the built app. Vercel builds a preview deployment for every PR, and the same smoke tests run against it. Branch protection makes the checks required on `main` and `hotfix/**`. Details are in `docs/ci.md`.
- **Goal:** A green CI run is the bar for merging and releasing, instead of locally produced evidence.
- **Alternatives:** The Phase 8 release harness (`npm run verify:release`) as the gate.
- **Why:** The checks run the same way for every change, on a clean machine. The smoke tests use only what a visitor can do, so one suite covers the dev server, the built app and a deployed preview.
- **Implementation choices made without a decision from the user:**
  - 11 smoke cases rather than exactly 10, with the privacy cases first.
  - The smoke job runs only after `check` passes.
  - `playwright-core` is pinned as a dev dependency, at the version already used locally.
  - The preview job runs on Vercel's deployment status and uses the Vercel bypass secret for protected previews.
- **Not decided:** Whether `verify:release` and the Phase 8 browser suites stay part of releasing. They are left as they are.

## 7. Deep links

- **Date:** 2026-10-29. Scope set for v2.4.
- **Goal:** A view can be shared, and opened directly by people and by tests, without stepping through the app to reach it.
- **Decision:**
  - A link carries the view's essentials: `?body=saturn`, `?base=jezero` (its body follows), `&view=horizon` (showcase bases), `&date=2061-07-28` or a full ISO time with its zone, and `&lang=en|my|ja`.
  - Anything unknown or invalid is ignored, never an error. `?flags=` and `?debug` stay as they are, exactly as typed.
  - A link with a date opens **paused** at that moment.
  - The address bar follows navigation quietly (`history.replaceState`, so Back isn't filled with views) when the body, base, view or language changes. The date isn't followed: it stays in the address only while that moment is still shown, paused.
  - The photo Share sheet includes the current link.
  - The browser smoke tests start from links instead of stepping through the app.
- **Alternatives offered:** Also `&speed=` and `&quality=` (which could override a visitor's own saved quality); reading links on load only, with no address-bar sync; a date link that keeps time running.
- **Why:** These five describe what's on screen. Speed and quality are the visitor's own settings. A moving date would make a link to a moment meaningless.
- **Implementation choices made without a decision from the user:**
  - A date without a time means UTC midnight; a time must carry its zone; days that don't exist on the calendar (2061-02-30) are rejected.
  - A link cuts straight to the view, with no fly-in, and is applied on the first frame, once the planets are where the date puts them.
  - The overview and English are the bare address: no `body=sun`, no `lang=en`.
  - Two smoke cases keep key presses where the keys are what's tested (arrows, and V / M / Escape); one new case covers links.

## 8. The release gate tests the production build

- **Date:** 2026-10-29.
- **Goal:** GO / NO-GO depends on what visitors get, not on development tooling.
- **Decision:** The release gate's browser tests run against the production build (`npm run build`, then `SMOKE_PREVIEW=1 npm run test:smoke`, as CI does) and against Vercel previews. The dev-server browser suites (`tests/browser/*.test.mjs`, the Phase 8 runs) stay for development and don't decide GO / NO-GO.
- **Alternatives:** The Phase 8 harness, which runs most browser suites against the Vite dev server, as the gate. Phase 8.7 ended NO-GO on 13 failed page startups while the dev server answered HTML and module requests.
- **Why:** Visitors never meet Vite's dev server or its dependency optimizer. A startup failure there is a development problem to fix, not a release blocker. The production build is what ships.
- **Refines:** entry 6, which said "on the built app" for CI. This makes it the rule for releasing too.

## 9. The dev server doesn't watch generated evidence

- **Date:** 2026-10-29.
- **Goal:** Dev-server startup stays fast and predictable, whatever QA has left on disk.
- **Decision:** Vite's file watcher ignores `tests/artifacts/**` and `tests/experiments/**` (`server.watch.ignored` in `vite.config.ts`).
- **Why (measured):** In isolated worktrees, the `mobile-panels` suite took 44–48 s cold. With the 22,749-file `tests/artifacts` tree present, it took 64–68 s, under either `optimizeDeps` configuration. The user's `optimizeDeps` change (`entries`, `noDiscovery`) was ruled out as the cause of the Phase 8.7 startup failures and stays.

## 10. Dev-server suites warm the server up before their first test

- **Date:** 2026-10-29.
- **Goal:** No test pays for the dev server's cold start, without raising any test's timeout.
- **Decision:** Each dev-server browser suite loads the app once in a throwaway browser at the end of its setup (`tests/browser/helpers/warmup.mjs`), until it reaches keyboard mode. The warm-up has its own allowance (120 s), and a suite whose server can't serve the app fails in setup with the reason. Test timeouts are unchanged. Suites against a production build or a deployed URL don't warm up, because there is nothing to compile.
- **Why (measured):** A cold first page load took 11–15 s, and the suites allow 15 s for it, so whichever test ran first failed whenever the machine was a little slower.
- **Alternatives:** Raising the page timeouts (rejected by the user); Vite's `server.warmup` config (it warms modules, not the dependency optimizer and the browser's first full load).
- **Not covered:** `tests/browser/phase8.test.mjs` and `tests/browser/release.test.mjs` hold uncommitted user work and were left untouched. Each needs `await warmUp(chromium, baseURL)` in its `before`, unless it runs on the production build.

## 11. Generated evidence lives outside the repository

- **Date:** 2026-10-29.
- **Goal:** QA evidence doesn't slow the dev server, can't be committed by accident, and doesn't pile up.
- **Decision:**
  - New evidence runs (`newEvidenceRun`) go to a sibling folder, `../<repository folder>-artifacts` (`../hand-gesture-artifacts` here). `GSE_EVIDENCE_DIR` overrides it.
  - A folder inside the repository is accepted only if git ignores it (`/*-artifacts/` and `/tests/artifacts/generated/` are ignored).
  - `npm run evidence:clean -- --keep N` keeps the newest N runs (default 10). It only lists what it would delete unless given `--yes`.
  - Curated, tracked evidence under `tests/artifacts` (the Phase 6 hardware results, for example) stays where it is.
- **Done:** The 92 existing runs (20,443 files, 939 MB) were moved to `../hand-gesture-artifacts` on 2026-10-29, checked file by file. Nothing was deleted; `evidence:clean` waits for the user's confirmation of its list. The reports' links into `tests/artifacts/generated/` were left as they are, by decision (no junction: a recursive delete through it would reach the evidence).
- **Side effect:** `scripts/evidence-path.mjs` was listed among `verify-release.mjs`'s source-integrity files. That turned out to be a presence check, not a stored hash, so there was no baseline to update. The harness is now archived (entry 13).

## 12. v2.4 ships from this branch; its gate is a real-phone check

- **Date:** 2026-10-29.
- **Goal:** Get v2.4 (auto-quality and Auto, deep links, CI, the fixes since 2.3.1) to users without waiting for Mars v2.5.
- **Decision:**
  - v2.4 is released from `feat/v2.4-auto-quality`, not cut again from v2.3.1.
  - The unfinished Mars v2.5 work stays behind `?flags=cinematic`, `operations` and `build`. The three finished redesigns (habitats, landing platform, rover and utility infrastructure) ship on by default.
  - A CI smoke test proves Mars works with every flag off.
  - Before the tag, the user checks a Vercel preview on a capable phone and an older one. The tag waits for that report.
- **Alternatives:** A `release/v2.4` branch from the v2.3.1 tag with only the v2.4 commits cherry-picked. Tried in a throwaway worktree, 12 of 15 commits conflicted: the v2.4 code is built on the Mars code in `main.ts`, and the test infrastructure exists only on this branch.
- **Why:** A clean cut would mean redoing most of v2.4. The flags already keep the unfinished parts out of sight.

## 13. The Phase 8 release tooling is archived

- **Date:** 2026-10-29.
- **Decision:** These move to `archive/phase8/` in one commit, nothing deleted:
  - the 10-stage `verify-release` runner, with its policy, process runner, registry and runner tests (`npm run verify:quick` and `verify:release` are removed);
  - acceptance-identity freezing and the Windows input observer;
  - the frozen browser-case inventory;
  - release acceptance, source integrity, TAP parsing, the WebGL canary, the startup-diagnostics tests and tools, and the mobile-builder stress runner.

  The browser suites stay as development tests. CI is the gate (entries 6 and 8).
- **Kept:**
  - the browser suites and their helpers;
  - the per-test page-evidence helper (`helpers/evidence.mjs`), which writes nothing unless `MARS_QA_EVIDENCE_DIR` is set, and only the archived runner set that;
  - `scripts/evidence-path.mjs` and `scripts/clean-evidence.mjs`, whose tests moved to `tests/evidencePath.test.ts`;
  - `scripts/three-recovery/` (the app's patched three.js);
  - the Mars measurement scripts and the Phase 8 reports in `tests/audit/`.

  `helpers/environmentInventory.mjs` now carries its own copy of `npmVersion`, so it no longer imports the archived runner.
- **Goal:** Release tooling that costs no upkeep. On its last day in use, three fixes were needed just to keep it green.
- **Not moved:** the user's untracked `tests/audit/vite-dependency-entries.test.mjs` and `tests/audit/phase8-5-acceptance-and-governance.md`, and the user's uncommitted edits to `verify-release.mjs`, which went to `archive/phase8/` with the file, still uncommitted.

## 14. Debugging aids: a GPU-memory bound and a copyable report

- **Date:** 2026-10-29.
- **Decision:**
  - The 8-cycle High rebuild test also asserts that GPU memory stays bounded: from `renderer.info` (WebGL reports counts, not bytes), the geometry count repeats per operations state and the shader program count doesn't grow.
  - The user asked for this to close the page-loss issue as covered. Clean reruns then showed the page loss happens while those counts stay constant (70 textures in every sample), so the bound can't explain it. The issue stays open in `docs/open-issues.md` until the user confirms how to treat it.
  - `?debug` gets a **📋 Copy report** button next to its lines. It copies the link, the device and the debug lines (including any ⚠ incident) to the clipboard. It is local only and sends nothing.
- **Implementation choices made without a decision from the user:**
  - `?debug` now shows its panel with the camera denied too (stats only, no empty mirror). Before, the panel was hidden until hand tracking started.
  - Where the clipboard is refused, the report text is shown selected, so it can be copied by hand.

## 15. v2.5 starts by splitting the frame loop into named phases

- **Date:** 2026-10-29.
- **Decision:** The first step of v2.5 is to split `main.ts`'s frame loop into named phases (input, simulation, scene, render, UI), before more Mars work lands in it. It is not part of v2.4.
- **Goal:** Per-frame concerns (Auto, resolution scaling, deep links, cinematic, Build) stay reviewable as v2.5 adds more.
- **Also deferred to v2.5:** the hand-tracking Web Worker, after the user's real-phone baseline.

## 16. v2.4.0 is released; from now on, short-lived branches

- **Date:** 2026-10-29.
- **Decision:**
  - v2.4.0 is tagged on the release commit `ed12b83` and `feat/v2.4-auto-quality` is merged into `main` (a fast-forward, so the tag is on `main`). The real-phone check passed on Android Chrome: overview, Jezero base, horizon view, hand control (GPU) and a landing.
  - v2.4 shipped from a long-running feature branch, with the unfinished Mars work hidden behind `?flags=cinematic`, `operations` and `build` (entry 12).
  - From now on: short-lived branches. One feature per branch, merged into `main` within days. A feature that isn't finished when its branch merges stays hidden behind a `?flags=` flag.
- **Goal:** `main` stays releasable, and a release is cut from `main` rather than from a branch that has drifted from it.
- **Alternatives:** Keep one long-running branch per release, as v2.0–v2.4 did.
- **Why:** v2.4's branch ran 61 commits ahead of `main`. Cutting a clean release from `v2.3.1` was impossible: 12 of 15 commits conflicted (entry 12).

## 17. v2.5 is polish and tech debt; `?reset` gives user tests a first visit

- **Date:** 2026-10-29.
- **Decision:**
  - v2.5 adds no features. Its items:
    1. split the frame loop into named phases, with no behavior change;
    2. document the patched three.js and decide whether to keep or upgrade it;
    3. lazy-load mission, base and Build code;
    4. a first-visit mode for user tests;
    5. a Burmese review file of the strings not yet reviewed, with a glossary.
  - Each item gets its own branch, merged into `main` when green (entry 16). Items 1 and 3 start with a proposal that the user approves first.
  - Item 4: `?reset` forgets everything the app saved on this device, so the next tester starts fresh. No tracking, nothing uploaded.
- **Implementation choices made without a decision from the user:**
  - `?reset` removes only the app's own `gse.` keys, before anything reads them.
  - It shows no message, because a tester's first visit shouldn't look different from anyone else's.
  - `reset` then drops out of the address, so a reload mid-test keeps the tester's progress. Other parameters stay, so `?reset&base=jezero` opens Jezero fresh.
  - Camera permission belongs to the browser and isn't reset: use the site settings or a private window.
- **Next after v2.5 (candidates, not decided):** a gesture tutorial (depending on the user tests), the hand-tracking Web Worker, a sky events list, a Moon showcase.

## 18. The patched three.js: what it changes, why, and keeping it

- **Date:** patched 2026-10-27 (`413f13e`). Documented and checked upstream 2026-10-29.
- **Superseded in part (2026-10-29, entry 19):** the user chose B and C. The patch is now applied by `patch-package`, and its tests run in `npm test`. "How it's applied" below describes the archived setup (`archive/three-recovery/`).
- **The bug (three.js 0.186.1, WebGLRenderer):**
  - After a WebGL context loss and restore, three.js builds a new set of GPU managers (`initGLContext()`). The old managers' `dispose` listeners stay attached to every texture, geometry and render target created before the loss.
  - When such a resource is disposed later, the obsolete manager's handler runs. It deletes GL handles from the lost context, giving `GL_INVALID_OPERATION` (1282). This was reproduced with a minimal `DataTexture` probe on unpatched 0.186.1: `tests/experiments/phase85-upstream/`.
  - The obsolete handlers also keep the old managers alive, and some do more than delete: the render-target handler disposes its depth texture, and the geometry handler changes shared instancing state. So guarding `gl.deleteTexture` alone wouldn't be enough.
  - In the app, the WebGL recovery browser tests hit it as GL 1282 in two places: `deleteTexture` after a restore, and `deleteBuffer` / `deleteVertexArray` when the restored scene's resources were disposed (`tests/audit/phase81-webgl-recovery.md`, `tests/audit/webgl-resource-lifetime-repair.md`).
- **What is patched:**
  - Every `dispose` subscription the WebGL managers make goes through a scope that belongs to one context generation (`createDisposalScope`, `scripts/three-recovery/lifetime-scope.mjs`).
  - On context loss the scope is abandoned: its listeners are detached, and wrappers already queued do nothing. No GL calls, no public `dispose` events.
  - Restoring creates a new scope for the new managers. Disposal in a live context, and after `renderer.dispose()`, works as before.
  - The scope holds owners and callbacks weakly, so it keeps nothing alive.
  - **Files changed:** the renderer and seven managers (`WebGLTextures`, `WebGLGeometries`, `WebGLObjects`, `WebGLUniformsGroups`, `WebGLMorphtargets`, `WebGLEnvironments`, `WebGLShadowMap`), in `build/three.module.js`, which is what the app bundles: 12 subscriptions, 11 removals, 1 check. The same changes go into their `src/` copies, plus one new helper file. The WebGPU renderer is untouched.
- **How it's applied:**
  - `vite.config.ts` aliases `three` to a patched copy, made by `scripts/three-recovery/prepare.mjs` under `node_modules/.cache/gse-three-recovery/`. The installed package isn't changed. The addons import `three`, so they get the patched copy too.
  - The installed package is pinned by hashes of all 1,263 files, so any other three.js version fails the build until the patch is reviewed.
  - **Cost:**
    - +3.95 kB minified (+1.23 kB gzipped) in the main bundle;
    - about 7 s on the first config load (0.26 s after that);
    - 461 lines of scripts.
  - Its 15 tests (`tests/experiments/recovery-lifetime/*.test.mjs`) pass, but nothing runs them: `npm test` and CI only pick up `tests/**/*.test.ts`.
- **Upstream, checked 2026-10-29:**
  - The latest release is still 0.186.1 (2026-09-24).
  - On the `dev` branch (`1083c7c`, 2026-10-29), `onContextLost` still only sets a flag, and `onContextRestore` still builds new managers without detaching the old listeners. So the bug is still there.
  - `dev` does add a `WebGLTextures.dispose()` run by `renderer.dispose()` (PR #34530, for r187). That cleans up at renderer teardown, not after a restore, so it doesn't fix this.
  - No matching upstream issue was found. A drafted issue is in `tests/experiments/phase85-upstream/README.md`, not posted.
- **Upgrading isn't an option yet:** no release fixes it.
- **Options:**
  - **A. Keep it as it is.** It works and is well guarded, but it's 461 lines of custom cache and pinning code to maintain.
  - **B. Keep the patch, applied by `patch-package`.** A `patches/three+0.186.1.patch` diff, applied on `npm install` (`postinstall`), would replace the copy, the alias and the hash pin.
    - It needs only `build/three.module.js` plus the helper, since nothing imports three's `src/`.
    - `patch-package` refuses a patch made for another version, so an upgrade still stops for review.
    - The cost is one devDependency, and the installed `node_modules/three` is now modified, which the original repair avoided on purpose.
  - **C. Report it upstream** (the drafted issue), alongside A or B, and drop the patch once a release fixes it.
- **Recommendation:** B and C, with the patch's tests run by `npm test`, so CI covers them. The patch's behavior doesn't change. Only its packaging does.

## 19. v2.5 choices: phases kept in order, flagged code lazy, `patch-package`, security policy, Burmese style

- **Date:** 2026-10-29.
- **Superseded in part (2026-10-30, entry 20):** operations stays in the main bundle. Only Build and the camera views load with their flag.
- **Decision:**
  - **Frame loop (item 1):** split into named phases without reordering anything, as proposed. A test pins the one ordering constraint: a deep link is applied after the planets are placed for that frame.
  - **Lazy loading (item 3):** option B. Only the code behind `?flags=` (Build, the camera views, operations) loads on first use. The mission and base code stays in the main bundle.
    - **Next:** a startup texture plan. Load only what the overview shows: small placeholders first, then 2K. The Moon, Pluto, Halley and the moons load only on focus. Measured on the production build before and after, as a proposal first. Textures are the real startup cost: 4.21 MB, against 0.30 MB of JavaScript.
  - **three.js patch (item 2):** option B and C from entry 18.
    - The patch is applied with `patch-package` instead of the copied, aliased package.
    - The patch's tests run in `npm test`, so CI runs them.
    - The user posts the upstream issue on GitHub; Claude drafts the text.
  - **`SECURITY.md`** replaces GitHub's template with a short policy for this project. The latest release is the supported version. Reports go privately through GitHub security advisories. The camera and privacy are in scope.
  - **Burmese:**
    - The landing pad is **ဆင်းသက်ကွင်း** everywhere.
    - Sentences use the spoken polite style (…ပါတယ် / …ပါ). Short button labels stay plain nouns.
    - Both rules go into the glossary in `docs/i18n-review-my.md`. The user still reviews the full file.
- **Goal:** Startup cost goes where it's measured, the engine patch has upkeep CI can see, and the Burmese UI reads with one voice.
- **Implementation choices made without a decision from the user (three.js patch):**
  - **The patch is unchanged.** `patches/three+0.186.1.patch` holds the same 10 files the old setup produced: `build/three.module.js`, the renderer and seven managers in `src/`, and the helper. The production bundle is byte-identical before and after (`index-Dk4EEos3.js`).
  - **How it runs:**
    - `postinstall` runs `patch-package --error-on-fail --error-on-warn`, so a failed patch, or one made for another three.js version, fails the install.
    - `.gitattributes` keeps the patch file LF on every checkout.
    - `patch-package` 8.0.1 is pinned exactly. It adds 123 packages to the development install.
  - **Tests:** the old 15 counted the copy-cache test's subtests. `tests/threePatch.test.ts` now runs 10 tests against the installed package, and with the patch reversed they fail.
    - 8 are carried over: on the scope, the geometry manager, the routes, and loss versus `renderer.dispose()`.
    - 2 are new: the installed version is the one the patch was made for and the patch is applied, and the bundle carries the same helper as `src/`.
    - Dropped: the tests of the copy cache, the hash pin and the copy writer, which are gone.
  - **Archived, not deleted:** the copy, alias and pin scripts, and the experiment folder, moved to `archive/three-recovery/`.
  - **Not changed:** the standalone upstream reproducer `tests/experiments/phase85-upstream/` stays. It is what the upstream issue points to.

## 20. v2.5 close-out: moving worktrees, the release path as it really is

- **Date:** 2026-10-30.
- **Worktrees:**
  - The main checkout and three worktrees (`hand-gesture-v25`, `hand-gesture-autotier`, `hand-gesture-v2.3.1`) had been moved into one parent folder as plain folders. The links between them broke: git failed inside each worktree, and so did `tests/evidencePath.test.ts`, which runs `git check-ignore`. `git worktree repair` from the main checkout fixed all three (659 / 659 unit tests after it).
  - **Rule:** move a worktree with `git worktree move <worktree> <new path>`, never with the file manager. The main checkout can't be moved that way: after moving it, run `git worktree repair <each worktree>` from it.
  - Still broken and left as they are: two old temporary worktrees. `git worktree prune` would drop their records.
- **Lazy loading (entry 19, item 3):** Build and the camera views load only with their `?flags=`. Measured on the production build without flags: 892.6 kB / 254.2 kB gzip of JavaScript at startup, from 899.5 kB / 254.5 kB. The operations controller stays in the main bundle: the base kit imports it statically, and it is 2.5 kB of source.
- **Superseded documents:** `release-candidate-v2.5.0.md`, `v2.5-release-gate-contract.md`, `release-notes-v2.5.0.md`, `release-notes-v2.5.0-rc-phase7.md` and `verification-phase83.md` describe the Phase 7/8 "v2.5.0", whose scope shipped as v2.4.0 (entries 12 and 16). Each now says so at the top. Nothing was moved or deleted.
- **The release path, as found:**
  - The repository is private on GitHub's free plan, so branch protection isn't available (entry 6 assumed it). "Merge only when CI is green" is a rule we keep, not one GitHub enforces.
  - Vercel's Git integration was never connected (no deployments are recorded on GitHub). So PRs get no preview, `preview-smoke.yml` has never run, and merging to `main` doesn't deploy. Production is deployed with the Vercel CLI.
  - CI had never run on GitHub: the commits that add it were never pushed. The v2.5.0 PR is its first run, and the smoke tests' first run on Linux.
- **Decision (v2.5.0):** one PR, `release/v2.5.0` → `main`, holding everything since `origin/main`: the 2.4.0 release and the v2.5 items.
  - Its last commit is the 2.5.0 release candidate, so the phone check sees the version that will be tagged.
  - The phone check uses a Vercel CLI preview of that commit.
  - When CI is green and the phone check passes, `main` is fast-forwarded to the tested commit, and the tag goes on it. No squash or rebase: both would rewrite commits that are already tagged (v2.4.0).
- **Why:** The tag, the tested commit and the deployed build stay one and the same commit, with the tools this repository actually has.

## 21. AstroLife 2126: a flagged shell, on-device only

- **Date:** 2026-10-30. Decided by the user after the Phase 0 audit.
- **Goal:** A personal project. Explore, book a fictional trip, fly it in the existing explorer and keep a souvenir, without breaking the explorer or its privacy promise.
- **Decision:**
  - **No exhibition.** The exhibition phase, operator check-in, kiosk timeouts and printable souvenirs are dropped from the roadmap.
  - **No backend.** Everything stays on the device (local storage), in a "demo mode". `SECURITY.md`'s promise stays as it is: no server, no third-party requests, the camera image never leaves the device.
  - **Check-in** is a button in the app. The boarding-pass QR code is a souvenir: it opens a deep link and authorizes nothing.
  - **Camera:** requested only when the explorer opens.
    - `/` stays the explorer, so a visitor without the flag sees no change: the explorer opens at once, and so does the camera request.
    - With `?flags=astrolife`, the hub opens first and the camera waits until the explorer does.
  - **Name:** the app keeps its name. "AstroLife 2126" is the shell's brand only.
  - **Colours:** cyan for the shell; amber stays the explorer's.
  - **First journey:** Cape Launch Center (Earth) → Jezero Dome (Mars).
  - **MVP:** hub, destinations, the Mars booking, boarding pass, journey, landing, journey stamp, postcard. All of it behind `?flags=astrolife`.
  - **After the MVP is live:** NOVA (the AI guide), seat maps, route comparison, spacecraft variants.
- **Alternatives (from the audit):** a shared backend (Vercel Functions with a hosted database, or a server on the local network) for check-in from a second device; the hub as the default page; renaming the app.
- **Why:** With one person on one device, nothing needs shared state, so a server would only add cost and risk, and would break the privacy promise.
- **As proposed in the audit, not separately decided:** a journey stamp is given only when a booked journey lands at its destination. The explorer's own visited stamps stay as they are: today any arrival at a base stamps it, a deep link too.

## 22. AstroLife: the boarding pass's QR code is a souvenir link, made by lean-qr

- **Date:** 2026-10-30. Decided by the user; the library chosen by measurement.
- **Decision:**
  - **What the QR holds:** a link to this app with the pass after the `#`, `?flags=astrolife#souvenir=1&ref=…&nick=…&av=…&fl=…&cab=…` (`src/travel/souvenir.ts`). A fragment never leaves the browser, so nothing reaches a server and `SECURITY.md` is unchanged. Any phone opens it as a keepsake; it is not a ticket and authorizes nothing.
  - **Reading a link:** every field is checked: the reference against the booking pattern, the avatar, flight and cabin against their lists, the nickname as a booking's would be. A fragment over 400 characters, a missing, extra or repeated field, or any bad field, and the whole souvenir is ignored: the shell opens on its hub. The route and the date come from the timetable via the flight number, never from the link. Fields are shown as text only: a test fails if `innerHTML` or its relatives appear in `src/shell` or `src/travel`.
  - **Nickname:** the field is labelled "Nickname" (နာမည်ပြောင်, ニックネーム), with a hint saying it appears in the souvenir link, so people don't put their real names into a shareable link. Nicknames, booked or linked, may hold only letters, marks, digits, emoji, spaces and `. ' ’ - ・`, at most 24 characters: no markup, URL, address or text-direction override.
  - **Library:** `lean-qr` 2.7.4 (MIT, no dependencies, published 2026-09-07), pinned exactly, imported only by the shell. Error correction M, dark on white with a four-module quiet zone, drawn as SVG with `createElementNS`.
- **Measured** (each candidate bundled minified with the app's Vite, encode only):

  | Package | License | Size | Gzip |
  |---|---|---:|---:|
  | `lean-qr/nano` | MIT | 5.67 kB | 2.60 kB |
  | **`lean-qr`** | MIT | 10.38 kB | **4.35 kB** |
  | `uqr` | MIT | 14.47 kB | 4.46 kB |
  | `qr` | MIT or Apache-2.0 | 21.49 kB | 7.39 kB |
  | `qrcode-generator` | MIT | 32.96 kB | 8.55 kB |

  - Every candidate's codes for three souvenir links (Latin, Burmese and Japanese with emoji nicknames) decoded back exactly with an independent decoder (`qr/decode.js`).
  - The codes in screenshots of the real boarding pass (390×844 phone, 1280×800 desktop) decoded back to the exact link.
  - The shell's chunk with the QR code and the pass: 42.9 kB / 16.6 kB gzip. Without the flag nothing more is downloaded.
- **Why lean-qr:** the smallest that lets the app require error correction M (the nano build picks its own level), and maintained. A hand-written encoder (~400 lines) would have been code to keep correct for no size gain.

## 23. AstroLife: journeys fly on real launch-window dates, and give the visitor's clock back

- **Date:** 2026-10-30. Decided by the user; the 2127 departure is an implementation reading, below, awaiting confirmation.
- **Decision:**
  - **Departures** come from real Earth → Mars launch windows (`src/travel/windows.ts`). `launchWindows(from, to, year)` finds when the target leads the origin by the Hohmann phase angle, φ = 180° − 360° · t / T₂, with the planets' longitudes from the ephemeris, to the minute. Earth → Mars: a 258.9-day transfer, φ = 44.3°.
  - **Boarding** jumps the clock to the booked departure and runs it. The banner in the explorer says "Simulation" with the booking reference.
  - **Leaving the journey for free roam** puts the visitor's date, speed and pause back exactly as they were (`src/app/journey.ts`). The journey lasts while at the spaceport before lift-off, during launch, flight and docking, and at the destination after landing. Anything else ends it: a body, the overview, another base, or AstroLife's hub.
  - **The journey stamp** is the completed booking: a landing at the booked destination, after a lift-off from the spaceport to it, completes the booking once (the store's state machine). Nothing else can make one.
- **2126 has no Earth → Mars window.** Windows come every ~26 months: the model puts them at 2125-01-29 and 2127-03-06. So the timetable reads the decision as: it is 2126 in AstroLife, and bookings are for the next window from the start of 2126. Three liners leave at 09:00 UTC on 2127-02-20, 2127-03-06 and 2127-03-20, two weeks either side of the window's centre. The booking form says so. If the user prefers departures dated 2126, the alternatives are the 2125 window (in the past for a 2126 story) or dates in 2126 outside any real window.
- **Accuracy, measured:** circular, coplanar orbits are assumed for φ, so a window's centre lands within about two months of real missions' launches (Curiosity 21 days, MAVEN 62, ExoMars 21, InSight 31, Perseverance 56; the tests allow 65). Mars's eccentric orbit accounts for the gap. The ephemeris is JPL's approximate elements, valid 1800–2050 and extrapolated beyond. Good for a fictional timetable, not for flying; the UI calls the window real and the 9-day crossing fiction.
- **Why:** The dates are the one thing in the timetable that can be true, so they are; everything else is labelled fiction.

## 24. The AstroLife MVP ships in v2.6.0, off by default

- **Date:** 2026-10-30. Proposed; the release waits for green CI and the user's phone check.
- **Decision:** v2.6.0 carries the whole MVP of entry 21 (hub, destinations, Cape → Jezero booking, boarding pass with souvenir QR, the journey, landing, the journey stamp, the postcard) behind `?flags=astrolife`. `/` stays the explorer, unchanged. The flag comes on by default only by a later decision, after real phones and a native Burmese review.
- **Measured** (production builds, this repository's Windows machine):
  - **Without the flag:** 258.00 kB gzip of JavaScript and CSS at startup, from 257.25 kB in 2.5.0 (+0.75 kB: the journey rules and capture code that live with the explorer). No AstroLife DOM, CSS or chunk is requested (a smoke case checks).
  - **The shell:** 57.1 kB / 21.4 kB gzip of JavaScript, `lean-qr` included, plus 10.1 kB / 2.9 kB gzip of CSS, loaded only with the flag.
  - **GPU resources over 10 hub ⇄ explorer round trips** (High, RTX 4060 laptop, ANGLE D3D11, dev server): geometries 61 → 81, textures 51 → 54, shader programs 62 → 69 over the first five, then flat to the tenth; zero GL errors. The explorer alone (Mars ⇄ Jezero with `V` / Escape, no shell) settles at 80 / 54 / 69 the same way: the growth is the scene's warm-up, not the shell's.
  - **Contrast:** every text colour in the shell is at least 6.0:1 against its panel, even assuming white behind the panel's 12 % transparency; the postcard's at least 5.1:1.
  - **Accessibility, automated:** on a 390 × 844 phone, in English, Burmese and Japanese, every AstroLife screen that needs no booking has a dialog title and no unnamed control, the page's language follows, and nothing scrolls sideways (a smoke case). Tabs are 44 px tall.
- **Not verified, so not claimed:** real phones (Android Chrome, iOS Safari), Firefox and Safari on a desktop, a screen reader, the camera prompt on a real device, and the 113 new Burmese strings (`docs/i18n-review-my.md`, last section).
- **Phone check for the release** (a Vercel preview, `?flags=astrolife`, with `?debug` once to copy its report): the hub over Mars; the camera prompt appears only after Open the explorer; book Jezero, check in, scan the QR with another phone (it opens the souvenir); Begin journey, launch, land (auto-land is fine); the stamp, a postcard saved to the photo library; back to the hub; the date is back to today in free roam; in Burmese and Japanese too.
