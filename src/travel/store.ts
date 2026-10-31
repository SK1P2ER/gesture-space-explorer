import {
  ACTIVE, cleanName, createBooking, departureById, isAvatar, isCabin, makeRef, nameError, REF_PATTERN, requestError,
  transition, type Booking, type BookingError, type BookingEvent, type BookingRequest, type BookingStatus, type Traveller,
} from './booking';
import { destinationById, SPACEPORT } from './destinations';

// AstroLife's bookings, kept on this device only (decision 21: no backend). One key in localStorage,
// starting with "gse." like everything the app keeps, so ?reset forgets it too. Every change reads
// what is stored first (another tab may have booked meanwhile), and anything malformed or
// tampered with is dropped, never thrown. When storage is blocked or full, bookings still work for
// this visit, in memory, and `persisted` says so.

export const STORE_KEY = 'gse.astrolife';

interface Saved {
  v: 1;
  /** The last traveller, to fill in the next booking. */
  traveller: Traveller | null;
  bookings: Booking[];
}

const empty = (): Saved => ({ v: 1, traveller: null, bookings: [] });
const STATUSES: readonly BookingStatus[] = ['confirmed', 'checkedIn', 'inJourney', 'completed', 'cancelled'];
const isTime = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));

function parseTraveller(v: unknown): Traveller | null {
  if (!v || typeof v !== 'object') return null;
  const { name, avatar } = v as Record<string, unknown>;
  return typeof name === 'string' && cleanName(name) === name && !nameError(name) && isAvatar(avatar) ? { name, avatar } : null;
}

function parseBooking(v: unknown): Booking | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const traveller = parseTraveller(b.traveller);
  const ok = traveller && typeof b.ref === 'string' && REF_PATTERN.test(b.ref) && typeof b.attempt === 'string'
    && b.from === SPACEPORT && typeof b.to === 'string' && destinationById(b.to)?.bookable
    && typeof b.departure === 'string' && departureById(b.departure)?.to === b.to && isCabin(b.cabin)
    && STATUSES.includes(b.status as BookingStatus) && typeof b.createdAt === 'number' && Number.isFinite(b.createdAt)
    && [b.checkedInAt, b.departedAt, b.completedAt, b.cancelledAt].every(isTime);
  if (!ok) return null;
  const out: Booking = {
    ref: b.ref as string, attempt: b.attempt as string, traveller, from: SPACEPORT, to: b.to as string,
    departure: b.departure as string, cabin: b.cabin as Booking['cabin'], status: b.status as BookingStatus, createdAt: b.createdAt as number,
  };
  for (const k of ['checkedInAt', 'departedAt', 'completedAt', 'cancelledAt'] as const) if (b[k] !== undefined) out[k] = b[k] as number;
  return out;
}

/** Whatever was stored → what can be trusted of it (malformed entries are dropped; never throws). */
export function parseSaved(text: string | null | undefined): Saved {
  if (!text) return empty();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty();
  }
  if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== 1) return empty();
  const { traveller, bookings } = data as Record<string, unknown>;
  const seen = new Set<string>();
  const kept = (Array.isArray(bookings) ? bookings : []).map(parseBooking).filter((b): b is Booking => {
    if (!b || seen.has(b.ref)) return false;
    seen.add(b.ref);
    return true;
  });
  return { v: 1, traveller: parseTraveller(traveller), bookings: kept };
}

export type Confirmation = { ok: true; booking: Booking; created: boolean } | { ok: false; error: BookingError | 'active' };

export class TravelStore {
  /** False once a save failed: bookings then last only as long as the page. */
  persisted = true;
  private memory: Saved = empty();

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
    /** n random bytes (crypto.getRandomValues in the app). */
    private readonly random: (n: number) => Uint8Array,
  ) {
    if (!storage) this.persisted = false;
    this.memory = this.read();
  }

  get bookings(): readonly Booking[] {
    return this.read().bookings;
  }

  /** The last traveller, to fill in the next booking. */
  get traveller(): Traveller | null {
    return this.read().traveller;
  }

  find(ref: string): Booking | null {
    return this.read().bookings.find((b) => b.ref === ref) ?? null;
  }

  /** The booking still under way (confirmed, checked in or flying), newest first. There is at most one. */
  active(): Booking | null {
    return this.read().bookings.filter((b) => ACTIVE.includes(b.status)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  /**
   * Books a request. The same attempt again returns the booking it made (created: false): a double
   * tap or a retry books once. A new attempt while another journey is under way is refused.
   */
  confirm(request: BookingRequest, now: number): Confirmation {
    const saved = this.read();
    const again = saved.bookings.find((b) => b.attempt === request.attempt);
    if (again) return { ok: true, booking: again, created: false };
    const error = requestError(request);
    if (error) return { ok: false, error };
    if (saved.bookings.some((b) => ACTIVE.includes(b.status))) return { ok: false, error: 'active' };
    const taken = new Set(saved.bookings.map((b) => b.ref));
    let ref = makeRef(this.random(5));
    while (taken.has(ref)) ref = makeRef(this.random(5));
    const booking = createBooking(request, ref, now);
    this.write({ ...saved, traveller: booking.traveller, bookings: [...saved.bookings, booking] });
    return { ok: true, booking, created: true };
  }

  /** A booking's next step (travel/booking.ts transition), saved. */
  apply(ref: string, event: BookingEvent, now: number) {
    const saved = this.read();
    const booking = saved.bookings.find((b) => b.ref === ref);
    if (!booking) return { ok: false as const, error: 'unknown' as const };
    const result = transition(booking, event, now);
    if (result.ok && result.changed) this.write({ ...saved, bookings: saved.bookings.map((b) => (b.ref === ref ? result.booking : b)) });
    return result;
  }

  /** Deletes everything AstroLife keeps on this device. */
  forget() {
    this.memory = empty();
    try {
      this.storage?.removeItem(STORE_KEY);
    } catch {
      // nothing was kept to forget
    }
  }

  private read(): Saved {
    if (!this.persisted || !this.storage) return this.memory;
    try {
      this.memory = parseSaved(this.storage.getItem(STORE_KEY));
    } catch {
      this.persisted = false; // blocked: this visit only
    }
    return this.memory;
  }

  private write(saved: Saved) {
    this.memory = saved;
    if (!this.persisted || !this.storage) return;
    try {
      this.storage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      this.persisted = false; // full or blocked: this visit only
    }
  }
}
