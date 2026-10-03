import { describe as group, expect, it } from 'vitest';
import {
  allKeys,
  ariaKeyShortcuts,
  keysLabel,
  matches,
  shortcuts,
  stepBy,
  twoWayLabel,
  way,
  type Key,
  type KeyPress,
} from './shortcuts';

const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

group('matches', () => {
  it('matches a key with its exact modifiers', () => {
    expect(matches(press('r'), [{ key: 'r' }])).toBe(true);
    expect(matches(press('R', { shiftKey: true }), [{ key: 'r' }])).toBe(false);
    expect(matches(press('r', { altKey: true }), [{ key: 'r' }])).toBe(false);
    expect(matches(press('r', { ctrlKey: true }), [{ key: 'r' }])).toBe(false);
    expect(matches(press('R', { shiftKey: true }), [{ key: 'r', shift: true }])).toBe(true);
    expect(matches(press('r'), [{ key: 'r', shift: true }])).toBe(false);
  });

  it('matches a letter whether or not Caps Lock is on', () => {
    expect(matches(press('R'), [{ key: 'r' }])).toBe(true);
  });

  it('takes Mod as Ctrl or ⌘, either on any platform, but not both', () => {
    const undo = [{ key: 'z', mod: true }];
    expect(matches(press('z', { ctrlKey: true }), undo)).toBe(true);
    expect(matches(press('z', { metaKey: true }), undo)).toBe(true);
    expect(matches(press('z'), undo)).toBe(false);
    expect(matches(press('z', { ctrlKey: true, metaKey: true }), undo)).toBe(false);
  });

  it('matches any of several keys', () => {
    const redo = [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ];
    expect(matches(press('Z', { ctrlKey: true, shiftKey: true }), redo)).toBe(true);
    expect(matches(press('y', { ctrlKey: true }), redo)).toBe(true);
    expect(matches(press('y', { metaKey: true }), redo)).toBe(true);
    expect(matches(press('z', { ctrlKey: true }), redo)).toBe(false);
    expect(matches(press('Y', { ctrlKey: true, shiftKey: true }), redo)).toBe(false);
  });

  it('matches named keys, e.g. Space and the arrows, with their modifiers', () => {
    expect(matches(press(' '), [{ key: ' ' }])).toBe(true);
    expect(matches(press(' ', { shiftKey: true }), [{ key: ' ' }])).toBe(false);
    expect(matches(press('ArrowLeft', { altKey: true, shiftKey: true }), [{ key: 'ArrowLeft', alt: true }])).toBe(
      false,
    );
  });

  it("takes Shift as part of a symbol it's typed with, e.g. ?", () => {
    expect(matches(press('?', { shiftKey: true }), [{ key: '?' }])).toBe(true);
    expect(matches(press('?'), [{ key: '?' }])).toBe(true);
    expect(matches(press('?', { ctrlKey: true, shiftKey: true }), [{ key: '?' }])).toBe(false);
  });

  it('matches a mouse Shortcut by its modifiers', () => {
    expect(matches(press('drag', { altKey: true }), [{ key: 'drag', alt: true }])).toBe(true);
    expect(matches(press('drag', { altKey: true, shiftKey: true }), [{ key: 'drag', alt: true }])).toBe(false);
  });
});

