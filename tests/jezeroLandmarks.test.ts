import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aimPitch, clearDistance, clearViewFor, CLEARANCE, distanceRange, DOME, EYE_HEIGHT, EYE_LIMIT, eyeClear, FILL, FULL_VIEW,
  isLandmarkId, LANDMARK_IDS, LANDMARKS, landmarkPose, lookTurn, MAST, maxDistance, minDistance, PAD, PITCH_RANGE, type ClearView, type LandmarkId,
} from '../src/app/jezeroLandmarks';
import { Mission } from '../src/app/mission';
import { ModeMachine, modeForFocus } from '../src/app/modes';
import { createState } from '../src/app/state';
import { footprint, segmentHitsPolygon, tunnelFootprint, type Point } from '../src/data/baseLayout';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { BASES, surfacePoint } from '../src/data/bases';
import { BODIES } from '../src/data/bodies';
import { communicationsParts } from '../src/scene/baseKit/communicationsParts';
import { habitatParts } from '../src/scene/baseKit/habitatParts';
import { LANDING_ANCHORS } from '../src/scene/baseKit/landingPadParts';
import type { BaseNode } from '../src/scene/bases';
import { CameraRig } from '../src/scene/cameraRig';
import { SimClock } from '../src/sim/clock';

const FOV = THREE.MathUtils.degToRad(50); // the rig's camera (cameraRig.ts)
const bounds = (parts: [unknown, THREE.BufferGeometry][]) => {
  const box = new THREE.Box3();
  for (const [, g] of parts) { g.computeBoundingBox(); box.union(g.boundingBox!); g.dispose(); }
  return box;
};
const mod = (id: string) => JEZERO.modules.find((m) => m.id === id)!;

describe('Jezero landmarks: ids and where the numbers come from', () => {
  it('keeps the stable ids', () => {
    expect(LANDMARK_IDS).toEqual(['habitat', 'pad', 'dish']);
    for (const id of LANDMARK_IDS) expect(LANDMARKS[id].id).toBe(id);
    expect(isLandmarkId('dish')).toBe(true);
    expect(isLandmarkId('antenna')).toBe(false);
  });

  it('habitat: HAB-01 (habA) dome, from the habitat geometry', () => {
    for (const quality of ['low', 'high'] as const) {
      const box = bounds(habitatParts({ quality, identifier: 'HAB-01', ports: [0, 1] }));
      expect(box.max.x).toBeCloseTo(DOME.r, 3);
      expect(box.max.y).toBeCloseTo(DOME.h, 3);
    }
    const h = LANDMARKS.habitat;
    expect([h.centre[0], h.centre[2]]).toEqual([mod('habA').x, mod('habA').z]);
    expect(h.centre[1]).toBeCloseTo(DOME.h / 2, 9);
    expect(h.radius).toBeCloseTo(Math.hypot(DOME.r, DOME.h / 2), 9);
  });

  it('pad: LZ-01 at the origin, the rocket on it', () => {
    const lz = LANDING_ANCHORS['LZ-01'];
    expect(lz.position[1]).toBe(PAD.y);
    expect(lz.radius).toBe(PAD.r);
    const p = LANDMARKS.pad;
    expect([p.centre[0], p.centre[2]]).toEqual([lz.position[0], lz.position[2]]);
    expect(p.radius).toBeGreaterThanOrEqual(PAD.r);
    expect(p.centre[1] + p.radius).toBeGreaterThan(PAD.rocketTop - 1e-9);
  });

  it('dish: COM-01 (the antenna module) whole-part bounds, the dish itself inside the framed sphere', () => {
    for (const quality of ['low', 'high'] as const) {
      const parts = communicationsParts(quality);
      const dish = parts.find(([, g]) => g.userData.feature === 'dish')![1];
      expect(dish.userData.center).toEqual([0, 0.38, 0.02]);
      const box = bounds(parts);
      expect(box.min.x).toBeCloseTo(MAST.min[0], 3);
      expect(box.max.x).toBeCloseTo(MAST.max[0], 3);
      expect(box.max.y).toBeCloseTo(MAST.max[1], 3);
      expect(box.min.z).toBeCloseTo(MAST.min[2], 3);
      expect(box.max.z).toBeCloseTo(MAST.max[2], 3);
    }
    const d = LANDMARKS.dish, a = mod('antenna');
    const dishCentre = new THREE.Vector3(a.x, 0.38, a.z + 0.02);
    expect(dishCentre.distanceTo(new THREE.Vector3(...d.centre)) + 0.08).toBeLessThan(d.radius); // the 0.08 dish fits
    expect(Math.hypot(d.centre[0] - a.x, d.centre[2] - a.z)).toBeLessThan(0.01);
  });
});

