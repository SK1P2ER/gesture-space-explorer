# CI: the release gate

> このリポジトリは、非公開の開発用リポジトリから書き出したスナップショットです。そのため、以下の CI の説明には、その開発用リポジトリの構成について書かれた部分があります。
>
> This repository is a snapshot exported from a private development repository, so some of these CI notes describe that repository's setup.

Every pull request must pass CI before it can merge. A release is tagged only from a commit
that passed it (see `docs/decisions.md`, entries 3 and 6).

**As of 2026-10-30** (`docs/decisions.md`, entry 20): the repository is private on GitHub's free
plan, so branch protection isn't available and nothing *enforces* this. Merge only when CI is green.
Vercel's Git integration isn't connected either (the one-time setup below hasn't been done), so PRs
get no preview, the preview smoke job doesn't run, and production is deployed with the Vercel CLI.

## What runs

| Workflow | Job (status check name) | When | What |
|---|---|---|---|
| `ci.yml` | `check (typecheck, unit tests, build)` | every PR; pushes to `main` and `hotfix/**` | `npm ci`, `npm run typecheck`, `npm test`, `npm run build` |
| `ci.yml` | `smoke (browser, production build)` | after `check` passes | builds, installs Chromium, runs `npm run test:smoke` against the built app |
| `preview-smoke.yml` | `smoke (Vercel preview)` | when Vercel reports a successful **preview** deployment | the same smoke tests against the deployed preview URL |

The smoke tests (`tests/browser/smoke.test.mjs`) are 22 short cases, one per area that must
never break. They cover startup in keyboard mode (with no AstroLife code downloaded), the webcam
being released after a failure, retrying the camera, planets, languages, deep links and the
address bar, Jezero and M, launching a mission, the Builder, keyboard ownership of controls,
photos, a phone layout, Mars with every `?flags=` off (only the finished redesigns), the `?debug`
report, `?reset`, and the AstroLife shell (`?flags=astrolife`): its camera staying off until the
explorer opens, its destinations on a phone in every language, a booking from start to cancel,
check-in with the souvenir link (a hostile one is ignored), and a booked journey flown from the
spaceport to Jezero, with its stamp and the visitor's date given back, then the passport, a postcard
and forgetting everything, and the accessibility basics of every AstroLife screen in every language.
They use only what a visitor can see or do, so they run against a dev server, the production
build or a deployed URL. They start from deep links (`?base=jezero`, `?body=venus`) rather
than stepping through the app. Rendering is software WebGL on CI, so they run on Low quality
and stay short.

The longer browser suites (`tests/browser/*.test.mjs`) are development tests, not part of the
gate; run them locally when a change touches their area. The Phase 8 release harness
(`verify-release`) is archived in `archive/phase8/`.

three.js is patched on install: `npm ci` (and `npm install`) runs `patch-package`, which applies
`patches/three+0.186.1.patch` and fails the install if it doesn't apply or was made for another
version. `npm test` includes the patch's tests (`tests/threePatch.test.ts`), so `check` runs them.
After pulling this change into an existing checkout, run `npx patch-package` once (or `npm ci`).

Before a release is tagged, a person checks the deployed preview on real phones (a capable
one and an older one); see the release checklist for the version.

## Running it locally

```powershell
npm run typecheck; npm test; npm run build
$env:SMOKE_PREVIEW = '1'; npm run test:smoke     # the built app (as CI runs it)
Remove-Item Env:SMOKE_PREVIEW; npm run test:smoke # the dev server
$env:SMOKE_URL = 'https://<preview>.vercel.app'; npm run test:smoke
```

`playwright-core` is a pinned dev dependency. Install its Chromium once with
`npx playwright-core install chromium`.

## Vercel preview deployments (one-time setup)

1. In Vercel, open the `gesture-space-explorer` project → **Settings → Git**, and connect this GitHub
   repository. Vercel then builds a preview for every push to a PR branch,
   comments its URL on the PR, and reports it to GitHub as a deployment. Pushes to `main` become
   production deployments.
2. Previews have **Deployment Protection** (Vercel Authentication) on by default. For the preview
   smoke job to get in: **Settings → Deployment Protection → Protection Bypass for Automation**,
   create a secret, then add it in GitHub under **Settings → Secrets and variables → Actions** as
   `VERCEL_AUTOMATION_BYPASS_SECRET`.
3. The production branch should stay `main`. Because pushing to `main` deploys production, merge
   to `main` only what is meant to go live.

`preview-smoke.yml` does nothing until step 1 is done. It has not been run yet: the first preview
after setup is its first test.

## Branch protection

Branch protection and rulesets on a **private** repository need a paid plan (GitHub Pro, Team
or Enterprise); GitHub Free offers them on public repositories only. Check your plan before
relying on this.

In GitHub: **Settings → Branches → Add branch ruleset** (or classic **branch protection rule**) for `main`:

- Require a pull request before merging (approvals: 0 if you work alone).
- Require status checks to pass, and require branches to be up to date before merging. Add the
  checks `check (typecheck, unit tests, build)` and `smoke (browser, production build)`. They
  appear in the list after CI has run once on a PR.
- Optionally also require `smoke (Vercel preview)`, once Vercel previews are connected.
- Block force pushes and deletions.

Apply the same rule to `hotfix/**`, so a hotfix is tagged only from a passing commit.

The same rule from the command line (classic branch protection; repeat for each branch):

```powershell
@'
{
  "required_status_checks": { "strict": true, "contexts": ["check (typecheck, unit tests, build)", "smoke (browser, production build)"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
'@ | gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input -
```

## Cost

On a private repository, Actions minutes count against the plan's monthly allowance (2,000 on
GitHub Free at the time of writing). A PR run is roughly 3 minutes for `check` and 4–5 for
`smoke`, plus the preview smoke job once Vercel is connected.
