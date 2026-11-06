import type {
  PhysicsWorld,
  PhysicsWorldOptions,
  RigidBody,
  RigidBodyDescription,
  RigidBodyState,
  LocalInertialFrame,
  PhysicsVec3,
} from './contracts';

export const PHYSICS_ABI_VERSION = 1;
const STATE_FLOATS = 13;
const BODY_INPUT_FLOATS = 10;
const ABI_FUNCTIONS = [
  '_malloc', '_free', '_gse_physics_abi_version', '_gse_world_create', '_gse_world_destroy',
  '_gse_world_step', '_gse_body_create', '_gse_body_destroy', '_gse_body_set_linear_velocity',
  '_gse_body_apply_force', '_gse_body_get_state',
] as const satisfies readonly (keyof JoltWasmModule)[];

/** The low-level exports required from the modularized Emscripten build. */
export interface JoltWasmModule {
  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _gse_physics_abi_version(): number;
  _gse_world_create(
    gx: number, gy: number, gz: number,
    maxBodies: number, maxBodyPairs: number, maxContactConstraints: number,
    outWorld: number,
  ): number;
  _gse_world_destroy(world: number): number;
  _gse_world_step(world: number, fixedStepSeconds: number): number;
  _gse_body_create(
    world: number, shape: number, motion: number, massKg: number, friction: number, restitution: number,
    position: number, rotation: number, shapeParameters: number, outBody: number,
  ): number;
  _gse_body_destroy(world: number, body: number): number;
  _gse_body_set_linear_velocity(world: number, body: number, x: number, y: number, z: number): number;
  _gse_body_apply_force(world: number, body: number, x: number, y: number, z: number): number;
  _gse_body_get_state(world: number, body: number, outState: number): number;
}

export type JoltWasmFactory = () => Promise<JoltWasmModule>;

export class PhysicsAbiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'PhysicsAbiError';
  }
}

export class PhysicsOverloadError extends Error {
  constructor(readonly requestedSteps: number, readonly maxSubSteps: number) {
    super(`Physics step needs ${requestedSteps} substeps; the configured limit is ${maxSubSteps}.`);
    this.name = 'PhysicsOverloadError';
  }
}

const STATUS_NAMES: Record<number, string> = {
  1: 'invalid argument',
  2: 'invalid handle',
  3: 'capacity exceeded',
  4: 'Jolt operation failed',
};

function requireFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
}

function requireFloat32(value: number, label: string) {
  requireFinite(value, label);
  if (!Number.isFinite(Math.fround(value))) throw new RangeError(`${label} is outside the float32 range used by the Jolt ABI.`);
}

function requireFiniteVector(vector: readonly number[], label: string) {
  if (vector.length !== 3) throw new RangeError(`${label} must have exactly three components.`);
  for (const value of vector) requireFinite(value, label);
}

function requireVector(vector: PhysicsVec3, label: string) {
  requireFiniteVector(vector, label);
  for (const value of vector) requireFloat32(value, label);
}

