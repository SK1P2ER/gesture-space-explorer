import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionOverlay, type OverlayView } from '../src/ui/missionOverlay';
import type { Intent } from '../src/intents';

vi.mock('../src/ui/basePanel', () => ({ skyFacts: () => [] }));

let activeElement: Element | null = null;

class Element {
  private text = '';
  textWrites = 0;
  className = '';
  type = '';
  hidden = false;
  open = false;
  dataset: Record<string, string> = {};
  children: Element[] = [];
  style = { width: '' };
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  replacements = 0;
  readonly tagName: string;
  constructor(tagName = 'div') { this.tagName = tagName.toUpperCase(); }
  get textContent() { return this.text; }
  set textContent(value: string) { this.textWrites++; this.text = value; }
  readonly classList = {
    toggle: (name: string, on: boolean) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
    },
  };
  get firstChild() { return this.children[0]; }
  append(...elements: Element[]) { this.children.push(...elements); }
  replaceChildren(...elements: Element[]) {
    if (activeElement && activeElement !== this && this.contains(activeElement)
      && !elements.some((element) => element.contains(activeElement!))) activeElement = null;
    this.replacements++;
    this.children = elements;
  }
  focus() { activeElement = this; }
  contains(element: Element): boolean { return this === element || this.children.some((child) => child.contains(element)); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  find(name: string): Element | undefined {
    if (this.className.split(' ').includes(name)) return this;
    return this.children.map((child) => child.find(name)).find(Boolean);
  }
  findAll(name: string): Element[] {
    return [
      ...(this.className.split(' ').includes(name) ? [this] : []),
      ...this.children.flatMap((child) => child.findAll(name)),
    ];
  }
}

let root: Element;
let emit: ReturnType<typeof vi.fn<(intent: Intent) => void>>;
let overlay: MissionOverlay;
const view = (extra: Partial<OverlayView> = {}): OverlayView => ({
  count: null, byHand: false, flyingTo: null, horizon: null,
  docking: { altitude: 1, auto: false, sensitivity: 'normal' }, ...extra,
});

beforeEach(() => {
  activeElement = null;
  root = new Element(); emit = vi.fn();
  vi.stubGlobal('document', {
    querySelector: () => root,
    createElement: (tagName: string) => new Element(tagName),
    get activeElement() { return activeElement; },
  });
  overlay = new MissionOverlay(emit);
});
afterEach(() => vi.unstubAllGlobals());

