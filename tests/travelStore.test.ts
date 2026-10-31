import { describe, expect, it } from 'vitest';
import { resetIfAsked } from '../src/app/settings';
import type { BookingRequest } from '../src/travel/booking';
import { parseSaved, STORE_KEY, TravelStore } from '../src/travel/store';

const NOW = Date.UTC(2026, 9, 30);
const request = (attempt: string, over: Partial<BookingRequest> = {}): BookingRequest => ({
  attempt, traveller: { name: 'Ada', avatar: 'a1' }, to: 'jezero', departure: 'AL212', cabin: 'window', ...over,
});

/** localStorage stand-in; `fail` makes reads or writes throw (blocked or full storage). */
function memoryStorage(fail: { get?: boolean; set?: boolean } = {}) {
  const items = new Map<string, string>();
  return {
    items,
    get length() { return items.size; },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem(k: string) { if (fail.get) throw new Error('blocked'); return items.get(k) ?? null; },
    setItem(k: string, v: string) { if (fail.set) throw new Error('full'); items.set(k, v); },
    removeItem(k: string) { items.delete(k); },
  };
}

/** Random bytes from a list of byte arrays, in order (then zeros). */
const bytes = (...lists: number[][]) => () => new Uint8Array(lists.shift() ?? [0, 0, 0, 0, 0]);
const counter = () => { let n = 0; return () => new Uint8Array([n, n, n, n, n++]); };

