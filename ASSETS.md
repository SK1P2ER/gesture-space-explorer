# Asset authorship and licenses

**Code: MIT / 3D assets: CC BY 4.0**, with the third-party exceptions below.
The code license in [LICENSE](LICENSE) does not replace an asset's own license.

## Original SK1P2ER models

The creator has confirmed that the rocket, shuttle and spaceport were modeled
by SK1P2ER in Blender. Pinterest was used only as visual reference; no
third-party rocket, shuttle or spaceport model files were imported.

| Model | Distributed files | Attribution |
| --- | --- | --- |
| Rocket / launch stack | Rocket geometry in `assets/spaceport-m03/ASTROLIFE_Tanegashima_M03_Launch.blend` and `public/spaceport/tanegashima-m03.glb` | Original Blender model by SK1P2ER — CC BY 4.0 |
| Shuttle | `public/rocket/shuttle-high.glb`, `public/rocket/shuttle-low.glb`; shuttle geometry in the spaceport scene | Original Blender model by SK1P2ER — CC BY 4.0 |
| Tanegashima spaceport | `assets/spaceport-m03/ASTROLIFE_Tanegashima_M03_Launch.blend`, `public/spaceport/tanegashima-m03.glb` (original site geometry; third-party vegetation excluded) | Original Blender model by SK1P2ER — CC BY 4.0 |

License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The full legal text is in [LICENSE-CC-BY-4.0.txt](LICENSE-CC-BY-4.0.txt).
Attribution source: [SK1P2ER/gesture-space-explorer](https://github.com/SK1P2ER/gesture-space-explorer).
When sharing an adapted model, retain the attribution, link the license and
identify your changes. Code that generates procedural models remains MIT.

The distributed Blender source has machine-specific paths removed. The
original and sanitized hashes are recorded in `export-manifest.json`.
The private `rocket-launch.blend` source and its embedded reference images are
not distributed in this snapshot.

## Third-party exceptions

- **Quaternius Stylized Nature MegaKit Standard: CC0.** The spaceport includes
  third-party tree/shrub meshes and six packed textures: `Bark_NormalTree`,
  `Bark_NormalTree_Normal`, `Flowers`, `Leaf_Pine_C`, `Leaves_NormalTree_C` and
  `Leaves_TwistedTree_C`. These are not original SK1P2ER assets and are not
  relicensed as CC BY 4.0. See
  [provenance](assets/quaternius-nature-standard/provenance.json) and the
  [creator's pack](https://quaternius.itch.io/stylized-nature-megakit).
- **Noto Sans JP variable font, Version 2.04: SIL OFL 1.1.** Packed unmodified
  in the Blender source; copyright 2014–2021 Adobe, Reserved Font Name 'Source'.
  See [notice](assets/spaceport-m03/NOTICE.md) and
  [license](assets/spaceport-m03/LICENSE-OFL-1.1.txt).
- **MediaPipe model: Apache 2.0.** See [notice](assets/models/NOTICE.md) and
  [license](assets/models/LICENSE-Apache-2.0.txt).
- **Draco decoder: Apache 2.0.** See [license](public/spaceport/draco/LICENSE)
  and [notice](public/spaceport/draco/NOTICE).
- **Planet, moon and sky images:** retain their existing individual credits
  and licenses; see [texture licenses](public/textures/LICENSE.txt) and the
  README credits. They are not covered by the original-model license above.

These exceptions apply to the embedded components as well as separately
distributed files.
