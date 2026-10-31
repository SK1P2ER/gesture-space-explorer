import type { Lang } from '../data/bodies';

// Deep links (v2.4): what a URL opens, and the URL for what's on screen. Pure, so both directions
// are tested without a browser; main.ts applies a link on the first frame and keeps the address
// bar following navigation (history.replaceState, so Back isn't filled with views).
//
//   ?body=saturn                    a body (the Sun, the overview, is the default)
//   ?base=jezero                    a base, and so its body
//   ?base=jezero&view=horizon       standing at a showcase base
//   &date=2061-07-28                a day (UTC midnight), or a full ISO time: 2024-04-08T18:18Z;
//                                   the app opens paused there
//   &lang=ja                        en, my or ja
//
// Anything unknown or invalid is ignored, never an error. Other parameters (?flags=, ?debug) are
// left as they are.

export interface DeepLink {
  body?: string;
  base?: string;
  view?: 'horizon';
  /** The moment to open at (ms), paused. */
  time?: number;
  lang?: Lang;
}

/** What exists, so a link can only name real things. */
export interface LinkCatalog {
  bodies: readonly string[];
  bases: readonly { id: string; body: string }[];
  /** Bases with a horizon view (the showcases). */
  horizon: readonly string[];
  /** The times the clock can show (ms). */
  range: readonly [number, number];
}

/** What's on screen, as far as a link describes it. */
export interface LinkView {
  body: string;
  base: string | null;
  horizon: boolean;
  lang: Lang;
}

const LANGS: readonly Lang[] = ['en', 'my', 'ja'];
const LINK_KEYS = ['body', 'base', 'view', 'lang'];

export function parseDeepLink(search: string, catalog: LinkCatalog): DeepLink {
  const q = new URLSearchParams(search);
  const link: DeepLink = {};
  const base = catalog.bases.find((b) => b.id === q.get('base')?.toLowerCase());
  if (base) {
    link.base = base.id;
    link.body = base.body; // a base names its body; a different ?body= alongside it is ignored
    if (q.get('view') === 'horizon' && catalog.horizon.includes(base.id)) link.view = 'horizon';
  } else {
    const body = q.get('body')?.toLowerCase();
    if (body && catalog.bodies.includes(body)) link.body = body;
  }
  const time = parseDate(q.get('date'));
  if (time !== null && time >= catalog.range[0] && time <= catalog.range[1]) link.time = time;
  const lang = q.get('lang') as Lang | null;
  if (lang && LANGS.includes(lang)) link.lang = lang;
  return link;
}

/**
 * The query string for what's on screen: body, base, view and language set (or removed when they
 * are the defaults), every other parameter kept. `date` is kept only while `keepDate` (the
 * linked moment is still the one shown); the clock moves every frame, so it isn't followed.
 */
export function linkSearch(search: string, view: LinkView, keepDate: boolean): string {
  // Other parameters stay exactly as typed (a bare ?debug stays bare).
  const drop = new Set(keepDate ? LINK_KEYS : [...LINK_KEYS, 'date']);
  const kept = search.replace(/^\?/, '').split('&').filter((part) => {
    if (!part) return false;
    let key = part.split('=')[0];
    try { key = decodeURIComponent(key); } catch { /* keep it as typed */ }
    return !drop.has(key);
  });
  const link = new URLSearchParams();
  if (view.base) {
    link.set('base', view.base);
    if (view.horizon) link.set('view', 'horizon');
  } else if (view.body !== 'sun') {
    link.set('body', view.body);
  }
  if (view.lang !== 'en') link.set('lang', view.lang);
  const linked = link.toString(); // (not .size: Safari only has it from 17)
  const out = [...kept, ...(linked ? [linked] : [])].join('&');
  return out ? `?${out}` : '';
}

/** A day (UTC midnight) or an ISO time with its zone; calendar-invalid days (2061-02-30) are rejected. */
function parseDate(text: string | null): number | null {
  if (!text) return null;
  const day = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
  const full = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  const date = day?.[1] ?? full?.[1];
  if (!date) return null;
  const ms = Date.parse(day ? `${date}T00:00:00Z` : text);
  if (!Number.isFinite(ms)) return null;
  // Date.parse rolls 2061-02-30 over to March: only a day that survives the round trip is real.
  return new Date(Date.parse(`${date}T00:00:00Z`)).toISOString().slice(0, 10) === date ? ms : null;
}