group('keysLabel', () => {
  const redo = [
    { key: 'z', mod: true, shift: true },
    { key: 'y', mod: true },
  ];

  it('names modifiers with symbols on a Mac', () => {
    expect(keysLabel([{ key: 'z', mod: true }], 'mac')).toBe('⌘Z');
    expect(keysLabel(redo, 'mac')).toBe('⌘⇧Z or ⌘Y');
    expect(keysLabel([{ key: 'ArrowLeft', alt: true, shift: true }], 'mac')).toBe('⌥⇧←');
  });

  it('names modifiers in words elsewhere', () => {
    expect(keysLabel([{ key: 'z', mod: true }], 'other')).toBe('Ctrl+Z');
    expect(keysLabel(redo, 'other')).toBe('Ctrl+Shift+Z or Ctrl+Y');
    expect(keysLabel([{ key: 'ArrowLeft', alt: true, shift: true }], 'other')).toBe('Alt+Shift+←');
  });

  it('names keys that have no character of their own', () => {
    expect(keysLabel([{ key: ' ' }], 'other')).toBe('Space');
    expect(keysLabel([{ key: 'r' }], 'mac')).toBe('R');
    expect(keysLabel([{ key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'ArrowRight' }], 'other')).toBe('↑ or ↓ or →');
    expect(keysLabel([{ key: 'F10', shift: true }, { key: 'ContextMenu' }], 'mac')).toBe('⇧F10 or Menu');
    expect(keysLabel([{ key: 'Delete' }, { key: 'Backspace' }], 'other')).toBe('Delete or Backspace');
  });

  it('names mouse Shortcuts by their modifier', () => {
    expect(keysLabel([{ key: 'drag', alt: true }], 'other')).toBe('Alt+drag');
    expect(keysLabel([{ key: 'drag', alt: true }], 'mac')).toBe('⌥+drag');
    expect(keysLabel([{ key: 'wheel', mod: true }], 'mac')).toBe('⌘+wheel');
    expect(keysLabel([{ key: 'wheel', mod: true }], 'other')).toBe('Ctrl+wheel');
  });
});

group('The list', () => {
  const label = (keys: readonly Key[]) => keysLabel(keys, 'other');
  const listed = Object.values(shortcuts).map((s) => ({
    name: s.name,
    group: s.group,
    keys: 'keys' in s ? label(s.keys) : `${label(s.back)} / ${label(s.forward)}`,
  }));

  it('holds every Shortcut on the Song page, with its group and default keys', () => {
    expect(listed).toEqual([
      { name: 'Play or pause', group: 'Playback & recording', keys: 'Space' },
      { name: 'Record', group: 'Playback & recording', keys: 'R' },
      { name: 'Undo', group: 'Timeline editing', keys: 'Ctrl+Z' },
      { name: 'Redo', group: 'Timeline editing', keys: 'Ctrl+Shift+Z or Ctrl+Y' },
      { name: 'Delete a Clip', group: 'Timeline editing', keys: 'Delete or Backspace' },
      { name: "Open a Clip's menu", group: 'Timeline editing', keys: 'Shift+F10 or Menu' },
      { name: 'Seek back or forward 5 s', group: 'Timeline editing', keys: '← or ↓ / → or ↑' },
      { name: 'Seek back or forward 15 s', group: 'Timeline editing', keys: 'Shift+← or Shift+↓ / Shift+→ or Shift+↑' },
      { name: 'Go to the start or end', group: 'Timeline editing', keys: 'Home / End' },
      { name: 'Nudge a Cue by 0.1 s', group: 'Timeline editing', keys: 'Alt+↓ / Alt+↑' },
      { name: 'Select every Clip', group: 'Timeline editing', keys: 'Ctrl+A' },
      { name: 'Clear the Selection', group: 'Timeline editing', keys: 'Esc' },
      { name: 'Copy the Selection', group: 'Timeline editing', keys: 'Ctrl+C' },
      { name: 'Cut the Selection', group: 'Timeline editing', keys: 'Ctrl+X' },
      { name: 'Paste the Clipboard', group: 'Timeline editing', keys: 'Ctrl+V' },
      { name: 'Split at the playhead', group: 'Timeline editing', keys: 'S' },
      { name: 'Cue the next Line', group: 'Sync mode', keys: 'Enter' },
      { name: 'Add or remove a Clip', group: 'Mouse', keys: 'Ctrl+click' },
      { name: 'Select Clips with a box', group: 'Mouse', keys: 'drag' },
      { name: 'Add Clips with a box', group: 'Mouse', keys: 'Ctrl+drag' },
      { name: 'Nudge a Take inside its Clip', group: 'Mouse', keys: 'Alt+drag' },
      { name: 'Skip snapping', group: 'Mouse', keys: 'Shift+drag' },
      { name: 'Zoom the Timeline', group: 'Mouse', keys: 'Ctrl+wheel' },
    ]);
  });

  it('names Mod ⌘ on a Mac', () => {
    expect(keysLabel(shortcuts.undo.keys, 'mac')).toBe('⌘Z');
    expect(keysLabel(shortcuts.redo.keys, 'mac')).toBe('⌘⇧Z or ⌘Y');
    expect(keysLabel(shortcuts.zoom.keys, 'mac')).toBe('⌘+wheel');
    expect(keysLabel(shortcuts.toggleClip.keys, 'mac')).toBe('⌘+click');
    expect(keysLabel(shortcuts.selectAll.keys, 'mac')).toBe('⌘A');
  });

  it('describes every Shortcut in one line', () => {
    for (const s of Object.values(shortcuts)) expect(s.description).toMatch(/^[^\n]+\.$/);
  });
});

