import { bodyOf, destinationById, SPACEPORT } from './destinations';
import { nextLaunchWindow } from './windows';

// AstroLife bookings (decision 21): the fictional 2126 timetable, what a booking request must hold,
// and the states a booking moves through. Pure (the caller supplies time and randomness), so every
// rule is tested without a browser. travel/store.ts keeps bookings on the device.
//
//   confirmed → checkedIn → inJourney → completed        (cancelled from confirmed or checkedIn)
//
// Repeating the step a booking has already taken changes nothing: a second check-in is no-op,
// and an arrival can complete a journey (and earn its stamp) only once.

export type AvatarId = 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6';
/** Six that look different at a glance, in every emoji font (the three astronauts didn't, on Windows). */
export const AVATARS: Record<AvatarId, string> = { a1: '🧑‍🚀', a2: '🛸', a3: '🌍', a4: '🚀', a5: '🪐', a6: '🌙' };
export const isAvatar = (v: unknown): v is AvatarId => typeof v === 'string' && Object.hasOwn(AVATARS, v);

export interface Departure {
  /** The flight number, also its id. */
  id: string;
  /** The destination's base. */
  to: string;
  /** When it leaves the spaceport (ms, UTC). */
  at: number;
}

/** It is 2126 in AstroLife: bookings are for the next launch window from the start of that year. */
export const TIMETABLE_FROM = Date.UTC(2126, 0, 1);
const DAY_MS = 86_400_000;
/** 09:00 UTC on the day of `ms`: liners leave on the hour. */
const nineOClock = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9); };

/**
 * The timetable (decision 23): three Cape → Jezero departures in the next real Earth → Mars launch
 * window (travel/windows.ts: when a Hohmann transfer can leave, from the planets' positions), two
 * weeks apart around its centre. 2126 itself has no window, so they leave in March 2127. The
 * liners, and their 9-day crossing, are fiction.
 */
export const LAUNCH_WINDOW = nextLaunchWindow('earth', bodyOf(destinationById('jezero')!), TIMETABLE_FROM)!;
export const DEPARTURES: readonly Departure[] = [-14, 0, 14].map((offset, i) => ({
  id: `AL2${12 + 4 * i}`, to: 'jezero', at: nineOClock(LAUNCH_WINDOW.at + offset * DAY_MS),
}));
export const departuresTo = (to: string) => DEPARTURES.filter((d) => d.to === to);
export const departureById = (id: string) => DEPARTURES.find((d) => d.id === id) ?? null;

export type CabinId = 'pod' | 'window' | 'suite';
/** Fares in credits: fiction too. Nothing is ever paid. */
export const CABINS: Record<CabinId, { fare: number }> = { pod: { fare: 4_800 }, window: { fare: 9_600 }, suite: { fare: 21_000 } };
export const CABIN_ORDER: readonly CabinId[] = ['pod', 'window', 'suite'];
export const isCabin = (v: unknown): v is CabinId => typeof v === 'string' && Object.hasOwn(CABINS, v);

export interface Traveller {
  name: string;
  avatar: AvatarId;
}

export type BookingStatus = 'confirmed' | 'checkedIn' | 'inJourney' | 'completed' | 'cancelled';
export const ACTIVE: readonly BookingStatus[] = ['confirmed', 'checkedIn', 'inJourney'];

export interface Booking {
  /** The booking reference, AL-XXXXX: unique on this device, and the booking's id. */
  ref: string;
  /** The request that made it: confirming the same request again finds this booking. */
  attempt: string;
  traveller: Traveller;
  from: string;
  to: string;
  departure: string;
  cabin: CabinId;
  status: BookingStatus;
  createdAt: number;
  checkedInAt?: number;
  departedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
}

export interface BookingRequest {
  /** A key made once per booking attempt (crypto.randomUUID()), so a double tap books once. */
  attempt: string;
  traveller: { name: string; avatar: string };
  to: string;
  departure: string;
  cabin: string;
}

