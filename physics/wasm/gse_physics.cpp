#include "gse_physics.hpp"

#include <Jolt/Jolt.h>
#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#include <Jolt/Core/Memory.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/EPhysicsUpdateError.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <cmath>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

namespace gse {
namespace {

constexpr std::uint32_t kMaxBodies = 65'536;
constexpr std::uint32_t kMaxPairs = 1'048'576;
constexpr std::uint32_t kTempAllocatorBytes = 2 * 1024 * 1024;
constexpr JPH::ObjectLayer kObjectLayer = 0;

void initializeJolt() {
  static std::once_flag initialized;
  std::call_once(initialized, [] {
    JPH::RegisterDefaultAllocator();
    JPH::Factory::sInstance = new JPH::Factory();
    JPH::RegisterTypes();
  });
}

bool finite(Vec3 value) {
  return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
}

bool finite(Quat value) {
  return std::isfinite(value.x) && std::isfinite(value.y) &&
         std::isfinite(value.z) && std::isfinite(value.w);
}

JPH::Vec3 toJolt(Vec3 value) {
  return {value.x, value.y, value.z};
}

JPH::Quat toJolt(Quat value) {
  return {value.x, value.y, value.z, value.w};
}

void requirePositiveFinite(float value, const char* name) {
  if (!std::isfinite(value) || value <= 0.0f) {
    throw std::invalid_argument(std::string(name) + " must be finite and greater than zero.");
  }
}

class BroadPhaseLayers final : public JPH::BroadPhaseLayerInterface {
 public:
  JPH::uint GetNumBroadPhaseLayers() const override { return 1; }
  JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer) const override {
    return JPH::BroadPhaseLayer(0);
  }
};

class ObjectLayerFilter final : public JPH::ObjectLayerPairFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer, JPH::ObjectLayer) const override { return true; }
};

class BroadPhaseFilter final : public JPH::ObjectVsBroadPhaseLayerFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer, JPH::BroadPhaseLayer) const override { return true; }
};

JPH::RefConst<JPH::Shape> makeShape(const BodyDescription& description) {
  const Vec3 dimensions = description.shapeParametersM;
  if (!finite(dimensions)) throw std::invalid_argument("shapeParametersM must be finite.");

  switch (description.shape) {
    case CollisionShape::Sphere:
      requirePositiveFinite(dimensions.x, "sphere radiusM");
      return new JPH::SphereShape(dimensions.x);
    case CollisionShape::Box:
      requirePositiveFinite(dimensions.x, "box halfX");
      requirePositiveFinite(dimensions.y, "box halfY");
      requirePositiveFinite(dimensions.z, "box halfZ");
      return new JPH::BoxShape(toJolt(dimensions), 0.0f);
    case CollisionShape::Capsule:
      requirePositiveFinite(dimensions.x, "capsule cylinderHalfHeightM");
      requirePositiveFinite(dimensions.y, "capsule radiusM");
      return new JPH::CapsuleShape(dimensions.x, dimensions.y);
    default:
      throw std::invalid_argument("Unsupported collision shape.");
  }
}

JPH::EMotionType toJolt(MotionType motion) {
  switch (motion) {
    case MotionType::Static:
      return JPH::EMotionType::Static;
    case MotionType::Kinematic:
      return JPH::EMotionType::Kinematic;
    case MotionType::Dynamic:
      return JPH::EMotionType::Dynamic;
    default:
      throw std::invalid_argument("Unsupported rigid-body motion type.");
  }
}

