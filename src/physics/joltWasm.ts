import type {
  PhysicsWorld,
  PhysicsWorldOptions,
  RigidBodyDescription,
  RigidBodyState,
  LocalInertialFrame,
  PhysicsVec3,
} from './contracts';

export const PHYSICS_ABI_VERSION = 2;

export interface EmbindVec3 {
  x: number;
  y: number;
  z: number;
}

export interface EmbindQuat extends EmbindVec3 {
  w: number;
}

export interface EmbindBodyState {
  positionM: EmbindVec3;
  rotation: EmbindQuat;
  linearVelocityMps: EmbindVec3;
  angularVelocityRadps: EmbindVec3;
}

export interface EmbindBodyDescription {
  shape: number;
  motion: number;
  massKg: number;
  friction: number;
  restitution: number;
  positionM: EmbindVec3;
  rotation: EmbindQuat;
  shapeParametersM: EmbindVec3;
}

export interface EmbindWorldDescription {
  gravityMps2: EmbindVec3;
  maxBodies: number;
  maxBodyPairs: number;
  maxContactConstraints: number;
}

export interface EmbindRigidBody {
  setLinearVelocity(velocityMps: EmbindVec3): void;
  applyForce(forceN: EmbindVec3): void;
  getState(): EmbindBodyState;
  delete(): void;
}

export interface EmbindPhysicsWorld {
  createBody(description: EmbindBodyDescription): EmbindRigidBody;
  step(fixedStepSeconds: number): void;
  delete(): void;
}

/** Shape and motion enums registered by the native Embind module. */
export interface EmbindPhysicsEnums {
  CollisionShape: { Sphere: number; Box: number; Capsule: number };
  MotionType: { Static: number; Kinematic: number; Dynamic: number };
}

/** The JS-facing surface produced by the modularized Embind build. */
export interface JoltWasmModule extends EmbindPhysicsEnums {
  physicsAbiVersion(): number;
  PhysicsWorld: new (description: EmbindWorldDescription) => EmbindPhysicsWorld;
}

export type JoltWasmFactory = () => Promise<JoltWasmModule>;

