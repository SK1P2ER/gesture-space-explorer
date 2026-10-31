import * as THREE from 'three';
import type { BaseLayout } from '../../data/baseLayout';
import { JEZERO } from '../../data/baseLayouts/jezero';
import type { BaseNode } from '../bases';
import { HORIZON, HorizonSky, type SkyObject } from './horizon';
import { Showcase, siteUv, type KitQuality } from './showcase';
import { BuildView } from './buildView';
import { LandingPad } from './landingPad';
import { MarsBaseOperationsController, type OperationalState } from './operations';
import { BaseLighting, setBaseLayer, type LightingOptions } from './baseLighting';
import type { Placed } from '../../sim/buildRules';

/** Bases with a showcase layout (the rest keep their v2.0 buildings). */
export const LAYOUTS: Readonly<Record<string, BaseLayout>> = { jezero: JEZERO };

/** The sky over a base this frame, in the base's own frame. */
export interface BaseSky {
  sun: THREE.Vector3;
  sunElevation: number;
  night: number;
  /** The world's distance from the Sun (AU) and how much light the dust lets through (0–1). */
  rAU: number;
  dust: number;
  objects: SkyObject[];
}

/** A world "flat" enough that the ground doesn't curve over the base (the horizon view). */
const FLAT_R = 1e6;

/**
 * Builds a showcase base only while it can be seen up close (its world in focus,
 * or a rocket on its way there), swapping out the simple v2.0 buildings, and
 * frees it all when you leave. Rebuilt when the quality setting changes, and
 * flat (with a sky dome round it) for the horizon view.
 */
export class Showcases {
  /** Retained entries still own replaceable resources even while not drawing. */
  get hasEntries() { return this.live.size > 0; }

  /** After the frame is drawn (the cached shadow's matrix is captured). */
  afterRender() {
    for (const e of this.live.values()) e.light.afterRender();
  }

  /** The lighting at a base (for tests and the debug readout). */
  lightingAt(baseId: string) {
    return this.live.get(baseId)?.light ?? null;
  }

  /** True scale: the sky moons at their real size (otherwise magnified to be seen). */
  trueScale = false;
  /** Base building: what's built at a base, and Build mode's guides (null outside Build mode). */
  buildAt: ((baseId: string) => { placed: readonly Placed[]; version: number; guides: Parameters<BuildView['setGuides']>[0] } | null) | null = null;
  private readonly live = new Map<string, { showcase: Showcase; landing: LandingPad; operations: MarsBaseOperationsController; lastSeconds: number; quality: KitQuality; flat: boolean; sky: HorizonSky | null; build: BuildView; light: BaseLighting; lightKey: string; layered?: number }>();
  operationsEnabled = false;
  operationsPaused = false;
  operationsAt: ((baseId: string) => OperationalState) | null = null;

  operationsFor(baseId: string) {
    return this.live.get(baseId)?.operations ?? null;
  }
  /** v2.3: shadows and sky reflections (High, Ultra), their sizes, and the generated texture size. */
  lighting: LightingOptions = { shadows: false, shadowSize: 2048, envSize: 64 };
  textureSize = 512;
  /** Where the rocket is (base frame), for the shadow cache; null: not at this base. */
  rocketAt: ((baseId: string) => THREE.Vector3 | null) | null = null;
  /** Is a showcase base being drawn this frame (the base render pass)? */
  drawing = false;

  constructor(private readonly bases: readonly BaseNode[]) {}

  get(baseId: string) {
    return this.live.get(baseId)?.showcase ?? null;
  }

  /** Additive landing art and semantic anchors; the persistent docking datum is unchanged. */
  landingAt(baseId: string) {
    return this.live.get(baseId)?.landing ?? null;
  }

  sky(baseId: string) {
    return this.live.get(baseId)?.sky ?? null;
  }

  /** Refresh borrowed maps after planet surface fades may have retired their predecessors. */
  syncMaps() {
    for (const node of this.bases) {
      const entry = this.live.get(node.base.id);
      if (!entry) continue;
      const map = (node.body.mesh.material as THREE.MeshStandardMaterial).map ?? null;
      entry.showcase.syncMap(map);
      entry.sky?.syncMap(map);
    }
  }

