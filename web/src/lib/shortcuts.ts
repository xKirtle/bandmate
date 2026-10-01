/**
 * The Song page's Shortcuts, the one place their keys are defined. Handlers
 * ask it whether a key is a Shortcut's, and keep their own guards, e.g.
 * against key repeat or typing in a text field.
 */

/**
 * One of a Shortcut's keys: a `KeyboardEvent.key`, or `drag` or `wheel`
 * for a mouse Shortcut, held with exactly these modifiers. Mod is Ctrl or
 * ⌘, either on any platform, shown as ⌘ on a Mac; Ctrl is the Control key
 * itself, on a Mac too, e.g. for Ctrl+Y, which a Mac browser keeps ⌘Y from.
 */
export type Key = { key: string; mod?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean };

/** Where a Shortcut is listed in the shortcuts dialog. */
export type ShortcutGroup = 'Playback & recording' | 'Timeline editing' | 'Sync mode' | 'Mouse';

type Described = {
  name: string;
  group: ShortcutGroup;
  /** One line, saying what it does. */
  description: string;
};

/**
 * A Shortcut, with its default keys. A two-way one, e.g. seeking, has keys
 * for going back and keys for going forward.
 */
export type Shortcut = Described & (OneWay | TwoWay);

/** The keys of a Shortcut that does one thing, e.g. Record. */
export type OneWay = { keys: readonly Key[] };

/** The keys of a Shortcut that goes back or forward, e.g. seeking. */
export type TwoWay = { back: readonly Key[]; forward: readonly Key[] };

/** Every Shortcut on the Song page, in the order the shortcuts dialog lists them. */
export const shortcuts = {
  playPause: {
    name: 'Play or pause',
    group: 'Playback & recording',
    description: 'Plays or pauses the Timeline, or stops a recording.',
    keys: [{ key: ' ' }],
  },
  record: {
    name: 'Record',
    group: 'Playback & recording',
    description: 'Records a Take on the Chosen Track, or stops recording.',
    keys: [{ key: 'r' }],
  },
  undo: {
    name: 'Undo',
    group: 'Timeline editing',
    description: 'Undoes the last edit to the Timeline or a Cue.',
    keys: [{ key: 'z', mod: true }],
  },
  redo: {
    name: 'Redo',
    group: 'Timeline editing',
    description: 'Redoes the last edit undone.',
    keys: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', ctrl: true },
    ],
  },
  deleteClip: {
    name: 'Delete a Clip',
    group: 'Timeline editing',
    description: 'Deletes the focused Clip.',
    keys: [{ key: 'Delete' }, { key: 'Backspace' }],
  },
  clipMenu: {
    name: "Open a Clip's menu",
    group: 'Timeline editing',
    description: "Opens the focused Clip's ⋯ menu.",
    keys: [{ key: 'F10', shift: true }, { key: 'ContextMenu' }],
  },
  seek: {
    name: 'Seek back or forward 5 s',
    group: 'Timeline editing',
    description: 'Moves the playhead 5 seconds, from the ruler.',
    back: [{ key: 'ArrowLeft' }, { key: 'ArrowDown' }],
    forward: [{ key: 'ArrowRight' }, { key: 'ArrowUp' }],
  },
  seekFar: {
    name: 'Seek back or forward 15 s',
    group: 'Timeline editing',
    description: 'Moves the playhead 15 seconds, from the ruler.',
    back: [
      { key: 'ArrowLeft', shift: true },
      { key: 'ArrowDown', shift: true },
    ],
    forward: [
      { key: 'ArrowRight', shift: true },
      { key: 'ArrowUp', shift: true },
    ],
  },
  startOrEnd: {
    name: 'Go to the start or end',
    group: 'Timeline editing',
    description: 'Moves the playhead to the start or the end, from the ruler.',
    back: [{ key: 'Home' }],
    forward: [{ key: 'End' }],
  },
  step: {
    name: "Step a menu's number field by its step",
    group: 'Timeline editing',
    description: "Steps a number in a ⋯ menu down or up, e.g. a Take's Nudge.",
    back: [{ key: 'ArrowLeft', alt: true }],
    forward: [{ key: 'ArrowRight', alt: true }],
  },
  shiftStep: {
    name: "Step a menu's number field by its Shift step",
    group: 'Timeline editing',
    description: 'Steps a number in a ⋯ menu down or up by more.',
    back: [{ key: 'ArrowLeft', alt: true, shift: true }],
    forward: [{ key: 'ArrowRight', alt: true, shift: true }],
  },
  cueNextLine: {
    name: 'Cue the next Line',
    group: 'Sync mode',
    description: 'Cues the next Line at the playhead.',
    keys: [{ key: 'Enter' }],
  },
  nudgeCue: {
    name: 'Nudge a Cue by 0.1 s',
    group: 'Sync mode',
    description: 'Moves the focused Cue 0.1 seconds earlier or later.',
    back: [{ key: 'ArrowDown', alt: true }],
    forward: [{ key: 'ArrowUp', alt: true }],
  },
  slip: {
    name: 'Slip a Take inside its Clip',
    group: 'Mouse',
    description: 'Moves the Take inside the Clip being dragged, keeping the Clip where it is.',
    keys: [{ key: 'drag', alt: true }],
  },
  skipSnapping: {
    name: 'Skip snapping',
    group: 'Mouse',
    description: 'Lets a Clip or the Loop being dragged go anywhere, snapping to nothing.',
    keys: [{ key: 'drag', shift: true }],
  },
  zoom: {
    name: 'Zoom the Timeline',
    group: 'Mouse',
    description: 'Zooms the Timeline in or out around the pointer.',
    // What a trackpad's pinch sends, too.
    keys: [{ key: 'wheel', ctrl: true }],
  },
} as const satisfies Record<string, Shortcut>;

