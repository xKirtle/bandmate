import { afterEach, describe as group, expect, it } from 'vitest';
import type { KeyDown } from './shortcuts';
import type { KeyPlace } from './keyPlace';
import { defaultKeyset, followKeys, type Keyset } from './shortcutKeys';
import { opensShortcuts, songKey, undoKey, type SongKeyContext } from './songKeys';

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
  ownsArrows: false,
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

  it('are taken while recording, so the page never scrolls, though the playhead stays', () => {
    expect(songKey(press('Home'), { ...idle, recording: true, capturing: true, canRecord: false })).toBe('start');
  });

  it('wait while a Beat is picked, the Latency Offset calibrated or a Mixdown made', () => {
    expect(songKey(press('End'), { ...idle, busy: true })).toBeNull();
  });
});

group('Undo and redo', () => {
  // The Song page at rest, for its Undo and Redo keys.
  const calm: KeyPlace = { dialogOpen: false, inTextField: false, ownsArrows: false };

  it('undo with Ctrl+Z or ⌘Z', () => {
    expect(undoKey(press('z', { ctrlKey: true }), calm)).toBe('undo');
    expect(undoKey(press('z', { metaKey: true }), calm)).toBe('undo');
  });

  it('redo with Ctrl+Shift+Z or ⌘⇧Z', () => {
    expect(undoKey(press('Z', { ctrlKey: true, shiftKey: true }), calm)).toBe('redo');
    expect(undoKey(press('Z', { metaKey: true, shiftKey: true }), calm)).toBe('redo');
  });

  it('redo with Ctrl+Y or ⌘Y, on every platform', () => {
    expect(undoKey(press('y', { ctrlKey: true }), calm)).toBe('redo');
    expect(undoKey(press('y', { metaKey: true }), calm)).toBe('redo');
  });

  it('are left alone with Alt, handled already, or typed, where the field undoes its own typing', () => {
    expect(undoKey(press('z', { ctrlKey: true, altKey: true }), calm)).toBeNull();
    expect(undoKey(press('z', { ctrlKey: true, defaultPrevented: true }), calm)).toBeNull();
    expect(undoKey(press('z', { ctrlKey: true }), { ...calm, inTextField: true })).toBeNull();
  });

  it('are left to an open dialog, e.g. picking a Beat or making a Mixdown', () => {
    expect(undoKey(press('z', { ctrlKey: true }), { ...calm, dialogOpen: true })).toBeNull();
    expect(undoKey(press('Z', { ctrlKey: true, shiftKey: true }), { ...calm, dialogOpen: true })).toBeNull();
    expect(undoKey(press('y', { ctrlKey: true }), { ...calm, dialogOpen: true })).toBeNull();
  });

  it('need Ctrl or ⌘', () => {
    expect(undoKey(press('z'), calm)).toBeNull();
  });

  it("Mod+Shift+Y, Ctrl+⌘Y and Ctrl+⌘Z don't", () => {
    expect(undoKey(press('Y', { ctrlKey: true, shiftKey: true }), calm)).toBeNull();
    expect(undoKey(press('Y', { metaKey: true, shiftKey: true }), calm)).toBeNull();
    expect(undoKey(press('y', { ctrlKey: true, metaKey: true }), calm)).toBeNull();
    expect(undoKey(press('z', { ctrlKey: true, metaKey: true }), calm)).toBeNull();
  });

  it("aren't the Timeline's keys any more, so a phone or Read mode undoes too", () => {
    expect(songKey(press('z', { ctrlKey: true }), idle)).toBeNull();
    expect(songKey(press('y', { ctrlKey: true }), idle)).toBeNull();
  });
});

group('Exact modifiers', () => {
  it("Shift+Space doesn't play and Shift+R doesn't record", () => {
    expect(songKey(press(' ', { shiftKey: true }), idle)).toBeNull();
    expect(songKey(press('R', { shiftKey: true }), idle)).toBeNull();
  });
});

group('An open dialog', () => {
  it('stops Space and R', () => {
    const open = { ...idle, dialogOpen: true };
    expect(songKey(press(' '), open)).toBeNull();
    expect(songKey(press('r'), open)).toBeNull();
  });
});

group('Keys as rebound', () => {
  afterEach(() => followKeys(() => defaultKeyset));
  const rebind = (changes: Partial<Keyset>) => followKeys(() => ({ ...defaultKeyset, ...changes }));

  it('acts on the keys chosen on this device, and no longer on the defaults', () => {
    rebind({ record: { keys: [{ key: 't' }] }, undo: { keys: [{ key: 'u', alt: true }] } });
    expect(songKey(press('t'), idle)).toBe('record');
    expect(songKey(press('r'), idle)).toBeNull();
    expect(undoKey(press('u', { altKey: true }), idle)).toBe('undo');
    expect(undoKey(press('z', { ctrlKey: true }), idle)).toBeNull();
  });

  it('opens the shortcuts dialog with no key at all once it has none', () => {
    rebind({ showShortcuts: { keys: [] } });
    expect(opensShortcuts(press('?'), idle)).toBe(false);
  });

  it('leaves arrows chosen to a focused control that uses them, e.g. a number box or a list', () => {
    rebind({
      record: { keys: [{ key: 'ArrowUp' }] },
      undo: { keys: [{ key: 'ArrowLeft', alt: true }] },
      showShortcuts: { keys: [{ key: 'ArrowDown', shift: true }] },
    });
    expect(songKey(press('ArrowUp'), idle)).toBe('record');
    expect(songKey(press('ArrowUp'), { ...idle, ownsArrows: true })).toBeNull();
    expect(undoKey(press('ArrowLeft', { altKey: true }), { ...idle, ownsArrows: true })).toBeNull();
    expect(opensShortcuts(press('ArrowDown', { shiftKey: true }), { ...idle, ownsArrows: true })).toBe(false);
    expect(opensShortcuts(press('ArrowDown', { shiftKey: true }), idle)).toBe(true);
  });

  it('leaves Home, End and Space chosen to a focused control that uses them, as their own Shortcuts do', () => {
    rebind({ startOrEnd: { back: [{ key: 'b' }], forward: [{ key: 'e' }] }, record: { keys: [{ key: 'Home' }] } });
    expect(songKey(press('Home'), idle)).toBe('record');
    expect(songKey(press('Home'), { ...idle, ownsHomeEnd: true })).toBeNull();
  });

  it("act where Space, Home or End would be the control's, once their Shortcuts have other keys, but not in a text field", () => {
    rebind({ playPause: { keys: [{ key: 'p' }] }, startOrEnd: { back: [{ key: 'b' }], forward: [{ key: 'e' }] } });
    expect(songKey(press('p'), { ...idle, ownsSpace: true })).toBe('playPause');
    expect(songKey(press('e'), { ...idle, ownsHomeEnd: true })).toBe('end');
    expect(songKey(press('p'), { ...idle, ownsSpace: true, inTextField: true })).toBeNull();
    expect(songKey(press('b'), { ...idle, ownsHomeEnd: true, inTextField: true })).toBeNull();
  });
});

group('?', () => {
  const nowhere = { dialogOpen: false, inTextField: false, ownsArrows: false };

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
