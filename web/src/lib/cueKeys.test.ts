// @vitest-environment happy-dom
// Deciding which Shortcut a press is asks where it was pressed, which reads
// the page's elements.
import { describe as group, expect, it } from 'vitest';
import { cueNudge, cueNudgeHint } from './cueKeys';
import { KeyHints } from './keyHints';
import { rebind } from './shortcutKeysFake';
import type { ShortcutPress } from './shortcutPress';

// Which Shortcut a press is, and that holding the keys goes on nudging,
// are shortcutPress.ts's, and tested there.
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

// In Write mode, or in Sync mode.
const writing = false;
const syncing = true;

group('Alt+↑/↓', () => {
  it('nudges a Cue later with ↑ and earlier with ↓ in Write mode', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true }), writing)).toBe(1);
    expect(cueNudge(press('ArrowDown', { altKey: true }), writing)).toBe(-1);
  });

  it('does nothing in Sync mode, which only cues', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true }), syncing)).toBeNull();
    expect(cueNudge(press('ArrowDown', { altKey: true }), syncing)).toBeNull();
  });

  it('goes on nudging while the keys are held', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true, repeat: true }), writing)).toBe(1);
    expect(cueNudge(press('ArrowDown', { altKey: true, repeat: true }), writing)).toBe(-1);
  });

  it("is only the Cue nudge's keys: the plain arrows are the field's own", () => {
    expect(cueNudge(press('ArrowUp'), writing)).toBeNull();
    expect(cueNudge(press('ArrowLeft', { altKey: true }), writing)).toBeNull();
    expect(cueNudge(press('Enter'), writing)).toBeNull();
  });
});

group('The nudge hint', () => {
  const desktop = (on: 'mac' | 'other' = 'other') => new KeyHints(on, () => true);

  it('names the keys that nudge a Cue in Write mode, later first, for its tooltip and aria-keyshortcuts', () => {
    expect(cueNudgeHint(desktop(), writing)).toEqual({ label: 'Alt+↑ or Alt+↓', aria: 'Alt+ArrowUp Alt+ArrowDown' });
    expect(cueNudgeHint(desktop('mac'), writing).label).toBe('⌥↑ or ⌥↓');
  });

  it('names no keys in Sync mode, where they do nothing', () => {
    expect(cueNudgeHint(desktop(), syncing)).toEqual({ label: null, aria: undefined });
  });

  it('names no keys on a phone or a narrow window', () => {
    expect(cueNudgeHint(new KeyHints('other', () => false), writing)).toEqual({ label: null, aria: undefined });
  });

  it('names the keys chosen on this device', () => {
    rebind({ nudgeCue: { back: [{ key: ',' }], forward: [{ key: '.' }] } });
    expect(cueNudgeHint(desktop(), writing)).toEqual({ label: '. or ,', aria: '. ,' });
  });
});
