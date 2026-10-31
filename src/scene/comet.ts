import * as THREE from 'three';

/**
 * How awake a comet is, 0 → 1: frozen and tail-less beyond ~4 AU, where its ices start
 * to boil off, full at Halley's perihelion distance (~0.6 AU). Smoothstep in between.
 */
export function activity(rAU: number): number {
  const [start, full] = [4, 0.6];
  const x = Math.min(1, Math.max(0, (start - rAU) / (start - full)));
  return x * x * (3 - 2 * x);
}

/** Where a tail runs, from the head (scene units). The Sun is at the origin. */
export interface TailShape {
  /** Straight away from the Sun: the ion tail, pushed by the solar wind. */
  ion: (s: number, out: THREE.Vector3) => THREE.Vector3;
  /** Away from the Sun, curving back along the orbit: dust is pushed more gently and lags behind. */
  dust: (s: number, out: THREE.Vector3) => THREE.Vector3;
}

export function tailShape(head: THREE.Vector3, motion: THREE.Vector3, level: number): TailShape {
  const away = head.clone().normalize();
  const back = motion.clone().normalize();
  const [ionLength, dustLength] = [22 * level, 14 * level];
  return {
    ion: (s, out) => out.copy(head).addScaledVector(away, ionLength * s),
    dust: (s, out) => out.copy(head).addScaledVector(away, dustLength * s).addScaledVector(back, -dustLength * 0.45 * s * s),
  };
}

const SEGMENTS = 32;

/** A glowing strip along a curve, turned to face the camera; brightest at the head, fading out along and across it. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly positions: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  constructor(color: THREE.Color, private readonly width: (s: number) => number) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    const along = new Float32Array((SEGMENTS + 1) * 2 * 2);
    const index: number[] = [];
    for (let k = 0; k <= SEGMENTS; k++) {
      along.set([k / SEGMENTS, -1, k / SEGMENTS, 1], k * 4);
      if (k < SEGMENTS) index.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
    }
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 2));
    geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec2 aAlong; // (s along the tail 0 → 1, side −1 → 1)
        varying vec2 vAlong;
        void main() {
          vAlong = aAlong;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vAlong;
        void main() {
          // max(): pow() of a slightly negative base (interpolation at the edges) is NaN, which bloom would smear over the frame.
          float fade = pow(max(1.0 - vAlong.x, 0.0), 1.6) * pow(max(1.0 - abs(vAlong.y), 0.0), 1.2);
          gl_FragColor = vec4(uColor * fade * uOpacity, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false; // rebuilt every frame
  }

  update(curve: (s: number, out: THREE.Vector3) => THREE.Vector3, camera: THREE.Camera, opacity: number) {
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    const behind = new THREE.Vector3();
    const side = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const h = 1 / SEGMENTS;
    for (let k = 0; k <= SEGMENTS; k++) {
      const s = k / SEGMENTS;
      curve(s, p);
      const tangent = curve(Math.min(1, s + h), ahead).sub(curve(Math.max(0, s - h), behind));
      toCamera.subVectors(camera.position, p);
      side.crossVectors(tangent, toCamera).normalize().multiplyScalar(this.width(s) / 2);
      this.positions.setXYZ(2 * k, p.x - side.x, p.y - side.y, p.z - side.z);
      this.positions.setXYZ(2 * k + 1, p.x + side.x, p.y + side.y, p.z + side.z);
    }
    this.positions.needsUpdate = true;
    this.material.uniforms.uOpacity.value = opacity;
  }
}

/** Coma and the two tails of a comet. Hidden when it's too far from the Sun to have any. */
export class CometTails {
  readonly group = new THREE.Group();
  private readonly ion = new Ribbon(new THREE.Color(0.45, 0.7, 1.0), (s) => 0.15 + 0.7 * s);
  private readonly dust = new Ribbon(new THREE.Color(1.0, 0.88, 0.68), (s) => 0.3 + 2.6 * s);
  private readonly coma: THREE.Sprite;

  constructor() {
    this.coma = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xd8e8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.group.add(this.dust.mesh, this.ion.mesh, this.coma);
    this.group.visible = false;
  }

  /**
   * @param head the nucleus, in scene coordinates (the Sun at the origin)
   * @param motion its direction of travel
   * @param rAU its real distance from the Sun
   */
  update(head: THREE.Vector3, motion: THREE.Vector3, rAU: number, camera: THREE.Camera) {
    const level = activity(rAU);
    this.group.visible = level > 0.001;
    if (!this.group.visible) return;
    const shape = tailShape(head, motion, level);
    this.ion.update(shape.ion, camera, 0.9 * level);
    this.dust.update(shape.dust, camera, 0.7 * level);
    this.coma.position.copy(head);
    this.coma.scale.setScalar(0.4 + 2.4 * level);
    this.coma.material.opacity = Math.min(1, 0.3 + level);
  }
}

/** A soft round glow, white in the middle. */
function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
