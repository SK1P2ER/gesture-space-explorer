The C++ Sobel kernel accelerates normal-map creation for the rocket fallback
and Jezero's fabric, ribbed metal and solar-cell materials. It does not change
the Three.js renderer or move small per-frame calls across the Wasm boundary.

`public/native/normal-map-v1.wasm` is committed, so normal install/build needs
no C++ toolchain or network access. The browser asynchronously initializes it;
the original JavaScript calculation remains available before initialization or
when WebAssembly, fetching, or compilation fails.

To rebuild with an LLVM Clang distribution containing the Wasm target:

```powershell
$env:WASM_CXX = '<llvm>\bin\clang++.exe'
node scripts/build-native.mjs
```

LLVM-MinGW is suitable for native Windows C++, but lacks the Wasm backend.
The local build script also detects the user installation under
`~/.codex/toolchains/llvm-wasm-23.1.4`. Toolchain source:
https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.4

The freestanding module has no JavaScript or WASI imports, no threads, and no
SharedArrayBuffer requirement. Each call copies its output so subsequent calls
or Wasm memory growth cannot mutate a texture already handed to Three.js.

High-quality procedural rocket and Jezero material normals now run in short-lived module Workers.
The rocket initially uses neutral normals, then updates its existing texture when
the result arrives. Disposing the rocket aborts pending work; completion, errors,
and a five-second timeout terminate the Worker. The input is copied before
transfer, and the JavaScript fallback remains usable without Workers or WASM.
The synchronous API remains for the 64px temporary shuttle fallback.
This does not move hull colour painting or rendering
off the main thread.

Run `node scripts/profile-normal-map.mjs` for desktop Chromium comparisons of JS,
main-thread WASM, and Worker WASM at 256/512/1024px. Evidence is written outside
the repository. Worker elapsed time includes startup, fetching and transfers;
timer gaps measure event-loop responsiveness, not FPS. The report records WASM
linear memory and input/output sizes, not total browser/GPU memory. Real-device
validation is separate; a Worker is not assumed to improve total completion time.