describe('Jezero landmarks: clear view and turns', () => {
  it('portrait card on top: the band below it; short-landscape right column: the band left of it; none: all', () => {
    const portrait = clearViewFor(390, 844, { left: 12, top: 72, right: 378, bottom: 330 });
    expect(portrait.w).toBe(1);
    expect(portrait.cy).toBeLessThan(0);
    expect(portrait.h).toBeCloseTo((844 - 338) / 844, 9);
    const land = clearViewFor(844, 390, { left: 844 - 16 - 340, top: 60, right: 844 - 16, bottom: 380 });
    expect(land.cx).toBeLessThan(-0.3);
    expect(land.h).toBe(1);
    expect(clearViewFor(844, 390, null)).toEqual(FULL_VIEW);
  });

  it('keeps between the header and the bottom controls (lead measurements: 390×844 card bottom 493, controls from 690; 844×390 card x 488–828)', () => {
    const portrait = clearViewFor(390, 844, { left: 12, top: 115, right: 378, bottom: 493 }, 8, 844 - 690 + 8, 0);
    const y = (cy: number) => ((1 - cy) / 2) * 844;
    expect(y(portrait.cy + portrait.h)).toBeCloseTo(501, 6); // band top: below the card
    expect(y(portrait.cy - portrait.h)).toBeCloseTo(682, 6); // band bottom: above the controls
    const land = clearViewFor(844, 390, { left: 488, top: 72, right: 828, bottom: 348 }, 8, 390 - 310 + 8, 80 + 8);
    expect(((land.cx + 1) / 2) * 844).toBeCloseTo(240, 6); // the middle of x 0 … 480
    expect(((1 - land.cy - land.h) / 2) * 390).toBeCloseTo(88, 6);
    expect(((1 - land.cy + land.h) / 2) * 390).toBeCloseTo(302, 6);
  });

  it('turns toward the clear part: a left band turns right (yaw < 0), a lower band looks up (pitch > 0)', () => {
    const t = lookTurn({ cx: -0.4, cy: -0.3, w: 0.6, h: 0.7 }, FOV, 2);
    expect(t.yaw).toBeLessThan(0);
    expect(t.pitch).toBeGreaterThan(0);
    // A point the turned camera looks past by t shows at the band's centre.
    const tanV = Math.tan(FOV / 2);
    expect(Math.tan(t.yaw) / (tanV * 2)).toBeCloseTo(-0.4, 9);
    expect(-Math.tan(t.pitch) / tanV).toBeCloseTo(-0.3, 9);
    const none = lookTurn(FULL_VIEW, FOV, 1);
    expect(Math.abs(none.yaw) + Math.abs(none.pitch)).toBe(0);
  });
});

const VIEWS: [string, number, ClearView][] = [
  ['phone portrait 390×844', 390 / 844, clearViewFor(390, 844, { left: 12, top: 72, right: 378, bottom: 360 })],
  ['phone landscape 844×390', 844 / 390, clearViewFor(844, 390, { left: 488, top: 60, right: 828, bottom: 382 })],
  ['desktop 1280×800', 1280 / 800, clearViewFor(1280, 800, { left: 420, top: 72, right: 860, bottom: 300 })],
  ['full view', 16 / 9, FULL_VIEW],
];
const obstacles = (except: string | null): Point[][] => {
  const byId = new Map(JEZERO.modules.map((m) => [m.id, m]));
  return [
    ...JEZERO.modules.filter((m) => m.id !== except).map(footprint),
    ...JEZERO.tunnels.filter((t) => t.from !== except && t.to !== except).map((t) => tunnelFootprint(byId.get(t.from)!, byId.get(t.to)!)),
  ];
};

