import { describe as group, expect, it } from 'vitest';
import type { KeyDown } from './shortcuts';
import { opensShortcuts, songKey, type SongKeyContext } from './songKeys';

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

// A Song page at rest: nothing open, nothing recording, a Take can be recorded.
const idle: SongKeyContext = {
  busy: false,
  dialogOpen: false,
  inTextField: false,
  ownsSpace: false,
  ownsHomeEnd: false,
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

  it('waits while a Beat is picked, the Latency Offset calibrated or a Mixdown made', () => {
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

  it('waits while a Beat is picked, the Latency Offset calibrated or a Mixdown made', () => {
    expect(songKey(press('r'), { ...idle, busy: true })).toBeNull();
  });
});

group('S', () => {
  it('splits at the playhead, whether or not Caps Lock is on', () => {
    expect(songKey(press('s'), idle)).toBe('split');
    expect(songKey(press('S'), idle)).toBe('split');
  });

  it('is left alone when held down, handled already, typed, with a modifier, or on a read-only Timeline', () => {
    expect(songKey(press('s', { repeat: true }), idle)).toBeNull();
    expect(songKey(press('s', { defaultPrevented: true }), idle)).toBeNull();
    expect(songKey(press('s'), { ...idle, inTextField: true })).toBeNull();
    expect(songKey(press('s', { ctrlKey: true }), idle)).toBeNull();
    expect(songKey(press('S', { shiftKey: true }), idle)).toBeNull();
    expect(songKey(press('s'), { ...idle, editable: false })).toBeNull();
  });

  it('waits while recording, a Beat is picked, the Latency Offset calibrated, a Mixdown made or a dialog is open', () => {
    expect(songKey(press('s'), { ...idle, recording: true, canRecord: false })).toBeNull();
    expect(songKey(press('s'), { ...idle, busy: true })).toBeNull();
    expect(songKey(press('s'), { ...idle, dialogOpen: true })).toBeNull();
  });
});

group('Home and End', () => {
  it('go to the start and the end', () => {
    expect(songKey(press('Home'), idle)).toBe('start');
    expect(songKey(press('End'), idle)).toBe('end');
  });

  it('go on going while held down, so the page never scrolls instead', () => {
    expect(songKey(press('Home', { repeat: true }), idle)).toBe('start');
    expect(songKey(press('End', { repeat: true }), idle)).toBe('end');
  });

  it('work in Read mode and on a phone, since moving the playhead is no edit', () => {
    expect(songKey(press('Home'), { ...idle, editable: false })).toBe('start');
    expect(songKey(press('End'), { ...idle, editable: false })).toBe('end');
  });

  it('are left to a text field, a menu or a control whose Home and End are its own, e.g. a volume slider', () => {
    expect(songKey(press('Home'), { ...idle, inTextField: true })).toBeNull();
    expect(songKey(press('End'), { ...idle, inTextField: true })).toBeNull();
    expect(songKey(press('Home'), { ...idle, ownsHomeEnd: true })).toBeNull();
    expect(songKey(press('End'), { ...idle, ownsHomeEnd: true })).toBeNull();
  });

  it('are left alone in a dialog, handled already, or with a modifier', () => {
    expect(songKey(press('Home'), { ...idle, dialogOpen: true })).toBeNull();
    expect(songKey(press('End'), { ...idle, dialogOpen: true })).toBeNull();
    expect(songKey(press('Home', { defaultPrevented: true }), idle)).toBeNull();
    expect(songKey(press('Home', { shiftKey: true }), idle)).toBeNull();
    expect(songKey(press('End', { ctrlKey: true }), idle)).toBeNull();
  });

  it('wait while recording, which plays from where it started, or while a Beat is picked', () => {
    expect(songKey(press('Home'), { ...idle, recording: true, canRecord: false })).toBeNull();
    expect(songKey(press('End'), { ...idle, busy: true })).toBeNull();
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

  it('wait while a Beat is picked, the Latency Offset calibrated or a Mixdown made', () => {
    expect(songKey(press('z', { ctrlKey: true }), { ...idle, busy: true })).toBeNull();
  });

  it('need Ctrl or ⌘', () => {
    expect(songKey(press('z'), idle)).toBeNull();
  });
});

group('Exact modifiers', () => {
  it("Shift+Space doesn't play and Shift+R doesn't record", () => {
    expect(songKey(press(' ', { shiftKey: true }), idle)).toBeNull();
    expect(songKey(press('R', { shiftKey: true }), idle)).toBeNull();
  });

  it('Mod+Y redoes, as Ctrl+Y or ⌘Y, on every platform', () => {
    expect(songKey(press('y', { ctrlKey: true }), idle)).toBe('redo');
    expect(songKey(press('y', { metaKey: true }), idle)).toBe('redo');
  });

  it("Mod+Shift+Y, Ctrl+⌘Y and Ctrl+⌘Z don't", () => {
    expect(songKey(press('Y', { ctrlKey: true, shiftKey: true }), idle)).toBeNull();
    expect(songKey(press('Y', { metaKey: true, shiftKey: true }), idle)).toBeNull();
    expect(songKey(press('y', { ctrlKey: true, metaKey: true }), idle)).toBeNull();
    expect(songKey(press('z', { ctrlKey: true, metaKey: true }), idle)).toBeNull();
  });
});

group('An open dialog', () => {
  it('stops Space, R, undo and redo', () => {
    const open = { ...idle, dialogOpen: true };
    expect(songKey(press(' '), open)).toBeNull();
    expect(songKey(press('r'), open)).toBeNull();
    expect(songKey(press('z', { ctrlKey: true }), open)).toBeNull();
    expect(songKey(press('Z', { ctrlKey: true, shiftKey: true }), open)).toBeNull();
    expect(songKey(press('y', { ctrlKey: true }), open)).toBeNull();
  });
});

group('?', () => {
  const nowhere = { dialogOpen: false, inTextField: false };

  it('opens the shortcuts dialog, typed with Shift or on a key of its own', () => {
    expect(opensShortcuts(press('?', { shiftKey: true }), nowhere)).toBe(true);
    expect(opensShortcuts(press('?'), nowhere)).toBe(true);
  });

  it('is typed in a text field instead', () => {
    expect(opensShortcuts(press('?', { shiftKey: true }), { ...nowhere, inTextField: true })).toBe(false);
  });

  it('is left alone while a dialog is open, when held down, or handled already', () => {
    expect(opensShortcuts(press('?'), { ...nowhere, dialogOpen: true })).toBe(false);
    expect(opensShortcuts(press('?', { repeat: true }), nowhere)).toBe(false);
    expect(opensShortcuts(press('?', { defaultPrevented: true }), nowhere)).toBe(false);
  });

  it('is only ? itself: not /, nor ? with Ctrl, ⌘ or Alt', () => {
    expect(opensShortcuts(press('/'), nowhere)).toBe(false);
    expect(opensShortcuts(press('?', { ctrlKey: true }), nowhere)).toBe(false);
    expect(opensShortcuts(press('?', { metaKey: true }), nowhere)).toBe(false);
    expect(opensShortcuts(press('?', { altKey: true }), nowhere)).toBe(false);
  });
});
