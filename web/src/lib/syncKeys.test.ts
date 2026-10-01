import { describe as group, expect, it } from 'vitest';
import type { KeyDown } from './shortcuts';
import { cuesNextLine, type CueNextContext } from './syncKeys';

const press = (key: string, mods: Partial<Omit<KeyDown, 'key'>> = {}): KeyDown => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  ...mods,
});

// Sync mode on, with focus on the Lyric Sheet, e.g. on a button.
const syncing: CueNextContext = { syncing: true, inTextField: false, inDialogOrMenu: false };

group('Enter', () => {
  it('cues the next Line in Sync mode', () => {
    expect(cuesNextLine(press('Enter'), syncing)).toBe(true);
  });

  it('does nothing outside Sync mode', () => {
    expect(cuesNextLine(press('Enter'), { ...syncing, syncing: false })).toBe(false);
  });

  it('is left alone when held down or handled already', () => {
    expect(cuesNextLine(press('Enter', { repeat: true }), syncing)).toBe(false);
    expect(cuesNextLine(press('Enter', { defaultPrevented: true }), syncing)).toBe(false);
  });

  it('is left alone with Ctrl, ⌘, Alt or Shift', () => {
    expect(cuesNextLine(press('Enter', { ctrlKey: true }), syncing)).toBe(false);
    expect(cuesNextLine(press('Enter', { metaKey: true }), syncing)).toBe(false);
    expect(cuesNextLine(press('Enter', { altKey: true }), syncing)).toBe(false);
    expect(cuesNextLine(press('Enter', { shiftKey: true }), syncing)).toBe(false);
  });

  it('is left to a text field, a dialog or a ⋯ menu', () => {
    expect(cuesNextLine(press('Enter'), { ...syncing, inTextField: true })).toBe(false);
    expect(cuesNextLine(press('Enter'), { ...syncing, inDialogOrMenu: true })).toBe(false);
  });

  it('is the only key that cues', () => {
    expect(cuesNextLine(press(' '), syncing)).toBe(false);
    expect(cuesNextLine(press('n'), syncing)).toBe(false);
  });
});
