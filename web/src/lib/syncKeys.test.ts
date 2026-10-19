// @vitest-environment happy-dom
// Deciding which Shortcut a press is asks where it was pressed, which reads
// the page's elements.
import { describe as group, expect, it } from 'vitest';
import type { ShortcutPress } from './shortcutPress';
import { cuesNextLine } from './syncKeys';

// Which Shortcut a press is, where it was pressed and the repeat rule are
// shortcutPress.ts's, and tested there.
const press = (key: string, mods: Partial<Omit<ShortcutPress, 'key'>> = {}): ShortcutPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  target: null,
  ...mods,
});

group('Enter', () => {
  it('cues the next Line in Sync mode', () => {
    expect(cuesNextLine(press('Enter'), true)).toBe(true);
  });

  it('does nothing outside Sync mode', () => {
    expect(cuesNextLine(press('Enter'), false)).toBe(false);
  });

  it('is the only key that cues', () => {
    expect(cuesNextLine(press(' '), true)).toBe(false);
    expect(cuesNextLine(press('n'), true)).toBe(false);
  });
});
