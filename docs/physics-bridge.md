# Physics bridge boundary

## Responsibilities

- The current `src/sim/travel.ts` Bezier flight remains presentation-only. It is not a force model or a trajectory solution.
- A future trajectory/ephemeris module owns solar-system-scale states, transfer solving, and long-duration propagation.
- The Jolt/WebAssembly bridge owns local rigid-body motion, collision detection, and contact response near a destination. Its world uses a local inertial frame and SI units: metres, kilograms, seconds, newtons, m/s, and rad/s.
- Three.js scene coordinates and compressed orbit radii never cross this boundary. Convert a local physics state to scene coordinates in a separate renderer adapter.

Jolt's uniform world gravity is appropriate only for a local operating volume. It is not a substitute for solar-system gravity or a central-body force model. If the local simulation later needs materially varying gravity, add an explicit force-field interface in the native adapter; do not encode it as Three.js motion or silently approximate it in the orbit propagator.

Each world carries a `LocalInertialFrame`: origin body, TDB epoch, ICRF state of the local origin, and a normalized local-to-ICRF rotation. At the frame epoch, convert states with `rIcrf = rOrigin + R * rLocal / 1000` and `vIcrf = vOrigin + R * vLocal / 1000`; local positions are metres and local velocities are m/s. Construct the frame and transform the base/site state from one consistent ephemeris and orientation source. This snapshot does not model an accelerating or rotating origin. A body-fixed pad treated as static in the local world is only a short-duration approximation; realistic surface contact over longer intervals needs moving terrain or explicit rotating-frame terms and updated frame transforms.

## ABI

`physics/wasm/gse_physics.h` is the C-compatible ABI. `src/physics/joltWasm.ts` is its TypeScript adapter. Keep the two sides in lockstep:

- ABI version must change when a function signature, enum value, or packed buffer layout changes.
- Export only the `gse_*` functions plus Emscripten memory allocation functions required by the adapter.
- Handles are opaque, nonzero `uint32_t` values. Every operation returns an explicit status; zero-filled states and successful fallbacks are not valid error handling.
- `gse_body_get_state` writes exactly 13 float32 values in the order documented in the header. Each call obtains a fresh view from the module because WebAssembly memory growth can replace typed-array views.
- Packed arrays avoid compiler-dependent C++ struct padding at the JS boundary. Validate pointer arguments and all numeric inputs in the native implementation too; TypeScript validation is not a security or correctness boundary.

## Time stepping and ownership

`PhysicsWorld.advance()` accepts elapsed wall time and submits only fixed-size steps. If catching up would exceed `maxSubSteps`, it throws `PhysicsOverloadError` before advancing; the caller must explicitly pause or retry the elapsed time in smaller chunks rather than silently clamping or discarding it. A native step failure faults that world; dispose it and report the failure rather than continuing with a success-shaped state.

Worlds and bodies have explicit owners. Dispose a body when its local simulation object leaves the world, then dispose the world when leaving the local-physics phase or tearing down the app. Do not retain Jolt handles across world destruction. `loadJoltWorld()` keeps module initialization asynchronous; stepping is synchronous, so production integration should run it in a worker if profiling shows frame-time impact.

## Not connected yet

This repository does not currently contain an Emscripten/Jolt build, a Jolt dependency, or a compiled `.wasm` asset. The header and adapter define the contract, but they do not claim that Jolt is linked or that the current landing/travel behavior uses rigid-body simulation. Add the native implementation and pinned Jolt/Emscripten build before wiring this into `Mission`; keep the existing presentation path until the physics path has end-to-end tests.