export type BookingError = 'name.empty' | 'name.long' | 'name.chars' | 'avatar' | 'destination' | 'departure' | 'cabin' | 'attempt';

/** Longest name on a boarding pass, in characters (code points). */
export const NAME_MAX = 24;

/** A name as typed → as kept: one space between words, composed (NFC), no zero-width spaces. */
export const cleanName = (raw: string) => raw.normalize('NFC').replace(/​/g, '').replace(/\s+/g, ' ').trim();

/**
 * What a nickname may hold: letters and their marks (Burmese vowel signs), digits, emoji, the joiners
 * Burmese and emoji use (ZWNJ, ZWJ), spaces and . ' ’ - ・ (ジョン・スミス). Nothing else: a nickname
 * travels in a shareable souvenir link (travel/souvenir.ts), so it can't carry markup, a URL, or a
 * text-direction override that makes a pass read backwards.
 */
const NICKNAME = /^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}‌‍ .'’\-・]+$/u;

/** What's wrong with a cleaned nickname, if anything. */
export function nameError(name: string): 'name.empty' | 'name.long' | 'name.chars' | null {
  if (!name) return 'name.empty';
  if ([...name].length > NAME_MAX) return 'name.long';
  if (!NICKNAME.test(name)) return 'name.chars';
  return null;
}

/** The request's first problem, or null when it can be booked. */
export function requestError(r: BookingRequest): BookingError | null {
  if (typeof r.attempt !== 'string' || r.attempt.length < 8 || r.attempt.length > 64) return 'attempt';
  const name = nameError(cleanName(r.traveller.name));
  if (name) return name;
  if (!isAvatar(r.traveller.avatar)) return 'avatar';
  if (!destinationById(r.to)?.bookable) return 'destination';
  if (departureById(r.departure)?.to !== r.to) return 'departure';
  if (!isCabin(r.cabin)) return 'cabin';
  return null;
}

/** A new booking from a valid request (check requestError first). */
export function createBooking(r: BookingRequest, ref: string, now: number): Booking {
  return {
    ref, attempt: r.attempt,
    traveller: { name: cleanName(r.traveller.name), avatar: r.traveller.avatar as AvatarId },
    from: SPACEPORT, to: r.to, departure: r.departure, cabin: r.cabin as CabinId,
    status: 'confirmed', createdAt: now,
  };
}

/** Booking references use these 32 characters: no I, L, O or U, so none can be misread. */
const REF_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const REF_PATTERN = /^AL-[0-9A-HJKMNP-TV-Z]{5}$/;

/** A reference from five random bytes (256 is a multiple of 32, so every character is equally likely). */
export const makeRef = (bytes: Uint8Array) => `AL-${Array.from(bytes.subarray(0, 5), (b) => REF_CHARS[b % 32]).join('')}`;

export type BookingEvent = 'checkIn' | 'depart' | 'arrive' | 'cancel';

const STEPS: Record<BookingEvent, { from: readonly BookingStatus[]; to: BookingStatus; at: 'checkedInAt' | 'departedAt' | 'completedAt' | 'cancelledAt' }> = {
  checkIn: { from: ['confirmed'], to: 'checkedIn', at: 'checkedInAt' },
  depart: { from: ['checkedIn'], to: 'inJourney', at: 'departedAt' },
  arrive: { from: ['inJourney'], to: 'completed', at: 'completedAt' },
  cancel: { from: ['confirmed', 'checkedIn'], to: 'cancelled', at: 'cancelledAt' },
};

export type Transition = { ok: true; booking: Booking; changed: boolean } | { ok: false; error: 'invalid' };

/** A booking after `event`. The step it has already taken is a no-op (changed: false); any other is refused. */
export function transition(b: Booking, event: BookingEvent, now: number): Transition {
  const step = STEPS[event];
  if (b.status === step.to) return { ok: true, booking: b, changed: false };
  if (!step.from.includes(b.status)) return { ok: false, error: 'invalid' };
  return { ok: true, booking: { ...b, status: step.to, [step.at]: now }, changed: true };
}
