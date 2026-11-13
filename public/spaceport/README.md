# Tanegashima M03 web scene

`tanegashima-m03.glb` is exported from the user's authored
`assets/spaceport-m03/ASTROLIFE_Tanegashima_M03_Launch.blend`.
It contains the coastal port, eight trees, nine shrubs, Shuttle and launch arms.

- Vegetation: [Quaternius Stylized Nature MegaKit Standard](https://quaternius.itch.io/stylized-nature-megakit), CC0.
  Download provenance is retained in `assets/quaternius-nature-standard/provenance.json`;
  the original archive is not included in this review snapshot.
- Original spaceport, rocket and shuttle geometry: Original Blender model by SK1P2ER — CC BY 4.0.
  Third-party vegetation remains CC0. See `../../ASSETS.md` for attribution and license scope.
- Draco decoder files: copyright The Draco Authors, Apache License 2.0.
  Unmodified decoder binaries copied from the installed Three.js package's
  `examples/jsm/libs/draco/gltf` directory. See `draco/LICENSE` and `draco/README.md`.

Rebuild from the app checkout with installed Blender:

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/export-spaceport-m03.py
```

Static meshes are grouped by material and moving parent, source textures are
limited to 1024 pixels, and Draco uses 20-bit position quantization to retain
small road markings. Blender procedural coast colours are converted to vertex
colours. Procedural rocket finishes use their authored palette. The source
blend is opened read-only and never saved by this exporter.

`npm run assets:export` validates the Blender animation at 68 sampled frames,
including camera framing, arm timing, nozzle alignment and a clear landing deck.
It exports collision height data and landmark bounds into `site.json` from the
same source. Candidates stay outside public and replace runtime assets only
after `scripts/validate-spaceport.mjs` succeeds. Every production build also
runs this gate. `assets/spaceport-m03/site-authoring.json` defines landmark
camera positions and the enclosed buildings used for camera collision.

The synchronized root, arm and exhaust clips run together over frames 1–480 at
24 fps (last key at 19.958 seconds). Browser steam uses 25 instanced translucent
meshes instead of Blender volumetric shaders. Camera presets and tracking are
implemented in the app. This is an interactive 3D scene, not video playback.
