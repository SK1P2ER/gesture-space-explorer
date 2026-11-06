/** The ?flags= features on. `?al` is short for `?flags=astrolife`, so a souvenir link stays short (decision 26). */
export function parseFlags(search: string): ReadonlySet<string> {
  const q = new URLSearchParams(search);
  const flags = new Set((q.get('flags') ?? '').split(',').filter(Boolean));
  if (q.has('al')) flags.add('astrolife');
  return flags;
}
