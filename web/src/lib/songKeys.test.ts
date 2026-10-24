// @vitest-environment happy-dom
// Deciding which Shortcut a press is asks where it was pressed, which reads
// the page's elements.
import { describe as group, expect, it } from 'vitest';
import type { ShortcutPress } from './shortcutPress';
import { togglesAutoScroll, opensShortcuts, songKey, undoKey, type SongKeyContext } from './songKeys';

// Which Shortcut a press is, where it was pressed and the repeat rule are
// shortcutPress.ts's, and tested there: these are the rules about what each
// Shortcut does on the Song page, and when.
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

// A Song page at rest: nothing recording, a Take can be recorded.
const idle: SongKeyContext = {
  busy: false,
  editable: true,
  recording: false,
  capturing: false,
  canRecord: true,
};

group('Space', () => {
  it('plays or pauses', () => {
    expect(songKey(press(' '), idle)).toBe('playPause');
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
  it('records', () => {
    expect(songKey(press('r'), idle)).toBe('record');
  });

  it('stops a recording', () => {
    expect(songKey(press('r'), { ...idle, recording: true, capturing: true, canRecord: false })).toBe('record');
  });

  it("is left alone when a Take can't be recorded", () => {
    expect(songKey(press('r'), { ...idle, canRecord: false })).toBeNull();
  });

  it('waits while a Beat is picked, the Latency Offset calibrated or a Mixdown made', () => {
    expect(songKey(press('r'), { ...idle, busy: true })).toBeNull();
  });
});

group('S', () => {
  it('splits at the playhead', () => {
    expect(songKey(press('s'), idle)).toBe('split');
  });

  it('is left alone on a read-only Timeline, e.g. on a phone', () => {
    expect(songKey(press('s'), { ...idle, editable: false })).toBeNull();
  });

  it('waits while recording, a Beat is picked, the Latency Offset calibrated or a Mixdown made', () => {
    expect(songKey(press('s'), { ...idle, recording: true, canRecord: false })).toBeNull();
    expect(songKey(press('s'), { ...idle, busy: true })).toBeNull();
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

  it('are taken while recording, though the playhead stays where it started', () => {
    expect(songKey(press('Home'), { ...idle, recording: true, capturing: true, canRecord: false })).toBe('start');
  });

  it('wait while a Beat is picked, the Latency Offset calibrated or a Mixdown made', () => {
    expect(songKey(press('End'), { ...idle, busy: true })).toBeNull();
  });
});

group('Undo and redo', () => {
  it('undo with Ctrl+Z or ⌘Z', () => {
    expect(undoKey(press('z', { ctrlKey: true }))).toBe('undo');
    expect(undoKey(press('z', { metaKey: true }))).toBe('undo');
  });

  it('redo with Ctrl+Shift+Z or Ctrl+Y', () => {
    expect(undoKey(press('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoKey(press('y', { ctrlKey: true }))).toBe('redo');
  });

  it("aren't the Timeline's keys, so a phone or Read mode undoes too", () => {
    expect(songKey(press('z', { ctrlKey: true }), idle)).toBeNull();
    expect(songKey(press('y', { ctrlKey: true }), idle)).toBeNull();
  });
});

group('?', () => {
  it('opens the shortcuts dialog', () => {
    expect(opensShortcuts(press('?', { shiftKey: true }))).toBe(true);
    expect(opensShortcuts(press('?'))).toBe(true);
  });

  it('is the only key that opens it', () => {
    expect(opensShortcuts(press('/'))).toBe(false);
    expect(opensShortcuts(press(' '))).toBe(false);
  });
});

group('A', () => {
  it('starts or pauses Auto-scroll', () => {
    expect(togglesAutoScroll(press('a'))).toBe(true);
    // Caps Lock on.
    expect(togglesAutoScroll(press('A'))).toBe(true);
  });

  it("isn't Ctrl+A, which selects every Clip, nor Space, which stays the Timeline's", () => {
    expect(togglesAutoScroll(press('a', { ctrlKey: true }))).toBe(false);
    expect(togglesAutoScroll(press(' '))).toBe(false);
    expect(songKey(press('a'), idle)).toBeNull();
  });

  it('is left to a text field or a dialog it was pressed in', () => {
    const field = document.createElement('input');
    expect(togglesAutoScroll(press('a', { target: field }))).toBe(false);
    const dialog = document.createElement('dialog');
    const button = dialog.appendChild(document.createElement('button'));
    expect(togglesAutoScroll(press('a', { target: button }))).toBe(false);
  });
});
