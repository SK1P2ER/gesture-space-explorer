import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OVERVIEW_REFERENCE, OVERVIEW_SUBJECTS, overviewDirection, overviewPose, type Bands } from '../src/scene/overviewFraming';
import { groundAt, type SpaceportSite } from '../src/scene/spaceportCollision';

const site = JSON.parse(readFileSync('public/spaceport/site.json', 'utf8')) as SpaceportSite;

/**
 * The authored coastal overview direction, framed around the app's UI.
 * Canvas sizes, FOVs (the preview's fit rule) and UI bands are the ones measured in the app (compare.mjs):
 * desktop 1440x900, phone portrait 390x844, phone landscape 844x390.
 */
const VIEWPORTS: Record<string, { w: number; h: number; fov: number; bands: Bands }> = {
  desktop: { w: 1440, h: 900, fov: 30, bands: { top: 65 / 900, bottom: 174 / 900 } },
  portrait: { w: 390, h: 844, fov: 82.03, bands: { top: 76 / 844, bottom: 217 / 844 } },
  landscape: { w: 844, h: 390, fov: 30, bands: { top: 65 / 390, bottom: 160 / 390 } },
};
const corners = (b: { min: readonly number[]; max: readonly number[] }) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]));
const ROCKET = { min: [-6, 13, -6], max: [6, 70, 6] };

function frame(name: string) {
  const v = VIEWPORTS[name], eye = new THREE.Vector3(), target = new THREE.Vector3();
  const fits = overviewPose(v.w / v.h, v.fov, v.bands, eye, target);
  const camera = new THREE.PerspectiveCamera(v.fov, v.w / v.h, 1, 15000);
  camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld();
  /** Screen box of a world box, in px from the top-left. */
  const box = (b: { min: readonly number[]; max: readonly number[] }) => {
    const p = corners(b).map(c => c.project(camera));
    return { left: Math.min(...p.map(q => (q.x + 1) / 2 * v.w)), right: Math.max(...p.map(q => (q.x + 1) / 2 * v.w)),
      top: Math.min(...p.map(q => (1 - q.y) / 2 * v.h)), bottom: Math.max(...p.map(q => (1 - q.y) / 2 * v.h)) };
  };
  return { v, eye, target, fits, box };
}

describe('Launch Preview coastal overview framing', () => {
  for (const name of Object.keys(VIEWPORTS)) {
    it(`${name}: terminal, pad + rocket, control tower and offshore platform are all between the top bar and the dock`, () => {
      const { v, fits, box } = frame(name);
      expect(fits).toBe(true);
      for (const [subject, b] of Object.entries(OVERVIEW_SUBJECTS)) {
        const s = box(b);
        expect(s.left, `${subject} left`).toBeGreaterThanOrEqual(0);
        expect(s.right, `${subject} right`).toBeLessThanOrEqual(v.w);
        expect(s.top, `${subject} under the top bar`).toBeGreaterThanOrEqual(v.bands.top * v.h);
        expect(s.bottom, `${subject} above the dock`).toBeLessThanOrEqual(v.h - v.bands.bottom * v.h);
      }
    });
    it(`${name}: reads left to right as terminal, rocket, offshore platform; the tower stands clear of the rocket`, () => {
      const { box } = frame(name);
      const terminal = box(OVERVIEW_SUBJECTS.terminal), rocket = box(ROCKET), tower = box(OVERVIEW_SUBJECTS.tower), offshore = box(OVERVIEW_SUBJECTS.offshore);
      expect(terminal.right).toBeLessThan(rocket.left);
      expect(offshore.left).toBeGreaterThan(rocket.right);
      expect(tower.left > rocket.right || tower.right < rocket.left, 'tower overlaps the rocket').toBe(true);
    });
  }
  it('keeps the reference camera’s coastal pitch, stays well above the ground and pivots on the campus', () => {
    const reference = new THREE.Vector3(...OVERVIEW_REFERENCE.target).sub(new THREE.Vector3(...OVERVIEW_REFERENCE.eye)).normalize();
    expect(overviewDirection().y).toBeCloseTo(reference.y, 6);
    expect(THREE.MathUtils.radToDeg(Math.asin(-reference.y))).toBeCloseTo(32, 0);
    for (const name of Object.keys(VIEWPORTS)) {
      const { eye, target } = frame(name);
      expect(eye.y - Math.max(0, groundAt(site, eye.x, eye.z)), `${name} eye above ground`).toBeGreaterThan(40);
      expect(target.y, `${name} orbit pivot at deck height or above`).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(Math.hypot(target.x, target.z), `${name} pivot within the campus shoreline and overlook`).toBeLessThan(OVERVIEW_SUBJECTS.offshore.max[2]);
    }
  });
});
