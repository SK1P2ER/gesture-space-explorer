import { describe, expect, it } from 'vitest';
import {
  cleanName, createBooking, DEPARTURES, departuresTo, LAUNCH_WINDOW, makeRef, TIMETABLE_FROM, NAME_MAX, nameError, REF_PATTERN, requestError, transition,
  type BookingRequest,
} from '../src/travel/booking';

const request = (over: Partial<BookingRequest> = {}): BookingRequest => ({
  attempt: 'attempt-0001', traveller: { name: 'Ada', avatar: 'a1' }, to: 'jezero', departure: 'AL212', cabin: 'window', ...over,
});
const NOW = Date.UTC(2026, 9, 30);

describe('booking requests', () => {
  it('accepts a complete request for Cape → Jezero', () => {
    expect(requestError(request())).toBeNull();
  });

  it('says what is wrong, one thing at a time', () => {
    expect(requestError(request({ attempt: 'x' }))).toBe('attempt');
    expect(requestError(request({ traveller: { name: '   ', avatar: 'a1' } }))).toBe('name.empty');
    expect(requestError(request({ traveller: { name: 'Ada', avatar: 'a9' } }))).toBe('avatar');
    expect(requestError(request({ to: 'tranquility' }))).toBe('destination'); // not bookable in the MVP
    expect(requestError(request({ to: 'cape' }))).toBe('destination');
    expect(requestError(request({ departure: 'AL999' }))).toBe('departure');
    expect(requestError(request({ cabin: 'cargo' }))).toBe('cabin');
  });

  it('only books departures to the chosen destination', () => {
    expect(departuresTo('jezero').map((d) => d.id)).toEqual(['AL212', 'AL216', 'AL220']);
    expect(departuresTo('tranquility')).toEqual([]);
  });

  it('leaves in the next real Earth → Mars launch window after 2126 begins: two weeks apart, at 09:00 UTC', () => {
    expect(LAUNCH_WINDOW.at).toBeGreaterThanOrEqual(TIMETABLE_FROM);
    const [a, b, c] = DEPARTURES.map((d) => d.at);
    for (const d of DEPARTURES) {
      expect(Math.abs(d.at - LAUNCH_WINDOW.at) / 86_400_000).toBeLessThan(15);
      expect(new Date(d.at).getUTCHours()).toBe(9);
    }
    expect([(b - a) / 86_400_000, (c - b) / 86_400_000]).toEqual([14, 14]);
    expect(new Date(b).toISOString().slice(0, 10)).toBe('2127-03-06');
  });
});

describe('traveller names', () => {
  it('are tidied: one space between words, composed, no zero-width spaces', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('Adéla')).toBe('Adéla'); // NFC
    expect(cleanName('မောင်​မောင်')).toBe('မောင်မောင်');
  });

  it('may be Burmese or Japanese, with the joiners Burmese uses', () => {
    expect(nameError(cleanName('ဒေါ်ခင်ခင်ကြည်'))).toBeNull();
    expect(nameError(cleanName('သ‌န်'))).toBeNull(); // ZWNJ
    expect(nameError(cleanName('山田 花子'))).toBeNull();
  });

  it(`are at most ${NAME_MAX} characters, counted as characters, not UTF-16 units`, () => {
    expect(nameError('a'.repeat(NAME_MAX))).toBeNull();
    expect(nameError('a'.repeat(NAME_MAX + 1))).toBe('name.long');
    expect(nameError('🚀'.repeat(NAME_MAX))).toBeNull(); // 48 UTF-16 units, 24 characters
  });

  it('may hold emoji and the punctuation names use, but no markup, URL or address', () => {
    for (const ok of ['ジョン・スミス', 'O’Brien', "O'Brien", 'Jean-Luc', 'Dr. Who', 'Ada 🚀', '👩🏽‍🚀 Mae']) expect(nameError(ok), ok).toBeNull();
    for (const bad of ['<b>Ada</b>', 'evil.example/login', 'a@b.c', 'x:y', 'Ada & Bob', '"Ada"', 'Ada#1']) expect(nameError(bad), bad).toBe('name.chars');
  });

  it('refuse control characters and text-direction overrides', () => {
    expect(nameError('Ada\u0007')).toBe('name.chars');
    expect(nameError('Ada‮gnissim')).toBe('name.chars');
    expect(nameError('Ada⁦x')).toBe('name.chars');
    expect(nameError('')).toBe('name.empty');
  });
});

describe('booking references', () => {
  it('look like AL-XXXXX, without characters that can be misread', () => {
    expect(makeRef(new Uint8Array([0, 1, 2, 3, 4]))).toBe('AL-01234');
    expect(makeRef(new Uint8Array([18, 21, 24, 27, 31]))).toBe('AL-JNRVZ'); // I, L, O and U are skipped
    expect(makeRef(new Uint8Array([32, 33, 34, 35, 36]))).toBe('AL-01234'); // b % 32: every byte maps evenly
    for (let b = 0; b < 256; b++) {
      const ref = makeRef(new Uint8Array([b, b, b, b, b]));
      expect(ref).toMatch(REF_PATTERN);
      expect(ref.slice(3)).not.toMatch(/[ILOU]/);
    }
  });
});

describe('a booking’s journey', () => {
  const booking = createBooking(request({ traveller: { name: '  Ada  ', avatar: 'a2' } }), 'AL-0ABCD', NOW);

  it('starts confirmed, from the Cape, with the name tidied', () => {
    expect(booking).toMatchObject({ status: 'confirmed', from: 'cape', to: 'jezero', traveller: { name: 'Ada', avatar: 'a2' }, createdAt: NOW });
  });

  it('goes confirmed → checked in → in journey → completed, timestamping each step', () => {
    const steps = [['checkIn', 'checkedIn', 'checkedInAt'], ['depart', 'inJourney', 'departedAt'], ['arrive', 'completed', 'completedAt']] as const;
    let b = booking;
    steps.forEach(([event, status, at], i) => {
      const r = transition(b, event, NOW + i + 1);
      expect(r.ok && r.changed).toBe(true);
      if (!r.ok) return;
      expect(r.booking.status).toBe(status);
      expect(r.booking[at]).toBe(NOW + i + 1);
      b = r.booking;
    });
  });

  it('a step taken twice is a no-op: no double check-in, no second arrival (or stamp)', () => {
    const checkedIn = transition(booking, 'checkIn', NOW + 1);
    expect(checkedIn.ok).toBe(true);
    if (!checkedIn.ok) return;
    const again = transition(checkedIn.booking, 'checkIn', NOW + 2);
    expect(again).toEqual({ ok: true, booking: checkedIn.booking, changed: false });
  });

  it('refuses steps out of order', () => {
    expect(transition(booking, 'depart', NOW)).toEqual({ ok: false, error: 'invalid' }); // not checked in
    expect(transition(booking, 'arrive', NOW)).toEqual({ ok: false, error: 'invalid' });
    const cancelled = transition(booking, 'cancel', NOW);
    expect(cancelled.ok && cancelled.booking.status).toBe('cancelled');
    if (!cancelled.ok) return;
    expect(transition(cancelled.booking, 'checkIn', NOW)).toEqual({ ok: false, error: 'invalid' });
  });

  it('can be cancelled before departure, not after', () => {
    const flying = { ...booking, status: 'inJourney' as const };
    expect(transition(flying, 'cancel', NOW)).toEqual({ ok: false, error: 'invalid' });
    expect(transition({ ...booking, status: 'checkedIn' }, 'cancel', NOW).ok).toBe(true);
  });
});
