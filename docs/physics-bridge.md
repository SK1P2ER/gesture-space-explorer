# Physics bridge boundary

## Responsibilities

- The current `src/sim/travel.ts` Bezier flight remains presentation-only. It is not a force model or a trajectory solution.
- A future trajectory/ephemeris module owns solar-system-scale states, transfer solving, and long-duration propagation.
- The Jolt/WebAssembly bridge owns local rigid-body motion, collision detection, and contact response near a destination. Its world uses a local inertial frame and SI units: metres, kilograms, seconds, newtons, m/s, and rad/s.
- Three.js scene coordinates and compressed orbit radii never cross this boundary. Convert a local physics state to scene coordinates in a separate renderer adapter.

Jolt's uniform world gravity is appropriate only for a local operating volume. It is not a substitute for solar-system gravity or a central-body force model. If the local simulation later needs materially varying gravity, add an explicit force-field interface in the native adapter; do not encode it as Three.js motion or silently approximate it in the orbit propagator.

Each world carries a `LocalInertialFrame`: origin body, TDB epoch, ICRF state of the local origin, and a normalized local-to-ICRF rotation. At the frame epoch, convert states with `rIcrf = rOrigin + R * rLocal / 1000` and `vIcrf = vOrigin + R * vLocal / 1000`; local positions are metres and local velocities are m/s. Construct the frame and transform the base/site state from one consistent ephemeris and orientation source. This snapshot does not model an accelerating or rotating origin. A body-fixed pad treated as static in the local world is only a short-duration approximation; realistic surface contact over longer intervals needs moving terrain or explicit rotating-frame terms and updated frame transforms.

## JavaScript boundary

`physics/wasm/gse_physics.hpp` defines the project's C++ facade and `gse_physics_bindings.cpp` registers that facade with Embind. `src/physics/joltWasm.ts` adapts the Embind module to the app-facing interfaces in `src/physics/contracts.ts`. This boundary is intended for this C++/WASM implementation and its TypeScript caller; it is not a cross-language C ABI.

- Use `enum class` values with explicit `int32_t` underlying types for collision shape and motion. Do not expose Jolt's own types.
- Pass `Vec3`, `Quat`, `WorldDescription`, and `BodyDescription` as Embind value objects. Return `BodyState` as a value object with named fields, not a pointer to a C++ struct or an index-dependent float buffer.
- `physicsAbiVersion()` must change when the exposed method signatures, enum values, or value-object fields/meanings change. Keep the native version and `PHYSICS_ABI_VERSION` in `src/physics/joltWasm.ts` synchronized.
- Native operations report failures by throwing C++ exceptions; Embind surfaces them as JavaScript errors. Never return a zero-filled state or otherwise success-shaped fallback after a native failure.
- The Emscripten build must enable C++ exception catching so native validation and backend failures reach JavaScript.
- Validate all numeric inputs and shape/motion combinations in the native implementation. TypeScript validation improves caller feedback but is not a native correctness boundary.
- Call `.delete()` on Embind-owned objects. Dispose body wrappers before their world, and do not retain native object wrappers after disposal.

Value objects intentionally favor a typed, named interface over minimal marshalling overhead. If profiling later shows per-body state conversion is a bottleneck, add a separate batch API and measure it; do not make ordinary callers manage native layout or memory pointers.

## Time stepping and ownership

`PhysicsWorld.advance()` accepts elapsed wall time and submits only fixed-size steps. If catching up would exceed `maxSubSteps`, it throws `PhysicsOverloadError` before advancing; the caller must explicitly pause or retry the elapsed time in smaller chunks rather than silently clamping or discarding it. A native step failure faults that world; dispose it and report the failure rather than continuing with a success-shaped state.

Worlds and bodies have explicit owners. Dispose a body when its local simulation object leaves the world, then dispose the world when leaving the local-physics phase or tearing down the app. Do not retain Embind wrappers after their native world is destroyed. `loadJoltWorld()` keeps module initialization asynchronous; stepping is synchronous, so production integration should run it in a worker if profiling shows frame-time impact.

## Not connected yet

This repository does not currently contain an Emscripten/Jolt build, a Jolt dependency, a native implementation of the facade, or a compiled `.wasm` asset. The header, binding registrations, and adapter describe the intended Embind contract; they do not claim that the module links or that the current landing/travel behavior uses rigid-body simulation. Implement the facade and pinned Jolt/Emscripten build before wiring this into `Mission`; keep the existing presentation path until the physics path has end-to-end tests.
