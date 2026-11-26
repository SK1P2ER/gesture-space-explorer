# Pinned Three.js WebGL restoration repair

The Vite configuration calls `prepareRecoveryThree(root)` and aliases the bare
`three` import to its result. The installed `three@0.186.1`, package.json and lockfile
are never rewritten. Addons resolve the same aliased core through their bare
imports. WebGPU renderers are outside this repair.

The patch scopes engine-owned disposal subscriptions to one context generation.
On context loss it invalidates that scope and detaches only its subscriptions,
without GL deletion, public disposal events or mutation of shared current objects.
Restoration builds new managers. Current-generation cleanup and later independent
resource cleanup after renderer.dispose retain their ordinary behavior.

The weak registry holds neither resource owners nor owner-capturing callbacks
strongly. Finalization prunes collected entries; normal disposal removes them
immediately. This avoids accumulating old manager closures across restorations.
Textures, geometry/attributes/VAOs, instanced objects, uniform groups, morph
targets, environments, shadow resources and renderer material callbacks are covered.

`patch-three.mjs` verifies exact baseline package/runtime/source identities and
transformation anchors. `prepare.mjs` additionally pins the complete installed
package inventory. Copies are independent regular files under
`node_modules/.cache/gse-three-recovery/`, keyed by installed content and patch
implementation bytes. Every reuse validates the immutable copy. Corruption fails
rather than deleting or overwriting an existing cache entry. Concurrent config
loads publish only a complete index. Partial/unreferenced generated entries are
preserved and never selected as valid cache entries.

Helper injection uses canonical source bytes, not function.toString(), so direct
Node execution and Vite's bundled configuration produce identical output. The
cache tests exercise both modes against the same entry.

An installed dependency change intentionally fails this pin. Review an upstream
fix or rebase this patch in isolation, rerun its minimal/resource probes and the
full application acceptance before updating these identities. Do not merely
replace hashes to bypass a mismatch. No released upstream fix was verified when
this repair was prepared on 2026-10-27.

Verification:

```powershell
node --test tests/experiments/recovery-lifetime/scope.test.mjs tests/experiments/recovery-lifetime/prepare.test.mjs
npm.cmd run verify:quick
npm.cmd run verify:release
```

The release command includes these engine/cache tests. A clean automated result
does not authorize production or replace physical-device/camera/browser evidence.
