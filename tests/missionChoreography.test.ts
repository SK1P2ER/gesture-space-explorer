import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mission, type MissionState } from '../src/app/mission';
import { modeForFocus, ModeMachine } from '../src/app/modes';
import { BODIES } from '../src/data/bodies';
import { SimClock, WEEK } from '../src/sim/clock';
import { CameraRig } from '../src/scene/cameraRig';
import type { Passport } from '../src/sim/passport';
import type { Intent } from '../src/intents';
import type { RocketOptions } from '../src/scene/rocketKit';
import { landingBases } from './helpers/landingBase';

// A whole visit, frame by frame, through a real Mission: at a base, the horizon view, Build's camera,
// a countdown, the flight, docking and the landing. Every sampled frame records the mode, what the
// camera is told, the camera, and the rocket and its dust (pose, layers, a digest of every part and
// material). The snapshot pins the choreography, so a refactor that moves this code must reproduce it
// exactly; a deliberate change to how a trip looks updates it (vitest -u).

const DT = 1 / 30;
const SAMPLE_EVERY = 10;
/** Where each body sits, so trips have a length (the fixtures otherwise stand at the origin). */
const PLACES: Record<string, [number, number, number]> = { earth: [0, 0, 0], moon: [6, 0.5, 0], mars: [60, -2, 20], europa: [-90, 3, -40], titan: [130, -4, 70] };

const round = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
const v = (p: THREE.Vector3) => [round(p.x), round(p.y), round(p.z)];
const q = (p: THREE.Quaternion) => [round(p.x), round(p.y), round(p.z), round(p.w)];

/** Every part's transform and visibility, and its material's look, as a few numbers. */
function digest(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  let parts = 0, visible = 0, transforms = 0, looks = 0;
  root.traverse((o) => {
    parts++;
    if (o.visible) visible++;
    o.matrix.elements.forEach((e, k) => (transforms += e * (((parts * 16 + k) % 7) + 1)));
    if (o instanceof THREE.InstancedMesh) {
      looks += o.count;
      o.instanceMatrix.array.forEach((e, k) => (transforms += e * ((k % 5) + 1)));
    }
    if (o instanceof THREE.Mesh) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const any = m as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };
        looks += m.opacity + (m.visible ? 1 : 0) + (any.emissiveIntensity ?? 0);
        if (any.color) looks += any.color.r + 2 * any.color.g + 3 * any.color.b;
        if (any.emissive) looks += any.emissive.r + 2 * any.emissive.g + 3 * any.emissive.b;
      }
    }
  });
  return [parts, visible, round(transforms), round(looks), root.layers.mask];
}

