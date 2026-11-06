import { describe, expect, it } from 'vitest';
import {
  createJoltWorld,
  PHYSICS_ABI_VERSION,
  PhysicsAbiError,
  PhysicsOverloadError,
  type EmbindBodyDescription,
  type EmbindBodyState,
  type EmbindPhysicsWorld,
  type EmbindRigidBody,
  type EmbindWorldDescription,
  type JoltWasmModule,
} from '../src/physics/joltWasm';
import type { RigidBodyDescription } from '../src/physics/contracts';

const state: EmbindBodyState = {
  positionM: { x: 1, y: 2, z: 3 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  linearVelocityMps: { x: 4, y: 5, z: 6 },
  angularVelocityRadps: { x: 7, y: 8, z: 9 },
};

function mockModule(abi = PHYSICS_ABI_VERSION) {
  const steps: number[] = [];
  const worlds: MockWorld[] = [];
  let stepFailure: Error | null = null;
  let stateFailure: Error | null = null;
  class MockWorld implements EmbindPhysicsWorld {
    readonly bodies: MockBody[] = [];
    deleted = false;

    constructor(readonly description: EmbindWorldDescription, private readonly stepLog: number[], private readonly failStep: () => Error | null) {}

    createBody(description: EmbindBodyDescription) {
      const body = new MockBody(description, () => stateFailure);
      this.bodies.push(body);
      return body;
    }

    step(dt: number) {
      const failure = this.failStep();
      if (failure) throw failure;
      this.stepLog.push(dt);
    }

    delete() {
      this.deleted = true;
    }
  }
  const module: JoltWasmModule = {
    CollisionShape: { Sphere: 0, Box: 1, Capsule: 2 },
    MotionType: { Static: 0, Kinematic: 1, Dynamic: 2 },
    physicsAbiVersion: () => abi,
    PhysicsWorld: class extends MockWorld {
      constructor(description: EmbindWorldDescription) {
        super(description, steps, () => stepFailure);
        worlds.push(this);
      }
    },
  };
  class MockBody implements EmbindRigidBody {
    deleted = false;
    velocities: { x: number; y: number; z: number }[] = [];
    forces: { x: number; y: number; z: number }[] = [];

    constructor(readonly description: EmbindBodyDescription, private readonly failState: () => Error | null) {}

    setLinearVelocity(velocity: { x: number; y: number; z: number }) {
      this.velocities.push(velocity);
    }

    applyForce(force: { x: number; y: number; z: number }) {
      this.forces.push(force);
    }

    getState() {
      const failure = this.failState();
      if (failure) throw failure;
      return state;
    }

    delete() {
      this.deleted = true;
    }
  }
  return {
    module,
    steps,
    worlds,
    failStep(error: Error | null) { stepFailure = error; },
    failState(error: Error | null) { stateFailure = error; },
  };
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

describe('Embind physics adapter', () => {
  it('rejects incompatible interface versions and incomplete modules', () => {
    const { module } = mockModule(PHYSICS_ABI_VERSION + 1);
    expect(() => createJoltWorld(module, options)).toThrow(PhysicsAbiError);
    expect(() => createJoltWorld({} as JoltWasmModule, options)).toThrow(/missing its physics facade exports/);
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

  it('passes named value objects and converts returned state fields', () => {
    const { module, worlds } = mockModule();
    const world = createJoltWorld(module, options);
    expect(worlds[0].description).toEqual({
      gravityMps2: { x: 0, y: -9.80665, z: 0 },
      maxBodies: 64,
      maxBodyPairs: 256,
      maxContactConstraints: 128,
    });
    const body = world.createBody(sphere);
    const nativeBody = worlds[0].bodies[0];
    expect(nativeBody.description).toEqual({
      shape: 0,
      motion: 2,
      massKg: 12,
      friction: 0.5,
      restitution: 0,
      positionM: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      shapeParametersM: { x: 0.5, y: 0, z: 0 },
    });
    expect(body.readState()).toEqual({
      positionM: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      linearVelocityMps: [4, 5, 6],
      angularVelocityRadps: [7, 8, 9],
    });
    body.setLinearVelocity([0, 1, 0]);
    body.applyForce([0, 10, 0]);
    expect(nativeBody.velocities).toEqual([{ x: 0, y: 1, z: 0 }]);
    expect(nativeBody.forces).toEqual([{ x: 0, y: 10, z: 0 }]);
    body.dispose();
    expect(nativeBody.deleted).toBe(true);
    expect(() => body.readState()).toThrow(PhysicsAbiError);
    world.dispose();
  });

  it('propagates native errors, faults a failed world, and releases owned objects', () => {
    const { module, worlds, failState, failStep } = mockModule();
    const world = createJoltWorld(module, options);
    const body = world.createBody(sphere);
    const stateError = new Error('native state failure');
    failState(stateError);
    expect(() => body.readState()).toThrow(stateError);
    failState(null);
    const stepError = new Error('native step failure');
    failStep(stepError);
    expect(() => world.advance(1 / 60)).toThrow(stepError);
    expect(() => world.advance(1 / 60)).toThrow(/world is faulted/);
    world.dispose();
    expect(worlds[0].bodies[0].deleted).toBe(true);
    expect(worlds[0].deleted).toBe(true);
    world.dispose();
  });

  it('rejects invalid units and body definitions before crossing Embind', () => {
    const { module } = mockModule();
    expect(() => createJoltWorld(module, { ...options, fixedStepSeconds: 0 })).toThrow(RangeError);
    const world = createJoltWorld(module, options);
    expect(() => world.createBody({ ...sphere, rotation: [0, 0, 0, 2] })).toThrow(RangeError);
    expect(() => world.createBody({ ...sphere, massKg: -1 })).toThrow(RangeError);
    world.dispose();
  });
});
