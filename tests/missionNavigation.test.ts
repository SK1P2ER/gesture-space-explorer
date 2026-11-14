import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Build } from '../src/app/build';
import { createIntentHandler, type HandlerDeps } from '../src/app/intentHandler';
import { Mission, type MissionDeps } from '../src/app/mission';
import { modeForFocus, ModeMachine } from '../src/app/modes';
import { createState } from '../src/app/state';
import { config } from '../src/config';
import { BASES, surfacePoint } from '../src/data/bases';
import { BODIES } from '../src/data/bodies';
import { keyToIntent } from '../src/input/keyboard';
import { createIntentBus } from '../src/intents';
import {padFrame,type BaseNode} from '../src/scene/bases';
import { CameraRig } from '../src/scene/cameraRig';
import { DAY, SimClock, WEEK } from '../src/sim/clock';
import {parseCheckpoint} from '../src/app/checkpoint';

const at = (id: string) => BODIES.findIndex((body) => body.id === id);
const INVARIANT = /Mission invariant: baseView without an active base \(at the (intent|frame) boundary\); recovered to SolarView/;
const cleanup: (() => void)[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Real mission/intent/scene objects; planet fixtures omit rendering-only services. */
function setup(bodyId = 'mars', rate = WEEK, presentation: Partial<Pick<MissionDeps, 'presentLaunch' | 'reducedMotion'>> = {}) {
  const scene = new THREE.Scene();
  const bases: BaseNode[] = BASES.map((base) => {
    const body = BODIES[at(base.body)];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), new THREE.MeshBasicMaterial());
    mesh.scale.setScalar(body.radius);
    const tilt = new THREE.Group();
    tilt.add(mesh);
    scene.add(tilt);
    const group = new THREE.Group();
    group.position.set(...surfacePoint(base.lat, base.lon));
    mesh.add(group);
    return {
      base, group, pad: new THREE.Group(), lights: [], buildings: [],
      body: { body, mesh, tilt } as unknown as BaseNode['body'],
    };
  });
  const state = createState();
  const modes = new ModeMachine();
  const rig = new CameraRig(16 / 9);
  const clock = new SimClock(Date.UTC(2026, 9, 24), rate);
  const flash = vi.fn();
  const report = vi.fn();
  // Same focus boundary as main.ts; importing main itself would start the DOM/GPU app.
  const setFocus = (index: number) => {
    state.focus = index;
    modes.go(modeForFocus(index));
    rig.focus(BODIES[index].radius, BODIES[index].radius, index === 0);
    if (state.selected) state.selected = BODIES[index];
  };
  setFocus(at(bodyId));
  const mission = new Mission({
    state, modes, rig, clock, bases, scene, setFocus, flash, report,
    reducedMotion: () => true,
    goldenHour: () => null,
    rocketOptions: () => ({ quality: 'low', textureSize: 32 }),
    ...presentation,
  });
  const build = new Build({
    state, modes, enabled: false, flash,
    site: () => null, groundAt: () => null, sol: () => null,
  });
  const bus = createIntentBus();
  bus.on(createIntentHandler({
    state, modes, rig, clock, mission, build, setFocus,
    gestureHud: { flash } as unknown as HandlerDeps['gestureHud'],
    overlay: {} as HandlerDeps['overlay'],
    photo: {} as HandlerDeps['photo'],
  }));
  const press = (key: string) => {
    const intent = keyToIntent(key, config.keyboard);
    if (!intent) throw new Error(`Unmapped test key: ${key}`);
    bus.emit(intent);
  };
  cleanup.push(() => {
    // Release fixtures, including any rocket still present at the end of a test.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    const textures = new Set<THREE.Texture>();
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
  });
  return { scene, state, modes, rig, clock, mission, flash, report, press };
}