function setup(reducedMotion: boolean) {
  // Deterministic randomness (the warp streaks' seeds).
  let seed = 12345;
  vi.spyOn(Math, 'random').mockImplementation(() => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31));
  const fixture = landingBases();
  for (const base of fixture.bases) base.body.tilt.position.set(...(PLACES[base.body.body.id] ?? [0, 0, 0]));
  const scene = new THREE.Scene();
  const state: MissionState = {
    focus: 0, selected: null, lang: 'en', autoLand: false, passport: {} as Passport, steerSensitivity: 'normal',
    passportOpen: false, menuOpen: false, weightOpen: false,
  };
  const modes = new ModeMachine();
  const rig = new CameraRig(16 / 9);
  const clock = new SimClock(Date.UTC(2026, 9, 24), WEEK);
  const events: string[] = [];
  const at = (id: string) => BODIES.findIndex((b) => b.id === id);
  const setFocus = (index: number) => {
    state.focus = index;
    modes.go(modeForFocus(index));
    rig.focus(BODIES[index].radius, BODIES[index].radius, index === 0);
  };
  let rocketOptions: RocketOptions = { detail: 'low', textureSize: 32 };
  const mission = new Mission({
    state, modes, rig, clock, bases: fixture.bases, scene, setFocus,
    savePassport: (p) => events.push(`passport ${Object.keys(p).join(',')}`),
    flash: (text) => events.push(`flash ${text}`),
    reducedMotion: () => reducedMotion,
    goldenHour: () => ({ ms: clock.time + 3_600_000, sun: new THREE.Vector3(1, 0.2, 0.5) }),
    rocketOptions: () => rocketOptions,
    report: (message) => events.push(`report ${message}`),
    liftedOff: (from, to) => events.push(`liftedOff ${from} ${to}`),
    landed: (id) => events.push(`landed ${id}`),
  });

  const trace: unknown[] = [];
  let frameNo = 0;
  const frame = () => {
    const view = mission.update(DT, rig.camera);
    if (view !== 'chase') {
      rig.setTarget(view?.target ?? new THREE.Vector3());
      rig.update(DT);
    }
    if (frameNo++ % SAMPLE_EVERY === 0) {
      const [rocket, dust] = mission.baseRoots();
      trace.push({
        f: frameNo - 1, mode: modes.mode,
        view: view === 'chase' || view === null ? view : v(view.target),
        cam: [...v(rig.camera.position), ...q(rig.camera.quaternion), round(rig.camera.near), round(rig.camera.far)],
        rocket: rocket ? [...v(rocket.position), ...q(rocket.quaternion), round(rocket.scale.x), ...digest(rocket)] : null,
        dust: dust ? digest(dust) : null,
        readout: mission.readout(),
        horizon: mission.horizon ? [round(mission.horizon.yaw), round(mission.horizon.pitch), round(mission.horizon.distance), ...v(mission.horizonEye)] : null,
        clock: [clock.time, clock.rate],
      });
    }
  };
  const frames = (n: number) => { for (let i = 0; i < n; i++) frame(); };
  const until = (done: () => boolean, max = 4000) => {
    for (let i = 0; i < max && !done(); i++) frame();
    expect(done()).toBe(true);
  };
  const send = (intent: Intent) => events.push(`${intent.type} ${mission.handle(intent)}`);
  return {
    mission, modes, state, at, setFocus, frames, until, send, trace, events, fixture,
    setRocketOptions: (o: RocketOptions) => (rocketOptions = o),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a visit through Mission, frame by frame', () => {
  it('in full motion: a base, its horizon and golden hour, Build, a launch, separation, a manual landing', () => {
    const s = setup(false);
    s.mission.baseShadows = true;
    s.mission.setRocketNight(0.6);
    s.setFocus(s.at('mars'));
    s.send({ type: 'enterBase', baseId: 'jezero' });
    s.frames(30);
    s.send({ type: 'toggleHorizon' });
    s.frames(20);
    s.send({ type: 'rotate', dx: 0.3, dy: -0.1 });
    s.send({ type: 'zoom', factor: 0.8 });
    s.frames(20);
    s.send({ type: 'goldenHour' });
    s.frames(20);
    s.send({ type: 'dismiss' });
    s.frames(10);
    s.modes.go('build');
    s.send({ type: 'rotate', dx: 0.2, dy: 0.1 });
    s.frames(10);
    s.modes.go('baseView');
    s.send({ type: 'next' });
    s.send({ type: 'launch' });
    s.until(() => s.modes.mode === 'travel');
    s.frames(15);
    s.until(() => !s.mission.trip || s.mission.trip.elapsed / s.mission.trip.seconds > 0.6);
    s.setRocketOptions({ detail: 'low', textureSize: 64 }); // a quality change mid-flight rebuilds the rocket as a lander
    s.until(() => s.modes.mode === 'docking');
    s.frames(30);
    s.send({ type: 'steer', x: 0.3, y: -0.2 });
    s.frames(20);
    s.send({ type: 'next' });
    s.send({ type: 'prev' });
    s.send({ type: 'zoom', factor: 1.2 });
    s.frames(60);
    s.send({ type: 'select' }); // let it land itself
    s.until(() => s.modes.mode === 'baseView');
    s.frames(20);
    vi.runAllTimers();
    expect({ events: s.events, trace: s.trace }).toMatchSnapshot();
    s.fixture.dispose();
  });

  it('with reduced motion: a countdown by hand, an abort, a skipped flight and an automatic landing', () => {
    const s = setup(true);
    s.state.autoLand = true;
    s.setFocus(s.at('mars'));
    s.send({ type: 'enterBase', baseId: 'jezero' });
    s.frames(10);
    s.send({ type: 'chooseDestination', baseId: 'tranquility' });
    s.send({ type: 'launch' });
    s.frames(5);
    s.send({ type: 'dismiss' }); // abort
    s.frames(5);
    s.send({ type: 'countdown', n: 3 });
    s.frames(5);
    s.send({ type: 'countdown', n: 2 });
    s.frames(5);
    s.send({ type: 'countdown', n: 1 });
    s.until(() => s.modes.mode === 'travel');
    s.frames(10);
    s.send({ type: 'select' }); // skip ahead
    s.until(() => s.modes.mode === 'docking');
    s.until(() => s.modes.mode === 'baseView');
    s.frames(10);
    s.send({ type: 'dismiss' }); // up to orbit: the rocket is freed
    s.frames(5);
    vi.runAllTimers();
    expect({ events: s.events, trace: s.trace }).toMatchSnapshot();
    s.fixture.dispose();
  });
});
