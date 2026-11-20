#include "gse_physics.hpp"

#include <cmath>
#include <stdexcept>

void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

int main() {
  gse::PhysicsWorld world({{0.0f, -9.80665f, 0.0f}, 32, 256, 128});
  auto floor = world.createBody({
      gse::CollisionShape::Box, gse::MotionType::Static, 0.0f, 0.8f, 0.0f,
      {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f, 1.0f}, {10.0f, 0.5f, 10.0f}});
  auto sphere = world.createBody({
      gse::CollisionShape::Sphere, gse::MotionType::Dynamic, 12.0f, 0.5f, 0.0f,
      {0.0f, 2.0f, 0.0f}, {0.0f, 0.0f, 0.0f, 1.0f}, {0.5f, 0.0f, 0.0f}});

  for (int i = 0; i < 120; ++i) world.step(1.0f / 60.0f);
  const gse::BodyState landed = sphere->getState();
  check(landed.positionM.y > 0.9f && landed.positionM.y < 1.1f,
        "The dynamic body did not settle on the floor.");
  check(std::abs(landed.linearVelocityMps.y) < 0.1f,
        "The dynamic body did not settle to rest.");

  sphere->applyForce({0.0f, 120.0f, 0.0f});
  world.step(1.0f / 60.0f);
  check(sphere->getState().linearVelocityMps.y > 0.0f,
        "Applying force did not change the body velocity.");

  bool rejectedInvalidInput = false;
  try {
    world.step(0.0f);
  } catch (const std::invalid_argument&) {
    rejectedInvalidInput = true;
  }
  check(rejectedInvalidInput, "The world accepted an invalid step.");

  bool rejectedForceOnStaticBody = false;
  try {
    floor->applyForce({0.0f, 1.0f, 0.0f});
  } catch (const std::logic_error&) {
    rejectedForceOnStaticBody = true;
  }
  check(rejectedForceOnStaticBody, "A force was accepted on a static body.");
}