void validateBody(const BodyDescription& description) {
  if (!finite(description.positionM)) throw std::invalid_argument("positionM must be finite.");
  if (!finite(description.rotation)) throw std::invalid_argument("rotation must be finite.");
  const float rotationLength = std::sqrt(
      description.rotation.x * description.rotation.x +
      description.rotation.y * description.rotation.y +
      description.rotation.z * description.rotation.z +
      description.rotation.w * description.rotation.w);
  if (std::abs(rotationLength - 1.0f) > 1e-4f) {
    throw std::invalid_argument("rotation must be a normalized quaternion.");
  }
  if (!std::isfinite(description.massKg) ||
      (description.motion == MotionType::Static ? description.massKg != 0.0f
                                                : description.massKg <= 0.0f)) {
    throw std::invalid_argument(
        "Static bodies require zero mass; kinematic and dynamic bodies require positive mass.");
  }
  if (!std::isfinite(description.friction) || description.friction < 0.0f ||
      description.friction > 1.0f) {
    throw std::invalid_argument("friction must be between zero and one.");
  }
  if (!std::isfinite(description.restitution) || description.restitution < 0.0f ||
      description.restitution > 1.0f) {
    throw std::invalid_argument("restitution must be between zero and one.");
  }
  toJolt(description.motion);
}

}  // namespace

struct PhysicsWorld::Impl {
  struct Runtime {
    Runtime() { initializeJolt(); }
  };

  explicit Impl(WorldDescription description) {
    if (!finite(description.gravityMps2)) {
      throw std::invalid_argument("gravityMps2 must be finite.");
    }
    if (description.maxBodies == 0 || description.maxBodies > kMaxBodies) {
      throw std::invalid_argument("maxBodies must be between 1 and 65536.");
    }
    if (description.maxBodyPairs == 0 || description.maxBodyPairs > kMaxPairs) {
      throw std::invalid_argument("maxBodyPairs must be between 1 and 1048576.");
    }
    if (description.maxContactConstraints == 0 ||
        description.maxContactConstraints > kMaxPairs) {
      throw std::invalid_argument("maxContactConstraints must be between 1 and 1048576.");
    }

    physicsSystem.Init(description.maxBodies, 0, description.maxBodyPairs,
                       description.maxContactConstraints, broadPhaseLayers,
                       broadPhaseFilter, objectLayerFilter);
    physicsSystem.SetGravity(toJolt(description.gravityMps2));
  }

  ~Impl() {
    JPH::BodyInterface& bodies = physicsSystem.GetBodyInterface();
    for (JPH::BodyID id : bodyIds) {
      bodies.RemoveBody(id);
      bodies.DestroyBody(id);
    }
  }

  Runtime runtime;
  BroadPhaseLayers broadPhaseLayers;
  BroadPhaseFilter broadPhaseFilter;
  ObjectLayerFilter objectLayerFilter;
  JPH::PhysicsSystem physicsSystem;
  JPH::TempAllocatorImplWithMallocFallback tempAllocator{kTempAllocatorBytes};
  JPH::JobSystemSingleThreaded jobSystem{JPH::cMaxPhysicsJobs};
  std::vector<JPH::BodyID> bodyIds;
};

struct RigidBody::Impl {
  Impl(std::shared_ptr<PhysicsWorld::Impl> world, MotionType bodyMotion)
      : world(std::move(world)), motion(bodyMotion) {}

  ~Impl() {
    if (ownsBody) {
      if (const auto owner = world.lock()) {
        JPH::BodyInterface& bodies = owner->physicsSystem.GetBodyInterface();
        if (isAdded) bodies.RemoveBody(bodyId);
        bodies.DestroyBody(bodyId);
        auto& ids = owner->bodyIds;
        ids.erase(std::remove(ids.begin(), ids.end(), bodyId), ids.end());
      }
    }
  }

  std::weak_ptr<PhysicsWorld::Impl> world;
  JPH::BodyID bodyId;
  MotionType motion;
  bool ownsBody = false;
  bool isAdded = false;
};

