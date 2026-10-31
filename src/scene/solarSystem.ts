import * as THREE from 'three';
import { ASTEROIDS, KUIPER } from '../data/belts';
import { reachFactor, sceneDistance, type Body, type TextureTier } from '../data/bodies';
import { boostLevel, boostLimits, boostScale, moonOpacity } from '../data/boost';
import { daysSinceJ2000, heliocentric, length, longitude, moonAngle, moonDirection, moonOrbitPole, orbitPath, sunCentered, type Vec3 } from '../data/ephemeris';
import { detailFor, HdSwitch, hdSwitchConfig } from '../planets/detail';
import { createBody, setDetail, toScene, type BodyNode } from '../planets/planet';
import { governSpin } from '../planets/spin';
import { TIER_WIDTH, type TextureContext } from '../planets/surface';
import { UploadQueue } from '../planets/textureLoader';
import { Belt } from './belts';
import { createBases, updateBases, type BaseNode } from './bases';
import { CometTails } from './comet';
import { ShootingStars, Sky } from './sky';

const UP = new THREE.Vector3(0, 1, 0);
const orbitTurn = new THREE.Quaternion();
const TWO_PI = Math.PI * 2;

/**
 * Fast-forwarding would spin moons round far too fast to see (Io at a week per
 * second: 4 orbits a second). Like planet spins, the shown motion is capped: a
 * system's fastest moon at this many degrees per second, the others in
 * proportion, so their real rhythm (Io 4 : Europa 2 : Ganymede 1) stays visible.
 */
const MOON_ORBIT_CAP = 60;

export interface TextureStatus {
  loaded: number;
  total: number;
  hd: boolean;
}

export interface Viewport {
  height: number; // CSS pixels
  pixelRatio: number;
}

const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();
const DAY_MS = 86_400_000;

/** Pluto and comets go where they really are, at their real distance mapped like the planets' (sceneDistance). */
const isSmallBody = (body: Body) => body.kind === 'dwarf' || body.kind === 'comet';

/** A Sun-centered position (AU, J2000 ecliptic) in the scene. */
function placeSmall(p: Vec3, out: THREE.Vector3) {
  const r = length(p);
  return toScene(p, out).multiplyScalar(sceneDistance(r) / r);
}

export interface TextureTiers {
  /** Every body loads this tier up front… */
  baseTier: TextureTier;
  /** …and the focused one switches to this one up close. */
  hdTier: TextureTier;
}

export interface BeltCounts {
  asteroids: number;
  kuiper: number;
}

export interface SkyTier {
  skyTier: TextureTier;
}

/** Rocks allocated per belt: the most any quality draws. */
const MAX_BELT: BeltCounts = { asteroids: 6000, kuiper: 1500 };

interface MoonLink {
  node: BodyNode;
  parent: BodyNode;
  /** Degrees per second its orbit may be shown at (see MOON_ORBIT_CAP). */
  cap: number;
  orbitLine: THREE.Line;
}

export class SolarSystem {
  readonly scene = new THREE.Scene();
  readonly nodes: BodyNode[] = [];

  private tiers: TextureTiers;
  private cloudDrift = 0;
  private readonly hdSwitches: HdSwitch[] = [];
  /** Whose base textures have been asked for: moons wait until their planet is visited (they're specks until then). */
  private readonly requested: boolean[] = [];
  private readonly moons: MoonLink[] = [];
  private readonly boostLimit: Map<string, number>;
  /** Overview boost, 0 (true size) → 1, as shown (eased, so the True scale toggle doesn't jump). */
  private boost = 0;
  private readonly asteroids = new Belt(ASTEROIDS, MAX_BELT.asteroids, 0x8a7f72, 11);
  private readonly kuiper = new Belt(KUIPER, MAX_BELT.kuiper, 0x6f7788, 23);
  private readonly tails = new CometTails();
  private readonly sky: Sky;
  private readonly uploads: UploadQueue;
  readonly shootingStars = new ShootingStars();
  /** Bases on the planets and moons (v2.0). */
  readonly bases: BaseNode[];
  private seconds = 0;
  /** The comet's state from update(), for its tails in updateView(): where it heads, and its real distance. */
  private readonly comet = { node: null as BodyNode | null, motion: new THREE.Vector3(), rAU: Infinity };

