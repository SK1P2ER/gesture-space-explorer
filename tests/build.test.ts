import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Build } from '../src/app/build';
import { ACCEPTS, ModeMachine, type Mode } from '../src/app/modes';
import { createState } from '../src/app/state';
import { config } from '../src/config';
import { JEZERO } from '../src/data/baseLayouts/jezero';
import { keyToIntent } from '../src/input/keyboard';
import { BuildView } from '../src/scene/baseKit/buildView';
import { cellBlocked, cellCenter, CELL, MAX_MODULES, type SolConditions } from '../src/sim/buildRules';

const SOL: SolConditions = { latDeg: 18.4, decDeg: 3.8, dust: 1 };

describe('BuildView grid ownership', () => {
  const guides = (version: number) => ({ layout: JEZERO, placed: [], version, held: null, cursor: null, ok: true });
  const gridOf = (view: BuildView) => view.group.getObjectByName('build:grid') as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  it('releases replaced geometry while reusing a valid material until final, repeatable teardown', () => {
    const view = new BuildView(8);
    const parent = new THREE.Group();
    parent.add(view.group);
    try {
      view.setGuides(guides(0));
      const material = gridOf(view).material;
      const materialDisposed = vi.fn();
      material.addEventListener('dispose', materialDisposed);
      expect(material.color.getHex()).toBe(0xffffff);
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBe(0.25);
      expect(material.depthWrite).toBe(false);

      for (let version = 1; version <= 10; version++) {
        const oldGrid = gridOf(view);
        const geometryDisposed = vi.fn();
        oldGrid.geometry.addEventListener('dispose', geometryDisposed);
        view.setGuides(guides(version));
        const grid = gridOf(view);
        expect(geometryDisposed).toHaveBeenCalledTimes(1);
        expect(oldGrid.parent).toBeNull();
        expect(grid.geometry).not.toBe(oldGrid.geometry);
        expect(grid.geometry.getAttribute('position').count).toBeGreaterThan(0);
        expect(grid.material).toBe(material);
        expect(materialDisposed).not.toHaveBeenCalled();
        expect(grid.visible).toBe(true);
      }

      const currentGrid = gridOf(view);
      const geometryDisposed = vi.fn();
      currentGrid.geometry.addEventListener('dispose', geometryDisposed);
      view.setGuides(guides(10));
      view.setGuides(null);
      expect(currentGrid.visible).toBe(false);
      view.setGuides(guides(10));
      expect(gridOf(view)).toBe(currentGrid);
      expect(currentGrid.visible).toBe(true);
      expect(geometryDisposed).not.toHaveBeenCalled();
      expect(materialDisposed).not.toHaveBeenCalled();

      view.dispose();
      expect(() => view.dispose()).not.toThrow();
      expect(materialDisposed).toHaveBeenCalledTimes(1);
      expect(geometryDisposed).toHaveBeenCalledTimes(1);
      expect(parent.children).toHaveLength(0);
    } finally {
      view.dispose();
    }
  });

  it('releases its owned line material once even if guides were never shown', () => {
    const view = new BuildView(8);
    const disposed = vi.spyOn(THREE.LineBasicMaterial.prototype, 'dispose');
    try {
      view.dispose();
      expect(() => view.dispose()).not.toThrow();
      expect(disposed).toHaveBeenCalledTimes(1);
    } finally {
      view.dispose();
      disposed.mockRestore();
    }
  });

  it('owns its material independently of other BuildViews', () => {
    const first = new BuildView(8);
    const second = new BuildView(8);
    try {
      first.setGuides(guides(0));
      second.setGuides(guides(0));
      const material = gridOf(second).material;
      const disposed = vi.fn();
      material.addEventListener('dispose', disposed);
      expect(gridOf(first).material).not.toBe(material);
      first.dispose();
      second.setGuides(guides(1));
      expect(gridOf(second).material).toBe(material);
      expect(disposed).not.toHaveBeenCalled();
      second.dispose();
      expect(disposed).toHaveBeenCalledTimes(1);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});

/** A Build in BaseView at Jezero; the "screen" maps straight onto the ground (x, y → cell). */
function setup(enabled = true) {
  const modes = new ModeMachine();
  for (const m of ['focus', 'baseView'] as Mode[]) modes.go(m);
  const state = createState();
  const flashes: string[] = [];
  const build = new Build({
    state, modes, enabled,
    site: () => ({ id: 'jezero-test', layout: JEZERO }),
    groundAt: (x, y) => [x, y],
    sol: () => SOL,
    flash: (s) => flashes.push(s),
  });
  const at = (i: number, j: number) => build.handle({ type: 'buildCursor', x: i * CELL, y: j * CELL });
  return { build, modes, state, flashes, at };
}

/** Some free cells, nearest the pad first. */
const free: [number, number][] = [];
for (let i = -7; i <= 7; i++) for (let j = -7; j <= 7; j++) if (!cellBlocked(JEZERO, [], i, j)) free.push([i, j]);
free.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));

describe('Build mode', () => {
  it('K (toggleBuild) enters from BaseView only when ?flags=build is on; Done / Esc leaves', () => {
    const off = setup(false);
    expect(off.build.handle({ type: 'toggleBuild' })).toBe(false);
    expect(off.modes.mode).toBe('baseView');
    const { build, modes } = setup();
    build.handle({ type: 'toggleBuild' });
    expect(modes.mode).toBe('build');
    build.handle({ type: 'dismiss' });
    expect(modes.mode).toBe('baseView');
  });

  it('grab a new module, see it before placing (ghost + preview), drop it; undo and redo', () => {
    const { build, at } = setup();
    build.handle({ type: 'toggleBuild' });
    build.handle({ type: 'buildPick', kind: 'habitat' });
    at(...free[0]);
    expect(build.ghost()?.item.kind).toBe('habitat'); // hover / first tap: a ghost already
    const preview = build.preview()!;
    expect(preview.blocked).toBeNull();
    expect(preview.status!.oxygen).toBeLessThan(0); // a habitat alone breathes but makes nothing
    build.handle({ type: 'buildGrab' });
    build.handle({ type: 'buildDrop' });
    expect(build.placed('jezero-test', JEZERO)).toHaveLength(1);
    build.handle({ type: 'buildUndo' });
    expect(build.placed('jezero-test', JEZERO)).toHaveLength(0);
    build.handle({ type: 'buildRedo' });
    expect(build.placed('jezero-test', JEZERO)).toHaveLength(1);
  });

  it('a blocked cell shows red (why) and refuses the drop, with a message', () => {
    const { build, at, flashes } = setup();
    build.handle({ type: 'toggleBuild' });
    at(0, 0); // the pad
    expect(build.preview()!.blocked).toBe('pad');
    build.handle({ type: 'buildGrab' });
    build.handle({ type: 'buildDrop' });
    expect(build.placed('jezero-test', JEZERO)).toHaveLength(0);
    expect(flashes.at(-1)).toMatch(/landing pad/);
  });

  it('move a module by grabbing it; turn it; remove it; Esc puts a held module back', () => {
    const { build, at } = setup();
    build.handle({ type: 'toggleBuild' });
    at(...free[0]);
    build.handle({ type: 'select' }); // Enter: grab
    build.handle({ type: 'select' }); // Enter: drop
    at(...free[0]);
    build.handle({ type: 'buildGrab' });
    at(...free[1]);
    build.handle({ type: 'buildDrop' });
    const placed = build.placed('jezero-test', JEZERO);
    expect(placed).toHaveLength(1);
    expect([placed[0].i, placed[0].j]).toEqual(free[1]);
    build.handle({ type: 'buildTurn', dir: 1 });
    expect(build.placed('jezero-test', JEZERO)[0].rot).toBe(1);
    build.handle({ type: 'buildGrab' });
    build.handle({ type: 'dismiss' }); // put it back
    expect(build.held).toBeNull();
    expect(build.placed('jezero-test', JEZERO)).toHaveLength(1);
    build.handle({ type: 'buildDelete' });
    expect(build.placed('jezero-test', JEZERO)).toHaveLength(0);
  });

  it('pointing at a planet (☝️ select with a body) does nothing in Build mode', () => {
    const { build, at } = setup();
    build.handle({ type: 'toggleBuild' });
    at(...free[0]);
    build.handle({ type: 'select', bodyId: 'earth' });
    expect(build.held).toBeNull();
  });

  it('earning a level flashes once and keeps it, even after the base is taken apart', () => {
    const { build, at, state, flashes } = setup();
    build.handle({ type: 'toggleBuild' });
    const kinds = ['habitat', 'oxygen', 'solar', 'solar', 'solar', 'solar', 'solar', 'battery', 'battery'] as const;
    kinds.forEach((k, n) => {
      build.handle({ type: 'buildPick', kind: k });
      at(...free[n]);
      build.handle({ type: 'buildGrab' });
      build.handle({ type: 'buildDrop' });
    });
    expect(build.status()!.level).toBe(2);
    expect(state.baseLevels['jezero-test']).toBe(2);
    expect(flashes.filter((f) => /level 2/.test(f))).toHaveLength(1);
    build.handle({ type: 'buildReset' });
    expect(build.status()!.level).toBe(1); // live status
    expect(state.baseLevels['jezero-test']).toBe(2); // kept
  });

  it('the mode table: Build takes the build intents, not planet switching or time; the keys', () => {
    for (const t of ['buildGrab', 'buildDrop', 'buildCursor', 'buildUndo', 'next', 'rotate', 'zoom'] as const) expect(ACCEPTS.build.has(t), t).toBe(true);
    for (const t of ['nextMoon', 'enterBase', 'launch', 'countdown', 'steer'] as const) expect(ACCEPTS.build.has(t), t).toBe(false);
    expect(ACCEPTS.build.has('dismissBuildHint')).toBe(true); // the first-time touch hint's ×
    for (const m of ['launch', 'travel', 'docking'] as const) expect(ACCEPTS[m].has('buildGrab'), m).toBe(false);
    const k = (key: string, mods = {}) => keyToIntent(key, config.keyboard, mods);
    expect(k('k')).toEqual({ type: 'toggleBuild' });
    expect(k('z', { ctrl: true })).toEqual({ type: 'buildUndo' });
    expect(k('Z', { ctrl: true, shift: true })).toEqual({ type: 'buildRedo' });
    expect(k('c', { ctrl: true })).toBeNull(); // copy stays the browser's
    expect(k('Delete')).toEqual({ type: 'buildDelete' });
  });
});

describe('the build view', () => {
  it('one instanced mesh per module kind (+5 draw calls), with the grid and ghost only in Build mode', () => {
    const v = new BuildView(5.6);
    const placed = [{ kind: 'solar' as const, ...{ i: free[0][0], j: free[0][1] }, rot: 0 as const }];
    v.setPlaced(placed, 1);
    let instanced = 0;
    v.group.traverse((o) => { if (o instanceof THREE.InstancedMesh) instanced++; });
    expect(instanced).toBe(5);
    expect((v.group.getObjectByName('build:solar') as THREE.InstancedMesh).count).toBe(1);
    v.setGuides({ layout: JEZERO, placed, version: 1, held: { kind: 'habitat', i: 0, j: 0, rot: 0 }, cursor: [0, 0], ok: false });
    expect(v.group.getObjectByName('build:grid')!.visible).toBe(true);
    expect(v.group.getObjectByName('build:ghost')!.visible).toBe(true);
    v.setGuides(null);
    expect(v.group.getObjectByName('build:grid')!.visible).toBe(false);
    expect(v.group.getObjectByName('build:ghost')!.visible).toBe(false);
    const p = new THREE.Vector3().setFromMatrixPosition((() => { const m = new THREE.Matrix4(); (v.group.getObjectByName('build:solar') as THREE.InstancedMesh).getMatrixAt(0, m); return m; })());
    expect(p.x).toBeCloseTo(cellCenter(...free[0])[0], 9);
    v.dispose();
    expect(MAX_MODULES).toBe(24);
  });
});
