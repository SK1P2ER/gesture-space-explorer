import { describe, expect, it } from 'vitest';
import { hohmann, launchWindows, nextLaunchWindow, targetLead } from '../src/travel/windows';

const DAY = 86_400_000;
const days = (a: number, b: number) => Math.abs(a - b) / DAY;

describe('a Hohmann transfer', () => {
  it('from Earth to Mars takes about 259 days and needs Mars about 44° ahead', () => {
    const { transferDays, phaseDeg } = hohmann(1, 1.523679);
    expect(transferDays).toBeCloseTo(258.9, 0);
    expect(phaseDeg).toBeCloseTo(44.3, 1);
  });

  it('to an inner planet needs it behind (a negative lead)', () => {
    expect(hohmann(1, 0.723332).phaseDeg).toBeLessThan(0); // Venus
  });
});

describe('Earth → Mars launch windows', () => {
  // Real launches, each within its window. The circular-orbit phase angle puts the window's
  // centre within about two months of them: Mars's orbit is eccentric (decision 23).
  const launches: [string, number][] = [
    ['Curiosity', Date.UTC(2011, 10, 26)],
    ['MAVEN', Date.UTC(2013, 10, 18)],
    ['ExoMars TGO', Date.UTC(2016, 2, 14)],
    ['InSight', Date.UTC(2018, 4, 5)],
    ['Perseverance', Date.UTC(2020, 6, 30)],
  ];
  for (const [mission, launched] of launches) {
    it(`find the one ${mission} launched in (within 65 days)`, () => {
      const w = nextLaunchWindow('earth', 'mars', launched - 120 * DAY)!;
      expect(days(w.at, launched)).toBeLessThan(65);
    });
  }

  it('open when Mars leads Earth by the Hohmann angle, to the minute', () => {
    for (const w of launchWindows('earth', 'mars', 2020)) {
      expect(targetLead('earth', 'mars', w.at)! - w.phaseDeg).toBeCloseTo(0, 2);
      expect(targetLead('earth', 'mars', w.at + 30 * DAY)!).toBeLessThan(w.phaseDeg); // Earth, faster, catches up
    }
  });

  it('come every 26 months or so, so some calendar years have none (2021, 2126)', () => {
    const all = Array.from({ length: 20 }, (_, i) => launchWindows('earth', 'mars', 2011 + i)).flat().map((w) => w.at);
    for (let i = 1; i < all.length; i++) expect(days(all[i], all[i - 1])).toBeGreaterThan(740);
    for (let i = 1; i < all.length; i++) expect(days(all[i], all[i - 1])).toBeLessThan(820);
    expect(launchWindows('earth', 'mars', 2021)).toEqual([]);
    expect(launchWindows('earth', 'mars', 2126)).toEqual([]);
  });

  it('after 2126 begins, the next is in March 2127', () => {
    const w = nextLaunchWindow('earth', 'mars', Date.UTC(2126, 0, 1))!;
    expect(new Date(w.at).toISOString().slice(0, 7)).toBe('2127-03');
  });

  it('exist only between two planets', () => {
    expect(launchWindows('earth', 'moon', 2026)).toEqual([]);
    expect(launchWindows('earth', 'earth', 2026)).toEqual([]);
    expect(launchWindows('earth', 'nowhere', 2026)).toEqual([]);
    expect(targetLead('earth', 'europa', 0)).toBeNull();
  });
});