  constructor(bodies: Body[], renderer: THREE.WebGLRenderer, tiers: TextureTiers & BeltCounts & SkyTier) {
    this.tiers = tiers;
    this.boostLimit = boostLimits(bodies);
    this.scene.background = new THREE.Color(0x02030a);
    const ambient = new THREE.AmbientLight(0xffffff, 0.06); // keeps night sides barely visible
    ambient.layers.enable(1); // the base pass too (v2.3)
    this.scene.add(ambient);
    this.scene.add(new THREE.PointLight(0xfff4e0, 3.2, 0, 0)); // the Sun: day side lit, night side dark
    this.scene.add(makeStarfield());
    this.scene.add(this.asteroids.mesh, this.kuiper.mesh, this.tails.group, this.shootingStars.mesh);
    this.setBeltCounts(tiers);

    this.uploads = new UploadQueue(renderer);
    const textures: TextureContext = {
      uploads: this.uploads,
      anisotropy: renderer.capabilities.getMaxAnisotropy(),
    };
    this.sky = new Sky(textures.uploads);
    this.scene.add(this.sky.mesh);
    for (const body of bodies) {
      const node = createBody(body, textures);
      this.scene.add(node.pivot);
      if (body.kind === 'planet') this.scene.add(makeOrbitLine(body.orbitRadius, 0x334466, 0.35));
      if (isSmallBody(body)) this.scene.add(makePathLine(body, body.kind === 'comet' ? 0x4f6a88 : 0x445566, 0.3));
      if (body.kind === 'comet') this.comet.node = node;
      this.nodes.push(node);
      this.hdSwitches.push(new HdSwitch(hdSwitchConfig(TIER_WIDTH[tiers.baseTier])));
      this.requested.push(false);
    }
    for (const node of this.nodes) {
      if (!node.body.moon) continue;
      const parent = this.nodes.find((n) => n.body.id === node.body.parent)!;
      const fastest = Math.max(...this.nodes.filter((n) => n.body.parent === node.body.parent).map((n) => n.body.moon!.n));
      const orbitLine = makeOrbitLine(node.body.orbitRadius, 0x5a6f99, 0);
      orbitLine.visible = false;
      this.scene.add(orbitLine);
      this.moons.push({ node, parent, cap: (MOON_ORBIT_CAP * node.body.moon.n) / fastest, orbitLine });
    }

    this.bases = createBases(this.nodes);

    // Images stream in after the first frame; until then each body shows its base color.
    this.nodes.forEach((node, i) => {
      if (node.body.kind !== 'moon') this.requestBase(i);
    });
    void this.sky.setTier(tiers.skyTier); // after the planets: they're what you look at first
  }

  private requestBase(i: number) {
    if (this.requested[i] || !this.nodes[i].body.textures.map) return; // the comet has no image
    this.requested[i] = true;
    void this.nodes[i].surface.loadBase(this.tiers.baseTier);
  }

  /** After a WebGL context loss and restore: reload every image texture. */
  reloadTextures() {
    this.uploads.resume();
    this.nodes.forEach((node, i) => {
      if (this.requested[i]) node.surface.reload();
    });
    this.sky.reload();
  }

  /** Invalidate queued/partial uploads while the renderer's context is unavailable. */
  suspendTextureUploads() {
    this.uploads.suspend();
  }

  /** The Milky Way's resolution (quality). */
  setSkyTier(tier: TextureTier) {
    void this.sky.setTier(tier);
  }

  /** How many rocks each belt draws (quality). */
  setBeltCounts(counts: BeltCounts) {
    this.asteroids.setCount(counts.asteroids);
    this.kuiper.setCount(counts.kuiper);
  }

  /** Quality change: every body cross-fades to the new base textures; up-close textures start over. */
  setTiers(tiers: TextureTiers) {
    this.tiers = tiers;
    this.nodes.forEach((node, i) => {
      this.hdSwitches[i].reset(hdSwitchConfig(TIER_WIDTH[tiers.baseTier]));
      node.surface.setHd(null);
      if (this.requested[i]) void node.surface.loadBase(tiers.baseTier);
    });
  }

