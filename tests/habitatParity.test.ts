import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { footprint, layoutProblems, onSphere, type BaseLayout, type Module } from '../src/data/baseLayout';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { Showcase } from '../src/scene/baseKit/showcase';
import { cellBlocked, parsePlaced, type Placed } from '../src/sim/buildRules';

const R = 5.6;
const site = { point: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion(), scale: 1 / R };
const single = (module: Module): BaseLayout => ({ modules: [module], tunnels: [], roverLoops: [], walks: [], terrainRadius: 2.4, frame: 1.4 });
const mesh = (view: Showcase, slot: string) => view.group.getObjectByName(`kit:${slot}`) as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

describe('habitat architectural parity (captured before extraction)', () => {
  it('retains Jezero internal IDs, anchors, rotations, exclusion footprints and corridor topology', () => {
    expect(JEZERO.modules.filter((m) => m.kind === 'habitat')).toEqual([
      { id: 'habA', kind: 'habitat', x: -0.75, z: -0.25 },
      { id: 'habB', kind: 'habitat', x: -0.75, z: 0.25 },
      { id: 'habC', kind: 'habitat', x: -1.15, z: 0 },
    ]);
    expect(JEZERO.tunnels).toEqual([
      { from: 'habA', to: 'habB' }, { from: 'habA', to: 'habC' },
      { from: 'habB', to: 'habC' }, { from: 'habB', to: 'greenhouse' },
    ]);
    for (const m of JEZERO.modules.filter((m) => m.kind === 'habitat')) {
      for (const [x, z] of footprint(m)) expect(Math.hypot(x - m.x, z - m.z)).toBeCloseTo(0.16, 7);
    }
    expect(layoutProblems(JEZERO)).toEqual([]);
  });

  it.each([0, 90])('keeps module-local shell bounds and curvature placement at %s degrees', (rot) => {
    const module: Module = { id: 'habA', kind: 'habitat', x: -0.75, z: -0.25, rot };
    const view = new Showcase(single(module), { quality: 'low', R, site });
    try {
      const { y, up } = onSphere(module.x, module.z, R);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...up));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot * Math.PI / 180));
      const inverse = new THREE.Matrix4().compose(new THREE.Vector3(module.x, y, module.z), q, new THREE.Vector3(1, 1, 1)).invert();
      const local = mesh(view, 'hull').geometry.clone().applyMatrix4(inverse);
      try {
        local.computeBoundingBox();
        expect(local.boundingBox!.min.y).toBeCloseTo(0, 6);
        expect(local.boundingBox!.max.y).toBeCloseTo(0.13, 6);
        expect(local.boundingBox!.min.z).toBeCloseTo(-0.16, 6);
        expect(local.boundingBox!.max.z).toBeCloseTo(0.16, 6);
        const position = local.getAttribute('position');
        let maximumRadius = 0;
        for (let n = 0; n < position.count; n++) maximumRadius = Math.max(maximumRadius, Math.hypot(position.getX(n), position.getZ(n)));
        expect(maximumRadius).toBeCloseTo(0.16, 6);
      } finally { local.dispose(); }
    } finally { view.dispose(); }
  });

  it('classifies shells, metal and glowing window panes into shared material batches', () => {
    const view = new Showcase(single({ id: 'habA', kind: 'habitat', x: 0, z: 0 }), { quality: 'low', R, site });
    try {
      expect(mesh(view, 'hull').material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mesh(view, 'dark').material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mesh(view, 'window').material).toBeInstanceOf(THREE.MeshBasicMaterial);
      for (const slot of ['hull', 'dark', 'window']) {
        const geometry = mesh(view, slot).geometry;
        expect(geometry.getAttribute('normal').count).toBe(geometry.getAttribute('position').count);
        expect(geometry.getAttribute('uv')).toBeDefined();
      }
    } finally { view.dispose(); }
  });

  it('accepts existing serialized Build kinds, cells and quarter-turns unchanged', () => {
    const saved: Placed[] = [
      { kind: 'habitat', i: 0, j: -5, rot: 0 },
      { kind: 'solar', i: 0, j: 5, rot: 1 },
      { kind: 'battery', i: 2, j: -5, rot: 2 },
      { kind: 'oxygen', i: -1, j: -5, rot: 3 },
      { kind: 'greenhouse', i: -1, j: 5, rot: 0 },
    ];
    saved.forEach((p, n) => expect(cellBlocked(JEZERO, saved.slice(0, n), p.i, p.j)).toBeNull());
    expect(parsePlaced(JSON.stringify(saved), JEZERO)).toEqual(saved);
  });

  it('gives each showcase independent owned outputs and releases habitat batches on teardown', () => {
    const make = () => new Showcase(single({ id: 'habA', kind: 'habitat', x: 0, z: 0 }), { quality: 'low', R, site });
    const first = make(), second = make();
    try {
      const owned = ['hull', 'dark', 'window'].map((slot) => {
        const a = mesh(first, slot), b = mesh(second, slot);
        expect(a.geometry).not.toBe(b.geometry);
        expect(a.material).not.toBe(b.material);
        return [vi.spyOn(a.geometry, 'dispose'), vi.spyOn(a.material, 'dispose')];
      });
      first.dispose();
      for (const pair of owned) for (const disposed of pair) expect(disposed).toHaveBeenCalledTimes(1);
      expect(mesh(second, 'hull').geometry.getAttribute('position').count).toBeGreaterThan(0);
    } finally { second.dispose(); }
  });
});
