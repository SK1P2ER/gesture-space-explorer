import { departureById, isAvatar, isCabin, nameError, REF_PATTERN, type AvatarId, type Booking, type CabinId } from './booking';

// The boarding pass's souvenir link (decision 22). The QR code holds a link to this app with the
// pass after the "#": a fragment never leaves the browser, so nothing reaches a server, and the
// link opens the pass as a keepsake on any phone. It is not a ticket and authorizes nothing.
//
//   …/?flags=astrolife#souvenir=1&ref=AL-9NH92&nick=Ada&av=a3&fl=AL216&cab=suite
//
// Whatever a link holds is checked field by field; one bad field and the whole souvenir is ignored
// (the shell opens on its hub instead). The shell shows the fields as text only (textContent).

export interface Souvenir {
  ref: string;
  nick: string;
  avatar: AvatarId;
  /** The flight: its destination and date come from the timetable, not from the link. */
  flight: string;
  cabin: CabinId;
}

/** Fragments longer than this aren't souvenirs (a real one is under 200 characters). */
export const FRAGMENT_MAX = 400;
const FIELDS = ['souvenir', 'ref', 'nick', 'av', 'fl', 'cab'] as const;

export const souvenirOf = (b: Booking): Souvenir => ({ ref: b.ref, nick: b.traveller.name, avatar: b.traveller.avatar, flight: b.departure, cabin: b.cabin });

/** The link for a souvenir, on this app (origin and path), with AstroLife's flag so it opens the shell. */
export function souvenirLink(appUrl: string, s: Souvenir): string {
  const url = new URL(appUrl);
  url.search = '?flags=astrolife';
  const fragment = new URLSearchParams({ souvenir: '1', ref: s.ref, nick: s.nick, av: s.avatar, fl: s.flight, cab: s.cabin });
  url.hash = fragment.toString();
  return url.toString();
}

/** A souvenir from an address's fragment ("#…"), or null when it isn't one, or isn't a valid one. */
export function parseSouvenir(hash: string): Souvenir | null {
  const text = hash.replace(/^#/, '');
  if (!text || text.length > FRAGMENT_MAX) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text); // decodes %XX; a malformed escape becomes U+FFFD, refused below
  } catch {
    return null;
  }
  // Exactly the fields a souvenir has, each once: nothing extra, nothing repeated.
  const keys = [...params.keys()];
  if (keys.length !== FIELDS.length || FIELDS.some((k) => params.getAll(k).length !== 1)) return null;
  const get = (k: (typeof FIELDS)[number]) => params.get(k)!;
  const s = { ref: get('ref'), nick: get('nick'), avatar: get('av'), flight: get('fl'), cabin: get('cab') };
  const ok = get('souvenir') === '1' && REF_PATTERN.test(s.ref) && s.nick.normalize('NFC') === s.nick && !nameError(s.nick)
    && s.nick.trim() === s.nick && !/ {2}/.test(s.nick) && isAvatar(s.avatar) && departureById(s.flight) !== null && isCabin(s.cabin);
  return ok ? { ...s, avatar: s.avatar as AvatarId, cabin: s.cabin as CabinId } : null;
}
