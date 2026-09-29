// The chosen Track: the Track a recording or "+ Beat" goes to. While the Timeline has
// any Tracks, exactly one is chosen. Choosing isn't an edit: it's kept on
// this device, for each Song, rather than saved with it.

/** Something that happened to the Tracks that can choose one. */
export type ChoiceEvent =
  /** A Track's header, or a Clip on it, was clicked. */
  | { kind: 'choose'; trackId: number }
  /** A Track was added with "+ Track". */
  | { kind: 'add'; trackId: number };

/**
 * The chosen Track's id, or null without Tracks: the one an event chooses,
 * or else the one remembered, or else, the first time or once the one
 * remembered is gone (e.g. deleted), the bottom Track. Any other change,
 * such as undoing a Track's deletion, keeps the one remembered, so
 * whichever is chosen should be remembered, the bottom one included.
 */
export function chosenTrack(
  tracks: readonly { id: number }[],
  remembered: number | null,
  event?: ChoiceEvent,
): number | null {
  const present = (id: number | null) => id !== null && tracks.some((t) => t.id === id);
  if (event && present(event.trackId)) return event.trackId;
  if (present(remembered)) return remembered;
  return tracks.at(-1)?.id ?? null;
}

/** The id of a Track in after that wasn't in before, or null for none. */
export function addedTrack(before: readonly { id: number }[], after: readonly { id: number }[]): number | null {
  return after.find((t) => !before.some((b) => b.id === t.id))?.id ?? null;
}

/** Where a Song's chosen Track is kept on this device. */
export function chosenKey(songId: number): string {
  return `bandmate.chosenTrack.${songId}`;
}

/** The Track chosen for a Song on this device, or null for none yet. */
export function readChosen(storage: Storage | undefined, songId: number): number | null {
  try {
    const id = Number(storage?.getItem(chosenKey(songId)) || NaN);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Keeps the Track chosen for a Song on this device. */
export function storeChosen(storage: Storage | undefined, songId: number, trackId: number) {
  try {
    storage?.setItem(chosenKey(songId), String(trackId));
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}
