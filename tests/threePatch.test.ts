import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// three.js 0.186.1 is patched on install by patch-package (patches/three+0.186.1.patch): engine
// disposal subscriptions belong to one WebGL context generation, so a context restore can't run the
// lost context's cleanup (docs/decisions.md, entry 18). These tests run against the installed,
// patched package, which is what the app bundles.

const three = new URL('../node_modules/three/', import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, three), 'utf8');
const patchFile = readdirSync(new URL('../patches/', import.meta.url)).find((f) => f.startsWith('three+'))!;
const patched = [...readFileSync(new URL(`../patches/${patchFile}`, import.meta.url), 'utf8').matchAll(/^diff --git a\/node_modules\/three\/(\S+)/gm)].map((m) => m[1]);
const HELPER = 'src/renderers/webgl/WebGLDisposalScope.js';

type Listener = (this: Owner, ...args: unknown[]) => unknown;
interface Scope {
  subscribe(owner: Owner, listener: Listener): void;
  unsubscribe(owner: Owner, listener: Listener): void;
  has(owner: Owner, listener: Listener): boolean;
  abandon(): number;
  readonly active: boolean;
  stats(): { epoch: number; active: boolean; subscriptions: number; registrations: number; removals: number };
}
const { createDisposalScope } = (await import(pathToFileURL(fileURLToPath(new URL(HELPER, three))).href)) as { createDisposalScope: (epoch?: number) => Scope };

/** A three.js EventDispatcher, as far as disposal goes. */
class Owner {
  listeners = new Map<string, Listener[]>();
  events = 0;
  id = 0;
  [key: string]: unknown;
  addEventListener(type: string, listener: Listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) this.listeners.set(type, (listeners = []));
    if (!listeners.includes(listener)) listeners.push(listener);
  }
  removeEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type);
    const index = listeners?.indexOf(listener) ?? -1;
    if (index !== -1) listeners!.splice(index, 1);
  }
  dispose() {
    this.events++;
    const event = { type: 'dispose', target: this };
    for (const listener of [...(this.listeners.get('dispose') ?? [])]) listener.call(this, event);
  }
  get count() { return this.listeners.get('dispose')?.length ?? 0; }
}
const firstListener = (owner: Owner) => owner.listeners.get('dispose')![0];

