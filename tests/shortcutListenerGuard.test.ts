import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('requires review of every global keydown listener and routes action handlers through shared ownership', () => {
  const registrations: Record<string, string[]> = {};
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) { scan(path); continue; }
      if (!path.endsWith('.ts')) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/(?<![\w.])(?:window\.)?addEventListener\(\s*([^,\n]+)/g)) {
        const argument = match[1].trim();
        if (argument === "'keydown'" || !/^['"]/.test(argument)) (registrations[path] ??= []).push(argument);
      }
    }
  }
  scan('src');
  expect(registrations).toEqual({
    'src/app/debugTools.ts': ["'keydown'", "'keydown'"],
    'src/input/keyboard.ts': ["'keydown'"],
    // These owners consume Escape only while their own drawer/view is open;
    // scene ownership must not block the owner's own dismissal key.
    'src/ui/chrome.ts': ["'keydown'", 'type'],
    'src/ui/cleanView.ts': ["'keydown'"],
    // Passive observer: audio unlock only observes first user input.
    'src/ui/photo.ts': ["'keydown'"],
  });
  for (const [path, count] of [['src/app/debugTools.ts', 2], ['src/input/keyboard.ts', 1]] as const) {
    const source = readFileSync(path, 'utf8');
    expect([...source.matchAll(/if \(!canHandleShortcut\(/g)]).toHaveLength(count);
    expect(source).toMatch(/import \{ canHandleShortcut \} from .*shortcutOwnership/);
  }
});
