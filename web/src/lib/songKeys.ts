import { matches, shortcuts, shortcutsDialogKeys, type KeyDown } from './shortcuts';
import type { KeyPlace } from './keyPlace';

/** The Song-wide Shortcuts, which work wherever focus is on the Song page. */
export type SongKey = 'playPause' | 'record' | 'undo' | 'redo' | 'split';

/** Where a key was pressed, and what the Song page is doing. */
export type SongKeyContext = KeyPlace & {
  /** Picking a Beat, calibrating the Latency Offset or making a Mixdown. */
  busy: boolean;
  /** Space there is the control's own, e.g. a text field, a checkbox or a ⋯ menu. */
  ownsSpace: boolean;
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
  // A dialog's keys are for what's in it, e.g. the shortcuts dialog.
  if (e.defaultPrevented || at.busy || at.dialogOpen) return null;
  if (matches(e, shortcuts.playPause.keys)) {
    return e.repeat || at.ownsSpace ? null : 'playPause';
  }
  if (matches(e, shortcuts.undo.keys) || matches(e, shortcuts.redo.keys)) {
    // Not while recording, which undo would take the place of.
    if (!at.editable || at.inTextField || at.recording) return null;
    return matches(e, shortcuts.undo.keys) ? 'undo' : 'redo';
  }
  if (matches(e, shortcuts.record.keys)) {
    if (e.repeat || at.inTextField || (!at.capturing && !at.canRecord)) return null;
    return 'record';
  }
  if (matches(e, shortcuts.splitClips.keys)) {
    // Editing, so not on a phone, nor while recording.
    if (e.repeat || !at.editable || at.inTextField || at.recording) return null;
    return 'split';
  }
  return null;
}

/** Whether a key press opens the shortcuts dialog: ?, unless it's typed or a dialog is open. */
export function opensShortcuts(e: KeyDown, at: KeyPlace): boolean {
  if (e.defaultPrevented || e.repeat || at.dialogOpen || at.inTextField) return false;
  return matches(e, shortcutsDialogKeys);
}
