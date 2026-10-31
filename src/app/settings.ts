import { parseWeight } from '../data/weight';
import { BASES } from '../data/bases';
import { parseSensitivity, type SteerSensitivity } from '../gestures/steer';
import { parsePassport, type Passport } from '../sim/passport';
import { safeLocalStorage } from '../quality';

// What the app remembers on this device (localStorage). Every access is guarded:
// storage can be blocked (private mode, sandboxed iframes), and then choices
// still apply for the visit, just aren't kept.

export const storage = safeLocalStorage();

/** Every key the app saves starts with this (settings, quality, Auto's memory, passport, Build layouts). */
const PREFIX = 'gse.';

/**
 * ?reset, for user tests: forget everything this app saved on this device, so the next tester
 * starts as a first-time visitor. Only the app's own keys go; nothing is sent anywhere, and nothing
 * is shown (a first visit has no message). Returns the address's search without `reset` (so a
 * reload keeps the tester's progress), or null when the address doesn't ask.
 */
export function resetIfAsked(search: string, store: Pick<Storage, 'length' | 'key' | 'removeItem'> | null): string | null {
  if (!new URLSearchParams(search).has('reset')) return null;
  try {
    const saved = Array.from({ length: store?.length ?? 0 }, (_, i) => store!.key(i)).filter((k): k is string => !!k?.startsWith(PREFIX));
    for (const key of saved) store!.removeItem(key);
  } catch {
    // storage blocked: nothing was kept to forget
  }
  // Other parameters stay exactly as typed (?reset&base=jezero opens Jezero, fresh).
  const rest = search.replace(/^\?/, '').split('&').filter((p) => p && decodeURIComponent(p.split('=')[0].replace(/\+/g, ' ')) !== 'reset');
  return rest.length ? `?${rest.join('&')}` : '';
}

export const KEYS = {
  watermark: 'gse.watermark',
  trueScale: 'gse.trueScale',
  autoLand: 'gse.autoLand',
  passport: 'gse.passport',
  steerSensitivity: 'gse.steerSensitivity',
  help: 'gse.help',
  previewHidden: 'gse.previewHidden',
  buildHint: 'gse.buildHintSeen',
  weight: 'gse.weightKg', // stays in this browser
};

export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = storage?.getItem(key);
    return v === null || v === undefined ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean) {
  try {
    storage?.setItem(key, value ? '1' : '0');
  } catch {
    // not persisted; still applies for this visit
  }
}

export function readWeight(): number | null {
  try {
    return parseWeight(storage?.getItem(KEYS.weight) ?? '');
  } catch {
    return null;
  }
}

export function writeWeight(kg: number | null) {
  try {
    if (kg === null) storage?.removeItem(KEYS.weight);
    else storage?.setItem(KEYS.weight, String(kg));
  } catch {
    // not persisted; still applies for this visit
  }
}

export function readPassport(): Passport {
  try {
    return parsePassport(storage?.getItem(KEYS.passport), BASES.map((b) => b.id));
  } catch {
    return {};
  }
}

export function writePassport(p: Passport) {
  try {
    storage?.setItem(KEYS.passport, JSON.stringify(p));
  } catch {
    // not persisted; the stamps still show for this visit
  }
}

export function readSensitivity(): SteerSensitivity {
  try {
    return parseSensitivity(storage?.getItem(KEYS.steerSensitivity));
  } catch {
    return 'normal';
  }
}

export function writeSensitivity(v: SteerSensitivity) {
  try {
    storage?.setItem(KEYS.steerSensitivity, v);
  } catch {
    // not persisted; still applies for this visit
  }
}