describe('Jezero landmarks: the poses that frame them', () => {
  for (const [name, aspect, view] of VIEWS) {
    for (const id of LANDMARK_IDS) {
      it(`${id}, ${name}: eye on the ground patch, clear of the modules, a clear line of sight, the landmark fitting the clear view`, () => {
        const lm = LANDMARKS[id];
        const pose = landmarkPose(id, FOV, aspect, view);
        expect(pose.centre).toEqual(lm.centre);
        expect(pose.yaw).toBe(lm.yaw);
        const eye: Point = [lm.centre[0] + Math.cos(pose.yaw) * pose.distance, lm.centre[2] + Math.sin(pose.yaw) * pose.distance];
        expect(Math.hypot(...eye)).toBeLessThanOrEqual(EYE_LIMIT + 1e-9);
        expect(EYE_LIMIT).toBeLessThan(JEZERO.terrainRadius);
        expect(EYE_HEIGHT).toBeGreaterThan(0);
        expect(eyeClear(...eye)).toBe(true);
        expect(pose.distance).toBeGreaterThanOrEqual(minDistance(id));
        expect(pose.pitch).toBeGreaterThanOrEqual(PITCH_RANGE.min);
        expect(pose.pitch).toBeLessThanOrEqual(PITCH_RANGE.max);
        expect(pose.pitch).toBeCloseTo(aimPitch(lm.centre[1], pose.distance, lm.eyeHeight), 12);
        expect(pose.height).toBe(lm.eyeHeight);
        expect(lm.eyeHeight).toBeGreaterThanOrEqual(EYE_HEIGHT);
        // Nothing else stands between the eye and the landmark (to the near side of its bounding sphere).
        const toward = 1 - lm.radius / pose.distance;
        const near: Point = [eye[0] + (lm.centre[0] - eye[0]) * toward, eye[1] + (lm.centre[2] - eye[1]) * toward];
        for (const poly of obstacles(lm.module)) expect(segmentHitsPolygon(eye, near, 0.01, poly)).toBe(false);
        // The bounding sphere fits the clear view (FILL of it, or less when the eye had to stand farther back).
        const range = Math.hypot(pose.distance, lm.centre[1] - lm.eyeHeight);
        const tanHalf = Math.tan(Math.asin(lm.radius / range));
        const tanV = Math.tan(FOV / 2) * view.h, tanH = Math.tan(FOV / 2) * aspect * view.w;
        expect(tanHalf).toBeLessThanOrEqual(Math.min(tanV, tanH) * FILL + 1e-9);
      });
    }
  }

  it('the eye never leaves the ground patch nor stands in a module, whichever side the look controls orbit to', () => {
    for (const id of LANDMARK_IDS) {
      const c = LANDMARKS[id].centre;
      for (let yaw = -Math.PI; yaw < Math.PI; yaw += Math.PI / 36) {
        const r = distanceRange(id, yaw);
        for (const want of [0, r.min, (r.min + r.max) / 2, r.max, 5]) {
          const d = clearDistance(id, yaw, want);
          const eye: Point = [c[0] + Math.cos(yaw) * d, c[2] + Math.sin(yaw) * d];
          expect(Math.hypot(...eye)).toBeLessThanOrEqual(EYE_LIMIT + 1e-9);
          expect(d).toBeGreaterThanOrEqual(minDistance(id) - 1e-9);
          if (d < r.max) expect(eyeClear(...eye, CLEARANCE)).toBe(true);
        }
      }
    }
  });

  it('maxDistance reaches EYE_LIMIT exactly', () => {
    for (const id of LANDMARK_IDS) {
      const c = LANDMARKS[id].centre;
      for (const yaw of [-2, -1, 0, 1, 2, 3]) {
        const d = maxDistance(c, yaw);
        expect(Math.hypot(c[0] + Math.cos(yaw) * d, c[2] + Math.sin(yaw) * d)).toBeCloseTo(EYE_LIMIT, 9);
      }
    }
  });
});

// The mission's Explore session with landmarks: real Mission, rig and clock; planets without rendering.
const disposers: (() => void)[] = [];
afterEach(() => { for (const d of disposers.splice(0)) d(); });
function explore(reduced = true) {
  const scene = new THREE.Scene();
  const at = (id: string) => BODIES.findIndex((b) => b.id === id);
  const bases: BaseNode[] = BASES.map((base) => {
    const body = BODIES[at(base.body)];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), new THREE.MeshBasicMaterial());
    mesh.scale.setScalar(body.radius);
    const tilt = new THREE.Group();
    tilt.add(mesh);
    scene.add(tilt);
    const group = new THREE.Group();
    group.position.set(...surfacePoint(base.lat, base.lon));
    mesh.add(group);
    return { base, group, pad: new THREE.Group(), lights: [], buildings: [], body: { body, mesh, tilt } as unknown as BaseNode['body'] };
  });
  const state = createState();
  const modes = new ModeMachine();
  const rig = new CameraRig(390 / 844);
  const clock = new SimClock(Date.UTC(2026, 10, 26), 1);
  const setFocus = (index: number) => { state.focus = index; modes.go(modeForFocus(index)); rig.focus(BODIES[index].radius, BODIES[index].radius, index === 0); };
  let clear: ClearView = FULL_VIEW;
  const mission = new Mission({
    state, modes, rig, clock, bases, scene, setFocus, flash: () => {}, reducedMotion: () => reduced, goldenHour: () => null,
    rocketOptions: () => ({ quality: 'low', textureSize: 32 }), exploreClear: () => clear,
  });
  disposers.push(() => scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }));
  mission.enter('jezero');
  mission.toggleHorizon();
  const frame = (dt = 1 / 30) => mission.update(dt, rig.camera);
  frame();
  return { mission, rig, clock, frame, setClear: (v: ClearView) => { clear = v; } };
}
const pose = (m: Mission) => ({ ...m.horizon!, centre: m.horizon!.centre.toArray() });