export class PhysicsAbiError extends Error {
  constructor(message: string) {
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

function requireFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
}

function requireFloat32(value: number, label: string) {
  requireFinite(value, label);
  if (!Number.isFinite(Math.fround(value))) throw new RangeError(`${label} is outside the float32 range used by the physics engine.`);
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
  if (Math.fround(value) === 0) throw new RangeError(`${label} is too small to represent as float32.`);
}

function requireCapacity(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must be a positive uint32.`);
  }
}

function immutableVec3([x, y, z]: PhysicsVec3): PhysicsVec3 {
  return Object.freeze([x, y, z]) as PhysicsVec3;
}

function immutableQuat([x, y, z, w]: LocalInertialFrame['localToIcrf']): LocalInertialFrame['localToIcrf'] {
  return Object.freeze([x, y, z, w]) as LocalInertialFrame['localToIcrf'];
}

function toVec3([x, y, z]: PhysicsVec3): EmbindVec3 {
  return { x, y, z };
}

function toQuat([x, y, z, w]: RigidBodyDescription['rotation']): EmbindQuat {
  return { x, y, z, w };
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

function embindBodyDescription(module: JoltWasmModule, description: RigidBodyDescription): EmbindBodyDescription {
  const { shape } = description;
  const shapeKind = shape.kind === 'sphere'
    ? module.CollisionShape.Sphere
    : shape.kind === 'box'
      ? module.CollisionShape.Box
      : module.CollisionShape.Capsule;
  const shapeParametersM = shape.kind === 'sphere'
    ? [shape.radiusM, 0, 0] as const
    : shape.kind === 'box'
      ? shape.halfExtentsM
      : [shape.cylinderHalfHeightM, shape.radiusM, 0] as const;
  const motion = description.motion === 'static'
    ? module.MotionType.Static
    : description.motion === 'kinematic'
      ? module.MotionType.Kinematic
      : module.MotionType.Dynamic;
  return {
    shape: shapeKind,
    motion,
    massKg: description.massKg,
    friction: description.friction,
    restitution: description.restitution,
    positionM: toVec3(description.positionM),
    rotation: toQuat(description.rotation),
    shapeParametersM: toVec3(shapeParametersM),
  };
}

function stateFromEmbind(state: EmbindBodyState): RigidBodyState {
  const values = [
    state?.positionM?.x, state?.positionM?.y, state?.positionM?.z,
    state?.rotation?.x, state?.rotation?.y, state?.rotation?.z, state?.rotation?.w,
    state?.linearVelocityMps?.x, state?.linearVelocityMps?.y, state?.linearVelocityMps?.z,
    state?.angularVelocityRadps?.x, state?.angularVelocityRadps?.y, state?.angularVelocityRadps?.z,
  ];
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new PhysicsAbiError('Body state returned an invalid Embind value object.');
  }
  return {
    positionM: [values[0]!, values[1]!, values[2]!],
    rotation: [values[3]!, values[4]!, values[5]!, values[6]!],
    linearVelocityMps: [values[7]!, values[8]!, values[9]!],
    angularVelocityRadps: [values[10]!, values[11]!, values[12]!],
  };
}

/**
 * Adapts the project's Embind facade. Native value objects cross the boundary
 * as named fields; this layer remains unaware of Three.js and scene-scale units.
 */
export function createJoltWorld(module: JoltWasmModule, options: PhysicsWorldOptions): PhysicsWorld {
  if (!module || typeof module.physicsAbiVersion !== 'function' || typeof module.PhysicsWorld !== 'function') {
    throw new PhysicsAbiError('The Embind module is missing its physics facade exports.');
  }
  if (module.physicsAbiVersion() !== PHYSICS_ABI_VERSION) {
    throw new PhysicsAbiError(`Physics interface mismatch; TypeScript expects version ${PHYSICS_ABI_VERSION}.`);
  }
  checkOptions(options);
  const frame: LocalInertialFrame = Object.freeze({
    ...options.frame,
    originPositionKm: immutableVec3(options.frame.originPositionKm),
    originVelocityKmps: immutableVec3(options.frame.originVelocityKmps),
    localToIcrf: immutableQuat(options.frame.localToIcrf),
  });
  const nativeWorld = new module.PhysicsWorld({
    gravityMps2: toVec3(options.gravityMps2),
    maxBodies: options.maxBodies,
    maxBodyPairs: options.maxBodyPairs,
    maxContactConstraints: options.maxContactConstraints,
  });
  const bodies = new Set<EmbindRigidBody>();
  const destroyedBodies = new WeakSet<EmbindRigidBody>();
  let disposed = false;
  let faulted = false;
  let accumulator = 0;
  const fixedStepSeconds = Math.fround(options.fixedStepSeconds);
  const maxSubSteps = options.maxSubSteps;
  const assertUsable = () => {
    if (disposed) throw new PhysicsAbiError('Physics world has been disposed.');
    if (faulted) throw new PhysicsAbiError('Physics world is faulted after a failed native operation; dispose it.');
  };
  const assertBodyAlive = (body: EmbindRigidBody) => {
    if (destroyedBodies.has(body)) throw new PhysicsAbiError('Rigid body has been disposed.');
  };

  return {
    frame,
    createBody(description) {
      assertUsable();
      checkDescription(description);
      const nativeBody = nativeWorld.createBody(embindBodyDescription(module, description));
      if (!nativeBody || typeof nativeBody.delete !== 'function') {
        throw new PhysicsAbiError('Embind createBody returned an invalid native body.');
      }
      bodies.add(nativeBody);
      return {
        setLinearVelocity(velocityMps) {
          assertUsable();
          assertBodyAlive(nativeBody);
          requireVector(velocityMps, 'velocityMps');
          nativeBody.setLinearVelocity(toVec3(velocityMps));
        },
        applyForce(forceN) {
          assertUsable();
          assertBodyAlive(nativeBody);
          requireVector(forceN, 'forceN');
          nativeBody.applyForce(toVec3(forceN));
        },
        readState() {
          assertUsable();
          assertBodyAlive(nativeBody);
          return stateFromEmbind(nativeBody.getState());
        },
        dispose() {
          if (destroyedBodies.has(nativeBody) || disposed) return;
          nativeBody.delete();
          destroyedBodies.add(nativeBody);
          bodies.delete(nativeBody);
        },
      };
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
          nativeWorld.step(fixedStepSeconds);
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
      for (const body of bodies) {
        try {
          body.delete();
          destroyedBodies.add(body);
        } catch (error) {
          failure ??= error;
        }
      }
      bodies.clear();
      try {
        nativeWorld.delete();
      } catch (error) {
        failure ??= error;
      } finally {
        disposed = true;
      }
      if (failure) throw failure;
    },
  };
}

export async function loadJoltWorld(factory: JoltWasmFactory, options: PhysicsWorldOptions): Promise<PhysicsWorld> {
  return createJoltWorld(await factory(), options);
}
