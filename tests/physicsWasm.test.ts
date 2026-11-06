import { describe, expect, it } from 'vitest';
import {
  createJoltWorld,
  PHYSICS_ABI_VERSION,
  PhysicsAbiError,
  PhysicsOverloadError,
  type JoltWasmModule,
} from '../src/physics/joltWasm';
import type { RigidBodyDescription } from '../src/physics/contracts';

function mockModule(abi = PHYSICS_ABI_VERSION) {
  const memory = new ArrayBuffer(16 * 1024);
  const frees: number[] = [];
  const steps: number[] = [];
  let nextPointer = 8;
  let stateStatus = 0;
  const heapF32 = new Float32Array(memory);
  const heapU32 = new Uint32Array(memory);
  const module: JoltWasmModule = {
    get HEAPF32() { return heapF32; },
    get HEAPU32() { return heapU32; },
    _malloc(size) {
      const pointer = nextPointer;
      nextPointer += size + 8;
      return pointer;
    },
    _free(pointer) { frees.push(pointer); },
    _gse_physics_abi_version: () => abi,
    _gse_world_create(_gx, _gy, _gz, _maxBodies, _maxPairs, _maxConstraints, out) {
      heapU32[out >>> 2] = 11;
      return 0;
    },
    _gse_world_destroy: () => 0,
    _gse_world_step(_world, dt) { steps.push(dt); return 0; },
    _gse_body_create(_world, _shape, _motion, _mass, _friction, _restitution, _pos, _rot, _dims, out) {
      heapU32[out >>> 2] = 22;
      return 0;
    },
    _gse_body_destroy: () => 0,
    _gse_body_set_linear_velocity: () => 0,
    _gse_body_apply_force: () => 0,
    _gse_body_get_state(_world, _body, out) {
      if (stateStatus) return stateStatus;
      heapF32.set([1, 2, 3, 0, 0, 0, 1, 4, 5, 6, 7, 8, 9], out >>> 2);
      return 0;
    },
  };
  return { module, frees, steps, failState(status: number) { stateStatus = status; } };
}

const options = {
  frame: {
    originBodyId: 'earth',
    epochJdTdb: 2_460_000.5,
    originPositionKm: [149_597_870.7, 0, 0] as const,
    originVelocityKmps: [0, 29.78, 0] as const,
    localToIcrf: [0, 0, 0, 1] as const,
  },
  gravityMps2: [0, -9.80665, 0] as const,
  fixedStepSeconds: 1 / 60,
  maxSubSteps: 4,
  maxBodies: 64,
  maxBodyPairs: 256,
  maxContactConstraints: 128,
};

const sphere: RigidBodyDescription = {
  shape: { kind: 'sphere', radiusM: 0.5 },
  motion: 'dynamic',
  massKg: 12,
  friction: 0.5,
  restitution: 0,
  positionM: [1, 2, 3],
  rotation: [0, 0, 0, 1],
};

describe('Jolt WebAssembly contract adapter', () => {
  it('rejects incompatible ABI versions', () => {
    const { module } = mockModule(PHYSICS_ABI_VERSION + 1);
    expect(() => createJoltWorld(module, options)).toThrow(PhysicsAbiError);
  });

  it('uses fixed steps and refuses to silently discard excessive catch-up time', () => {
    const { module, steps } = mockModule();
    const world = createJoltWorld(module, options);
    expect(world.advance(1 / 120)).toBe(0);
    expect(world.advance(1 / 120)).toBe(1);
    expect(steps).toEqual([Math.fround(1 / 60)]);
    expect(() => world.advance(5 / 60)).toThrow(PhysicsOverloadError);
    expect(steps).toHaveLength(1);
    world.dispose();
  });

  it('marshals body descriptions and reads the documented SI state layout', () => {
    const { module } = mockModule();
    const world = createJoltWorld(module, options);
    const body = world.createBody(sphere);
    expect(body.readState()).toEqual({
      positionM: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      linearVelocityMps: [4, 5, 6],
      angularVelocityRadps: [7, 8, 9],
    });
    body.setLinearVelocity([0, 1, 0]);
    body.applyForce([0, 10, 0]);
    body.dispose();
    expect(() => body.readState()).toThrow(PhysicsAbiError);
    world.dispose();
  });

  it('surfaces native failures and frees bridge allocations on disposal', () => {
    const { module, frees, failState } = mockModule();
    const world = createJoltWorld(module, options);
    const body = world.createBody(sphere);
    failState(4);
    expect(() => body.readState()).toThrow(/Jolt operation failed/);
    world.dispose();
    world.dispose();
    expect(frees).toHaveLength(2);
  });

  it('rejects invalid units and body definitions before crossing the ABI', () => {
    const { module } = mockModule();
    expect(() => createJoltWorld(module, { ...options, fixedStepSeconds: 0 })).toThrow(RangeError);
    const world = createJoltWorld(module, options);
    expect(() => world.createBody({ ...sphere, rotation: [0, 0, 0, 2] })).toThrow(RangeError);
    expect(() => world.createBody({ ...sphere, massKg: -1 })).toThrow(RangeError);
    world.dispose();
  });
});
