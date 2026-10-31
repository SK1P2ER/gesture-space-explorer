import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MarsCinematicDirector, CINEMATIC_VIEWS, type CinematicContext } from '../src/scene/marsCinematicDirector';
import { Showcase } from '../src/scene/baseKit/showcase';
import { LandingPad } from '../src/scene/baseKit/landingPad';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { CameraRig } from '../src/scene/cameraRig';
import { landingBases } from './helpers/landingBase';

const insets = { top: 0, right: 0, bottom: 0, left: 0 };
function fixture() {
  const bases = landingBases(), base = bases.jezero;
  const owner = new Showcase(JEZERO, { quality: 'high', textureSize: 16, R: 5.6,
    site: { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / 5.6 } });
  const landing = new LandingPad('high'); base.group.add(owner.group, landing.group);
  base.group.updateWorldMatrix(true, false);
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 2000);
  camera.position.copy(base.group.localToWorld(new THREE.Vector3(2, 3, 4)));
  camera.lookAt(base.group.localToWorld(new THREE.Vector3())); camera.updateMatrixWorld();
  const director = new MarsCinematicDirector(camera);
  const context: CinematicContext = { base, owner, landing, mode: 'baseView', horizon: false, quality: 'high' };
  return { base, owner, landing, camera, director, context, dispose() { director.dispose(); owner.dispose(); landing.dispose(); bases.dispose(); } };
}
const tick = (d: MarsCinematicDirector, count = 100, reduced = false) => {
  for (let n = 0; n < count; n++) d.update(0.05, reduced, false, insets);
};

