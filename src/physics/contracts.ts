export type PhysicsVec3 = readonly [number, number, number];
export type PhysicsQuat = readonly [number, number, number, number];

export interface LocalInertialFrame {
  /** Body at the local origin; identifies the ephemeris/rotation source for the transform. */
  readonly originBodyId: string;
  /** Frame epoch, Julian date in TDB. */
  readonly epochJdTdb: number;
  /** ICRF state of the frame origin at the epoch. */
  readonly originPositionKm: PhysicsVec3;
  readonly originVelocityKmps: PhysicsVec3;
  /** Normalized quaternion rotating local coordinates into ICRF coordinates, x,y,z,w. */
  readonly localToIcrf: PhysicsQuat;
}

export type CollisionShape =
  | { kind: 'sphere'; radiusM: number }
  | { kind: 'box'; halfExtentsM: PhysicsVec3 }
  | { kind: 'capsule'; cylinderHalfHeightM: number; radiusM: number };

export type MotionType = 'static' | 'kinematic' | 'dynamic';

export interface RigidBodyDescription {
  shape: CollisionShape;
  motion: MotionType;
  massKg: number;
  friction: number;
  restitution: number;
  positionM: PhysicsVec3;
  rotation: PhysicsQuat;
}

export interface RigidBodyState {
  positionM: PhysicsVec3;
  rotation: PhysicsQuat;
  linearVelocityMps: PhysicsVec3;
  angularVelocityRadps: PhysicsVec3;
}

export interface PhysicsWorldOptions {
  frame: LocalInertialFrame;
  /** Uniform gravity in this local physics world's axes, m/s^2. */
  gravityMps2: PhysicsVec3;
  fixedStepSeconds: number;
  maxSubSteps: number;
  maxBodies: number;
  maxBodyPairs: number;
  maxContactConstraints: number;
}

export interface RigidBody {
  setLinearVelocity(velocityMps: PhysicsVec3): void;
  applyForce(forceN: PhysicsVec3): void;
  readState(): RigidBodyState;
  dispose(): void;
}

export interface PhysicsWorld {
  readonly frame: LocalInertialFrame;
  createBody(description: RigidBodyDescription): RigidBody;
  /** Advances by elapsed wall time using fixed simulation steps. Throws rather than dropping time. */
  advance(elapsedSeconds: number): number;
  dispose(): void;
}