  /**
   * Puts every body where it is at `timeMs`: around the Sun by its real
   * longitude (orbit radii stay on the compressed scale), spin axis fixed in
   * space, turned to its real rotation angle (capped when that would strobe).
   * Moons go around their planet the same way, always facing it.
   * @param rate simulated seconds per real second (for the caps)
   * @param dt real seconds since the last frame
   */
  update(timeMs: number, rate: number, dt: number) {
    const days = daysSinceJ2000(timeMs);
    this.asteroids.update(days);
    this.kuiper.update(days);
    this.cloudDrift = (this.cloudDrift + dt * 0.02) % TWO_PI; // clouds creep over the surface
    for (const node of this.nodes) {
      if (node.body.moon) continue;
      const { body, pivot, tilt, mesh, clouds } = node;
      if (isSmallBody(body)) {
        // Placed directly (the pivot stays put), so the axis needs no undoing.
        placeSmall(sunCentered(body, timeMs), node.anchor.position);
        if (node === this.comet.node) {
          this.comet.rAU = length(sunCentered(body, timeMs));
          this.comet.motion.copy(placeSmall(sunCentered(body, timeMs + DAY_MS), tmp)).sub(node.anchor.position);
        }
      } else {
        if (body.orbit) pivot.rotation.y = longitude(heliocentric(body.orbit, timeMs));
        // The axis must not swing round with the orbit (that would erase the seasons): undo the orbit's turn.
        tilt.quaternion.copy(orbitTurn.setFromAxisAngle(UP, -pivot.rotation.y)).multiply(node.axis);
      }
      const exact = THREE.MathUtils.degToRad(body.spin.w0 + body.spin.degPerDay * days);
      // Standing on it (the horizon view), it must turn exactly with time, or the ground would swing after a jump.
      node.spinShown = this.horizon !== null && this.nodes[this.horizon] === node ? exact % (Math.PI * 2) : governSpin(node.spinShown, exact, (body.spin.degPerDay * rate) / 86_400, dt);
      mesh.rotation.y = node.spinShown;
      if (clouds) clouds.rotation.y = node.spinShown + this.cloudDrift;
    }

    for (const { node, parent, cap, orbitLine } of this.moons) {
      const { body } = node;
      const orbit = body.moon!;
      // The planet's position, straight from its pivot (world matrices aren't updated yet this frame).
      const center = tmp.set(parent.body.orbitRadius, 0, 0).applyAxisAngle(UP, parent.pivot.rotation.y);
      const exact = moonAngle(orbit, timeMs);
      node.orbitShown = governSpin(node.orbitShown, exact, (orbit.n * rate) / 86_400, dt, cap);
      toScene(moonDirection(orbit, parent.body, node.orbitShown, timeMs), dir);
      // A boosted planet grows by (scale − 1) × its reach: its moons move out by as much, so they stay clear of it.
      const radius = body.orbitRadius + (parent.tilt.scale.x - 1) * parent.body.radius * reachFactor(parent.body);
      node.anchor.position.copy(center).addScaledVector(dir, radius);
      // Tidally locked: the spin follows the shown orbit, so the same face always points at the planet.
      const w = THREE.MathUtils.degToRad(body.spin.w0 + body.spin.degPerDay * days) + (node.orbitShown - exact);
      node.mesh.rotation.y = ((w % TWO_PI) + TWO_PI) % TWO_PI;

      if (orbitLine.visible) {
        orbitLine.position.copy(center);
        orbitLine.scale.setScalar(radius / body.orbitRadius);
        orbitLine.quaternion.setFromUnitVectors(UP, toScene(moonOrbitPole(orbit, parent.body, timeMs), dir));
      }
    }
  }

  /**
   * Per-frame view-dependent work: sphere detail from each body's size on
   * screen, up-close textures for the focused body when it's big enough to
   * need them, and texture cross-fades. `dt` is real time (fades run while paused).
   * Visiting a planet (or one of its moons) loads its moons' textures and shows their orbits.
   */
  /**
   * The horizon view at a base on this body (null: off). Standing on the ground, only
   * the sky behind (the Milky Way, stars, shooting stars), the lights and that body's
   * surface are drawn: no other planets, belts, orbit lines or its own halo, which
   * would all hang wrongly close in a sky drawn at this scale.
   */
  setHorizon(bodyIndex: number | null) {
    if (bodyIndex === this.horizon) return;
    if (this.horizon !== null) for (const [o, v] of this.hidden) o.visible = v; // as it was
    this.hidden.clear();
    this.horizon = bodyIndex;
    this.applyHorizon();
  }

  private horizon: number | null = null;
  private readonly hidden = new Map<THREE.Object3D, boolean>();

