import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATARS, CABINS, createBooking, DEPARTURES, REF_CHARS } from '../src/travel/booking';
import { encodeFields, FRAGMENT_MAX, parseSouvenir, souvenirLink, souvenirOf, WIRE, type Souvenir, type WireFields } from '../src/travel/souvenir';

const APP = 'https://gesture-space-explorer.vercel.app/';
const ADA: Souvenir = { ref: 'AL-9NH92', nick: 'Ada Lovelace', avatar: 'a3', flight: 'AL216', cabin: 'suite' };
const utf8 = (s: string) => new TextEncoder().encode(s);
/** Ada's fields as packed, with some replaced: nothing is checked, so broken links can be made. */
const wire = (over: Partial<WireFields> = {}): WireFields => ({
  version: 1, avatar: 2, flight: 1, cabin: 2, ref: Array.from('9NH92', (c) => REF_CHARS.indexOf(c)), pad: 0, nick: utf8(ADA.nick), ...over,
});
const fragment = (over: Partial<WireFields> = {}) => `#${encodeFields(wire(over))}`;

describe('the souvenir link', () => {
  it('opens AstroLife with the pass after the #, which never reaches a server', () => {
    const url = new URL(souvenirLink(`${APP}?debug&base=jezero#old`, ADA));
    expect(url.origin + url.pathname).toBe(APP);
    expect(url.search).toBe('?al'); // AstroLife's flag, and nothing of the pass in the query
    expect(parseSouvenir(url.hash)).toEqual(ADA);
  });

  it('is short, and shows none of its fields at a glance', () => {
    const link = souvenirLink(APP, { ...ADA, nick: 'Ada' });
    expect(link).toBe(`${APP}?al#KZNYpEBBZGE`); // decision 27 quotes this example
    expect(new URL(souvenirLink(APP, { ...ADA, nick: '山田 花子' })).hash.length - 1).toBe(24); // was 91
    expect(new URL(link).hash).not.toMatch(/Ada|AL-|9NH92|suite|AL216|=|&/);
  });

  it('round-trips every avatar, flight and cabin, and Burmese, Japanese and emoji nicknames', () => {
    for (const nick of ['ဒေါ်ခင်ခင်ကြည်', 'သ‌န်', 'ジョン・スミス', '山田 花子', 'Ada 🚀', 'O’Brien', 'Jean-Luc', 'a'.repeat(24)]) {
      const s = { ...ADA, nick };
      expect(parseSouvenir(new URL(souvenirLink(APP, s)).hash), nick).toEqual(s);
    }
    for (const avatar of WIRE.avatars) for (const flight of WIRE.flights) for (const cabin of WIRE.cabins) {
      for (const ref of ['AL-00000', 'AL-ZZZZZ', 'AL-9NH92']) {
        const s = { ...ADA, ref, avatar, flight, cabin };
        expect(parseSouvenir(new URL(souvenirLink(APP, s)).hash)).toEqual(s);
      }
    }
  });

  it('fits the longest nickname under FRAGMENT_MAX', () => {
    const s = { ...ADA, nick: '🪐'.repeat(24) }; // 4 bytes each: the most a nickname can take
    const hash = new URL(souvenirLink(APP, s)).hash;
    expect(hash.length - 1).toBeLessThanOrEqual(FRAGMENT_MAX);
    expect(parseSouvenir(hash)).toEqual(s);
  });

  it('numbers the values in a fixed order, which shared links depend on', () => {
    // Append to WIRE (and the catalog) to add a value; never reorder: every shared link would change meaning.
    expect(WIRE.avatars).toEqual(Object.keys(AVATARS));
    expect(WIRE.flights).toEqual(DEPARTURES.map((d) => d.id));
    expect(WIRE.cabins).toEqual(Object.keys(CABINS));
    expect(WIRE.avatars.length).toBeLessThanOrEqual(8); // 3 bits
    expect(WIRE.flights.length).toBeLessThanOrEqual(4); // 2 bits
    expect(WIRE.cabins.length).toBeLessThanOrEqual(4); // 2 bits
  });

  it('is made from a booking with its nickname, avatar, flight and cabin, and nothing else', () => {
    const b = createBooking({ attempt: 'attempt-0001', traveller: { name: ' Ada ', avatar: 'a2' }, to: 'jezero', departure: 'AL212', cabin: 'pod' }, 'AL-0ABCD', 0);
    expect(souvenirOf(b)).toEqual({ ref: 'AL-0ABCD', nick: 'Ada', avatar: 'a2', flight: 'AL212', cabin: 'pod' });
    expect(parseSouvenir(new URL(souvenirLink(APP, souvenirOf(b))).hash)).toEqual(souvenirOf(b));
  });
});

