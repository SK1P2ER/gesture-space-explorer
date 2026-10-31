import { departureById, type Booking } from './booking';
import { destinationById } from './destinations';

// Travel memories (decision 21): the passport's journey stamps and what a postcard says. A journey
// stamp is a completed booking, nothing else: only the booking's state machine (landing at the
// booked destination after lifting off for it) can make one. Pure, so it can be tested.

const HOUR_MS = 3_600_000;

/** When a journey arrived, in the story: its departure plus the liner's crossing (fiction). */
export const arrivalAt = (b: Booking) => departureById(b.departure)!.at + destinationById(b.to)!.hours * HOUR_MS;

/** The journey stamps: completed bookings, earliest arrival first. */
export const stamps = (bookings: readonly Booking[]) =>
  bookings.filter((b) => b.status === 'completed').sort((a, b) => arrivalAt(a) - arrivalAt(b) || a.createdAt - b.createdAt);

/**
 * Text broken into lines no wider than `max`, by `measure` (a canvas's measureText in the app).
 * Breaks at spaces; a word wider than a line (Burmese and Japanese have few spaces) is broken by
 * character. At most `limit` lines, the last ending in "…" when text is left over.
 */
export function wrapLines(text: string, max: number, measure: (s: string) => number, limit = 3): string[] {
  const lines: string[] = [];
  let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of text.split(' ')) {
    const tried = line ? `${line} ${word}` : word;
    if (measure(tried) <= max) { line = tried; continue; }
    push();
    for (const ch of Array.from(word)) {
      if (measure(line + ch) > max) push();
      line += ch;
    }
  }
  push();
  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  let last = kept[limit - 1];
  while (last && measure(`${last}…`) > max) last = Array.from(last).slice(0, -1).join('');
  kept[limit - 1] = `${last}…`;
  return kept;
}
