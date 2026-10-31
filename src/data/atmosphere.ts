// What a world's air does to a rocket (v2.2): the flame's colour and spread, and
// the dust its engines kick up from the pad. Stylized but grounded: in vacuum the
// exhaust spreads wide and burns blue-white; in thick air it stays narrow and orange.

export type Atmosphere = 'none' | 'thin' | 'thick';

const AIR: Record<string, Atmosphere> = { earth: 'thick', venus: 'thick', titan: 'thick', mars: 'thin' };

/** The air at a world's surface (anything not listed: none). */
export const atmosphereOf = (bodyId: string): Atmosphere => AIR[bodyId] ?? 'none';

/**
 * Pad dust when a rocket lifts off or lands: how much (0–1) and its colour. None on the
 * Moon, as asked (its regolith flies off ballistically, without the billowing cloud);
 * a little icy frost on Europa; rust on Mars, brownish haze on Titan, steam and smoke on Earth.
 */
const DUST: Record<string, { amount: number; color: number }> = {
  moon: { amount: 0, color: 0x9a9a9a },
  europa: { amount: 0.3, color: 0xe8f0f8 },
  mars: { amount: 1, color: 0xc0704a },
  titan: { amount: 0.8, color: 0xa07848 },
  earth: { amount: 0.6, color: 0xd8d8d8 },
};

export const dustFor = (bodyId: string): { amount: number; color: number } => DUST[bodyId] ?? { amount: 0, color: 0xaaaaaa };

/** The flame for each kind of air: core and edge colours (linear RGB) and how far the plume spreads (× nozzle). */
export const FLAME: Record<Atmosphere, { core: [number, number, number]; edge: [number, number, number]; spread: number }> = {
  none: { core: [0.85, 0.92, 1.0], edge: [0.35, 0.55, 1.0], spread: 2.2 },
  thin: { core: [1.0, 0.92, 0.8], edge: [1.0, 0.6, 0.35], spread: 1.5 },
  thick: { core: [1.0, 0.95, 0.75], edge: [1.0, 0.45, 0.12], spread: 1.1 },
};
