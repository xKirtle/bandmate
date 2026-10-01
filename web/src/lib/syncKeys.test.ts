import { describe as group, expect, it } from 'vitest';
import { cueNudge, cuesNextLine, type CueNextContext, type SyncKeyPress } from './syncKeys';

const press = (key: string, mods: Partial<Omit<SyncKeyPress, 'key'>> = {}): SyncKeyPress => ({
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

group('Alt+↑/↓', () => {
  it('nudges a Cue later with ↑ and earlier with ↓', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true }))).toBe(1);
    expect(cueNudge(press('ArrowDown', { altKey: true }))).toBe(-1);
  });

  it('needs Alt', () => {
    expect(cueNudge(press('ArrowUp'))).toBeNull();
    expect(cueNudge(press('ArrowDown'))).toBeNull();
  });

  it('is left alone with Ctrl or ⌘ as well', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(cueNudge(press('ArrowDown', { altKey: true, metaKey: true }))).toBeNull();
  });

  it('nudges with Shift held too', () => {
    expect(cueNudge(press('ArrowUp', { altKey: true, shiftKey: true }))).toBe(1);
    expect(cueNudge(press('ArrowDown', { altKey: true, shiftKey: true }))).toBe(-1);
  });

  it('is only ↑ and ↓', () => {
    expect(cueNudge(press('ArrowLeft', { altKey: true }))).toBeNull();
    expect(cueNudge(press('ArrowRight', { altKey: true }))).toBeNull();
  });
});
