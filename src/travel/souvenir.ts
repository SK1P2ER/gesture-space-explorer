import { departureById, isAvatar, isCabin, nameError, REF_CHARS, REF_PATTERN, type AvatarId, type Booking, type CabinId } from './booking';

// The boarding pass's souvenir link (decisions 22, 26 and 27). The QR code holds a link to this app
// with the pass after the "#": a browser never sends the fragment, so the nickname and reference
// never reach this app's host (the link itself goes wherever people share it). The link opens the
// pass as a keepsake on any phone. It is not a ticket and authorizes nothing.
//
//   …/?al#KZNYpEBBZGE          (?al is short for ?flags=astrolife)
//
// The fragment is base64url of five bytes of fields, then the nickname in UTF-8:
//
//   bits  3 version (1) · 3 avatar · 2 flight · 2 cabin · 5×5 reference · 5 zero
//
// The avatar, flight and cabin are positions in the WIRE lists below, and the reference is its
// five characters after "AL-" as positions in REF_CHARS. This makes the link short, and it hides
// the fields from a glance, but it hides nothing from anyone who decodes it: the nickname is still
// in the link, which is why the booking form asks for a nickname, not a name.
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

/**
 * The order each field's values are numbered in. Shared links hold these positions, so the lists
 * only ever grow at the end (a test pins them); a value that doesn't fit its bits needs version 2.
 */
export const WIRE = {
  avatars: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], // 3 bits
  flights: ['AL212', 'AL216', 'AL220'], // 2 bits
  cabins: ['pod', 'window', 'suite'], // 2 bits
} as const satisfies { avatars: readonly AvatarId[]; flights: readonly string[]; cabins: readonly CabinId[] };

const VERSION = 1;
/** The fields' bytes, before the nickname. */
const HEAD = 5;
/** A souvenir's fields as they are packed, unchecked (souvenirLink makes them; tests make broken ones). */
export interface WireFields {
  version: number;
  avatar: number;
  flight: number;
  cabin: number;
  /** The reference's five characters, as positions in REF_CHARS. */
  ref: readonly number[];
  /** The five bits after the reference: always zero. */
  pad: number;
  nick: Uint8Array;
}

/** The longest fragment a souvenir can have: 24 code points of 4 bytes each, after the fields. */
export const FRAGMENT_MAX = Math.ceil(((HEAD + 24 * 4) * 4) / 3);

export const souvenirOf = (b: Booking): Souvenir => ({ ref: b.ref, nick: b.traveller.name, avatar: b.traveller.avatar, flight: b.departure, cabin: b.cabin });

/** The link for a souvenir, on this app (origin and path), with AstroLife's flag so it opens the shell. */
export function souvenirLink(appUrl: string, s: Souvenir): string {
  const url = new URL(appUrl);
  url.search = '?al';
  url.hash = encodeFields({
    version: VERSION,
    avatar: WIRE.avatars.indexOf(s.avatar),
    flight: (WIRE.flights as readonly string[]).indexOf(s.flight),
    cabin: WIRE.cabins.indexOf(s.cabin),
    ref: Array.from(s.ref.slice(3), (c) => REF_CHARS.indexOf(c)),
    pad: 0,
    nick: new TextEncoder().encode(s.nick),
  });
  return url.toString();
}

/** The fragment (without "#") for these fields, as given: nothing is checked. */
export function encodeFields(f: WireFields): string {
  const head = new Uint8Array(HEAD);
  let pos = 0;
  const write = (value: number, bits: number) => {
    for (let i = bits - 1; i >= 0; i--, pos++) if ((value >> i) & 1) head[pos >> 3] |= 0x80 >> (pos & 7);
  };
  write(f.version, 3);
  write(f.avatar, 3);
  write(f.flight, 2);
  write(f.cabin, 2);
  for (const c of f.ref) write(c, 5);
  write(f.pad, 5);
  const bytes = new Uint8Array(HEAD + f.nick.length);
  bytes.set(head);
  bytes.set(f.nick, HEAD);
  return toBase64Url(bytes);
}

/** A souvenir from an address's fragment ("#…"), or null when it isn't one, or isn't a valid one. */
export function parseSouvenir(hash: string): Souvenir | null {
  const text = hash.replace(/^#/, '');
  if (!text || text.length > FRAGMENT_MAX || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const bytes = fromBase64Url(text);
  // Only the one spelling souvenirLink makes: no padding, no stray bits after the last byte.
  if (!bytes || bytes.length <= HEAD || toBase64Url(bytes) !== text) return null;
  let pos = 0;
  const read = (bits: number) => {
    let value = 0;
    for (let i = 0; i < bits; i++, pos++) value = (value << 1) | ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1);
    return value;
  };
  const version = read(3);
  const avatar = WIRE.avatars.at(read(3));
  const flight = WIRE.flights.at(read(2));
  const cabin = WIRE.cabins.at(read(2));
  const ref = `AL-${Array.from({ length: 5 }, () => REF_CHARS[read(5)]).join('')}`;
  const pad = read(5);
  let nick: string;
  try {
    // fatal: malformed UTF-8 is refused, not patched with U+FFFD; ignoreBOM: a BOM stays, and is refused below.
    nick = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(HEAD));
  } catch {
    return null;
  }
  const ok = version === VERSION && pad === 0 && avatar !== undefined && flight !== undefined && cabin !== undefined
    && REF_PATTERN.test(ref) && nick.normalize('NFC') === nick && !nameError(nick) && nick.trim() === nick && !/ {2}/.test(nick)
    && isAvatar(avatar) && departureById(flight) !== null && isCabin(cabin);
  return ok ? { ref, nick, avatar, flight, cabin } : null;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null; // a length no bytes can have
  }
}
