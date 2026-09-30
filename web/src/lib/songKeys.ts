/** The Song-wide Shortcuts, which work wherever focus is on the Song page. */
export type SongKey = 'playPause' | 'record' | 'undo' | 'redo';

export type SongKeyPress = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'defaultPrevented'
>;

/** Where a key was pressed, and what the Song page is doing. */
export type SongKeyContext = {
  /** Picking a Beat, calibrating the latency or making a mixdown. */
  busy: boolean;
  /** A dialog is open, e.g. the shortcuts dialog. */
  dialogOpen: boolean;
  /** It was pressed in a text field, which takes typed keys. */
  inTextField: boolean;
  /** Space there is the control's own, e.g. a text field, a checkbox or a ⋯ menu. */
  ownsSpace: boolean;
  /** The Timeline can be edited, i.e. it isn't a phone's read-only one. */
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
export function songKey(e: SongKeyPress, at: SongKeyContext): SongKey | null {
  if (e.defaultPrevented || at.busy) return null;
  if (e.key === ' ' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return at.ownsSpace ? null : 'playPause';
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
    // Not while recording, which undo would take the place of.
    if (!at.editable || at.inTextField || at.recording) return null;
    return e.shiftKey ? 'redo' : 'undo';
  }
  if (e.key.toLowerCase() === 'r' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (at.inTextField || (!at.capturing && !at.canRecord)) return null;
    return 'record';
  }
  return null;
}
