import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Item 3: text and focus contrast of the launch preview tokens (src/ui/spaceportView.css, the #spaceport-view block),
 * composited over representative frames of the scene behind the glass: daylight sky, grass, the ignition flame, and
 * white (the worst case for a dark translucent panel). WCAG AA: 4.5:1 for text (the help and hint text is 12–14 px,
 * so no large-text allowance), 3:1 for focus indicators and the cyan/amber state outlines against what touches them.
 */
const css = readFileSync(new URL('../src/ui/spaceportView.css', import.meta.url), 'utf8');
const block = css.slice(css.indexOf('#spaceport-view {'), css.indexOf('}', css.indexOf('#spaceport-view {')));
const tokens = Object.fromEntries([...block.matchAll(/--sp-([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));

type RGBA = [number, number, number, number];
function color(name: string): RGBA {
  let value = tokens[name];
  if (!value) throw new Error(`no token --sp-${name}`);
  const ref = /^var\(--sp-([\w-]+)\)$/.exec(value);
  if (ref) return color(ref[1]);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
  throw new Error(`can't read --sp-${name}: ${value}`);
}
const hexColor = (hex: string): RGBA => [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16)).concat(1) as RGBA;
/** Layers painted bottom to top over an opaque backdrop. */
const over = (backdrop: RGBA, ...layers: RGBA[]): RGBA => layers.reduce<RGBA>((under, [r, g, b, a]) =>
  [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1], backdrop);
const luminance = ([r, g, b]: RGBA) => {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Representative scene colours behind the glass (sampled from the preview's daylight and ignition frames) + white. */
const FRAMES: Record<string, RGBA> = {
  'daylight sky': hexColor('#9fc7df'), 'grass': hexColor('#7aa05a'), 'ignition flame': hexColor('#ffd28a'),
  'pad concrete': hexColor('#e3e6e8'), 'white': hexColor('#ffffff'),
};
const cases = Object.entries(FRAMES);

describe('launch preview contrast over the scene (WCAG AA)', () => {
  it('reads every token it checks', () => {
    for (const t of ['panel', 'surface-solid', 'scrim', 'zone-bg', 'text', 'muted', 'body', 'play', 'on-play', 'hand', 'hand-tint', 'hand-text', 'ink', 'focus', 'halo', 'tint'])
      expect(() => color(t)).not.toThrow();
  });

  it.each(cases)('text on the glass panels ≥ 4.5 over %s', (_, frame) => {
    const panel = over(frame, color('panel'));
    for (const t of ['text', 'muted', 'body', 'play', 'hand-text']) expect(ratio(color(t), panel), t).toBeGreaterThanOrEqual(4.5);
    // The details panel (reading surface)
    expect(color('surface-solid')[3], 'the details panel is opaque').toBe(1);
    const strong = over(frame, color('surface-solid'));
    for (const t of ['text', 'body']) expect(ratio(color(t), strong), `details ${t}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases)('selected view and place text on their cyan tint ≥ 4.5 over %s', (_, frame) => {
    const view = over(frame, color('panel'), color('tint'), color('hand-tint'));
    expect(ratio(color('text'), view)).toBeGreaterThanOrEqual(4.5);
    const chip = over(frame, color('panel'), color('hand-tint'));
    expect(ratio(color('hand-text'), chip)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases)('side-zone labels ≥ 4.5 over %s', (_, frame) => {
    const zone = over(frame, color('zone-bg'));
    for (const t of ['text', 'muted']) expect(ratio(color(t), zone), t).toBeGreaterThanOrEqual(4.5);
  });

  it('labels on the solid amber and on the 👍 prompt ≥ 4.5', () => {
    expect(ratio(color('on-play'), color('play'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color('ink'), color('text'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color('ink'), color('hand'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases)('focus ring and state outlines ≥ 3 against what touches them, over %s', (_, frame) => {
    const halo = over(frame, color('halo'));
    expect(ratio(color('focus'), halo), 'focus ring vs its halo').toBeGreaterThanOrEqual(3);
    const panel = over(frame, color('panel'));
    expect(ratio(color('hand'), panel), 'cyan outline vs the glass').toBeGreaterThanOrEqual(3);
    expect(ratio(color('play'), panel), 'amber marker vs the glass').toBeGreaterThanOrEqual(3);
    // The focus ring around the amber ▶ sits beside amber: it must differ from it too.
    expect(ratio(color('focus'), color('play')) >= 1.1 || ratio(color('halo'), color('play')) >= 3).toBe(true);
  });
});