describe('mission landing deck', () => {
  it('keeps the landing heading and controls in one deck without a separate status card', () => {
    overlay.render(view(), 'en');
    const deck = root.find('mission-actions')!;
    expect(root.findAll('mission-actions')).toHaveLength(1);
    expect(root.find('mission-status')).toBeUndefined();
    expect(deck.find('mission-title')?.textContent).toBe('Landing approach');
    expect(deck.find('auto-land')?.tagName).toBe('BUTTON');
    expect(deck.find('steering')?.tagName).toBe('BUTTON');
  });

  it.each([
    ['en', 'Help'],
    ['my', 'အကူအညီ'],
    ['ja', 'ヘルプ'],
  ] as const)('keeps secondary landing information in closed native help in %s', (lang, summaryText) => {
    overlay.render(view({ docking: {
      altitude: 0.8, auto: false, sensitivity: 'normal',
      telemetry: { descent: 0.1, offset: 0.2, alignment: 'aligned' },
    } }), lang);
    const deck = root.find('mission-actions')!, help = deck.find('landing-help')!;
    expect(help?.tagName).toBe('DETAILS');
    expect(help.open).toBe(false);
    expect(help.children.find((child) => child.tagName === 'SUMMARY')?.textContent).toBe(summaryText);
    expect(help.find('landing-telemetry')?.textContent).toBeTruthy();
    expect(help.find('hint')?.textContent).toBeTruthy();
    expect(deck.find('landing-alignment')?.attributes.get('role')).toBe('status');
    for (const alwaysAvailable of ['landing-alignment', 'altitude', 'auto-land', 'steering']) {
      expect(deck.find(alwaysAvailable), alwaysAvailable).toBeDefined();
      expect(help.find(alwaysAvailable), alwaysAvailable).toBeUndefined();
    }
  });

  it('keeps controls and their focus target intact as altitude and landing settings change', () => {
    overlay.render(view(), 'en');
    const auto = root.find('auto-land')!, steering = root.find('steering')!, meter = root.find('altitude')!;
    const replacements = root.replacements;
    for (let step = 0; step <= 50; step++) {
      overlay.render(view({ docking: { altitude: 1 - step / 50, auto: step > 20, sensitivity: step > 30 ? 'high' : 'normal' } }), 'en');
    }
    expect(root.replacements).toBe(replacements);
    expect(root.find('auto-land')).toBe(auto);
    expect(root.find('steering')).toBe(steering);
    expect(meter.attributes.get('aria-valuenow')).toBe('0');
    expect(meter.firstChild.style.width).toBe('0%');
    expect(auto.attributes.get('aria-pressed')).toBe('true');
    auto.listeners.get('click')!(); steering.listeners.get('click')!();
    expect(emit.mock.calls.map(([intent]) => intent.type)).toEqual(['toggleAutoLand', 'cycleSteerSensitivity']);
  });

  it('preserves expanded help and keyboard focus while docking readings and settings update', () => {
    overlay.render(view(), 'en');
    const help = root.find('landing-help')!;
    expect(help?.tagName).toBe('DETAILS');
    help.open = true;
    const auto = root.find('auto-land')!, steering = root.find('steering')!, meter = root.find('altitude')!;
    const replacements = root.replacements;
    for (let step = 0; step <= 50; step++) {
      const target = step % 2 ? auto : steering;
      target.focus();
      overlay.render(view({ docking: {
        altitude: 1 - step / 50, auto: step > 20, sensitivity: step > 30 ? 'high' : 'normal',
        telemetry: { descent: 0.1, offset: 0.2 + step / 200, alignment: 'aligned' },
      } }), 'en');
      expect(document.activeElement).toBe(target);
      expect(root.find('landing-help')).toBe(help);
      expect(help.open).toBe(true);
      expect(root.find('auto-land')).toBe(auto);
      expect(root.find('steering')).toBe(steering);
      expect(root.find('altitude')).toBe(meter);
    }
    expect(root.replacements).toBe(replacements);
    expect(auto.attributes.get('aria-pressed')).toBe('true');
    expect(meter.attributes.get('aria-valuenow')).toBe('0');
    auto.listeners.get('click')!(); steering.listeners.get('click')!();
    expect(emit.mock.calls.map(([intent]) => intent.type)).toEqual(['toggleAutoLand', 'cycleSteerSensitivity']);
  });

  it('announces discrete alignment changes without making changing telemetry a live region', () => {
    const docking = { altitude: 0.8, auto: false, sensitivity: 'normal' as const,
      telemetry: { descent: 0.1, offset: 0.2, alignment: 'aligned' as const } };
    overlay.render(view({ docking }), 'en');
    expect(root.attributes.get('aria-live')).toBe('off');
    const alignment = root.find('landing-alignment')!, telemetry = root.find('landing-telemetry')!;
    expect(alignment.attributes.get('role')).toBe('status');
    expect(telemetry.attributes.get('role')).not.toBe('status');
    expect(telemetry.attributes.get('aria-live')).not.toBe('polite');
    const originalMessage = alignment.textContent, originalWrites = alignment.textWrites;
    for (let step = 0; step < 20; step++) {
      overlay.render(view({ docking: { ...docking, altitude: 0.8 - step / 100,
        telemetry: { ...docking.telemetry, offset: 0.2 + step / 100 } } }), 'en');
    }
    expect(root.find('landing-alignment')).toBe(alignment);
    expect(alignment.textContent).toBe(originalMessage);
    expect(alignment.textWrites).toBe(originalWrites);
    overlay.render(view({ docking: { ...docking,
      telemetry: { ...docking.telemetry, offset: 0.9, alignment: 'correct' } } }), 'en');
    expect(alignment.textContent).toBe('↔ Correct your position');
    expect(alignment.textWrites).toBe(originalWrites + 1);
    overlay.render(view({ docking: null, count: 3 }), 'en');
    expect(root.attributes.get('aria-live')).toBe('assertive');
  });

  it('clears horizon and landing layout classes when the mission phase changes', () => {
    overlay.render(view({ docking: null, horizon: {} as NonNullable<OverlayView['horizon']> }), 'en');
    expect(root.className).toContain('horizon');
    overlay.render(view({ count: 3, docking: null }), 'en');
    expect(root.className).not.toContain('horizon');
    expect(root.className).toContain('is-countdown');
    overlay.render(view(), 'my');
    expect(root.className).toBe('is-landing');
    expect(root.find('mission-title')!.textContent).toBe('ဆင်းသက်နေပါပြီ');
    overlay.render(view({ docking: null, flyingTo: 'Jezero' }), 'ja');
    expect(root.className).toBe('is-flight');
    expect(root.find('flying')!.textContent).toContain('Jezero');
    expect(root.find('mission-eyebrow')).toBeFalsy(); // one compact line: the rocket flies just below it
    overlay.render(view({ docking: null }), 'en');
    expect(root.hidden).toBe(true);
    expect(root.className).toBe('');
  });
});
