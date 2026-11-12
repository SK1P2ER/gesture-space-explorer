# Physics bridge boundary

## Responsibilities

- The current `src/sim/travel.ts` Bezier flight remains presentation-only. It is not a force model or a trajectory solution.
- A future trajectory/ephemeris module owns solar-system-scale states, transfer solving, and long-duration propagation.
- The Jolt/WebAssembly bridge owns local rigid-body motion, collision detection, and contact response near a destination. Its world uses a local inertial frame and SI units: metres, kilograms, seconds, newtons, m/s, and rad/s.
- Three.js scene coordinates and compressed orbit radii never cross this boundary. Convert a local physics state to scene coordinates in a separate renderer adapter.

Jolt's uniform world gravity is appropriate only for a local operating volume. It is not a substitute for solar-system gravity or a central-body force model. If the local simulation later needs materially varying gravity, add an explicit force-field interface in the native adapter; do not encode it as Three.js motion or silently approximate it in the orbit propagator.

Each world carries a `LocalInertialFrame`: origin body, TDB epoch, ICRF state of the local origin, and a normalized local-to-ICRF rotation. At the frame epoch, convert states with `rIcrf = rOrigin + R * rLocal / 1000` and `vIcrf = vOrigin + R * vLocal / 1000`; local positions are metres and local velocities are m/s. Construct the frame and transform the base/site state from one consistent ephemeris and orientation source. This snapshot does not model an accelerating or rotating origin. A body-fixed pad treated as static in the local world is only a short-duration approximation; realistic surface contact over longer intervals needs moving terrain or explicit rotating-frame terms and updated frame transforms.

## JavaScript boundary

`physics/wasm/gse_physics.hpp` defines the project's C++ facade, `gse_physics.cpp` implements it with Jolt Physics, and `gse_physics_bindings.cpp` exposes it through Embind. `src/physics/joltWasm.ts` adapts the module to the app-facing interfaces in `src/physics/contracts.ts`. This is a typed C++/JavaScript boundary, not a cross-language C ABI; Jolt types and memory layouts never escape the facade.

- Use `enum class` values with explicit `int32_t` underlying types for collision shape and motion. Do not expose Jolt's own types.
- Pass `Vec3`, `Quat`, `WorldDescription`, and `BodyDescription` as Embind value objects. Return `BodyState` as a value object with named fields, not a pointer to a C++ struct or an index-dependent float buffer.
- `physicsAbiVersion()` must change when the exposed method signatures, enum values, or value-object fields/meanings change. Keep the native version and `PHYSICS_ABI_VERSION` in `src/physics/joltWasm.ts` synchronized.
- Native operations report failures by throwing C++ exceptions. With Emscripten's exception catching, Embind may surface those as numeric exception pointers; `joltWasm.ts` decodes them with `getExceptionMessage()` and throws ordinary JavaScript `Error` objects. Never return a zero-filled state or otherwise success-shaped fallback after a native failure.
- The Emscripten build enables C++ exception catching and exports the runtime helpers used by the TypeScript adapter to decode and release native exceptions.
- Validate all numeric inputs and shape/motion combinations in the native implementation. TypeScript validation improves caller feedback but is not a native correctness boundary.
- `PhysicsWorld.createBody()` returns an owned Embind object. Call `.delete()` on bodies and worlds; the TypeScript adapter disposes body wrappers before the world.
- The direct C++ facade uses RAII and does not expose a status-code API or raw memory. The Jolt world is single-threaded for now; move stepping to a worker if profiling shows main-thread impact.

Value objects intentionally favor a typed, named interface over minimal marshalling overhead. If profiling later shows per-body state conversion is a bottleneck, add a separate batch API and measure it; do not make ordinary callers manage native layout or memory pointers.

## Time stepping and ownership

`PhysicsWorld.advance()` accepts elapsed wall time and submits only fixed-size steps. If catching up would exceed `maxSubSteps`, it throws `PhysicsOverloadError` before advancing; the caller must explicitly pause or retry the elapsed time in smaller chunks rather than silently clamping or discarding it. A native step failure faults that world; dispose it and report the failure rather than continuing with a success-shaped state.

Worlds and bodies have explicit owners. Dispose a body when its local simulation object leaves the world, then dispose the world when leaving the local-physics phase or tearing down the app. Do not retain Embind wrappers after their native world is destroyed. `loadJoltModule()` and `loadJoltWorldFromUrl()` keep module initialization asynchronous; stepping is synchronous.

## Build and use

The CMake project pins Jolt Physics 5.3.0 to an exact source commit and enables no WebAssembly SIMD requirement. Install Emscripten 3.1.64, CMake 3.24 or newer, and Ninja, then run `npm run physics:test`. This builds the modularized ES module and `.wasm` into ignored `public/physics/` output, then runs the actual Embind module in Node. `npm run physics:native:test` builds the same facade against native Jolt and runs its C++ smoke test without Emscripten.

After `npm run physics:build`, a browser caller can use `loadJoltWorldFromUrl('/physics/gse_physics.js', options)` from `src/physics/joltWasm.ts`. The module is lazy and is not included in the normal app build unless generated first. The current landing/travel behavior still does not use this rigid-body simulation; keep the presentation path until the physics path has dedicated end-to-end product integration.
