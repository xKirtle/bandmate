import { pressedOnPage, type ShortcutPress } from './shortcutPress';

/** The Timeline's Shortcuts that work wherever focus is on the Song page, e.g. Space to play. */
export type SongKey = 'playPause' | 'record' | 'start' | 'end' | 'split';

/** What the Song page is doing, which says whether a Shortcut can act now. */
export type SongKeyContext = {
  /** Picking a Beat, calibrating the Latency Offset or making a Mixdown. */
  busy: boolean;
  /** The Timeline can be edited, i.e. it isn't on a phone, where it only plays. */
  editable: boolean;
  /** A recording is starting, under way or saving. */
  recording: boolean;
  /** A recording is under way, which R and Space stop. */
  capturing: boolean;
  /** A Take can be recorded now. */
  canRecord: boolean;
};

/**
 * Which Song-wide Shortcut a key press is, if any, and if it should act
 * now: null leaves the key to the page.
 */
export function songKey(e: ShortcutPress, at: SongKeyContext): SongKey | null {
  if (at.busy) return null;
  const pressed = pressedOnPage(e);
  switch (pressed?.id) {
    case 'playPause':
      return 'playPause';
    case 'startOrEnd':
      return pressed.way === 'back' ? 'start' : 'end';
    case 'record':
      return at.capturing || at.canRecord ? 'record' : null;
    case 'splitClips':
      // Editing, so not on a phone, nor while recording.
      return at.editable && !at.recording ? 'split' : null;
    default:
      return null;
  }
}

/**
 * Whether a key press is Undo's or Redo's key, if either: anywhere on the
 * Song page, in Read mode and on a phone too. Whether there's anything to
 * undo or redo is the Song undo's to say (see songUndo.svelte.ts). Null
 * leaves the key to the page.
 */
export function undoKey(e: ShortcutPress): 'undo' | 'redo' | null {
  const pressed = pressedOnPage(e);
  if (pressed?.id === 'undo') return 'undo';
  return pressed?.id === 'redo' ? 'redo' : null;
}

/** Whether a key press opens the shortcuts dialog: its key, ? unless rebound. */
export function opensShortcuts(e: ShortcutPress): boolean {
  return pressedOnPage(e)?.id === 'showShortcuts';
}

/**
 * Whether a key press starts or pauses Auto-scroll: its key, A unless
 * rebound. Whether it can now, in Read mode while the Timeline isn't
 * playing, is Auto-scroll's to say (see autoScroll.svelte.ts).
 */
export function autoScrollKey(e: ShortcutPress): boolean {
  return pressedOnPage(e)?.id === 'autoScroll';
}
