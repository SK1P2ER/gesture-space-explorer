import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, easeInOutCubic } from '../src/scene/cameraRig';

const DT = 1 / 60;
const step = (rig: CameraRig, seconds: number, target: () => THREE.Vector3) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    rig.setTarget(target());
    rig.update(DT);
  }
};
const looksAt = (rig: CameraRig, p: THREE.Vector3) =>
  rig.camera.getWorldDirection(new THREE.Vector3()).dot(p.clone().sub(rig.camera.position).normalize());

function setup() {
  const rig = new CameraRig(16 / 9);
  rig.setSystemRadius(100);
  rig.focus(8, 8, true, true); // start on the overview
  step(rig, 0.1, () => new THREE.Vector3());
  return rig;
}

describe('easeInOutCubic', () => {
  it('starts and ends gently', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.1)).toBeLessThan(0.01);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.99);
  });
});

/** Screen extents (NDC) of the outermost orbit. */
function orbitExtents(rig: CameraRig) {
  rig.camera.updateMatrixWorld();
  let [minY, maxY, maxX] = [Infinity, -Infinity, 0];
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    const p = new THREE.Vector3(Math.cos(a) * 100, 0, Math.sin(a) * 100).project(rig.camera);
    [minY, maxY, maxX] = [Math.min(minY, p.y), Math.max(maxY, p.y), Math.max(maxX, Math.abs(p.x))];
  }
  return { minY, maxY, maxX };
}

const expectWholeSystemInView = (rig: CameraRig) => {
  const { minY, maxY, maxX } = orbitExtents(rig);
  expect(minY).toBeGreaterThan(-1);
  expect(maxY).toBeLessThan(1);
  expect(maxX).toBeLessThan(1);
  // …and fills it: no more than ~15% wasted in the tighter direction.
  expect(Math.max(maxY - minY, 2 * maxX)).toBeGreaterThan(1.7);
};

describe('CameraRig overview', () => {
  // Landscape monitors down to tall phones (9:16, 9:19.5).
  for (const aspect of [16 / 9, 4 / 3, 1, 0.75, 9 / 16, 9 / 19.5]) {
    it(`keeps every orbit on screen (aspect ${aspect.toFixed(2)})`, () => {
      const rig = new CameraRig(aspect);
      rig.setSystemRadius(100);
      rig.focus(8, 8, true, true);
      step(rig, 0.1, () => new THREE.Vector3());
      expectWholeSystemInView(rig);
    });
  }

  it('re-fits when the viewport changes shape (phone rotated to portrait)', () => {
    const rig = setup(); // 16:9
    rig.resize(9 / 19.5);
    step(rig, 0.1, () => new THREE.Vector3());
    expectWholeSystemInView(rig);
  });

  it('keeps a manual zoom relative to the new fit', () => {
    const fitted = setup();
    const zoomed = setup();
    zoomed.zoom(0.5);
    step(zoomed, 3, () => new THREE.Vector3());
    for (const rig of [fitted, zoomed]) {
      rig.resize(9 / 16);
      step(rig, 0.1, () => new THREE.Vector3());
    }
    expect(zoomed.camera.position.length() / fitted.camera.position.length()).toBeCloseTo(0.5, 2);
  });
});