group('way', () => {
  it('tells which way a two-way Shortcut goes, if its key was pressed', () => {
    expect(way(press('ArrowDown'), shortcuts.seek)).toBe('back');
    expect(way(press('ArrowUp'), shortcuts.seek)).toBe('forward');
    expect(way(press('ArrowUp', { shiftKey: true }), shortcuts.seek)).toBeNull();
    expect(way(press('ArrowUp', { shiftKey: true }), shortcuts.seekFar)).toBe('forward');
  });
});

group('stepBy', () => {
  const seeks = [
    [shortcuts.seek, 5],
    [shortcuts.seekFar, 15],
  ] as const;

  it('steps by the amount of the two-way Shortcut pressed, back as a negative one', () => {
    expect(stepBy(press('ArrowLeft'), seeks)).toBe(-5);
    expect(stepBy(press('ArrowUp'), seeks)).toBe(5);
    expect(stepBy(press('ArrowDown', { shiftKey: true }), seeks)).toBe(-15);
    expect(stepBy(press('ArrowRight', { shiftKey: true }), seeks)).toBe(15);
  });

  it('steps by the first of them whose key was pressed', () => {
    expect(
      stepBy(press('ArrowLeft'), [
        [shortcuts.seek, 5],
        [shortcuts.seek, 1],
      ]),
    ).toBe(-5);
  });

  it("doesn't step for a key that isn't one of their keys", () => {
    expect(stepBy(press('Home'), seeks)).toBeNull();
    expect(stepBy(press('ArrowLeft', { altKey: true }), seeks)).toBeNull();
    expect(stepBy(press('ArrowLeft'), [])).toBeNull();
  });
});

group('ariaKeyShortcuts', () => {
  it("declares each key with the platform's modifier for Mod", () => {
    const redo = [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ];
    expect(ariaKeyShortcuts(redo, 'mac')).toBe('Meta+Shift+Z Meta+Y');
    expect(ariaKeyShortcuts(redo, 'other')).toBe('Control+Shift+Z Control+Y');
    expect(ariaKeyShortcuts([{ key: ' ' }], 'other')).toBe('Space');
    expect(ariaKeyShortcuts([{ key: 'ArrowLeft', alt: true }], 'other')).toBe('Alt+ArrowLeft');
  });
});

group('allKeys', () => {
  it("gives two-way Shortcuts' keys, each one's back keys then its forward keys", () => {
    expect(allKeys([shortcuts.startOrEnd, shortcuts.nudgeCue])).toEqual([
      { key: 'Home' },
      { key: 'End' },
      { key: 'ArrowDown', alt: true },
      { key: 'ArrowUp', alt: true },
    ]);
  });

  it('gives the forward keys first when asked', () => {
    expect(allKeys([shortcuts.nudgeCue], 'forward')).toEqual([
      { key: 'ArrowUp', alt: true },
      { key: 'ArrowDown', alt: true },
    ]);
  });
});

group('twoWayLabel', () => {
  it("names a two-way Shortcut's keys, back then forward, for a platform", () => {
    expect(twoWayLabel(shortcuts.nudgeCue, 'other')).toBe('Alt+↓ or Alt+↑');
    expect(twoWayLabel(shortcuts.seekFar, 'mac')).toBe('⇧← or ⇧↓ or ⇧→ or ⇧↑');
  });

  it('names the forward keys first when asked', () => {
    expect(twoWayLabel(shortcuts.nudgeCue, 'mac', 'forward')).toBe('⌥↑ or ⌥↓');
  });
});
