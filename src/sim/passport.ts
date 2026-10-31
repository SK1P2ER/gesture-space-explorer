// The passport: a stamp for each base you've been to (the date of your first
// visit). Pure; settings.ts keeps it in localStorage.

export type Passport = Readonly<Record<string, number>>;

/** Whatever was stored → a passport (anything malformed is dropped, never thrown). */
export function parsePassport(text: string | null | undefined, knownIds: readonly string[]): Passport {
  if (!text) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const [id, ms] of Object.entries(data)) if (knownIds.includes(id) && typeof ms === 'number' && Number.isFinite(ms)) out[id] = ms;
  return out;
}

/** Stamp a base (only the first visit counts). */
export function stamp(p: Passport, baseId: string, ms: number): { passport: Passport; isNew: boolean } {
  if (baseId in p) return { passport: p, isNew: false };
  return { passport: { ...p, [baseId]: ms }, isNew: true };
}