describe('three.js patch: installed as patches/ says', () => {
  it('the installed three.js is the version the patch was made for, and the patch is applied', () => {
    expect(patchFile).toBe(`three+${JSON.parse(read('package.json')).version}.patch`);
    expect(patched).toContain('build/three.module.js'); // what the app bundles
    expect(patched).toContain(HELPER);
    expect(read('build/three.module.js')).toMatch(/^\/\/ EXPERIMENTAL_RECOVERY_DISPOSAL_SCOPE_V1\n/);
  });

  it('every engine disposal route goes through the scope, and every patched file still parses', () => {
    const bundle = read('build/three.module.js');
    const count = (re: RegExp) => bundle.match(re)?.length ?? 0;
    expect([count(/disposalScope\.subscribe\( /g), count(/disposalScope\.unsubscribe\( /g), count(/disposalScope\.has\( /g)]).toEqual([12, 11, 1]);
    expect(bundle).toMatch(/function WebGLTextures\( _gl, extensions, state, properties, capabilities, utils, info, disposalScope \)/);
    expect(bundle).toMatch(/new WebGLTextures\( _gl, extensions, state, properties, capabilities, utils, info, disposalScope \)/);
    for (const relative of patched) {
      expect(read(relative), relative).not.toMatch(/\.(?:add|remove|has)EventListener\( 'dispose'/);
      const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: read(relative), encoding: 'utf8', timeout: 15000 });
      expect(checked.status, `${relative}: ${checked.stderr}`).toBe(0);
    }
    expect(read('build/three.cjs')).toMatch(/module\.exports = require\( '\.\/three\.module\.js' \)/); // the same patched runtime
  });

  it('the bundle carries the same helper as the source', () => {
    const helper = read(HELPER).replace(/\nexport \{ createDisposalScope \};\n$/, '');
    expect(helper).not.toBe(read(HELPER));
    expect(read('build/three.module.js').startsWith(helper)).toBe(true);
  });

  it('context loss abandons the scope; renderer.dispose() keeps the baseline teardown', () => {
    for (const renderer of [read('src/renderers/WebGLRenderer.js'), read('build/three.module.js')]) {
      const lost = renderer.slice(renderer.indexOf('function onContextLost'), renderer.indexOf('function onContextRestore'));
      expect(lost).toMatch(/disposalScope\.abandon\(\)/);
      const terminal = renderer.slice(renderer.indexOf('this.dispose = function'), renderer.indexOf('function onContextLost'));
      expect(terminal).not.toMatch(/abandon\(/);
      expect(terminal).toMatch(/bindingStates\.dispose\(\)/);
      expect(renderer).not.toMatch(/scopeHistory|previousScopes/); // no former scope is kept
    }
  });
});

describe('three.js patch: the disposal scope', () => {
  it('live subscriptions keep duplicate, identity, this, arguments, result and exception behavior', () => {
    const scope = createDisposalScope(1);
    const owner = new Owner();
    const observations: { thisValue: unknown; args: unknown[] }[] = [];
    function listener(this: Owner, ...args: unknown[]) { observations.push({ thisValue: this, args }); return 42; }
    scope.subscribe(owner, listener);
    scope.subscribe(owner, listener);
    expect(owner.count).toBe(1);
    expect(scope.has(owner, listener)).toBe(true);
    const event = { type: 'dispose', target: owner };
    expect(firstListener(owner).call(owner, event, 'extra')).toBe(42);
    expect(observations[0].thisValue).toBe(owner);
    expect(observations[0].args).toEqual([event, 'extra']);
    const failure = new Error('native callback failure');
    const throwing = () => { throw failure; };
    scope.subscribe(owner, throwing);
    expect(() => owner.dispose()).toThrow(failure);
    scope.unsubscribe(owner, throwing);
    scope.unsubscribe(owner, listener);
    scope.unsubscribe(owner, listener);
    expect(scope.has(owner, listener)).toBe(false);
    expect(owner.count).toBe(0);
    expect(scope.stats()).toEqual({ epoch: 1, active: true, subscriptions: 0, registrations: 2, removals: 2 });
  });

  it('loss abandons subscriptions without running them; a stale dispatch snapshot stays inert', () => {
    const old = createDisposalScope(1);
    const target = new Owner();
    const depth = new Owner();
    let nativeDeletes = 0;
    // The WebGLTextures cascade: guarding deleteTexture alone would let an old render-target
    // listener dispose a restored depth texture.
    const staleTargetDispose = () => { depth.dispose(); nativeDeletes++; };
    old.subscribe(target, staleTargetDispose);
    const staleSnapshot = firstListener(target);
    expect(old.abandon()).toBe(1);
    expect(old.abandon()).toBe(0);
    expect([target.count, target.events, depth.events, nativeDeletes]).toEqual([0, 0, 0, 0]);
    const current = createDisposalScope(2);
    current.subscribe(depth, () => nativeDeletes++);
    current.subscribe(target, () => { depth.dispose(); nativeDeletes++; });
    staleSnapshot.call(target, { type: 'dispose', target });
    expect([depth.events, nativeDeletes]).toEqual([0, 0]);
    old.subscribe(target, staleTargetDispose);
    expect(old.has(target, staleTargetDispose)).toBe(false);
    target.dispose();
    expect([depth.events, nativeDeletes]).toEqual([1, 2]);
  });

  it('a listener that unsubscribes itself during a nested dispatch is safe', () => {
    const scope = createDisposalScope(3);
    const owner = new Owner();
    let calls = 0;
    function listener() {
      scope.unsubscribe(owner, listener);
      calls++;
      owner.dispose();
    }
    scope.subscribe(owner, listener);
    owner.dispose();
    expect([calls, owner.count, scope.stats().subscriptions]).toEqual([1, 0, 0]);
  });

  it('repeated context generations leave exactly the current subscriptions', () => {
    const owner = new Owner();
    let calls = 0;
    for (let epoch = 1; epoch <= 20; epoch++) {
      const scope = createDisposalScope(epoch);
      scope.subscribe(owner, () => calls++);
      expect([owner.count, scope.stats().subscriptions]).toEqual([1, 1]);
      owner.dispose();
      expect(calls).toBe(epoch);
      scope.abandon();
      expect([scope.stats().subscriptions, owner.count]).toEqual([0, 0]);
    }
  });

  it('the registry lets an owner, and a callback that closes over it, be garbage-collected', () => {
    // A child process gives real GC without running the whole suite with --expose-gc.
    const source = `
      import assert from 'node:assert/strict';
      import { setImmediate as turn } from 'node:timers/promises';
      import { createDisposalScope } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL(HELPER, three))).href)};
      ${Owner.toString()}
      const scope = createDisposalScope(1);
      function allocate() {
        const owner = new Owner();
        const listener = () => owner.dispose();
        scope.subscribe(owner, listener);
        return { owner: new WeakRef(owner), listener: new WeakRef(listener) };
      }
      const refs = allocate();
      await turn();
      for (let i = 0; i < 16; i++) { global.gc(); await turn(); }
      assert.equal(refs.owner.deref(), undefined, 'scope retained resource owner');
      assert.equal(refs.listener.deref(), undefined, 'scope retained owner-capturing callback');
      assert.equal(scope.stats().subscriptions, 0, 'collected subscription was not pruned');
    `;
    const child = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000 });
    expect(child.status, child.stderr || child.error?.message).toBe(0);
  });

  it('the patched geometry manager frees only the restored context\'s buffers and VAOs', () => {
    const source = read('src/renderers/webgl/WebGLGeometries.js');
    const body = source.slice(source.indexOf('function WebGLGeometries'), source.lastIndexOf('export {'));
    const factory = new Function(`return (${body});`)() as (...args: unknown[]) => { get(object: object, geometry: Owner): void };
    const geometry = new Owner();
    Object.assign(geometry, { id: 7, index: {}, attributes: { position: {} }, isInstancedBufferGeometry: true });
    const deleted: string[] = [];
    let currentEpoch = 1;
    const manager = (scope: Scope, epoch: number) => {
      const nativeDelete = (kind: string) => {
        expect(epoch, 'obsolete native handle deletion').toBe(currentEpoch);
        deleted.push(`${kind}:${epoch}`);
      };
      return factory({}, { remove: () => nativeDelete('buffer') }, { memory: { geometries: 0 } }, { releaseStatesOfGeometry: () => nativeDelete('vao') }, scope);
    };
    const old = createDisposalScope(1);
    manager(old, 1).get({}, geometry);
    const staleSnapshot = firstListener(geometry);
    old.abandon();
    currentEpoch = 2;
    const current = createDisposalScope(2);
    manager(current, 2).get({}, geometry);
    geometry._maxInstanceCount = 10;
    staleSnapshot.call(geometry, { target: geometry });
    expect(geometry._maxInstanceCount, 'obsolete callback changed shared geometry state').toBe(10);
    expect(deleted).toEqual([]);
    geometry.dispose();
    expect(deleted).toEqual(['buffer:2', 'buffer:2', 'vao:2']);
    expect(geometry._maxInstanceCount).toBeUndefined();
    expect([geometry.count, current.stats().subscriptions]).toEqual([0, 0]);
  });
});
