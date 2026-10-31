import type * as THREE from 'three';

/** One label: its text and where it is in the scene. */
export interface SkyLabel {
  id: string;
  text: string;
  world: THREE.Vector3;
}

/**
 * Small names under the sky moons and Earth in the horizon view. Plain DOM over
 * the canvas, placed by projecting each object; none when the list is empty.
 */
export class SkyLabels {
  private readonly root = document.createElement('div');
  private readonly spans = new Map<string, HTMLSpanElement>();

  constructor() {
    this.root.id = 'sky-labels';
    this.root.setAttribute('aria-hidden', 'true');
    document.body.append(this.root);
  }

  render(labels: readonly SkyLabel[], camera: THREE.Camera) {
    const seen = new Set<string>();
    for (const l of labels) {
      const p = l.world.clone().project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue; // behind or off screen
      let span = this.spans.get(l.id);
      if (!span) {
        span = document.createElement('span');
        this.spans.set(l.id, span);
        this.root.append(span);
      }
      if (span.textContent !== l.text) span.textContent = l.text;
      span.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
      span.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
      span.hidden = false;
      seen.add(l.id);
    }
    for (const [id, span] of this.spans) if (!seen.has(id)) span.hidden = true;
  }
}
