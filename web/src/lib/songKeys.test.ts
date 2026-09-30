import { describe as group, expect, it } from 'vitest';
import { songKey, type SongKeyPress, type SongKeyContext } from './songKeys';

const press = (key: string, mods: Partial<Omit<SongKeyPress, 'key'>> = {}): SongKeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  ...mods,
});

// A Song page at rest: nothing open, nothing recording, a Take can be recorded.
const idle: SongKeyContext = {
  busy: false,
  dialogOpen: false,
  inTextField: false,
  ownsSpace: false,
  editable: true,
  recording: false,
  capturing: false,
  canRecord: true,
};

group('Space', () => {
  it('plays or pauses', () => {
    expect(songKey(press(' '), idle)).toBe('playPause');
  });

  it('is left alone when held down, handled already, or with Ctrl, ⌘ or Alt', () => {
    expect(songKey(press(' ', { repeat: true }), idle)).toBeNull();
    expect(songKey(press(' ', { defaultPrevented: true }), idle)).toBeNull();
    expect(songKey(press(' ', { ctrlKey: true }), idle)).toBeNull();
    expect(songKey(press(' ', { metaKey: true }), idle)).toBeNull();
    expect(songKey(press(' ', { altKey: true }), idle)).toBeNull();
  });

  it('is left to what owns it, e.g. a text field or a checkbox', () => {
    expect(songKey(press(' '), { ...idle, ownsSpace: true })).toBeNull();
  });

  it('waits while a Beat is picked, the latency calibrated or a mixdown made', () => {
    expect(songKey(press(' '), { ...idle, busy: true })).toBeNull();
  });

  it('plays on a phone too, where the Timeline is read-only', () => {
    expect(songKey(press(' '), { ...idle, editable: false })).toBe('playPause');
  });

  it('stops a recording', () => {
    expect(songKey(press(' '), { ...idle, recording: true, capturing: true, canRecord: false })).toBe('playPause');
  });
});

group('R', () => {
  it('records, whether or not Caps Lock is on', () => {
    expect(songKey(press('r'), idle)).toBe('record');
    expect(songKey(press('R'), idle)).toBe('record');
  });

  it('stops a recording', () => {
    expect(songKey(press('r'), { ...idle, recording: true, capturing: true, canRecord: false })).toBe('record');
  });

  it("is left alone when a Take can't be recorded", () => {
    expect(songKey(press('r'), { ...idle, canRecord: false })).toBeNull();
  });

  it('is left alone when held down, handled already, typed, or with Ctrl, ⌘ or Alt', () => {
    expect(songKey(press('r', { repeat: true }), idle)).toBeNull();
    expect(songKey(press('r', { defaultPrevented: true }), idle)).toBeNull();
    expect(songKey(press('r'), { ...idle, inTextField: true })).toBeNull();
    expect(songKey(press('r', { ctrlKey: true }), idle)).toBeNull();
    expect(songKey(press('r', { metaKey: true }), idle)).toBeNull();
    expect(songKey(press('r', { altKey: true }), idle)).toBeNull();
  });

  it('waits while a Beat is picked, the latency calibrated or a mixdown made', () => {
    expect(songKey(press('r'), { ...idle, busy: true })).toBeNull();
  });
});

group('Undo and redo', () => {
  it('undo with Ctrl+Z or ⌘Z', () => {
    expect(songKey(press('z', { ctrlKey: true }), idle)).toBe('undo');
    expect(songKey(press('z', { metaKey: true }), idle)).toBe('undo');
  });

  it('redo with Ctrl+Shift+Z or ⌘⇧Z', () => {
    expect(songKey(press('Z', { ctrlKey: true, shiftKey: true }), idle)).toBe('redo');
    expect(songKey(press('Z', { metaKey: true, shiftKey: true }), idle)).toBe('redo');
  });

  it('are left alone with Alt, handled already, typed, or on a read-only Timeline', () => {
    expect(songKey(press('z', { ctrlKey: true, altKey: true }), idle)).toBeNull();
    expect(songKey(press('z', { ctrlKey: true, defaultPrevented: true }), idle)).toBeNull();
    expect(songKey(press('z', { ctrlKey: true }), { ...idle, inTextField: true })).toBeNull();
    expect(songKey(press('z', { ctrlKey: true }), { ...idle, editable: false })).toBeNull();
  });

  it('wait while recording, which undo would take the place of', () => {
    expect(songKey(press('z', { ctrlKey: true }), { ...idle, recording: true, canRecord: false })).toBeNull();
  });

  it('wait while a Beat is picked, the latency calibrated or a mixdown made', () => {
    expect(songKey(press('z', { ctrlKey: true }), { ...idle, busy: true })).toBeNull();
  });

  it('need Ctrl or ⌘', () => {
    expect(songKey(press('z'), idle)).toBeNull();
  });
});

group("Today's loose modifiers, to be made exact", () => {
  it('Shift+Space plays and Shift+R records', () => {
    expect(songKey(press(' ', { shiftKey: true }), idle)).toBe('playPause');
    expect(songKey(press('R', { shiftKey: true }), idle)).toBe('record');
  });
});