describe('the travel store', () => {
  it('books, and keeps the booking and the traveller on the device', () => {
    const storage = memoryStorage();
    const store = new TravelStore(storage, counter());
    const r = store.confirm(request('attempt-0001'), NOW);
    expect(r.ok && r.created).toBe(true);
    const again = new TravelStore(storage, counter());
    expect(again.bookings.map((b) => b.ref)).toEqual([r.ok ? r.booking.ref : '']);
    expect(again.traveller).toEqual({ name: 'Ada', avatar: 'a1' });
    expect(again.active()?.status).toBe('confirmed');
  });

  it('books once when the same attempt is confirmed twice (a double tap, a retry)', () => {
    const store = new TravelStore(memoryStorage(), counter());
    const first = store.confirm(request('attempt-0001'), NOW);
    const second = store.confirm(request('attempt-0001'), NOW + 5);
    expect(second).toEqual({ ok: true, booking: first.ok ? first.booking : null, created: false });
    expect(store.bookings).toHaveLength(1);
  });

  it('keeps one journey under way at a time; after a cancel, another can be booked', () => {
    const store = new TravelStore(memoryStorage(), counter());
    const first = store.confirm(request('attempt-0001'), NOW);
    expect(store.confirm(request('attempt-0002'), NOW)).toEqual({ ok: false, error: 'active' });
    store.apply(first.ok ? first.booking.ref : '', 'cancel', NOW + 1);
    expect(store.active()).toBeNull();
    expect(store.confirm(request('attempt-0002'), NOW + 2).ok).toBe(true);
    expect(store.bookings).toHaveLength(2);
  });

  it('refuses an invalid request without saving anything', () => {
    const storage = memoryStorage();
    const store = new TravelStore(storage, counter());
    expect(store.confirm(request('attempt-0001', { traveller: { name: '', avatar: 'a1' } }), NOW)).toEqual({ ok: false, error: 'name.empty' });
    expect(storage.items.size).toBe(0);
  });

  it('draws a new reference when one is already taken', () => {
    const store = new TravelStore(memoryStorage(), bytes([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [9, 9, 9, 9, 9]));
    const a = store.confirm(request('attempt-0001'), NOW);
    if (a.ok) store.apply(a.booking.ref, 'cancel', NOW);
    const b = store.confirm(request('attempt-0002'), NOW);
    expect(a.ok && a.booking.ref).toBe('AL-12345');
    expect(b.ok && b.booking.ref).toBe('AL-99999');
  });

  it('saves each step; a repeated check-in changes nothing', () => {
    const storage = memoryStorage();
    const store = new TravelStore(storage, counter());
    const r = store.confirm(request('attempt-0001'), NOW);
    const ref = r.ok ? r.booking.ref : '';
    expect(store.apply(ref, 'checkIn', NOW + 1)).toMatchObject({ ok: true, changed: true });
    const saved = storage.items.get(STORE_KEY);
    expect(store.apply(ref, 'checkIn', NOW + 2)).toMatchObject({ ok: true, changed: false });
    expect(storage.items.get(STORE_KEY)).toBe(saved);
    expect(new TravelStore(storage, counter()).find(ref)?.checkedInAt).toBe(NOW + 1);
    expect(store.apply('AL-NOPE0', 'checkIn', NOW)).toEqual({ ok: false, error: 'unknown' });
  });

  it('sees what another tab saved before it changes anything', () => {
    const storage = memoryStorage();
    const tabA = new TravelStore(storage, counter());
    const tabB = new TravelStore(storage, bytes([7, 7, 7, 7, 7]));
    tabB.confirm(request('attempt-from-b'), NOW);
    expect(tabA.confirm(request('attempt-from-a'), NOW)).toEqual({ ok: false, error: 'active' });
  });

  it('works for the visit, in memory, when storage is blocked or full, and says so', () => {
    for (const fail of [{ get: true }, { set: true }]) {
      const store = new TravelStore(memoryStorage(fail), counter());
      const r = store.confirm(request('attempt-0001'), NOW);
      expect(r.ok).toBe(true);
      expect(store.persisted).toBe(false);
      expect(store.active()?.ref).toBe(r.ok ? r.booking.ref : '');
    }
    const none = new TravelStore(null, counter());
    expect(none.persisted).toBe(false);
    expect(none.confirm(request('attempt-0001'), NOW).ok).toBe(true);
  });

  it('forgets everything on request, and with ?reset (its key is one of the app’s gse. keys)', () => {
    const storage = memoryStorage();
    const store = new TravelStore(storage, counter());
    store.confirm(request('attempt-0001'), NOW);
    store.forget();
    expect(store.bookings).toEqual([]);
    expect(storage.items.has(STORE_KEY)).toBe(false);
    new TravelStore(storage, counter()).confirm(request('attempt-0002'), NOW);
    resetIfAsked('?reset', storage);
    expect(storage.items.has(STORE_KEY)).toBe(false);
  });
});

describe('what was stored', () => {
  const valid = {
    ref: 'AL-12345', attempt: 'attempt-0001', traveller: { name: 'Ada', avatar: 'a1' }, from: 'cape', to: 'jezero',
    departure: 'AL212', cabin: 'window', status: 'confirmed', createdAt: NOW,
  };
  const saved = (bookings: unknown[], traveller: unknown = null) => JSON.stringify({ v: 1, traveller, bookings });

  it('is read back as it was', () => {
    expect(parseSaved(saved([valid])).bookings).toEqual([valid]);
  });

  it('drops what is malformed or tampered with, keeping the rest, and never throws', () => {
    for (const text of [null, '', '{', '[]', '"x"', JSON.stringify({ v: 2, bookings: [valid] })]) expect(parseSaved(text).bookings).toEqual([]);
    const bad = [
      { ...valid, ref: 'AL-IIIII' }, // misreadable characters: never made by makeRef
      { ...valid, ref: 'AL-00001', status: 'boarded' },
      { ...valid, ref: 'AL-00002', to: 'tranquility' }, // not bookable
      { ...valid, ref: 'AL-00003', departure: 'AL999' },
      { ...valid, ref: 'AL-00004', traveller: { name: 'Ada‮', avatar: 'a1' } },
      { ...valid, ref: 'AL-00005', completedAt: 'yesterday' },
      { ...valid, ref: 'AL-00006', from: 'jezero' },
      valid, // a duplicate reference: the first one stays
      'AL-00007',
    ];
    expect(parseSaved(saved([valid, ...bad])).bookings).toEqual([valid]);
  });

  it('keeps the traveller only when the name is one a booking could have', () => {
    expect(parseSaved(saved([], { name: 'Ada', avatar: 'a1' })).traveller).toEqual({ name: 'Ada', avatar: 'a1' });
    expect(parseSaved(saved([], { name: '  Ada', avatar: 'a1' })).traveller).toBeNull();
    expect(parseSaved(saved([], { name: 'Ada', avatar: 'zz' })).traveller).toBeNull();
  });
});
