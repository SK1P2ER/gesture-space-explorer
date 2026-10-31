import * as THREE from 'three';
import { BASES } from '../../src/data/bases';
import { BODIES } from '../../src/data/bodies';
import { createBases } from '../../src/scene/bases';
import type { BodyNode } from '../../src/planets/planet';

/** Real persistent pads; omit planet texture/network services. */
export function landingBases() {
  const nodes = [...new Set(BASES.map((base) => base.body))].map((id) => {
    const body = BODIES.find((body) => body.id === id)!;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), new THREE.MeshStandardMaterial());
    mesh.scale.setScalar(body.radius);
    const tilt = new THREE.Group();
    tilt.add(mesh);
    return { body, mesh, tilt, anchor: tilt } as unknown as BodyNode;
  });
  const bases = createBases(nodes);
  return { bases, jezero: bases.find((base) => base.base.id === 'jezero')!, dispose() {
    const geometry = new Set<THREE.BufferGeometry>();
    // Module-level shared pad/fallback materials are borrowed by these fixtures.
    for (const node of nodes) node.tilt.traverse((object) => {
      if (object instanceof THREE.Mesh) geometry.add(object.geometry);
    });
    for (const item of geometry) item.dispose();
    for (const node of nodes) (node.mesh.material as THREE.Material).dispose();
    for (const base of bases) for (const light of base.lights) light.dispose();
  } };
}
