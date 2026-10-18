import { matches, way, type KeyDown } from './shortcuts';
import { rebound } from './shortcutKeys';
import type { KeyAt } from './keyPlace';

/** The Timeline's Shortcuts that work wherever focus is on the Song page, e.g. Space to play. */
export type SongKey = 'playPause' | 'record' | 'start' | 'end' | 'split';

/** Whether the key is the control's own where it was pressed, and what the Song page is doing. */
export type SongKeyContext = KeyAt & {
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
export function songKey(e: KeyDown, at: SongKeyContext): SongKey | null {
  if (e.defaultPrevented || at.own || at.busy) return null;
  const shortcuts = rebound();
  if (matches(e, shortcuts.playPause.keys)) return e.repeat ? null : 'playPause';
  const going = way(e, shortcuts.startOrEnd);
  // Even held down or recording, so the page never scrolls instead, though
  // a recording keeps the playhead where it started.
  if (going) return going === 'back' ? 'start' : 'end';
  if (matches(e, shortcuts.record.keys)) {
    if (e.repeat || (!at.capturing && !at.canRecord)) return null;
    return 'record';
  }
  if (matches(e, shortcuts.splitClips.keys)) {
    // Editing, so not on a phone, nor while recording.
    if (e.repeat || !at.editable || at.recording) return null;
    return 'split';
  }
  return null;
}

/**
 * Whether a key press is Undo's or Redo's key, if either: anywhere on the
 * Song page, in Read mode and on a phone too, but not where the key is the
 * control's own, e.g. a text field, whose own typing it undoes, or a
 * popover. Whether there's anything to
 * undo or redo is the Song undo's to say (see songUndo.svelte.ts). Null
 * leaves the key to the page.
 */
export function undoKey(e: KeyDown, at: KeyAt): 'undo' | 'redo' | null {
  if (e.defaultPrevented || at.own) return null;
  if (matches(e, rebound().undo.keys)) return 'undo';
  if (matches(e, rebound().redo.keys)) return 'redo';
  return null;
}

/** Whether a key press opens the shortcuts dialog: its key, ? unless rebound, unless it's the control's own, e.g. typed or in a dialog. */
export function opensShortcuts(e: KeyDown, at: KeyAt): boolean {
  if (e.defaultPrevented || e.repeat || at.own) return false;
  return matches(e, rebound().showShortcuts.keys);
}
