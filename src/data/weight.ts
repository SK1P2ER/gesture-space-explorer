import { BODIES } from './bodies';

const EARTH_GRAVITY = BODIES.find((b) => b.id === 'earth')!.gravity;

/** The weights the panel accepts, in kg. */
export const MIN_KG = 1;
export const MAX_KG = 500;

/**
 * What a bathroom scale would read, in kg, on a world with this surface gravity,
 * for someone whose scale reads `kg` on Earth.
 */
export const weightOn = (kg: number, gravity: number) => (kg * gravity) / EARTH_GRAVITY;

/** How many times Earth's gravity. */
export const gravityRatio = (gravity: number) => gravity / EARTH_GRAVITY;

/**
 * A typed weight in kg, or null if it isn't one. Accepts a decimal point or comma,
 * and full-width (Japanese IME) or Myanmar digits.
 */
export function parseWeight(text: string): number | null {
  const ascii = text
    .normalize('NFKC') // full-width digits and punctuation → ASCII
    .replace(/[၀-၉]/g, (d) => String(d.charCodeAt(0) - 0x1040))
    .trim()
    .replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(ascii)) return null;
  const kg = Number(ascii);
  return kg >= MIN_KG && kg <= MAX_KG ? kg : null;
}