describe('Mission: Explore landmarks', () => {
  it('default Explore is unchanged: the base origin, the usual pose and eye', () => {
    const { mission } = explore();
    expect(pose(mission)).toEqual({ yaw: Math.PI / 2 - 0.25, pitch: 0.04, distance: 2.1, centre: [0, 0, 0], height: 0.055 });
    expect(mission.landmark).toBeNull();
    expect(mission.landmarkCanReturn).toBe(false);
    const v = mission.horizonView()!;
    expect(v.eye.x).toBeCloseTo(Math.cos(Math.PI / 2 - 0.25) * 2.1, 9);
    expect(v.eye.y).toBeCloseTo(0.055, 9);
  });

  it('the first landmark saves the Explore pose (zoom and look included); switching keeps it; Back to overview restores it exactly', () => {
    const { mission, frame, clock } = explore();
    mission.handle({ type: 'rotate', dx: 0.3, dy: -0.1 });
    mission.handle({ type: 'zoom', factor: 0.8 });
    const before = pose(mission);
    const t0 = clock.time;
    mission.handle({ type: 'frameLandmark', id: 'habitat' });
    expect(mission.landmark).toBe('habitat');
    expect(mission.landmarkCanReturn).toBe(true);
    expect(mission.landmarkReturnPose).toEqual(before);
    frame();
    const v = mission.horizonView()!;
    expect(v.centre.toArray()).toEqual(LANDMARKS.habitat.centre);
    expect(v.eye.distanceTo(v.goalEye)).toBeLessThan(1e-9); // reduced motion: a cut
    for (const id of ['dish', 'pad', 'habitat'] as LandmarkId[]) {
      mission.handle({ type: 'frameLandmark', id });
      expect(mission.landmark).toBe(id);
      expect(mission.landmarkReturnPose).toEqual(before);
    }
    expect(clock.time).toBe(t0); // camera only
    mission.handle({ type: 'landmarkOverview' });
    expect(pose(mission)).toEqual(before);
    expect(mission.landmark).toBeNull();
    expect(mission.landmarkCanReturn).toBe(false);
    expect(clock.time).toBe(t0);
  });

  it('the look controls orbit a framed landmark and leave Back to overview intact', () => {
    const { mission, frame } = explore();
    const before = pose(mission);
    mission.handle({ type: 'frameLandmark', id: 'dish' });
    const framed = pose(mission);
    mission.handle({ type: 'rotate', dx: 0.5, dy: 0.05 });
    mission.handle({ type: 'zoom', factor: 3 });
    expect(mission.horizon!.yaw).toBeCloseTo(framed.yaw + 0.5, 12);
    expect(mission.horizon!.centre.toArray()).toEqual(LANDMARKS.dish.centre);
    expect(mission.horizon!.distance).toBeLessThanOrEqual(distanceRange('dish', mission.horizon!.yaw).max + 1e-12);
    frame();
    const v = mission.horizonView()!;
    expect(Math.hypot(v.eye.x, v.eye.z)).toBeLessThanOrEqual(EYE_LIMIT + 1e-9);
    mission.handle({ type: 'landmarkOverview' });
    expect(pose(mission)).toEqual(before);
  });

  it('eases into a landmark without reduced motion (settled within 0.9 s), and the user can take over mid-move', () => {
    const { mission, frame } = explore(false);
    for (let i = 0; i < 60; i++) frame(); // settle on the default view
    mission.handle({ type: 'frameLandmark', id: 'pad' });
    frame(0.1);
    const mid = mission.horizonView()!;
    expect(mid.eye.distanceTo(mid.goalEye)).toBeGreaterThan(0.05); // still moving
    mission.handle({ type: 'rotate', dx: 0.2, dy: 0 }); // take over
    for (let t = 0; t < 0.8; t += 0.1) frame(0.1);
    const v = mission.horizonView()!;
    const start = mid.eye.distanceTo(mid.goalEye);
    expect(v.eye.distanceTo(v.goalEye)).toBeLessThan(start * 0.1);
    expect(mission.landmark).toBe('pad');
  });

  it('a framed landmark is turned into the clear part of the view (below the portrait card)', () => {
    const { mission, frame, setClear } = explore();
    setClear(clearViewFor(390, 844, { left: 12, top: 72, right: 378, bottom: 360 }));
    mission.handle({ type: 'frameLandmark', id: 'habitat' });
    frame();
    const cam = (mission as unknown as { d: { rig: CameraRig } }).d.rig.camera;
    cam.updateMatrixWorld();
    const g = mission.base!.group;
    const centre = g.localToWorld(new THREE.Vector3(...LANDMARKS.habitat.centre)).project(cam);
    const clear = clearViewFor(390, 844, { left: 12, top: 72, right: 378, bottom: 360 });
    expect(centre.y).toBeCloseTo(clear.cy, 1);
    expect(Math.abs(centre.x)).toBeLessThan(0.05);
  });

  it('the clear band is measured once at framing: card changes (a preset, the hint) never swing the view; a resize re-measures and re-fits', () => {
    const { mission, frame, setClear, rig } = explore();
    const first = clearViewFor(390, 844, { left: 12, top: 115, right: 378, bottom: 395 });
    setClear(first);
    mission.handle({ type: 'frameLandmark', id: 'pad' });
    frame();
    const a = mission.horizonView()!;
    expect(mission.landmarkBand).toEqual(first);
    // The card grows (Restore appears) or shrinks (the hint goes): nothing moves.
    setClear(clearViewFor(390, 844, { left: 12, top: 115, right: 378, bottom: 520 }));
    for (let i = 0; i < 5; i++) frame();
    const b = mission.horizonView()!;
    expect(b.goalLook.distanceTo(a.goalLook)).toBeLessThan(1e-12);
    expect(b.goalEye.distanceTo(a.goalEye)).toBeLessThan(1e-12);
    expect(mission.landmarkBand).toEqual(first);
    // Switching or re-selecting keeps the band too (the card now shows Back to overview): the same framing again.
    mission.handle({ type: 'frameLandmark', id: 'dish' });
    mission.handle({ type: 'frameLandmark', id: 'pad' });
    frame();
    expect(mission.landmarkBand).toEqual(first);
    expect(mission.horizonView()!.goalLook.distanceTo(a.goalLook)).toBeLessThan(1e-12);
    // Rotated to landscape: measured again and the distance re-fitted.
    const land = clearViewFor(844, 390, { left: 488, top: 72, right: 828, bottom: 348 });
    setClear(land);
    const before = mission.horizon!.distance;
    rig.resize(844 / 390);
    frame();
    expect(mission.landmarkBand).toEqual(land);
    expect(mission.horizon!.distance).toBeLessThan(before);
    expect(mission.horizon!.distance).toBeCloseTo(landmarkPose('pad', FOV, 844 / 390, land).distance, 9);
    mission.handle({ type: 'landmarkOverview' });
    expect(mission.landmarkBand).toBeNull();
  });

  it('leaving Explore by any path clears the landmark and the saved pose; re-entering starts fresh', () => {
    const { mission } = explore();
    mission.handle({ type: 'frameLandmark', id: 'dish' });
    mission.handle({ type: 'dismiss' }); // Esc
    expect(mission.horizon).toBeNull();
    expect(mission.landmark).toBeNull();
    expect(mission.landmarkCanReturn).toBe(false);
    mission.toggleHorizon();
    expect(pose(mission)).toEqual({ yaw: Math.PI / 2 - 0.25, pitch: 0.04, distance: 2.1, centre: [0, 0, 0], height: 0.055 });
    mission.handle({ type: 'frameLandmark', id: 'pad' });
    mission.toggleHorizon(); // O / Return to orbit
    expect(mission.landmark).toBeNull();
    expect(mission.landmarkReturnPose).toBeNull();
    // Not exploring: the intents change nothing.
    mission.handle({ type: 'frameLandmark', id: 'pad' });
    expect(mission.landmark).toBeNull();
    expect(mission.horizon).toBeNull();
  });

  it('a time jump keeps the framed pose in the base frame', () => {
    const { mission, frame, clock } = explore();
    mission.handle({ type: 'frameLandmark', id: 'dish' });
    frame();
    const a = mission.horizonView()!;
    clock.jumpTo(clock.time + 6 * 3600e3);
    frame();
    const b = mission.horizonView()!;
    expect(b.eye.distanceTo(a.eye)).toBeLessThan(1e-9);
    expect(b.look.distanceTo(a.look)).toBeLessThan(1e-9);
    expect(mission.landmark).toBe('dish');
  });
});
