import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const moduleUrl = pathToFileURL(resolve('public/physics/gse_physics.js'));
const { default: createModule } = await import(moduleUrl.href);
const wasmUrl = pathToFileURL(resolve('public/physics/gse_physics.wasm')).href;
const module = await createModule({ locateFile: () => wasmUrl });

assert.equal(module.physicsAbiVersion(), 3);
assert.ok(module.CollisionShape.Sphere);
assert.ok(module.CollisionShape.Box);
assert.ok(module.CollisionShape.Capsule);
assert.notEqual(module.CollisionShape.Sphere, module.CollisionShape.Box);
assert.notEqual(module.CollisionShape.Box, module.CollisionShape.Capsule);

const world = new module.PhysicsWorld({
  gravityMps2: { x: 0, y: -9.80665, z: 0 },
  maxBodies: 32,
  maxBodyPairs: 256,
  maxContactConstraints: 128,
});
const floor = world.createBody({
  shape: module.CollisionShape.Box,
  motion: module.MotionType.Static,
  massKg: 0,
  friction: 0.8,
  restitution: 0,
  positionM: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  shapeParametersM: { x: 10, y: 0.5, z: 10 },
});
const sphere = world.createBody({
  shape: module.CollisionShape.Sphere,
  motion: module.MotionType.Dynamic,
  massKg: 12,
  friction: 0.5,
  restitution: 0,
  positionM: { x: 0, y: 2, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  shapeParametersM: { x: 0.5, y: 0, z: 0 },
});

try {
  for (let i = 0; i < 120; i++) world.step(1 / 60);
  const landed = sphere.getState();
  assert.ok(landed.positionM.y > 0.9 && landed.positionM.y < 1.1, JSON.stringify(landed));
  assert.ok(Math.abs(landed.linearVelocityMps.y) < 0.1, JSON.stringify(landed));

  sphere.applyForce({ x: 0, y: 120, z: 0 });
  world.step(1 / 60);
  assert.ok(sphere.getState().linearVelocityMps.y > 0);

  const expectNativeError = (operation, text) => {
    const stack = module.stackSave();
    try {
      assert.throws(operation, (exception) => {
        if (typeof exception !== 'number') return false;
        const [, message] = module.getExceptionMessage(exception);
        module.decrementExceptionRefcount(exception);
        return message.includes(text);
      });
    } finally {
      module.stackRestore(stack);
    }
  };
  expectNativeError(() => world.step(0), 'fixedStepSeconds');
  expectNativeError(() => floor.applyForce({ x: 0, y: 1, z: 0 }), 'dynamic bodies');
  expectNativeError(() => sphere.applyForce({ x: Number.NaN, y: 0, z: 0 }), 'finite');
} finally {
  sphere.delete();
  floor.delete();
  world.delete();
}

console.log('Emscripten/Jolt bridge smoke test passed.');
