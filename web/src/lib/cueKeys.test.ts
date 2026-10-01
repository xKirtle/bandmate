import { describe as group, expect, it } from 'vitest';
import { cueNudge, cueNudgeHint } from './cueKeys';
import { KeyHints } from './keyHints';
import type { KeyPress } from './shortcuts';

const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

// In Write mode, not syncing.
const writing = false;

group('Alt+↑/↓', () => {
  it('nudges a Cue later with ↑ and earlier with ↓ in Write mode', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true }), writing)).toBe(1);
    expect(cueNudge(press('ArrowDown', { altKey: true }), writing)).toBe(-1);
  });

  it('does nothing in Sync mode, which only cues', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true }), true)).toBeNull();
    expect(cueNudge(press('ArrowDown', { altKey: true }), true)).toBeNull();
  });

  it('needs Alt', () => {
    expect(cueNudge(press('ArrowUp'), writing)).toBeNull();
    expect(cueNudge(press('ArrowDown'), writing)).toBeNull();
  });

  it('is left alone with Ctrl or ⌘ as well', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true, ctrlKey: true }), writing)).toBeNull();
    expect(cueNudge(press('ArrowDown', { altKey: true, metaKey: true }), writing)).toBeNull();
  });

  it('is left alone with Shift as well, its modifiers being exact', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true, shiftKey: true }), writing)).toBeNull();
    expect(cueNudge(press('ArrowDown', { altKey: true, shiftKey: true }), writing)).toBeNull();
  });

  it('is only ↑ and ↓', () => {
    expect(cueNudge(press('ArrowLeft', { altKey: true }), writing)).toBeNull();
    expect(cueNudge(press('ArrowRight', { altKey: true }), writing)).toBeNull();
  });
});

group('The nudge hint', () => {
  const desktop = (on: 'mac' | 'other' = 'other') => new KeyHints(on, () => true);

  it('names the keys that nudge a Cue in Write mode, later first, for its tooltip and aria-keyshortcuts', () => {
    expect(cueNudgeHint(desktop(), writing)).toEqual({ label: 'Alt+↑ or Alt+↓', aria: 'Alt+ArrowUp Alt+ArrowDown' });
    expect(cueNudgeHint(desktop('mac'), writing).label).toBe('⌥↑ or ⌥↓');
  });

  it('names no keys in Sync mode, where they do nothing', () => {
    expect(cueNudgeHint(desktop(), true)).toEqual({ label: null, aria: undefined });
  });

  it('names no keys without a fine pointer', () => {
    expect(cueNudgeHint(new KeyHints('other', () => false), writing)).toEqual({ label: null, aria: undefined });
  });
});
