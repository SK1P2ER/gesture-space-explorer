import { afterEach, expect, it, vi } from 'vitest';
import type { SkyReport } from '../src/app/baseSky';
import { baseById } from '../src/data/bases';
import { BasePanel } from '../src/ui/basePanel';

class El {
  children: El[] = [];
  textContent = '';
  className = '';
  hidden = false;
  disabled = false;
  type = '';
  private attrs = new Map<string, string>();
  constructor(public tagName: string) {}
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  addEventListener() {}
  append(...nodes: El[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: El[]) { this.children = nodes; }
  get text(): string { return this.textContent + this.children.map((c) => c.text).join(''); }
}

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const root = new El('aside');
  vi.stubGlobal('document', { querySelector: () => root, createElement: (tag: string) => new El(tag) });
  return { root, panel: new BasePanel(() => {}) };
}

const sky = (hours: number) => ({
  local: { objects: [] }, day: { hours, sunrise: 6, sunset: 18 }, up: [],
}) as unknown as SkyReport;
const find = (root: El, cls: string) => root.children.find((c) => c.className.split(' ').includes(cls))!;
const facts = (root: El) => root.children.find((c) => c.tagName === 'dl')!;

it('updates the clock and the chosen destination in place, keeping the controls', () => {
  const { root, panel } = fixture();
  const jezero = baseById('jezero');
  panel.render(jezero, 'en', null, sky(10));
  const children = [...root.children];
  const launch = find(root, 'launch');
  const [first] = find(root, 'destinations').children;
  expect(launch.disabled).toBe(true);
  expect(facts(root).text).toContain('10:00');

  panel.render(jezero, 'en', 'tranquility', sky(10 + 1 / 60));
  expect(root.children).toEqual(children); // the same nodes: focus and an in-progress tap survive
  expect(find(root, 'launch')).toBe(launch);
  expect(launch.disabled).toBe(false);
  expect(facts(root).text).toContain('10:01');
  const pressed = find(root, 'destinations').children.filter((b) => b.getAttribute('aria-pressed') === 'true');
  expect(pressed.map((b) => b.textContent)).toEqual([baseById('tranquility').name.en]);
  expect(find(root, 'destinations').children[0]).toBe(first);
});

it('keeps the ticking clock out of the panel\'s live announcements', () => {
  const { root, panel } = fixture();
  panel.render(baseById('jezero'), 'en', null, sky(10));
  expect(facts(root).getAttribute('aria-live')).toBe('off');
});

it('rebuilds for another language or base, and hides with no base', () => {
  const { root, panel } = fixture();
  panel.render(baseById('jezero'), 'en', 'cape', sky(10));
  const launch = find(root, 'launch');
  panel.render(baseById('jezero'), 'ja', 'cape', sky(10));
  expect(find(root, 'launch')).not.toBe(launch);
  expect(find(root, 'launch').disabled).toBe(false); // destination state reapplied after a rebuild
  panel.render(null, 'ja', null);
  expect(root.hidden).toBe(true);
  panel.render(baseById('cape'), 'ja', null, null);
  expect(root.hidden).toBe(false);
  expect(find(root, 'launch').disabled).toBe(true);
});
