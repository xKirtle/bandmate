/**
 * The Song page's Shortcuts, the one place they and their default keys are
 * defined, with whether each goes on while its keys are held. Which
 * Shortcut a press is, by the keys as rebound on this device (see
 * shortcutKeys.ts), is decided in one place from here (see
 * shortcutPress.ts); handlers keep only what each Shortcut does and when.
 *
 * No two Shortcuts may hold the same key, which rebinding refuses: the
 * three handlers the Song page listens with each hear every press, and
 * only a key one Shortcut has keeps them from acting on one another's.
 */

/**
 * One of a Shortcut's keys: a `KeyboardEvent.key`, or `click`, `drag` or
 * `wheel` for a mouse Shortcut, held with exactly these modifiers. Mod is Ctrl or
 * ⌘, either on any platform, shown as ⌘ on a Mac.
 */
export type Key = { key: string; mod?: boolean; alt?: boolean; shift?: boolean };

/** Where a Shortcut is listed, in the shortcuts dialog and Settings' Shortcuts tab. */
export type ShortcutGroup = 'Playback & recording' | 'Song editing' | 'Timeline editing' | 'Sync mode' | 'Mouse';

type Described = {
  name: string;
  group: ShortcutGroup;
  /** One line, saying what it does. */
  description: string;
  /** Where it works, finishing "Works in …", e.g. "the ruler, once it has focus." */
  worksIn: string;
  /**
   * Whether holding its keys down does it again and again. A Shortcut
   * declares it where holding it is the point, like scanning the Song or
   * walking a Cue into place, or where the key must be kept while it's
   * held, so the browser doesn't act on the repeats instead. Every other
   * one is done once, however long its keys are held.
   */
  repeats?: true;
};

/**
 * A Shortcut, with its default keys. A two-way one, e.g. seeking, has keys
 * for going back and keys for going forward.
 */
export type Shortcut = Described & (OneWay | TwoWay);

/** The keys of a Shortcut that does one thing, e.g. Record. */
export type OneWay = { keys: readonly Key[] };

/** The keys of a Shortcut that goes back or forward, e.g. seeking, or of a control's own two-way keys, e.g. a number box's ↓/↑. */
export type TwoWay = { back: readonly Key[]; forward: readonly Key[] };

