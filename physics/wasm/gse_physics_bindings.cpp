#include "gse_physics.hpp"

#include <emscripten/bind.h>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(gse_physics) {
  enum_<gse::CollisionShape>("CollisionShape")
      .value("Sphere", gse::CollisionShape::Sphere)
      .value("Box", gse::CollisionShape::Box)
      .value("Capsule", gse::CollisionShape::Capsule);

  enum_<gse::MotionType>("MotionType")
      .value("Static", gse::MotionType::Static)
      .value("Kinematic", gse::MotionType::Kinematic)
      .value("Dynamic", gse::MotionType::Dynamic);

  value_object<gse::Vec3>("Vec3")
      .field("x", &gse::Vec3::x)
      .field("y", &gse::Vec3::y)
      .field("z", &gse::Vec3::z);

  value_object<gse::Quat>("Quat")
      .field("x", &gse::Quat::x)
      .field("y", &gse::Quat::y)
      .field("z", &gse::Quat::z)
      .field("w", &gse::Quat::w);

  value_object<gse::WorldDescription>("WorldDescription")
      .field("gravityMps2", &gse::WorldDescription::gravityMps2)
      .field("maxBodies", &gse::WorldDescription::maxBodies)
      .field("maxBodyPairs", &gse::WorldDescription::maxBodyPairs)
      .field("maxContactConstraints", &gse::WorldDescription::maxContactConstraints);

  value_object<gse::BodyDescription>("BodyDescription")
      .field("shape", &gse::BodyDescription::shape)
      .field("motion", &gse::BodyDescription::motion)
      .field("massKg", &gse::BodyDescription::massKg)
      .field("friction", &gse::BodyDescription::friction)
      .field("restitution", &gse::BodyDescription::restitution)
      .field("positionM", &gse::BodyDescription::positionM)
      .field("rotation", &gse::BodyDescription::rotation)
      .field("shapeParametersM", &gse::BodyDescription::shapeParametersM);

  value_object<gse::BodyState>("BodyState")
      .field("positionM", &gse::BodyState::positionM)
      .field("rotation", &gse::BodyState::rotation)
      .field("linearVelocityMps", &gse::BodyState::linearVelocityMps)
      .field("angularVelocityRadps", &gse::BodyState::angularVelocityRadps);

  class_<gse::RigidBody>("RigidBody")
      .function("setLinearVelocity", &gse::RigidBody::setLinearVelocity)
      .function("applyForce", &gse::RigidBody::applyForce)
      .function("getState", &gse::RigidBody::getState);

  class_<gse::PhysicsWorld>("PhysicsWorld")
      .constructor<gse::WorldDescription>()
      .function("createBody", &gse::PhysicsWorld::createBody)
      .function("step", &gse::PhysicsWorld::step);

  function("physicsAbiVersion", &gse::physicsAbiVersion);
}