describe('CameraRig fly-in', () => {
  it('takes ~1.5 s and lands on the body even while it orbits', () => {
    const rig = setup();
    let angle = 0;
    const planet = () => new THREE.Vector3(Math.cos(angle) * 40, 0, Math.sin(angle) * 40);
    rig.focus(2, 2.1, false);
    step(rig, 1.4, () => ((angle += 0.01), planet()));
    expect(rig.flying).toBe(true);
    step(rig, 0.2, () => ((angle += 0.01), planet()));
    expect(rig.flying).toBe(false);
    expect(looksAt(rig, planet())).toBeGreaterThan(0.9999);
    step(rig, 1, () => ((angle += 0.01), planet())); // and stays on it afterwards, without trailing
    expect(looksAt(rig, planet())).toBeGreaterThan(0.9999);
  });

  it('frames the body at a close orbit distance', () => {
    const rig = setup();
    const p = new THREE.Vector3(30, 0, 0);
    rig.focus(2, 2.1, false);
    step(rig, 2, () => p);
    const distance = rig.camera.position.distanceTo(p);
    // 2.1 units should fill half the view height: 2.1 / (0.5 · tan 25°) ≈ 9.0
    expect(distance).toBeCloseTo(2.1 / (0.5 * Math.tan(THREE.MathUtils.degToRad(25))), 1);
  });

  it('cuts instead of flying with reduced motion', () => {
    const rig = setup();
    rig.reducedMotion = true;
    const p = new THREE.Vector3(30, 0, 0);
    rig.focus(2, 2.1, false);
    expect(rig.flying).toBe(false);
    step(rig, DT, () => p);
    expect(looksAt(rig, p)).toBeGreaterThan(0.9999);
  });

  it('stops the flight where it is when the user zooms', () => {
    const rig = setup();
    const p = new THREE.Vector3(30, 0, 0);
    rig.focus(2, 2.1, false);
    step(rig, 0.5, () => p);
    rig.zoom(1.2);
    expect(rig.flying).toBe(false);
  });

  it('still rotates during a flight', () => {
    const a = setup();
    const b = setup();
    const p = new THREE.Vector3(30, 0, 0);
    a.focus(2, 2.1, false);
    b.focus(2, 2.1, false);
    b.rotate(1, 0);
    step(a, 0.5, () => p);
    step(b, 0.5, () => p);
    expect(a.flying && b.flying).toBe(true);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeGreaterThan(1);
  });
});

describe('CameraRig bottom inset (the info sheet on phones)', () => {
  /** Where the focused body's center, top and bottom land on screen (NDC y). */
  function bodyOnScreen(rig: CameraRig, radius: number) {
    rig.camera.updateMatrixWorld();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.camera.quaternion);
    const y = (p: THREE.Vector3) => p.clone().project(rig.camera).y;
    const c = new THREE.Vector3();
    return { center: y(c), top: y(c.clone().addScaledVector(up, radius)), bottom: y(c.clone().addScaledVector(up, -radius)) };
  }

  for (const aspect of [9 / 19.5, 16 / 9]) {
    it(`keeps the focused body centered and whole above the sheet (aspect ${aspect.toFixed(2)})`, () => {
      const rig = new CameraRig(aspect);
      rig.setSystemRadius(100);
      rig.focus(2, 2.12, false, true);
      step(rig, 0.5, () => new THREE.Vector3());
      rig.setBottomInset(0.5); // the sheet covers the bottom half
      step(rig, 2, () => new THREE.Vector3());
      const { center, top, bottom } = bodyOnScreen(rig, 2.12);
      expect(center).toBeCloseTo(0.5, 2); // the middle of the top half (NDC 0 … 1)
      expect(bottom).toBeGreaterThan(0); // clear of the sheet
      expect(top).toBeLessThan(1);
      rig.setBottomInset(0);
      step(rig, 2, () => new THREE.Vector3());
      expect(bodyOnScreen(rig, 2.12).center).toBeCloseTo(0, 2);
      expect(rig.camera.view?.enabled ?? false).toBe(false);
    });
  }

  it('leaves the overview framing alone', () => {
    const rig = new CameraRig(9 / 19.5);
    rig.setSystemRadius(100);
    rig.focus(8, 8, true, true);
    step(rig, 0.5, () => new THREE.Vector3());
    const before = rig.camera.position.length();
    rig.setBottomInset(0.4);
    step(rig, 2, () => new THREE.Vector3());
    expect(rig.camera.position.length()).toBeCloseTo(before, 3);
  });
});