/** Every Shortcut on the Song page, in the order the shortcuts dialog and the Shortcuts tab list them. */
export const shortcuts = {
  playPause: {
    name: 'Play or pause',
    group: 'Playback & recording',
    description: 'Plays or pauses the Timeline, or stops a recording.',
    worksIn:
      'any part of the Song page but a dialog, or a control that takes Space itself, like a text field or a checkbox.',
    keys: [{ key: ' ' }],
  },
  record: {
    name: 'Record',
    group: 'Playback & recording',
    description: 'Records a Take on the Chosen Track, or stops recording.',
    worksIn: 'any part of the Song page but a text field or a dialog.',
    keys: [{ key: 'r' }],
  },
  startOrEnd: {
    name: 'Go to the start or end',
    group: 'Playback & recording',
    description: 'Moves the playhead to the start or the end.',
    worksIn: 'any part of the Song page but a text field, a list, a slider, a menu or a dialog.',
    // Not to go to the start twice, which changes nothing, but to keep the
    // key while it's held, so the browser never scrolls the page instead.
    repeats: true,
    back: [{ key: 'Home' }],
    forward: [{ key: 'End' }],
  },
  undo: {
    name: 'Undo',
    group: 'Song editing',
    description: 'Undoes the last edit to the Song.',
    worksIn: 'any part of the Song page but a text field or a dialog, in Read mode too.',
    keys: [{ key: 'z', mod: true }],
  },
  redo: {
    name: 'Redo',
    group: 'Song editing',
    description: 'Redoes the last edit to the Song that was undone.',
    worksIn: 'any part of the Song page but a text field or a dialog, in Read mode too.',
    keys: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ],
  },
  showShortcuts: {
    name: 'Show the Shortcuts',
    group: 'Song editing',
    description: 'Opens the shortcuts dialog, which lists every Shortcut.',
    worksIn: 'any part of the Song page but a text field or a dialog.',
    // The keyboard button opens the dialog too, whatever this key is.
    keys: [{ key: '?' }],
  },
  deleteClip: {
    name: 'Delete a Clip',
    group: 'Timeline editing',
    description: 'Deletes the selected Clips, or, on a focused Clip outside the Selection, that Clip alone.',
    worksIn: 'the Timeline, outside a text field.',
    keys: [{ key: 'Delete' }, { key: 'Backspace' }],
  },
  clipMenu: {
    name: "Open a Clip's menu",
    group: 'Timeline editing',
    description: "Opens the focused Clip's ⋯ menu.",
    worksIn: 'a focused Clip.',
    keys: [{ key: 'F10', shift: true }, { key: 'ContextMenu' }],
  },
  seek: {
    name: 'Seek back or forward 5 s',
    group: 'Timeline editing',
    description: 'Moves the playhead 5 seconds.',
    worksIn: 'the ruler, once it has focus.',
    // Held down, it scans the Song, 5 s a repeat.
    repeats: true,
    back: [{ key: 'ArrowLeft' }, { key: 'ArrowDown' }],
    forward: [{ key: 'ArrowRight' }, { key: 'ArrowUp' }],
  },
  seekFar: {
    name: 'Seek back or forward 15 s',
    group: 'Timeline editing',
    description: 'Moves the playhead 15 seconds.',
    worksIn: 'the ruler, once it has focus.',
    // Held down, it scans the Song faster, 15 s a repeat.
    repeats: true,
    back: [
      { key: 'ArrowLeft', shift: true },
      { key: 'ArrowDown', shift: true },
    ],
    forward: [
      { key: 'ArrowRight', shift: true },
      { key: 'ArrowUp', shift: true },
    ],
  },
  nudgeCue: {
    name: 'Nudge a Cue by 0.1 s',
    group: 'Timeline editing',
    description: 'Moves the focused Cue time 0.1 seconds earlier or later.',
    worksIn: 'a focused Cue time, in Write mode.',
    // Held down, it goes on nudging: that's how a Cue is walked into place.
    repeats: true,
    back: [{ key: 'ArrowDown', alt: true }],
    forward: [{ key: 'ArrowUp', alt: true }],
  },
  selectAll: {
    name: 'Select every Clip',
    group: 'Timeline editing',
    description: 'Selects every Clip.',
    worksIn: 'the Timeline, outside a text field.',
    keys: [{ key: 'a', mod: true }],
  },
  clearSelection: {
    name: 'Clear the Selection',
    group: 'Timeline editing',
    description: 'Clears the Selection, so no Clip is selected.',
    worksIn: 'the Timeline, outside a text field.',
    keys: [{ key: 'Escape' }],
  },
  copyClips: {
    name: 'Copy the Selection',
    group: 'Timeline editing',
    description: 'Copies every selected Clip, to paste on this Song.',
    worksIn: 'the Timeline, outside a text field.',
    keys: [{ key: 'c', mod: true }],
  },
  cutClips: {
    name: 'Cut the Selection',
    group: 'Timeline editing',
    description: 'Copies every selected Clip, then deletes them.',
    worksIn: 'the Timeline, outside a text field.',
    keys: [{ key: 'x', mod: true }],
  },
  pasteClips: {
    name: 'Paste the Clipboard',
    group: 'Timeline editing',
    description:
      'Pastes the Clips last copied or cut at the playhead on the Chosen Track, both of which a click on empty lane space sets, or later where they fit, and selects them.',
    worksIn: 'the Timeline, outside a text field.',
    keys: [{ key: 'v', mod: true }],
  },
  splitClips: {
    name: 'Split at the playhead',
    group: 'Timeline editing',
    description:
      "Splits each selected Clip the playhead crosses in two there, or with none selected, the Chosen Track's Clip under it.",
    worksIn: 'any part of the Song page but a text field or a dialog, while editing and not recording.',
    keys: [{ key: 's' }],
  },
  cueNextLine: {
    name: 'Cue the next Line',
    group: 'Sync mode',
    description: 'Cues the next Line at the playhead.',
    worksIn: 'Sync mode, in any part of the Song page but a text field, a dialog or a menu.',
    keys: [{ key: 'Enter' }],
  },
  toggleClip: {
    name: 'Add or remove a Clip',
    group: 'Mouse',
    description: 'Adds the Clip clicked to the Selection, or takes it out, leaving the Chosen Track as it is.',
    worksIn: 'a Clip on the Timeline.',
    keys: [{ key: 'click', mod: true }],
  },
  boxSelect: {
    name: 'Select Clips with a box',
    group: 'Mouse',
    description: 'Selects every Clip the box drawn touches, leaving the Chosen Track and the playhead as they are.',
    worksIn: 'empty lane space on the Timeline.',
    keys: [{ key: 'drag' }],
  },
  addBox: {
    name: 'Add Clips with a box',
    group: 'Mouse',
    description: 'Adds every Clip the box drawn touches to the Selection.',
    worksIn: 'empty lane space on the Timeline.',
    keys: [{ key: 'drag', mod: true }],
  },
  nudgeClip: {
    name: "Nudge a Clip's audio inside it",
    group: 'Mouse',
    description: 'Moves the audio inside the Clip being dragged, whatever it holds, keeping the Clip where it is.',
    worksIn: 'any Clip being dragged.',
    keys: [{ key: 'drag', alt: true }],
  },
  skipSnapping: {
    name: 'Skip snapping',
    group: 'Mouse',
    description:
      "Lets a Clip or the Loop being dragged go anywhere, snapping to nothing, or a Clip's gain line move in fine steps.",
    worksIn: 'a Clip, its gain line or the Loop being dragged.',
    keys: [{ key: 'drag', shift: true }],
  },
  zoom: {
    name: 'Zoom the Timeline',
    group: 'Mouse',
    description: 'Zooms the Timeline in or out around the pointer. Pinching always zooms too.',
    worksIn: "the Timeline's lanes and its scroll bar.",
    // A trackpad's pinch zooms too, whatever these are: a browser sends
    // it as a Ctrl wheel event.
    keys: [{ key: 'wheel', mod: true }],
  },
} as const satisfies Record<string, Shortcut>;