/**
 * The key that opens the shortcuts dialog. It's the dialog's own key, so
 * the dialog doesn't list it: its button's tooltip names it. Rebinding
 * Shortcuts would need to count it as taken.
 */
export const shortcutsDialogKeys: readonly Key[] = [{ key: '?' }];

/** A key press, or a mouse action given as `drag` or `wheel`. */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Letters, and keys that name themselves, e.g. Space and ArrowLeft, which Shift doesn't change. */
function shiftCounts(key: string): boolean {
  return key.length > 1 || key === ' ' || key.toLowerCase() !== key.toUpperCase();
}

function same(pressed: KeyPress, key: Key): boolean {
  if (pressed.key.toLowerCase() !== key.key.toLowerCase()) return false;
  // Mod is one modifier: Ctrl or ⌘, not both.
  if (pressed.ctrlKey && pressed.metaKey) return false;
  if (key.ctrl) {
    if (!pressed.ctrlKey) return false;
  } else if ((pressed.ctrlKey || pressed.metaKey) !== !!key.mod) return false;
  if (pressed.altKey !== !!key.alt) return false;
  // A symbol, e.g. the ? that opens the shortcuts dialog, may take Shift
  // to type, which is then part of it.
  return !shiftCounts(key.key) || pressed.shiftKey === !!key.shift;
}

/** Whether a key press is one of `keys`, with exactly its modifiers. */
export function matches(pressed: KeyPress, keys: readonly Key[]): boolean {
  return keys.some((key) => same(pressed, key));
}

/** Which way a key press sends a two-way Shortcut, or null if it isn't one of its keys. */
export function way(pressed: KeyPress, shortcut: TwoWay): 'back' | 'forward' | null {
  if (matches(pressed, shortcut.back)) return 'back';
  return matches(pressed, shortcut.forward) ? 'forward' : null;
}

/** Which modifiers a platform's labels show: a Mac's symbols, or words elsewhere. */
export type Platform = 'mac' | 'other';

/** The platform this browser runs on. */
export function platform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform: string } };
  return /mac/i.test(nav.userAgentData?.platform ?? nav.platform) ? 'mac' : 'other';
}

// Keys shown by a symbol or a shorter name than their own.
const names: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ContextMenu: 'Menu',
};

const mouse = ['drag', 'wheel'];

/** A key's own name, without its modifiers, e.g. Z, Space or ArrowLeft. */
function keyName(key: Key): string {
  if (key.key === ' ') return 'Space';
  return key.key.length === 1 ? key.key.toUpperCase() : key.key;
}

function keyLabel(key: Key, on: Platform): string {
  const name = names[key.key] ?? keyName(key);
  if (on === 'mac') {
    const mods = (key.mod ? '⌘' : '') + (key.ctrl ? '⌃' : '') + (key.alt ? '⌥' : '') + (key.shift ? '⇧' : '');
    // "⌥drag" would read as one word.
    return mods && mouse.includes(key.key) ? `${mods}+${name}` : mods + name;
  }
  return [(key.mod || key.ctrl) && 'Ctrl', key.alt && 'Alt', key.shift && 'Shift', name].filter(Boolean).join('+');
}

/** Names `keys` for a platform, e.g. "⌘⇧Z or ⌘Y" on a Mac and "Ctrl+Shift+Z or Ctrl+Y" elsewhere. */
export function keysLabel(keys: readonly Key[], on: Platform): string {
  return keys.map((key) => keyLabel(key, on)).join(' or ');
}

/** Which of a two-way Shortcut's ways is named first. */
export type FirstWay = 'back' | 'forward';

/** Every key of two-way Shortcuts, e.g. for `aria-keyshortcuts`: each one's back keys then its forward keys, or forward first. */
export function allKeys(ways: readonly TwoWay[], first: FirstWay = 'back'): Key[] {
  return ways.flatMap((s) => (first === 'back' ? [...s.back, ...s.forward] : [...s.forward, ...s.back]));
}

/** Names a two-way Shortcut's keys for a platform, e.g. "Alt+← or Alt+→", back first unless asked otherwise. */
export function twoWayLabel(shortcut: TwoWay, on: Platform, first: FirstWay = 'back'): string {
  return keysLabel(allKeys([shortcut], first), on);
}

/** Declares `keys` for `aria-keyshortcuts`, with Mod as the platform's modifier and Ctrl as Control. */
export function ariaKeyShortcuts(keys: readonly Key[], on: Platform): string {
  return keys
    .map((key) =>
      [
        ((key.mod && on === 'other') || key.ctrl) && 'Control',
        key.mod && on === 'mac' && 'Meta',
        key.alt && 'Alt',
        key.shift && 'Shift',
        keyName(key),
      ]
        .filter(Boolean)
        .join('+'),
    )
    .join(' ');
}