  /**
   * @param horizonAt the base whose horizon view is on, if any
   * @param skyAt the sky over a base (for its lights, panels and horizon sky), when known
   * @param eye the horizon view's eye (base frame)
   */
  update(
    isActive: (baseId: string) => boolean,
    quality: KitQuality,
    seconds: number,
    camera: THREE.Camera,
    reducedMotion: boolean,
    horizonAt: string | null,
    skyAt: (baseId: string) => BaseSky | null,
    eye: THREE.Vector3,
    renderer: THREE.WebGLRenderer,
  ) {
    this.drawing = false;
    for (const node of this.bases) {
      const id = node.base.id;
      const layout = LAYOUTS[id];
      if (!layout) continue;
      let entry = this.live.get(id);
      const want = isActive(id);
      const flat = horizonAt === id;
      const lightKey = JSON.stringify([this.lighting, this.textureSize, this.operationsEnabled]);
      if (entry && (!want || entry.quality !== quality || entry.flat !== flat || entry.lightKey !== lightKey)) {
        entry.operations.dispose();
        entry.showcase.dispose();
        entry.landing.dispose();
        entry.sky?.dispose();
        entry.build.dispose();
        entry.light.dispose();
        this.live.delete(id);
        entry = undefined;
      }
      if (!entry && want) {
        const g = node.group;
        const site = { point: g.position.clone(), quaternion: g.quaternion.clone(), scale: g.scale.x };
        const R = flat ? FLAT_R : 1 / g.scale.x;
        const showcase = new Showcase(layout, { quality, R, site, textureSize: this.textureSize, operations: this.operationsEnabled });
        g.add(showcase.group);
        const landing = new LandingPad(quality);
        g.add(landing.group);
        const build = new BuildView(R);
        g.add(build.group);
        const sky = flat ? new HorizonSky((x, z) => siteUv(site, x, z)) : null;
        if (sky) g.add(sky.group);
        const light = new BaseLighting(g, this.lighting, layout.terrainRadius);
        showcase.setEnvironment(light.envMap);
        landing.setEnvironment(light.envMap);
        showcase.setShadows(this.lighting.shadows);
        const operations = new MarsBaseOperationsController(this.operationsEnabled && quality === 'high', quality === 'high');
        entry = { showcase, landing, operations, lastSeconds: seconds, quality, flat, sky, build, light, lightKey };
        this.live.set(id, entry);
      }
      for (const b of node.buildings) b.visible = !entry;
      if (entry && node.group.visible) {
        const map = (node.body.mesh.material as THREE.MeshStandardMaterial).map ?? null;
        entry.showcase.syncMap(map);
        const sky = skyAt(id);
        const built = this.buildAt?.(id);
        entry.operations.update(seconds - entry.lastSeconds, this.operationsAt?.(id) ?? 'standby',
          this.operationsPaused, reducedMotion, sky?.sun.x ?? 0, sky?.sun.y ?? 1, sky?.night ?? 0);
        entry.showcase.applyOperations(entry.operations);
        if (sky) entry.showcase.setDaylight(sky.night, sky.sun, 0);
        entry.landing.setOperationalState(entry.operations.state);
        entry.landing.setDaylight(sky?.night ?? 0, this.lighting.shadows);
        if (this.lighting.shadows) {
          // High, Ultra: everything here is drawn in the base pass (its own Sun), not with the planets.
          const layerKey = built?.version ?? 0;
          if (entry.layered !== layerKey) {
            // Layers once per change of what's built (the build grid is rebuilt with the layout).
            for (const part of [entry.showcase.group, entry.landing.group, entry.build.group]) setBaseLayer(part, true);
            // The horizon sky (unlit, always farther than the base) stays with the stars in pass 1; only its lit plain joins the base.
            const plain = entry.sky?.group.getObjectByName('horizon:plain');
            if (plain) setBaseLayer(plain, true);
            entry.build.setShadows(true);
            entry.layered = layerKey;
          }
          if (sky) entry.light.update(renderer, sky.sun, sky.sunElevation, sky.night, sky.rAU, sky.dust, this.rocketAt?.(id) ?? null, (built?.version ?? 0) * 1000 + Math.round(entry.showcase.tilt * 100)); // panels count when they've turned ~0.6°
          // Filtering initializes on the first sky update; materials borrow its stable output.
          entry.showcase.setEnvironment(entry.light.envMap);
          entry.landing.setEnvironment(entry.light.envMap);
          // Reflections fade with the daylight (the cube's night sky still has a glow of its own).
          entry.showcase.setEnvironmentStrength(sky ? 0.7 * (1 - sky.night) : 0.7);
          this.drawing = true;
        } else if (sky) {
          // Low: no base pass. The base is drawn with the planets and darkened at night (the v2.2 way).
          entry.showcase.dimForNight(sky.night);
          entry.build.dimForNight(sky.night);
        }
        if (built) entry.build.setPlaced(built.placed, built.version);
        entry.build.setGuides(built?.guides ?? null);
        entry.showcase.update(seconds, camera, reducedMotion);
        if (entry.sky) {
          entry.sky.syncMap(map);
          if (sky) entry.sky.update({ dir: sky.sun, elevation: sky.sunElevation, night: sky.night }, sky.objects, eye, this.trueScale ? 1 : HORIZON.moonMagnify);
        }
      }
      if (entry) entry.lastSeconds = seconds;
    }
  }
}
