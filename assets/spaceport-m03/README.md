# ASTROLIFE M03 — building gardens and Shuttle launch

Open `ASTROLIFE_Tanegashima_M03_Launch.blend` in Blender 5.1. The original M02
and uploaded rocket file remain unchanged. All images and video here are
rendered from the authored Blender scene.

The old distant procedural woodland is removed. **Eight actual Quaternius
tree meshes** and **nine shrubs** are placed only around the assembly hall and
control/service building, with mulch, stone edging and small paved paths.
The coast, launch apron, access roads and separate landing target stay clear.

Asset source: [Quaternius Stylized Nature MegaKit Standard](https://quaternius.itch.io/stylized-nature-megakit).
The Standard version was downloaded through the creator's public zero-price
download flow. It is CC0; no account, API key or paid tier was used. Source
archive, glTFs/textures and SHA-256 provenance are in
`../quaternius-nature-standard/`. Selected trees are CommonTree 1–4 and Pine 1–2;
the two shrub models are Bush_Common and Bush_Common_Flowers.

## Animation

Select **CAM M03 | Launch tracking**, start at frame 1 and play with Space.
The scene has **480 frames at 24 fps**, a 20-second sequence:

| Frames | Action |
| --- | --- |
| 1–72 | Ready, quiet prelaunch venting, slow camera move |
| 73–144 | Two service arms pivot away from the stack |
| 145–192 | Engine ignition, emissive jets and warm engine lighting ramp up |
| 193–216 | Full thrust, stack still held on the mount |
| 217–480 | Slow initial liftoff followed by accelerating ascent; camera follows |

`CTRL | Shuttle ascent` parents the existing stack without changing its mesh.
The two arm pivots, camera target, five engines, their lights and steam volume
envelopes are independently editable. Effects are keyed procedural geometry
and volumes, so no external simulation cache is needed. This first sequence
ends in initial ascent; booster separation and landing are separate future
animation work.

The master uses EEVEE. Imported textures and Japanese font are packed into the
blend. Material Preview is the default editing view; use Rendered view or F12
to inspect flames, lights and steam. Other cameras include the original
coastal overview and a new building-garden review view.

## Deliverables and checks

- `01-landscaped-port.png`: complete site, frame 1.
- `02-ignition.png`: frame 184, retracted arms and starting engines.
- `03-liftoff.png`: frame 300.
- `04-ascent.png`: frame 450.
- `05-building-garden.png`: closer landscaping view.
- `launch-preview.mp4`: 960 × 600, 24 fps, full 20-second animation preview.
- `design-checks.json`: rocket/arm/jet timing, camera framing across 67 sampled
  frames, nozzle-to-jet alignment, finite transforms, tree placements and
  landing-surface ray casts.
- `scene-report.json`: measured geometry, source and timing metadata.

The app now exposes this scene from the Japan base's **Explore spaceport · 3D**
button. The lazy-loaded GLB includes the authored model and synchronized launch
clips. The original destination-based mission remains available when closing
the preview. See `docs/tanegashima-spaceport.md` for integration details.

The packed master and exported web asset are sufficient for app development.
Preview stills, MP4 and raw frame sequences are local review outputs. Rebuilding
the design from scratch also requires the original local M02 and nature-pack
sources, using the local design scripts:

```powershell
blender --background --factory-startup --disable-autoexec --python scripts/build-spaceport-m03.py
blender --background --factory-startup --disable-autoexec --python scripts/build-spaceport-m03.py -- --preview
ffmpeg -framerate 24 -i assets/spaceport-m03/preview-frames/frame-%05d.png -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart assets/spaceport-m03/launch-preview.mp4
```

Re-export the app asset directly from the packed M03 master:

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/export-spaceport-m03.py
```
