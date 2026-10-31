import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBooking } from '../src/travel/booking';
import { FRAGMENT_MAX, parseSouvenir, souvenirLink, souvenirOf, type Souvenir } from '../src/travel/souvenir';

const APP = 'https://gesture-space-explorer.vercel.app/';
const ADA: Souvenir = { ref: 'AL-9NH92', nick: 'Ada Lovelace', avatar: 'a3', flight: 'AL216', cabin: 'suite' };
const fragment = (fields: Record<string, string>) => `#${new URLSearchParams(fields).toString()}`;
const fields = (over: Record<string, string> = {}) => ({ souvenir: '1', ref: ADA.ref, nick: ADA.nick, av: ADA.avatar, fl: ADA.flight, cab: ADA.cabin, ...over });

describe('the souvenir link', () => {
  it('opens AstroLife with the pass after the #, which never reaches a server', () => {
    const url = new URL(souvenirLink(`${APP}?debug&base=jezero#old`, ADA));
    expect(url.origin + url.pathname).toBe(APP);
    expect(url.search).toBe('?flags=astrolife'); // nothing of the pass in the query
    expect(parseSouvenir(url.hash)).toEqual(ADA);
  });

  it('round-trips Burmese, Japanese and emoji nicknames', () => {
    for (const nick of ['ဒေါ်ခင်ခင်ကြည်', 'သ‌န်', 'ジョン・スミス', '山田 花子', 'Ada 🚀', 'O’Brien', 'Jean-Luc']) {
      const s = { ...ADA, nick };
      expect(parseSouvenir(new URL(souvenirLink(APP, s)).hash), nick).toEqual(s);
    }
  });

  it('is made from a booking with its nickname, avatar, flight and cabin, and nothing else', () => {
    const b = createBooking({ attempt: 'attempt-0001', traveller: { name: ' Ada ', avatar: 'a2' }, to: 'jezero', departure: 'AL212', cabin: 'pod' }, 'AL-0ABCD', 0);
    expect(souvenirOf(b)).toEqual({ ref: 'AL-0ABCD', nick: 'Ada', avatar: 'a2', flight: 'AL212', cabin: 'pod' });
    expect(new URL(souvenirLink(APP, souvenirOf(b))).hash).not.toMatch(/attempt|createdAt|status/);
  });
});

describe('a hostile or broken souvenir link is ignored, whole', () => {
  const hostile: [string, string][] = [
    ['markup in the nickname', fragment(fields({ nick: '<img src=x onerror=alert(1)>' }))],
    ['a script tag', fragment(fields({ nick: '<script>x</script>' }))],
    ['a URL in the nickname', fragment(fields({ nick: 'evil.example/login' }))],
    ['an e-mail address', fragment(fields({ nick: 'a@b.c' }))],
    ['a text-direction override', fragment(fields({ nick: 'Ada‮ecalevol' }))],
    ['a control character', fragment(fields({ nick: 'Ada\u0000' }))],
    ['a zero-width space', fragment(fields({ nick: 'A​da' }))],
    ['too long a nickname', fragment(fields({ nick: 'a'.repeat(25) }))],
    ['an empty nickname', fragment(fields({ nick: '' }))],
    ['padding around the nickname', fragment(fields({ nick: ' Ada' }))],
    ['two spaces in a row', fragment(fields({ nick: 'Ada  L' }))],
    ['a decomposed (not NFC) nickname', fragment(fields({ nick: 'Adéla' }))],
    ['a malformed % escape', '#souvenir=1&ref=AL-9NH92&nick=%E0%A4&av=a3&fl=AL216&cab=suite'],
    ['a reference that makeRef never makes', fragment(fields({ ref: 'AL-IIIII' }))],
    ['a reference with something after it', fragment(fields({ ref: 'AL-9NH92x' }))],
    ['an unknown avatar', fragment(fields({ av: 'a9' }))],
    ['an unknown flight', fragment(fields({ fl: 'AL999' }))],
    ['an unknown cabin', fragment(fields({ cab: 'cargo' }))],
    ['another version', fragment(fields({ souvenir: '2' }))],
    ['a missing field', fragment((({ cab: _, ...rest }) => rest)(fields()))],
    ['an extra field', fragment(fields({ admin: '1' }))],
    ['a __proto__ field', `${fragment(fields())}&__proto__=x`],
    ['a repeated field', `${fragment(fields())}&nick=Mallory`],
    ['an oversized fragment', `${fragment(fields())}&pad=${'x'.repeat(FRAGMENT_MAX)}`],
    ['not a souvenir', '#section-2'],
    ['nothing', ''],
    ['a bare #', '#'],
  ];
  for (const [what, hash] of hostile) it(what, () => expect(parseSouvenir(hash)).toBeNull());
});

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