describe('authored Earth launch handoff', () => {
  function launch(options: Partial<Pick<MissionDeps, 'presentLaunch' | 'reducedMotion'>> = {}, body = 'earth') {
    const fixture = setup(body, WEEK, { reducedMotion: () => false, ...options });
    // Navigation fixtures normally overlap planets at the origin. Give real
    // flight-boundary cases distinct worlds before exercising the route solver.
    fixture.scene.children.filter(node => node instanceof THREE.Group).forEach((node, index) => { node.position.x = index * 100; });
    fixture.scene.updateMatrixWorld(true);
    fixture.press('v'); fixture.press('ArrowRight'); fixture.press('Enter');
    for (let i = 0; i < 3; i++) fixture.mission.update(1, fixture.rig.camera);
    return fixture;
  }

  it.each(['travel','docking'] as const)('resumes %s at the saved progress without replaying launch or stamping early',phase=>{
    const source=launch({},'moon');source.state.autoLand=true;
    if(phase==='docking'){source.mission.trip!.elapsed=source.mission.trip!.seconds;source.mission.update(0,source.rig.camera);}
    source.mission.update(.5,source.rig.camera);
    const saved=parseCheckpoint(JSON.stringify(source.mission.checkpoint()))!;
    expect(saved.phase).toBe(phase);
    const restored=setup('mars');restored.mission.resume(saved);
    expect(restored.modes.mode).toBe(phase);expect(restored.mission.countdown).toBeNull();
    if(phase==='travel')expect(restored.mission.trip?.elapsed).toBe(saved.trip?.elapsed);
    else {expect(restored.mission.dock?.state.alt).toBe(saved.dock?.state.alt);expect(restored.state.passport.cape).toBeUndefined();}
    expect(restored.mission.checkpoint()?.lang).toBe(saved.lang);
  });

  it('returns camera up to the world frame when leaving the local Japan orbit',()=>{
    const {mission,rig,press}=setup('earth');press('v');mission.update(0,rig.camera);
    expect(rig.camera.up.distanceTo(new THREE.Vector3(0,1,0))).toBeGreaterThan(.1);
    mission.leave();expect(rig.camera.up.toArray()).toEqual([0,1,0]);
  });
  it('resets the Japan map without launching or changing the mission',()=>{
    const {mission,modes,press,rig}=setup('earth');press('v');
    mission.handle({type:'rotate',dx:1,dy:.1});mission.resetJapanView();
    mission.japanMapCamera(rig.camera);
    expect(rig.zoomDistance).toBeCloseTo(rig.camera.position.distanceTo(padFrame(mission.base!).center));
    expect(rig.zoomDistance).toBeLessThan(10);expect(rig.flying).toBe(false);
    expect(modes.mode).toBe('baseView');expect(mission.trip).toBeNull();expect(mission.countdown).toBeNull();
  });

  it('holds one launch, then starts the selected flight exactly once after completion', () => {
    let complete!: () => void, cancel!: () => void;
    const close = vi.fn();
    const presentLaunch = vi.fn((_destination, done, abort) => { complete = done; cancel = abort; return close; });
    const { mission, modes, rig } = launch({ presentLaunch });
    const destination = mission.destination;
    expect(modes.mode).toBe('launch'); expect(mission.presentingLaunch).toBe(true);
    expect(mission.trip).toBeNull(); expect(mission.countdown).toBeNull();
    mission.update(10, rig.camera);
    expect(presentLaunch).toHaveBeenCalledTimes(1);
    expect(presentLaunch.mock.calls[0][0]).toBe(destination);
    complete();
    expect(modes.mode).toBe('travel'); expect(mission.presentingLaunch).toBe(false);
    expect(mission.trip?.to).toBe(destination); expect(mission.trip?.elapsed).toBe(1.2);
    const trip = mission.trip;
    complete(); cancel();
    expect(mission.trip).toBe(trip); expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancels without spending the destination or allowing a stale completion to depart', () => {
    let complete!: () => void, cancel!: () => void;
    const close = vi.fn();
    const { mission, modes, clock, press } = launch({ presentLaunch: (_to, done, abort) => { complete = done; cancel = abort; return close; } });
    const base = mission.base, destination = mission.destination;
    cancel(); complete();
    expect(modes.mode).toBe('baseView'); expect(mission.base).toBe(base);
    expect(mission.destination).toBe(destination); expect(mission.trip).toBeNull();
    expect(mission.presentingLaunch).toBe(false); expect(clock.rate).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    press('Escape'); expect(clock.rate).toBe(WEEK);
  });

  it('an aborted presentation cannot complete a later launch', () => {
    const completions: (() => void)[] = [];
    const close = vi.fn();
    const { mission, modes, rig, press } = launch({ presentLaunch: (_to, done) => { completions.push(done); return close; } });
    press('Escape'); press('Enter');
    for (let i = 0; i < 3; i++) mission.update(1, rig.camera);
    completions[0](); expect(modes.mode).toBe('launch'); expect(mission.trip).toBeNull();
    completions[1](); expect(modes.mode).toBe('travel'); expect(close).toHaveBeenCalledTimes(2);
  });

  it('falls through to flight if the presenter throws', () => {
    const { mission, modes, report } = launch({ presentLaunch: () => { throw new Error('Renderer unavailable'); } });
    expect(modes.mode).toBe('travel'); expect(mission.trip?.to).toBe(mission.destination);
    expect(mission.presentingLaunch).toBe(false); expect(report).toHaveBeenCalledTimes(1);
  });

  it('releases a presentation when another base replaces its owner', () => {
    let complete!: () => void;
    const close = vi.fn();
    const { mission, modes } = launch({ presentLaunch: (_to, done) => { complete = done; return close; } });
    mission.enter('jezero'); complete();
    expect(modes.mode).toBe('baseView'); expect(mission.base?.base.id).toBe('jezero');
    expect(mission.trip).toBeNull(); expect(mission.presentingLaunch).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['reduced motion', 'another world'])('keeps the direct flight for %s', reason => {
    const presentLaunch = vi.fn(() => vi.fn());
    const { mission, modes } = launch({ presentLaunch, reducedMotion: () => reason === 'reduced motion' }, reason === 'another world' ? 'mars' : 'earth');
    expect(presentLaunch).not.toHaveBeenCalled(); expect(modes.mode).toBe('travel');
    expect(mission.presentingLaunch).toBe(false);
  });

  it.each([false,true])('Japan arrival enters normal docking directly (auto-land: %s)',autoLand=>{
    const {mission,modes,rig,state} = launch({},'moon');
    state.autoLand = autoLand;
    mission.trip!.elapsed = mission.trip!.seconds; mission.update(0,rig.camera);
    expect(modes.mode).toBe('docking'); expect(mission.base?.base.id).toBe('cape');
    expect(mission.trip).toBeNull(); expect(state.passport.cape).toBeUndefined();
    const attempt = mission.dock!;
    for(let i=0;i<20;i++) mission.update(.05,rig.camera);
    expect(mission.dock).toBe(attempt); expect(attempt.state.alt).toBeLessThan(attempt.startAlt);
    if(!autoLand) mission.handle({type:'select'});
    let view;for(let i=0;i<240&&modes.mode==='docking';i++) view=mission.update(.05,rig.camera);
    expect(modes.mode).toBe('baseView'); expect(mission.dock).toBeNull();
    expect(view).toBe('chase'); // no one-frame world-up camera flash at Japan touchdown
    expect(state.passport.cape).toBeDefined();
  });
});

describe('moon navigation through keyboard intents, Mission and general handling', () => {
  it.each(['m', 'M'])('%s at Jezero preserves the base, destination, progress and scene resources', (key) => {
    const { scene, state, modes, rig, clock, mission, flash, press } = setup('mars', -DAY);
    press('v');
    press('ArrowRight');
    mission.update(0, rig.camera);
    const base = mission.base;
    const destination = mission.destination;
    const passport = state.passport;
    const roots = [...scene.children];
    const rocket = mission.rocket;
    const removeRocket = vi.spyOn(rocket, 'removeFromParent');
    const disposeBaseGeometry = vi.spyOn(base!.body.mesh.geometry, 'dispose');
    const disposeRocketGeometry = vi.spyOn((rocket.getObjectByName('rocket:booster') as THREE.Mesh).geometry, 'dispose');
    const time = clock.time;

    press(key);

    expect(modes.mode).toBe('baseView');
    expect(mission.base).toBe(base);
    expect(mission.base?.base.id).toBe('jezero');
    expect(mission.destination).toBe(destination);
    expect(state.focus).toBe(at('mars'));
    expect(state.passport).toBe(passport);
    expect(clock.rate).toBe(1);
    expect(clock.time).toBe(time);
    expect(clock.paused).toBe(false);
    expect(flash).toHaveBeenLastCalledWith('Mars: no moons to visit');
    expect(() => mission.update(0, rig.camera)).not.toThrow();
    expect(mission.rocket).toBe(rocket);
    expect(scene.children).toEqual(roots);
    expect(removeRocket).not.toHaveBeenCalled();
    expect(disposeBaseGeometry).not.toHaveBeenCalled();
    expect(disposeRocketGeometry).not.toHaveBeenCalled();
    expect(mission.readout()?.base).toBe('Jezero Dome');
  });

  it('can choose a destination, start a launch and abort after rejected moon navigation', () => {
    const { modes, clock, mission, press } = setup();
    press('v');
    const base = mission.base;
    press('m');
    press('ArrowRight');
    expect(mission.destination?.base.id).toBe('cape');
    press('Enter');
    expect(modes.mode).toBe('launch');
    expect(mission.countdown).toMatchObject({ count: 3, auto: true });
    press('Escape');
    expect(modes.mode).toBe('baseView');
    expect(mission.base).toBe(base);
    expect(mission.countdown).toBeNull();
    expect(clock.rate).toBe(1);
  });

  it('Escape leaves Jezero and restores the clock; planet switching and V still work afterward', () => {
    const { state, modes, clock, mission, press } = setup();
    press('v');
    const base = mission.base;
    const passport = state.passport;
    const setRate = vi.spyOn(clock, 'setRate');
    press('m');
    expect(setRate).not.toHaveBeenCalled();
    press('Escape');
    expect(modes.mode).toBe('focus');
    expect(mission.base).toBeNull();
    expect(mission.destination).toBeNull();
    expect(state.focus).toBe(at('mars'));
    expect(clock.rate).toBe(WEEK);
    expect(setRate).toHaveBeenCalledExactlyOnceWith(WEEK);
    press('ArrowRight');
    expect(state.focus).toBe(at('jupiter'));
    press('ArrowLeft');
    press('v');
    expect(modes.mode).toBe('baseView');
    expect(mission.base).toBe(base);
    expect(state.passport).toBe(passport);
    expect(clock.rate).toBe(1);
  });

  it('rejected moon navigation preserves horizon and camera clipping until Escape exits', () => {
    const { modes, rig, clock, mission, press } = setup();
    press('v');
    const clips = { near: rig.camera.near, far: rig.camera.far };
    press('o');
    const horizon = mission.horizon;
    expect(horizon).not.toBeNull();
    press('m');
    expect(mission.horizon).toBe(horizon);
    expect(rig.camera.near).toBe(0.002);
    press('Escape');
    expect(mission.horizon).toBeNull();
    expect(modes.mode).toBe('baseView');
    expect(mission.base?.base.id).toBe('jezero');
    expect(rig.camera.near).toBe(clips.near);
    expect(rig.camera.far).toBe(clips.far);
    expect(clock.rate).toBe(1);
    press('Escape');
    expect(modes.mode).toBe('focus');
    expect(clock.rate).toBe(WEEK);
  });

  it.each([
    ['earth', 'moon'], ['moon', 'earth'], ['europa', 'ganymede'], ['titan', 'saturn'],
  ])('valid M from the %s base focuses %s and performs established cleanup', (from, to) => {
    const { scene, state, modes, rig, clock, mission, flash, press } = setup(from);
    press('v');
    press('ArrowRight');
    mission.update(0, rig.camera);
    const rocket = mission.rocket;
    const setRate = vi.spyOn(clock, 'setRate');
    press('m');
    expect(modes.mode).toBe('focus');
    expect(state.focus).toBe(at(to));
    expect(mission.base).toBeNull();
    expect(mission.destination).toBeNull();
    expect(mission.countdown).toBeNull();
    expect(mission.horizon).toBeNull();
    expect(clock.rate).toBe(WEEK);
    expect(setRate).toHaveBeenCalledExactlyOnceWith(WEEK);
    expect(flash).not.toHaveBeenCalled();
    // Mission releases its render kit on the first frame outside base/flight modes.
    mission.update(0, rig.camera);
    expect(rocket.parent).toBeNull();
    expect(scene.children).not.toContain(rocket);
    expect(mission.rocketStats()).toBeNull();
  });

  it('hands BaseView camera placement to one temporary owner and falls back when it releases', () => {
    const { mission, rig, press } = setup();
    press('v');
    const owner = vi.fn(() => true); mission.baseCamera = owner;
    expect(mission.update(0.01, rig.camera)).toBe('chase');
    expect(owner).toHaveBeenCalledTimes(1);
    owner.mockReturnValue(false);
    expect(mission.update(0.01, rig.camera)).toHaveProperty('target');
  });

  it('never calls the temporary base camera from launch or travel', () => {
    const { mission, rig, press } = setup('earth');
    press('v');
    const owner = vi.fn(() => true); mission.baseCamera = owner;
    press('ArrowRight'); press('Enter');
    mission.update(0.01, rig.camera);
    expect(owner).not.toHaveBeenCalled();
  });

  it('continues to ignore M during a launch, preserving the countdown and base', () => {
    const { modes, clock, mission, press } = setup('earth');
    press('v');
    press('ArrowRight');
    press('Enter');
    const base = mission.base;
    const countdown = mission.countdown;
    press('m');
    expect(modes.mode).toBe('launch');
    expect(mission.base).toBe(base);
    expect(mission.countdown).toBe(countdown);
    expect(clock.rate).toBe(1);
  });

  it.each(['intent', 'frame'] as const)('recovers once from a baseView without a base at the %s boundary, without throwing', (boundary) => {
    const { state, modes, rig, clock, mission, report, press } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    press('v');
    expect(clock.rate).toBe(1); // a base runs the clock at real speed; leaving gives the old speed back
    mission.base = null; // deliberately inject the corrupt state from the original defect
    const passport = state.passport;
    const act = () => boundary === 'intent' ? press('m') : mission.update(0.016, rig.camera);
    expect(act).not.toThrow();
    expect(modes.mode).toBe('solarView');
    expect(state.focus).toBe(0);
    expect(clock.rate).toBe(WEEK);
    expect(state.passport).toBe(passport); // progress is kept
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatch(INVARIANT);
    expect(report.mock.calls[0][0]).toContain(`at the ${boundary} boundary`);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(INVARIANT);
    // The app carries on: later frames and keys work, and nothing is reported again.
    for (let i = 0; i < 120; i++) expect(mission.update(0.016, rig.camera)).not.toBe('chase');
    press('ArrowRight');
    expect(modes.mode).toBe('focus');
    expect(report).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('recovers out of the horizon view too, restoring the camera clipping', () => {
    const { modes, rig, mission, report, press } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    press('v');
    const { near, far } = rig.camera;
    mission.toggleHorizon();
    expect(mission.horizon).not.toBeNull();
    mission.base = null;
    expect(() => mission.update(0.016, rig.camera)).not.toThrow();
    expect(mission.horizon).toBeNull();
    expect([rig.camera.near, rig.camera.far]).toEqual([near, far]);
    expect(modes.mode).toBe('solarView');
    expect(report).toHaveBeenCalledTimes(1);
  });
});