describe('exclusive Mars cinematic camera lease', () => {
  it('starts inactive and never changes a camera without a request', () => {
    const f = fixture();
    try {
      const before = f.camera.position.clone();
      expect(f.director.active).toBe(false); expect(f.director.update(1, false, false, insets)).toBe(false);
      expect(f.camera.position.toArray()).toEqual(before.toArray());
    } finally { f.dispose(); }
  });

  it.each(CINEMATIC_VIEWS)('selects %s using existing metadata and a safe bounded pose', view => {
    const f = fixture();
    try {
      expect(f.director.start(view, f.context, false)).toBe(true); tick(f.director);
      expect(f.director.active).toBe(true); expect(f.director.animating).toBe(false);
      expect(f.director.selected).toBe(view); expect(f.director.eye.y).toBeGreaterThanOrEqual(0.6);
      expect(f.camera.near).toBe(0.002); expect(f.camera.quaternion.length()).toBeCloseTo(1);
    } finally { f.dispose(); }
  });

  it('interpolates continuously from a safe manual pose and finishes exactly', () => {
    const f = fixture();
    try {
      const before = f.camera.position.clone(); f.director.start('habitats', f.context, false);
      f.director.update(0, false, false, insets);
      expect(f.camera.position.distanceTo(before)).toBeLessThan(1e-8);
      f.director.update(0.05, false, false, insets);
      expect(f.camera.position.distanceTo(before)).toBeGreaterThan(0);
      tick(f.director); const end = f.camera.position.clone(); tick(f.director);
      expect(f.camera.position.distanceTo(end)).toBeLessThan(1e-8);
    } finally { f.dispose(); }
  });

  it('blends orientation before completion rather than aliasing the quaternion destination', () => {
    const f = fixture();
    try {
      const original = f.camera.quaternion.clone();
      f.director.start('garage', f.context, false); tick(f.director, 14);
      expect(f.camera.quaternion.angleTo(original)).toBeGreaterThan(0.01);
      const halfway = f.camera.quaternion.clone(); tick(f.director, 15);
      expect(f.camera.quaternion.angleTo(halfway)).toBeGreaterThan(0.01);
    } finally { f.dispose(); }
  });

  it('keeps transitions and every flyover segment above structures, then releases ownership', () => {
    const f = fixture();
    try {
      f.director.start('flyover', f.context, false);
      for (let n = 0; n < 230; n++) {
        f.director.update(0.05, false, false, insets);
        if (f.director.active) expect(f.director.eye.y).toBeGreaterThanOrEqual(0.6);
      }
      expect(f.director.active).toBe(false); expect(f.camera.near).toBe(0.1);
    } finally { f.dispose(); }
  });

  it('skip/cancel restores projection without writing a stale transform, repeatedly', () => {
    const f = fixture();
    try {
      f.director.start('garage', f.context, false); tick(f.director, 4);
      const pose = f.camera.position.clone(); f.director.cancel(); f.director.cancel();
      expect(f.camera.position.toArray()).toEqual(pose.toArray());
      expect(f.camera.near).toBe(0.1); expect(f.camera.far).toBe(2000);
      expect(f.director.update(1, false, false, insets)).toBe(false);
    } finally { f.dispose(); }
  });

  it.each(['focus', 'launch', 'travel', 'docking', 'build'] as const)('releases ownership before %s camera placement', mode => {
    const f = fixture();
    try {
      f.director.start('landing', f.context, false); tick(f.director, 3);
      f.director.validate({ ...f.context, mode });
      expect(f.director.active).toBe(false);
      expect(f.director.update(1, false, false, insets)).toBe(false);
    } finally { f.dispose(); }
  });

  it('does not overwrite a newer horizon projection or foreign camera transform', () => {
    const f = fixture();
    try {
      f.director.start('garage', f.context, false); tick(f.director, 3);
      f.camera.near = 0.002; f.camera.far = 1200; f.camera.position.set(10, 20, 30);
      f.director.validate({ ...f.context, horizon: true });
      expect(f.camera.near).toBe(0.002); expect(f.camera.far).toBe(1200);
      expect(f.camera.position.toArray()).toEqual([10, 20, 30]);
    } finally { f.dispose(); }
  });

  it('preserves existing horizon clipping when returning to its manual owner', () => {
    const f = fixture();
    try {
      f.camera.near = 0.002; f.camera.far = 1200;
      f.director.start('panorama', { ...f.context, horizon: true }, true); tick(f.director, 1, true);
      f.director.cancel(); expect(f.camera.near).toBe(0.002); expect(f.camera.far).toBe(1200);
    } finally { f.dispose(); }
  });

  it('cancels on quality, owner retirement and destination changes', () => {
    const f = fixture();
    try {
      for (const context of [{ ...f.context, quality: 'low' }, null]) {
        f.director.start('overview', f.context, false); tick(f.director, 2);
        f.director.validate(context); expect(f.director.active).toBe(false);
      }
      f.director.start('garage', f.context, false); f.owner.dispose(); f.director.validate(f.context);
      expect(f.director.active).toBe(false);
    } finally { f.dispose(); }
  });

  it('supersedes older requests and never retains callbacks or borrowed resources after disposal', () => {
    const f = fixture();
    try {
      const disposed = vi.spyOn(f.owner, 'dispose');
      f.director.start('flyover', f.context, false); tick(f.director, 2);
      const generation = f.director.generation;
      f.director.start('garage', f.context, true); tick(f.director, 1, true);
      expect(f.director.generation).toBeGreaterThan(generation);
      expect(f.director.selected).toBe('garage'); f.director.dispose(); f.director.dispose();
      expect(disposed).not.toHaveBeenCalled();
      expect(f.director.start('overview', f.context, false)).toBe(false);
    } finally { f.dispose(); }
  });

  it('uses direct reduced-motion views, rejects flyover, and stops if preference changes', () => {
    const f = fixture();
    try {
      expect(f.director.start('flyover', f.context, true)).toBe(false);
      f.director.start('habitats', f.context, true); tick(f.director, 1, true);
      expect(f.director.animating).toBe(false);
      f.director.start('flyover', f.context, false); tick(f.director, 2);
      f.director.update(0.01, true, false, insets); expect(f.director.active).toBe(false);
    } finally { f.dispose(); }
  });

  it('handles pause, invalid steps, unsafe starts and mobile framing without geometry allocation', () => {
    const f = fixture();
    try {
      const geometry = (f.owner.group.getObjectByName('kit:hull') as THREE.Mesh).geometry;
      f.camera.position.copy(f.base.group.localToWorld(new THREE.Vector3(0, 0.01, 0)));
      f.director.start('garage', f.context, false);
      f.director.update(0, false, true, { ...insets, bottom: 0.6 });
      expect(f.director.eye.y).toBeGreaterThanOrEqual(0.6);
      const before = f.camera.position.clone();
      f.director.update(NaN, false, true, { ...insets, bottom: 0.6 });
      expect(f.camera.position.toArray()).toEqual(before.toArray());
      expect((f.owner.group.getObjectByName('kit:hull') as THREE.Mesh).geometry).toBe(geometry);
    } finally { f.dispose(); }
  });

  it('returns manual control to Rig using its current destination, not an old world-space snapshot', () => {
    const f = fixture(), rig = new CameraRig(1.5);
    try {
      const director = new MarsCinematicDirector(rig.camera);
      director.start('garage', f.context, true); tick(director, 1, true);
      director.cancel();
      rig.focus(1, 1, false, true); rig.setTarget(new THREE.Vector3(100, 0, 0)); rig.update(0.1);
      expect(rig.camera.position.x).toBeGreaterThan(99); director.dispose();
    } finally { f.dispose(); }
  });
});