/**
 * A key press, or a mouse action given as `click`, `drag` or `wheel`, and
 * where the key pressed sits on the keyboard (`KeyboardEvent.code`), if
 * it's a key.
 */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> &
  Partial<Pick<KeyboardEvent, 'code'>>;

/**
 * A key press as a handler hears it: whether it's a held key's repeat, and
 * whether a handler before it has taken it.
 */
export type KeyDown = KeyPress & Pick<KeyboardEvent, 'repeat' | 'defaultPrevented'>;

/** Letters, and keys that name themselves, e.g. Space and ArrowLeft, which Shift doesn't change. */
export function shiftCounts(key: string): boolean {
  return key.length > 1 || key === ' ' || key.toLowerCase() !== key.toUpperCase();
}

const isLetter = (key: string) => key.length === 1 && key.toLowerCase() !== key.toUpperCase();

/**
 * The key a press stands for, without its modifiers: the letter printed
 * on it, so on AZERTY the key labelled A is A. Where a Mac's Option turns
 * a letter into a symbol (⌥R types ®) or an accent to come, it's the
 * letter at the key's place instead.
 */
export function pressedKey(pressed: KeyPress): string {
  const place = /^Key([A-Z])$/.exec(pressed.code ?? '');
  if (pressed.altKey && place && !isLetter(pressed.key)) return place[1].toLowerCase();
  return pressed.key;
}

function same(pressed: KeyPress, key: Key): boolean {
  if (pressedKey(pressed).toLowerCase() !== key.key.toLowerCase()) return false;
  // Mod is one modifier: Ctrl or ⌘, not both.
  if (pressed.ctrlKey && pressed.metaKey) return false;
  if ((pressed.ctrlKey || pressed.metaKey) !== !!key.mod) return false;
  if (pressed.altKey !== !!key.alt) return false;
  // A symbol, e.g. the ? that opens the shortcuts dialog, may take Shift
  // to type, which is then part of it.
  return !shiftCounts(key.key) || pressed.shiftKey === !!key.shift;
}

/** Whether two keys are one, with the same modifiers, e.g. two Shortcuts' keys. */
export function sameKey(a: Key, b: Key): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false;
  if (!!a.mod !== !!b.mod || !!a.alt !== !!b.alt) return false;
  return !shiftCounts(a.key) || !!a.shift === !!b.shift;
}

/** Whether a key press is one of `keys`, with exactly its modifiers. */
export function matches(pressed: KeyPress, keys: readonly Key[]): boolean {
  return keys.some((key) => same(pressed, key));
}

/** A way a two-way Shortcut goes. */
export type Way = 'back' | 'forward';

/** Which way a key press sends a two-way Shortcut, or null if it isn't one of its keys. */
export function way(pressed: KeyPress, shortcut: TwoWay): Way | null {
  if (matches(pressed, shortcut.back)) return 'back';
  return matches(pressed, shortcut.forward) ? 'forward' : null;
}

/** A two-way Shortcut and the amount it steps a value by, e.g. seeking and 5 s. */
export type Step = readonly [shortcut: TwoWay, amount: number];

