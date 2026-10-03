import type { Edit } from './history';

// While a recording runs, a new Take or a Retake, from pressing Record
// until its Take is saved, the Timeline can't be edited: it stays as it was
// while performing against it, so the Take still fits once it's saved. Only
// a Track's levels still change, heard live. Likewise while a Merge is being
// made, from pressing Merge until its Sound is saved, so the Clips it
// merges are still there to replace.

/** Why the Timeline can't be edited: a recording or a Merge under way, or null while it can be. */
export type Freeze = 'recording' | 'merging' | null;

/** What a disabled edit control says while the Timeline can't be edited, by why. */
const frozenHints = {
  recording: 'Stop recording to edit',
  merging: 'Wait for the Merge to finish to edit',
};

/** Whether an edit can still be made while frozen: only to a Track's mute, solo or volume. */
export function editsWhileRecording(e: Edit): boolean {
  return e.kind === 'updateTrack' && e.changes.name === undefined;
}

/** An edit control's tooltip: while frozen, that it's off until the recording or Merge is done. */
export function editHint(freeze: Freeze, hint: string | undefined): string | undefined {
  return freeze ? frozenHints[freeze] : hint;
}