  private applyHorizon() {
    if (this.horizon === null) return;
    const node = this.nodes[this.horizon];
    const keep = new Set<THREE.Object3D>([this.sky.mesh, this.shootingStars.mesh, node.pivot]);
    const hide = (o: THREE.Object3D) => {
      if (!this.hidden.has(o)) this.hidden.set(o, o.visible);
      o.visible = false;
    };
    for (const o of this.scene.children) if (!(o instanceof THREE.Light) && !keep.has(o) && !(o instanceof THREE.Points)) hide(o);
    for (const o of node.tilt.children) if (o !== node.mesh) hide(o); // its halo and clouds
  }

  updateView(camera: THREE.PerspectiveCamera, focusIndex: number, viewport: Viewport, dt: number, zoomDistance: number, trueScale: boolean) {
    const focused = this.nodes[focusIndex].body;
    const system = focused.parent ?? focused.id;
    // Overview boost (data/boost.ts): smooth in the zoom distance, eased only so the True scale toggle glides.
    const goal = trueScale ? 0 : boostLevel(zoomDistance);
    this.boost += (goal - this.boost) * Math.min(1, dt * 8);
    const fade = moonOpacity(this.boost);
    for (const node of this.nodes) {
      node.tilt.scale.setScalar(boostScale(this.boostLimit.get(node.body.id)!, this.boost));
      if (node.body.kind === 'moon') fadeBody(node, fade);
    }
    const pxPerUnitAtDist1 = viewport.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.nodes.forEach((node, i) => {
      if (node.body.parent === system) this.requestBase(i);
      const distance = node.mesh.getWorldPosition(tmp).distanceTo(camera.position);
      const radiusPx = ((node.body.radius * node.tilt.scale.x) / distance) * pxPerUnitAtDist1;
      setDetail(node, detailFor(radiusPx, i === focusIndex));

      const hd = this.hdSwitches[i];
      if (hd.update(dt, i === focusIndex, 2 * radiusPx * viewport.pixelRatio)) {
        node.surface.setHd(hd.wanted ? this.tiers.hdTier : null);
      }
      node.surface.update(dt);
    });

    if (this.comet.node) this.tails.update(this.comet.node.anchor.position, this.comet.motion, this.comet.rAU, camera);
    this.sky.update(camera);
    this.shootingStars.update(dt, camera);
    this.seconds += dt;
    updateBases(this.bases, camera, this.seconds);

    const k = 1 - Math.exp(-dt * 4);
    for (const { node, orbitLine } of this.moons) {
      const material = orbitLine.material as THREE.LineBasicMaterial;
      material.opacity += ((node.body.parent === system ? 0.5 * fade : 0) - material.opacity) * k;
      orbitLine.visible = material.opacity > 0.01;
    }
    this.applyHorizon();
  }

  get textureStatus(): TextureStatus {
    const requested = this.nodes.filter((_, i) => this.requested[i]);
    return {
      loaded: requested.filter((n) => n.surface.baseState !== 'loading').length,
      total: requested.length,
      hd: this.nodes.some((n) => n.surface.hdLoading),
    };
  }

  worldPosition(index: number, out = new THREE.Vector3()) {
    return this.nodes[index].mesh.getWorldPosition(out);
  }
}

function makeOrbitLine(radius: number, color: number, opacity: number) {
  const points = Array.from({ length: 257 }, (_, i) => {
    const a = (i / 256) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  });
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

/** Fades a moon in or out (opacity 0–1); hidden when gone, opaque again when fully back. */
function fadeBody(node: BodyNode, opacity: number) {
  node.anchor.visible = opacity > 0.01;
  node.tilt.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!m) return;
    if (m instanceof THREE.ShaderMaterial) o.visible = opacity > 0.99; // the halo: no opacity of its own
    else {
      m.transparent = opacity < 1 || (m.userData.transparent ??= m.transparent);
      m.opacity = opacity;
    }
  });
}

/** A small body's whole (eccentric, tilted) orbit, traced through the scene's distance mapping. */
function makePathLine(body: Body, color: number, opacity: number) {
  const points = orbitPath(body, Date.UTC(2000, 0, 1, 12)).map((p) => placeSmall(p, new THREE.Vector3()));
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function makeStarfield() {
  const count = 4000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(600 + Math.random() * 400);
    positions.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false }));
}