/**
 * How far a key press steps a value, given `steps`, e.g. seeking 5 s or
 * 15 s: the amount of the first whose key it is, negative going back, or
 * null if the press is none of their keys.
 */
export function stepBy(pressed: KeyPress, steps: readonly Step[]): number | null {
  for (const [shortcut, amount] of steps) {
    const going = way(pressed, shortcut);
    if (going) return going === 'back' ? -amount : amount;
  }
  return null;
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
  Escape: 'Esc',
};

/** A mouse action a mouse Shortcut's key names: a click, a drag or a turn of the wheel. */
export type Gesture = 'click' | 'drag' | 'wheel';

const gestures: readonly string[] = ['click', 'drag', 'wheel'] satisfies Gesture[];

/** Whether a key is a mouse action, rather than a key on the keyboard. */
export function isGesture(key: string): key is Gesture {
  return gestures.includes(key);
}

/** Whether a key is held with no modifier at all. */
export function holdsNothing(key: Key): boolean {
  return !key.mod && !key.alt && !key.shift;
}

/** A key's own name, without its modifiers, e.g. Z, Space or ArrowLeft. */
function keyName(key: Key): string {
  if (key.key === ' ') return 'Space';
  return key.key.length === 1 ? key.key.toUpperCase() : key.key;
}

/** The modifiers a key is held with, as a platform names them: "⌘⇧" on a Mac, "Ctrl+Shift" elsewhere. */
function modsLabel(key: Key, on: Platform): string {
  if (on === 'mac') return (key.mod ? '⌘' : '') + (key.alt ? '⌥' : '') + (key.shift ? '⇧' : '');
  return [key.mod && 'Ctrl', key.alt && 'Alt', key.shift && 'Shift'].filter(Boolean).join('+');
}

function keyLabel(key: Key, on: Platform): string {
  const name = names[key.key] ?? keyName(key);
  const mods = modsLabel(key, on);
  if (!mods) return name;
  // On a Mac, "⌥drag" would read as one word.
  return on === 'mac' && !isGesture(key.key) ? mods + name : `${mods}+${name}`;
}

/** Names `keys` for a platform, e.g. "⌘⇧Z or ⌘Y" on a Mac and "Ctrl+Shift+Z or Ctrl+Y" elsewhere. */
export function keysLabel(keys: readonly Key[], on: Platform): string {
  return keys.map((key) => keyLabel(key, on)).join(' or ');
}

/** A modifier a key or a mouse Shortcut is held with: Mod (Ctrl or ⌘), Alt (⌥) or Shift (⇧). */
export type Modifier = 'mod' | 'alt' | 'shift';

/** Every modifier, in the order they're named. */
export const modifiers: readonly Modifier[] = ['mod', 'alt', 'shift'];

/** Names a modifier for a platform: in words, and with its symbol on a Mac, e.g. "⌥ Option". */
export function modifierName(modifier: Modifier, on: Platform): string {
  if (on === 'mac') return { mod: '⌘ Cmd', alt: '⌥ Option', shift: '⇧ Shift' }[modifier];
  return { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' }[modifier];
}

/** Names only what's held with each of a mouse Shortcut's keys, e.g. "Shift", or "⇧" on a Mac. */
export function heldLabel(keys: readonly Key[], on: Platform): string {
  return keys.map((key) => modsLabel(key, on)).join(' or ');
}

/** Which of a two-way Shortcut's ways is named first. */
export type FirstWay = Way;

/** Every key of two-way Shortcuts, e.g. for `aria-keyshortcuts`: each one's back keys then its forward keys, or forward first. */
export function allKeys(ways: readonly TwoWay[], first: FirstWay = 'back'): Key[] {
  return ways.flatMap((s) => (first === 'back' ? [...s.back, ...s.forward] : [...s.forward, ...s.back]));
}

/** Names a two-way Shortcut's keys for a platform, e.g. "Alt+↓ or Alt+↑", back first unless asked otherwise. */
export function twoWayLabel(shortcut: TwoWay, on: Platform, first: FirstWay = 'back'): string {
  return keysLabel(allKeys([shortcut], first), on);
}

/** Declares `keys` for `aria-keyshortcuts`, with Mod as the platform's modifier. */
export function ariaKeyShortcuts(keys: readonly Key[], on: Platform): string {
  return keys
    .map((key) =>
      [key.mod && (on === 'mac' ? 'Meta' : 'Control'), key.alt && 'Alt', key.shift && 'Shift', keyName(key)]
        .filter(Boolean)
        .join('+'),
    )
    .join(' ');
}
