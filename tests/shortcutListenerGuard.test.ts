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
    // Passive observers: idle wake never dispatches actions; audio unlock observes first user input.
    'src/ui/chrome.ts': ['type'], 'src/ui/photo.ts': ["'keydown'"],
    // Esc goes back a screen, only while the AstroLife shell's modal layer is open, when no scene shortcut
    // can run (shortcutOwnership.ts sees aria-modal). Global, because a click on the backdrop leaves focus on <body>.
    'src/shell/shell.ts': ["'keydown'"],
  });
  for (const [path, count] of [['src/app/debugTools.ts', 2], ['src/input/keyboard.ts', 1]] as const) {
    const source = readFileSync(path, 'utf8');
    expect([...source.matchAll(/if \(!canHandleShortcut\(/g)]).toHaveLength(count);
    expect(source).toMatch(/import \{ canHandleShortcut \} from .*shortcutOwnership/);
  }
});