RigidBody::RigidBody(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
RigidBody::~RigidBody() = default;

void RigidBody::setLinearVelocity(Vec3 velocityMps) {
  if (!finite(velocityMps)) throw std::invalid_argument("velocityMps must be finite.");
  if (impl_->motion == MotionType::Static) {
    throw std::logic_error("Static bodies cannot have a linear velocity.");
  }
  const auto world = impl_->world.lock();
  if (!world) throw std::logic_error("The physics world has been disposed.");
  world->physicsSystem.GetBodyInterface().SetLinearVelocity(impl_->bodyId, toJolt(velocityMps));
}

void RigidBody::applyForce(Vec3 forceN) {
  if (!finite(forceN)) throw std::invalid_argument("forceN must be finite.");
  if (impl_->motion != MotionType::Dynamic) {
    throw std::logic_error("Forces can only be applied to dynamic bodies.");
  }
  const auto world = impl_->world.lock();
  if (!world) throw std::logic_error("The physics world has been disposed.");
  world->physicsSystem.GetBodyInterface().AddForce(impl_->bodyId, toJolt(forceN));
}

BodyState RigidBody::getState() const {
  const auto world = impl_->world.lock();
  if (!world) throw std::logic_error("The physics world has been disposed.");
  const JPH::BodyInterface& bodies = world->physicsSystem.GetBodyInterface();
  JPH::RVec3 position;
  JPH::Quat rotation;
  bodies.GetPositionAndRotation(impl_->bodyId, position, rotation);
  const JPH::Vec3 linearVelocity = bodies.GetLinearVelocity(impl_->bodyId);
  const JPH::Vec3 angularVelocity = bodies.GetAngularVelocity(impl_->bodyId);
  return {
      {static_cast<float>(position.GetX()), static_cast<float>(position.GetY()),
       static_cast<float>(position.GetZ())},
      {rotation.GetX(), rotation.GetY(), rotation.GetZ(), rotation.GetW()},
      {linearVelocity.GetX(), linearVelocity.GetY(), linearVelocity.GetZ()},
      {angularVelocity.GetX(), angularVelocity.GetY(), angularVelocity.GetZ()},
  };
}

PhysicsWorld::PhysicsWorld(WorldDescription description)
    : impl_(std::make_shared<Impl>(description)) {}
PhysicsWorld::~PhysicsWorld() = default;

std::unique_ptr<RigidBody> PhysicsWorld::createBody(BodyDescription description) {
  validateBody(description);
  const auto shape = makeShape(description);
  const JPH::EMotionType motion = toJolt(description.motion);
  JPH::BodyCreationSettings settings(shape.GetPtr(), JPH::RVec3(description.positionM.x,
      description.positionM.y, description.positionM.z), toJolt(description.rotation), motion,
      kObjectLayer);
  settings.mFriction = description.friction;
  settings.mRestitution = description.restitution;
  if (description.motion == MotionType::Dynamic) {
    settings.mOverrideMassProperties = JPH::EOverrideMassProperties::CalculateInertia;
    settings.mMassPropertiesOverride.mMass = description.massKg;
  }

  JPH::BodyInterface& bodies = impl_->physicsSystem.GetBodyInterface();
  auto bodyImpl = std::make_unique<RigidBody::Impl>(impl_, description.motion);
  JPH::Body* body = bodies.CreateBody(settings);
  if (!body) throw std::runtime_error("Jolt could not allocate a rigid body.");

  const JPH::BodyID id = body->GetID();
  bodyImpl->bodyId = id;
  bodyImpl->ownsBody = true;
  bodies.AddBody(id, description.motion == MotionType::Static ? JPH::EActivation::DontActivate
                                                              : JPH::EActivation::Activate);
  bodyImpl->isAdded = true;
  impl_->bodyIds.push_back(id);
  return std::unique_ptr<RigidBody>(new RigidBody(std::move(bodyImpl)));
}

void PhysicsWorld::step(float fixedStepSeconds) {
  requirePositiveFinite(fixedStepSeconds, "fixedStepSeconds");
  const JPH::EPhysicsUpdateError error =
      impl_->physicsSystem.Update(fixedStepSeconds, 1, &impl_->tempAllocator, &impl_->jobSystem);
  if (error != JPH::EPhysicsUpdateError::None) {
    throw std::runtime_error("Jolt physics step failed with error flags " +
                             std::to_string(static_cast<std::uint32_t>(error)) + ".");
  }
}

}  // namespace gse
