import type { MenuAction } from './menu';
import Download from '@lucide/svelte/icons/download';
import Mic from '@lucide/svelte/icons/mic';
import Redo2 from '@lucide/svelte/icons/redo-2';
import Undo2 from '@lucide/svelte/icons/undo-2';
import Upload from '@lucide/svelte/icons/upload';

// The transport row's actions, icon buttons on it where there's room, and
// otherwise folded into its ⋯, in the order they fold: Import audio…, which
// a file dropped on a Track does too, then Mix down…, then the mic, then
// Undo and Redo, used most and which their keys do too, folding together.
// All but Mix down… are for the full Timeline: on a transport-only one,
// e.g. an upright phone, Mix down… is the only one offered.

/** What the Timeline is doing, which decides what the ⋯ offers. */
export type TransportState = {
  /** The full Timeline shows, rather than the transport row alone. */
  fullTimeline: boolean;
  importing: boolean;
  recording: boolean;
  /** A Merge is being made, so the Timeline can't be edited. */
  merging: boolean;
  /** The Chosen Track's name, which Import audio… imports onto. */
  chosenTrack: string;
  /** The Timeline has Clips, which a Mixdown needs. */
  hasClips: boolean;
  /** Whether there's an edit to undo, and what Undo says over its button, e.g. why it's disabled. */
  undo: { can: boolean; title?: string };
  /** The same for Redo. */
  redo: { can: boolean; title?: string };
};

/** What each action does. */
export type TransportRun = {
  importAudio: () => void;
  mixDown: () => void;
  /** Opens the mic button's popover, of the Inputs to record from, by the ⋯. */
  recordFrom: () => void;
  undo: () => void;
  redo: () => void;
};

/** One of the transport row's actions, named by what it runs. */
export type TransportAction = MenuAction & { key: keyof TransportRun; run: () => void };

/** The transport row's actions, in the order they fold: always at least Mix down…. */
export function transportActions(state: TransportState, run: TransportRun): TransportAction[] {
  const importAudio: TransportAction = {
    key: 'importAudio',
    icon: Upload,
    label: 'Import audio…',
    title: state.recording
      ? 'Stop recording to import audio'
      : state.merging
        ? 'Wait for the Merge to finish to import audio'
        : `Import an audio file as a Sound onto ${state.chosenTrack}`,
    disabled: state.importing || state.recording || state.merging,
    run: run.importAudio,
  };
  const mixDown: TransportAction = {
    key: 'mixDown',
    icon: Download,
    label: 'Mix down…',
    title: state.recording
      ? 'Stop recording to mix down'
      : state.hasClips
        ? 'Download the Timeline, or its Loop, as one audio file'
        : 'Add a Beat, Sound or Take to mix down',
    disabled: !state.hasClips || state.recording,
    run: run.mixDown,
  };
  const recordFrom: TransportAction = {
    key: 'recordFrom',
    icon: Mic,
    label: 'Record from…',
    title: state.recording ? 'Stop recording to pick the Input to record from' : 'Pick the Input to record from',
    disabled: state.recording,
    run: run.recordFrom,
  };
  const undo: TransportAction = {
    key: 'undo',
    icon: Undo2,
    label: 'Undo',
    title: state.undo.title,
    disabled: !state.undo.can,
    run: run.undo,
  };
  const redo: TransportAction = {
    key: 'redo',
    icon: Redo2,
    label: 'Redo',
    title: state.redo.title,
    disabled: !state.redo.can,
    run: run.redo,
  };
  return state.fullTimeline ? [importAudio, mixDown, recordFrom, undo, redo] : [mixDown];
}

/**
 * Those of `actions` that fold into the ⋯, the first first, as many as
 * `foldCount` says for `room` and `each`, except that Undo never folds
 * without Redo.
 */
export function foldedActions(actions: TransportAction[], room: number, each: number): TransportAction[] {
  let count = foldCount(actions.length, room, each);
  if (actions[count - 1]?.key === 'undo') count++;
  return actions.slice(0, count);
}

/**
 * How many of `count` actions fold into the ⋯, the first first, with `room`
 * px for them on the row, each, and the ⋯, taking `each` px with its gap:
 * the fewest that leave room for the rest and the ⋯, or, where none do, all
 * of them. As the ⋯ takes a place of its own, folding just one gains
 * nothing, so a lone action never folds, and the first folds with the second.
 */
export function foldCount(count: number, room: number, each: number): number {
  if (count * each <= room || count === 1) return 0;
  for (let folded = 1; folded < count; folded++) {
    if ((count - folded + 1) * each <= room) return folded;
  }
  return count;
}
