import * as THREE from 'three';
import type { Lang } from '../data/bodies';
import type { BodyNode } from '../planets/planet';
import { labelText } from './kind';

const tmp = new THREE.Vector3();
const screenUp = new THREE.Vector3();

/**
 * Name labels above at most two planets: the active (focused/selected) one,
 * and the one being hovered by finger or mouse. Nothing else, to stay clean.
 */
export class PlanetLabels {
  private active = document.querySelector<HTMLElement>('#labels [data-slot="active"]')!;
  private hover = document.querySelector<HTMLElement>('#labels [data-slot="hover"]')!;

  update(nodes: BodyNode[], camera: THREE.Camera, activeId: string, hoverId: string | null, lang: Lang) {
    this.place(this.active, nodes, camera, activeId, lang);
    this.place(this.hover, nodes, camera, hoverId && hoverId !== activeId ? hoverId : null, lang);
  }

  private place(el: HTMLElement, nodes: BodyNode[], camera: THREE.Camera, id: string | null, lang: Lang) {
    const node = id ? nodes.find((n) => n.body.id === id) : undefined;
    if (!node) {
      el.hidden = true;
      return;
    }
    // Anchor just above the planet's top edge (in screen terms).
    node.mesh.getWorldPosition(tmp);
    screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion); // camera's up, in world space
    tmp.addScaledVector(screenUp, node.body.radius * node.tilt.scale.x * 1.25);
    tmp.project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.2 || Math.abs(tmp.y) > 1.2) {
      el.hidden = true;
      return;
    }
    const x = ((tmp.x + 1) / 2) * innerWidth;
    const y = ((1 - tmp.y) / 2) * innerHeight;
    const text = labelText(node.body, lang);
    if (el.textContent !== text) el.textContent = text;
    el.hidden = false;
    el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${(y - 6).toFixed(1)}px)`;
  }
}