function requirePositive(value: number, label: string) {
  requireFloat32(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  if (Math.fround(value) === 0) throw new RangeError(`${label} is too small to represent in the float32 Jolt ABI.`);
}

function requireCapacity(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must be a positive uint32.`);
  }
}

function checkStatus(status: number, operation: string) {
  if (status === 0) return;
  const reason = STATUS_NAMES[status] ?? `unknown status ${status}`;
  throw new PhysicsAbiError(`${operation} failed: ${reason}.`, status);
}

function readVec3(values: Float32Array, offset: number): PhysicsVec3 {
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function immutableVec3([x, y, z]: PhysicsVec3): PhysicsVec3 {
  return Object.freeze([x, y, z]) as PhysicsVec3;
}

function immutableQuat([x, y, z, w]: LocalInertialFrame['localToIcrf']): LocalInertialFrame['localToIcrf'] {
  return Object.freeze([x, y, z, w]) as LocalInertialFrame['localToIcrf'];
}

function checkOptions(options: PhysicsWorldOptions) {
  if (!options.frame.originBodyId.trim()) throw new TypeError('frame.originBodyId must not be empty.');
  requireFinite(options.frame.epochJdTdb, 'frame.epochJdTdb');
  requireFiniteVector(options.frame.originPositionKm, 'frame.originPositionKm');
  requireFiniteVector(options.frame.originVelocityKmps, 'frame.originVelocityKmps');
  if (options.frame.localToIcrf.length !== 4) throw new RangeError('frame.localToIcrf must have exactly four components.');
  for (const value of options.frame.localToIcrf) requireFinite(value, 'frame.localToIcrf');
  if (Math.abs(Math.hypot(...options.frame.localToIcrf) - 1) > 1e-4) {
    throw new RangeError('frame.localToIcrf must be a normalized quaternion.');
  }
  requireVector(options.gravityMps2, 'gravityMps2');
  requirePositive(options.fixedStepSeconds, 'fixedStepSeconds');
  requireCapacity(options.maxSubSteps, 'maxSubSteps');
  requireCapacity(options.maxBodies, 'maxBodies');
  requireCapacity(options.maxBodyPairs, 'maxBodyPairs');
  requireCapacity(options.maxContactConstraints, 'maxContactConstraints');
}

function checkDescription(description: RigidBodyDescription) {
  requireVector(description.positionM, 'positionM');
  if (description.rotation.length !== 4) throw new RangeError('rotation must have exactly four components.');
  for (const value of description.rotation) requireFloat32(value, 'rotation');
  const qLength = Math.hypot(...description.rotation);
  if (Math.abs(qLength - 1) > 1e-4) throw new RangeError('rotation must be a normalized quaternion.');
  requireFloat32(description.massKg, 'massKg');
  if (description.motion === 'static' ? description.massKg !== 0 : description.massKg <= 0) {
    throw new RangeError('Static bodies require zero mass; kinematic and dynamic bodies require positive mass.');
  }
  if (description.motion !== 'static') requirePositive(description.massKg, 'massKg');
  for (const [label, value] of [['friction', description.friction], ['restitution', description.restitution]] as const) {
    requireFloat32(value, label);
    if (value < 0 || value > 1) throw new RangeError(`${label} must be between zero and one.`);
  }
  switch (description.shape.kind) {
    case 'sphere':
      requirePositive(description.shape.radiusM, 'sphere radiusM');
      break;
    case 'box':
      requireVector(description.shape.halfExtentsM, 'box halfExtentsM');
      for (const [index, value] of description.shape.halfExtentsM.entries()) {
        requirePositive(value, `box halfExtentsM[${index}]`);
      }
      break;
    case 'capsule':
      requirePositive(description.shape.cylinderHalfHeightM, 'capsule cylinderHalfHeightM');
      requirePositive(description.shape.radiusM, 'capsule radiusM');
      break;
    default:
      throw new TypeError('Unsupported collision shape.');
  }
  switch (description.motion) {
    case 'static':
    case 'kinematic':
    case 'dynamic':
      break;
    default:
      throw new TypeError('Unsupported rigid-body motion type.');
  }
}

/**
 * Adapts the narrow C ABI exported by the Emscripten/Jolt build. This layer is
 * deliberately unaware of Three.js, ephemeris time, and scene-scale units.
 */
export function createJoltWorld(module: JoltWasmModule, options: PhysicsWorldOptions): PhysicsWorld {
  if (!module || !(module.HEAPF32 instanceof Float32Array) || !(module.HEAPU32 instanceof Uint32Array)) {
    throw new PhysicsAbiError('The Emscripten module is missing its float32 or uint32 memory views.');
  }
  for (const name of ABI_FUNCTIONS) {
    if (typeof module[name] !== 'function') throw new PhysicsAbiError(`The Emscripten module is missing ${name}.`);
  }
  if (module._gse_physics_abi_version() !== PHYSICS_ABI_VERSION) {
    throw new PhysicsAbiError(`Physics ABI mismatch; TypeScript expects version ${PHYSICS_ABI_VERSION}.`);
  }
  checkOptions(options);
  const frame: LocalInertialFrame = Object.freeze({
    ...options.frame,
    originPositionKm: immutableVec3(options.frame.originPositionKm),
    originVelocityKmps: immutableVec3(options.frame.originVelocityKmps),
    localToIcrf: immutableQuat(options.frame.localToIcrf),
  });

  const scratchBytes = Math.max(STATE_FLOATS * Float32Array.BYTES_PER_ELEMENT, BODY_INPUT_FLOATS * Float32Array.BYTES_PER_ELEMENT);
  const scratch = module._malloc(scratchBytes);
  const outHandle = module._malloc(Uint32Array.BYTES_PER_ELEMENT);
  if (!scratch || !outHandle) {
    if (scratch) module._free(scratch);
    if (outHandle) module._free(outHandle);
    throw new PhysicsAbiError('Could not allocate WebAssembly bridge memory.');
  }

  let worldHandle = 0;
  try {
    checkStatus(module._gse_world_create(
      ...options.gravityMps2,
      options.maxBodies,
      options.maxBodyPairs,
      options.maxContactConstraints,
      outHandle,
    ), 'world create');
    worldHandle = module.HEAPU32[outHandle >>> 2];
    if (!worldHandle) throw new PhysicsAbiError('World create returned an empty handle.');
  } catch (error) {
    module._free(outHandle);
    module._free(scratch);
    throw error;
  }

  const bodies = new Set<WasmRigidBody>();
  let disposed = false;
  let faulted = false;
  let accumulator = 0;
  const fixedStepSeconds = Math.fround(options.fixedStepSeconds);
  const maxSubSteps = options.maxSubSteps;
  const assertUsable = () => {
    if (disposed) throw new PhysicsAbiError('Physics world has been disposed.');
    if (faulted) throw new PhysicsAbiError('Physics world is faulted after a failed Jolt operation; dispose it.');
  };
  const writeFloat32 = (pointer: number, values: readonly number[]) => {
    module.HEAPF32.set(values, pointer >>> 2);
  };

  class WasmRigidBody implements RigidBody {
    private destroyed = false;

    constructor(readonly handle: number) {}

    setLinearVelocity(velocityMps: PhysicsVec3) {
      assertUsable();
      this.assertAlive();
      requireVector(velocityMps, 'velocityMps');
      checkStatus(module._gse_body_set_linear_velocity(worldHandle, this.handle, ...velocityMps), 'set linear velocity');
    }

    applyForce(forceN: PhysicsVec3) {
      assertUsable();
      this.assertAlive();
      requireVector(forceN, 'forceN');
      checkStatus(module._gse_body_apply_force(worldHandle, this.handle, ...forceN), 'apply force');
    }

    readState(): RigidBodyState {
      assertUsable();
      this.assertAlive();
      checkStatus(module._gse_body_get_state(worldHandle, this.handle, scratch), 'read body state');
      const state = module.HEAPF32.slice(scratch >>> 2, (scratch >>> 2) + STATE_FLOATS);
      if (state.length !== STATE_FLOATS || state.some((value) => !Number.isFinite(value))) {
        throw new PhysicsAbiError('Body state returned an invalid float32 buffer.');
      }
      return {
        positionM: readVec3(state, 0),
        rotation: [state[3], state[4], state[5], state[6]],
        linearVelocityMps: readVec3(state, 7),
        angularVelocityRadps: readVec3(state, 10),
      };
    }

    dispose() {
      if (this.destroyed || disposed) return;
      assertUsable();
      checkStatus(module._gse_body_destroy(worldHandle, this.handle), 'body destroy');
      this.destroyed = true;
      bodies.delete(this);
    }

    private assertAlive() {
      if (this.destroyed) throw new PhysicsAbiError('Rigid body has been disposed.');
    }
  }

  return {
    frame,
    createBody(description) {
      assertUsable();
      checkDescription(description);
      const shape = description.shape;
      const shapeKind = shape.kind === 'sphere' ? 0 : shape.kind === 'box' ? 1 : 2;
      const motion = description.motion === 'static' ? 0 : description.motion === 'kinematic' ? 1 : 2;
      const shapeParameters = shape.kind === 'sphere'
        ? [shape.radiusM, 0, 0]
        : shape.kind === 'box'
          ? [...shape.halfExtentsM]
          : [shape.cylinderHalfHeightM, shape.radiusM, 0];
      writeFloat32(scratch, [...description.positionM, ...description.rotation, ...shapeParameters]);
      checkStatus(module._gse_body_create(
        worldHandle, shapeKind, motion, description.massKg, description.friction, description.restitution,
        scratch, scratch + 3 * Float32Array.BYTES_PER_ELEMENT, scratch + 7 * Float32Array.BYTES_PER_ELEMENT, outHandle,
      ), 'body create');
      const handle = module.HEAPU32[outHandle >>> 2];
      if (!handle) throw new PhysicsAbiError('Body create returned an empty handle.');
      const body = new WasmRigidBody(handle);
      bodies.add(body);
      return body;
    },
    advance(elapsedSeconds) {
      assertUsable();
      requireFinite(elapsedSeconds, 'elapsedSeconds');
      if (elapsedSeconds < 0) throw new RangeError('elapsedSeconds cannot be negative.');
      const total = accumulator + elapsedSeconds;
      const steps = Math.floor(total / fixedStepSeconds + 1e-6);
      if (steps > maxSubSteps) throw new PhysicsOverloadError(steps, maxSubSteps);
      for (let i = 0; i < steps; i++) {
        try {
          checkStatus(module._gse_world_step(worldHandle, fixedStepSeconds), 'world step');
        } catch (error) {
          faulted = true;
          throw error;
        }
      }
      accumulator = Math.max(0, total - steps * fixedStepSeconds);
      return steps;
    },
    dispose() {
      if (disposed) return;
      let failure: unknown;
      try {
        checkStatus(module._gse_world_destroy(worldHandle), 'world destroy');
      } catch (error) {
        failure = error;
      } finally {
        disposed = true;
        bodies.clear();
        module._free(outHandle);
        module._free(scratch);
      }
      if (failure) throw failure;
    },
  };
}

export async function loadJoltWorld(factory: JoltWasmFactory, options: PhysicsWorldOptions): Promise<PhysicsWorld> {
  return createJoltWorld(await factory(), options);
}
