import { parseWeight } from '../data/weight';
import { BASES } from '../data/bases';
import { parseSensitivity, type SteerSensitivity } from '../gestures/steer';
import { parsePassport, type Passport } from '../sim/passport';
import { safeLocalStorage } from '../quality';
import type {Lang} from '../data/bodies';

// What the app remembers on this device (localStorage). Every access is guarded:
// storage can be blocked (private mode, sandboxed iframes), and then choices
// still apply for the visit, just aren't kept.

export const storage = safeLocalStorage();
export function readLanguage():Lang {try{const lang=storage?.getItem('gse.lang');return lang==='my'||lang==='ja'?lang:'en';}catch{return 'en';}}
export function writeLanguage(lang:Lang){try{storage?.setItem('gse.lang',lang);}catch{/* Optional storage. */}}

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
