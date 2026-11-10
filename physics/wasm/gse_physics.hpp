#ifndef GSE_PHYSICS_HPP
#define GSE_PHYSICS_HPP

#include <cstdint>
#include <memory>

namespace gse {

inline constexpr std::uint32_t kPhysicsInterfaceVersion = 2;

enum class CollisionShape : std::int32_t {
  Sphere = 0,
  Box = 1,
  Capsule = 2,
};

enum class MotionType : std::int32_t {
  Static = 0,
  Kinematic = 1,
  Dynamic = 2,
};

struct Vec3 {
  float x;
  float y;
  float z;
};

struct Quat {
  float x;
  float y;
  float z;
  float w;
};

struct WorldDescription {
  Vec3 gravityMps2;
  std::uint32_t maxBodies;
  std::uint32_t maxBodyPairs;
  std::uint32_t maxContactConstraints;
};

struct BodyDescription {
  CollisionShape shape;
  MotionType motion;
  float massKg;
  float friction;
  float restitution;
  Vec3 positionM;
  Quat rotation;
  // Sphere: radiusM,0,0; box: halfX,halfY,halfZ;
  // capsule: cylinderHalfHeightM,radiusM,0.
  Vec3 shapeParametersM;
};

struct BodyState {
  Vec3 positionM;
  Quat rotation;
  Vec3 linearVelocityMps;
  Vec3 angularVelocityRadps;
};

class RigidBody {
 public:
  void setLinearVelocity(Vec3 velocityMps);
  void applyForce(Vec3 forceN);
  BodyState getState() const;

 private:
  friend class PhysicsWorld;
  struct Impl;
  explicit RigidBody(std::shared_ptr<Impl> impl);
  std::shared_ptr<Impl> impl_;
};

class PhysicsWorld {
 public:
  explicit PhysicsWorld(WorldDescription description);
  ~PhysicsWorld();

  PhysicsWorld(const PhysicsWorld&) = delete;
  PhysicsWorld& operator=(const PhysicsWorld&) = delete;

  std::shared_ptr<RigidBody> createBody(BodyDescription description);
  void step(float fixedStepSeconds);

 private:
  struct Impl;
  std::shared_ptr<Impl> impl_;
};

inline std::uint32_t physicsAbiVersion() {
  return kPhysicsInterfaceVersion;
}

}  // namespace gse

#endif
