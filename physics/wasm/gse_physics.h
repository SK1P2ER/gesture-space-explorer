#ifndef GSE_PHYSICS_H
#define GSE_PHYSICS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define GSE_PHYSICS_ABI_VERSION 1

typedef int32_t GsePhysicsStatus;
typedef uint32_t GsePhysicsHandle;

enum GsePhysicsStatusCode {
  GSE_PHYSICS_OK = 0,
  GSE_PHYSICS_INVALID_ARGUMENT = 1,
  GSE_PHYSICS_INVALID_HANDLE = 2,
  GSE_PHYSICS_CAPACITY_EXCEEDED = 3,
  GSE_PHYSICS_BACKEND_ERROR = 4
};

enum GseCollisionShape {
  GSE_SHAPE_SPHERE = 0,
  GSE_SHAPE_BOX = 1,
  GSE_SHAPE_CAPSULE = 2
};

enum GseMotionType {
  GSE_MOTION_STATIC = 0,
  GSE_MOTION_KINEMATIC = 1,
  GSE_MOTION_DYNAMIC = 2
};

uint32_t gse_physics_abi_version(void);

GsePhysicsStatus gse_world_create(
    float gravity_x_mps2, float gravity_y_mps2, float gravity_z_mps2,
    uint32_t max_bodies, uint32_t max_body_pairs, uint32_t max_contact_constraints,
    GsePhysicsHandle *out_world);
GsePhysicsStatus gse_world_destroy(GsePhysicsHandle world);
GsePhysicsStatus gse_world_step(GsePhysicsHandle world, float fixed_step_seconds);

/*
 * Input arrays are packed float32 values:
 * position[3] in m; rotation[4] as normalized x,y,z,w quaternion.
 * shape_parameters[3]: sphere = radius,0,0; box = halfX,halfY,halfZ;
 * capsule = cylinderHalfHeight,radius,0. All dimensions are in m.
 */
GsePhysicsStatus gse_body_create(
    GsePhysicsHandle world, uint32_t shape, uint32_t motion,
    float mass_kg, float friction, float restitution,
    const float *position_m, const float *rotation_xyzw,
    const float *shape_parameters_m, GsePhysicsHandle *out_body);
GsePhysicsStatus gse_body_destroy(GsePhysicsHandle world, GsePhysicsHandle body);
GsePhysicsStatus gse_body_set_linear_velocity(
    GsePhysicsHandle world, GsePhysicsHandle body, float x_mps, float y_mps, float z_mps);
GsePhysicsStatus gse_body_apply_force(
    GsePhysicsHandle world, GsePhysicsHandle body, float x_n, float y_n, float z_n);

/*
 * Writes 13 float32 values: position[3] m, rotation[4] x,y,z,w,
 * linear velocity[3] m/s, angular velocity[3] rad/s.
 */
GsePhysicsStatus gse_body_get_state(
    GsePhysicsHandle world, GsePhysicsHandle body, float *out_state);

#ifdef __cplusplus
}
#endif

#endif