describe('a hostile or broken souvenir link is ignored, whole', () => {
  const ok = fragment();
  const nick = (s: string) => fragment({ nick: utf8(s) });
  // [what, the fragment, whether it is spelled like a real link: so it reaches the field checks]
  const hostile: [string, string, boolean][] = [
    ['markup in the nickname', nick('<img src=x onerror=alert(1)>'), true],
    ['a script tag', nick('<script>x</script>'), true],
    ['a URL in the nickname', nick('evil.example/login'), true],
    ['an e-mail address', nick('a@b.c'), true],
    ['a text-direction override', nick('Ada‮ecalevol'), true],
    ['a control character', nick('Ada\u0000'), true],
    ['a zero-width space', nick('A​da'), true],
    ['a byte-order mark', nick('﻿Ada'), true],
    ['too long a nickname', nick('a'.repeat(25)), true],
    ['an empty nickname', fragment({ nick: new Uint8Array() }), false], // the fields alone: too short to be one
    ['padding around the nickname', nick(' Ada'), true],
    ['two spaces in a row', nick('Ada  L'), true],
    ['a decomposed (not NFC) nickname', nick('Adéla'), true],
    ['malformed UTF-8', fragment({ nick: Uint8Array.of(0x41, 0xff, 0x41) }), true],
    ['a cut-off UTF-8 character', fragment({ nick: utf8('山').subarray(0, 2) }), true],
    ['an unknown avatar (6)', fragment({ avatar: 6 }), true],
    ['an unknown avatar (7)', fragment({ avatar: 7 }), true],
    ['an unknown flight', fragment({ flight: 3 }), true],
    ['an unknown cabin', fragment({ cabin: 3 }), true],
    ['version 0', fragment({ version: 0 }), true],
    ['another version', fragment({ version: 2 }), true],
    ['bits set after the reference', fragment({ pad: 1 }), true],
    ['cut off inside the fields', ok.slice(0, 7), false],
    ['a stray bit in the last character', `${ok.slice(0, -1)}${String.fromCharCode(ok.at(-1)!.charCodeAt(0) + 1)}`, false],
    ['base64 padding', `${fragment({ nick: utf8('Ad') })}=`, false],
    ['standard base64 (+ and /)', '#KZNYpEBB+GE/', false],
    ['a length no bytes can have', `${ok}AA`, false],
    ['a NUL byte appended', `${ok}A`, true],
    ['the v2.6.0 format', '#souvenir=1&ref=AL-9NH92&nick=Ada&av=a3&fl=AL216&cab=suite', false],
    ['an oversized fragment', `#${'A'.repeat(FRAGMENT_MAX + 1)}`, false],
    ['not a souvenir', '#section-2', false],
    ['a word', '#top', false],
    ['nothing', '', false],
    ['a bare #', '#', false],
  ];
  it('accepts the unbroken one (so each case below breaks only what it names)', () => expect(parseSouvenir(ok)).toEqual(ADA));
  for (const [what, hash, spelled] of hostile) {
    it(what, () => {
      expect(parseSouvenir(hash)).toBeNull();
      // The field cases must be refused by the field checks, not because the spelling broke first.
      const text = hash.slice(1);
      expect(/^[A-Za-z0-9_-]+$/.test(text) && text.length <= FRAGMENT_MAX && canonical(text)).toBe(spelled);
    });
  }
});

/** Whether a fragment is base64url as souvenirLink spells it (decodes, and encodes back the same). */
function canonical(text: string): boolean {
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === text && bin.length > 5;
  } catch {
    return false;
  }
}

it('the shell and the travel code never parse text as HTML', () => {
  const files: string[] = [];
  const scan = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) scan(path);
      else if (path.endsWith('.ts')) files.push(path);
    }
  };
  scan('src/shell');
  scan('src/travel');
  for (const path of files) expect(readFileSync(path, 'utf8'), path).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/);
});
