import type { Edit } from './history';

// While a recording runs, a new Take or a Retake, from pressing Record
// until its Take is saved, the Timeline can't be edited: it stays as it was
// while performing against it, so the Take still fits once it's saved. Only
// a Track's levels still change, heard live.

/** What a disabled edit control says while recording. */
const frozenHint = 'Stop recording to edit';

/** Whether an edit can still be made while recording: only to a Track's mute, solo or volume. */
export function editsWhileRecording(e: Edit): boolean {
  return e.kind === 'updateTrack' && e.changes.name === undefined;
}

/** An edit control's tooltip: while recording, that it's off until the recording stops. */
export function editHint(recording: boolean, hint: string | undefined): string | undefined {
  return recording ? frozenHint : hint;
}
