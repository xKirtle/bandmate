// The Clipboard: the Clips last copied or cut from the Selection, as they
// were then, to paste elsewhere on the same Song's Timeline. It holds
// copies of what each Clip was, so later changes to the Clips copied, or
// deleting them, never change it, and a paste makes new Clips from it, so
// it can be pasted again and again. Like the Selection, it isn't an edit, and it's
// never kept: it lives in the page while the Song is open, so leaving the
// Song drops it. The system clipboard is never touched.

import type { Clip, ClipCopy, PastedClip, Track, TrackToAdd } from './api';
import type { Selection } from './selection';

/** A Clip as it was copied, and how many Tracks below the topmost Clip copied it was then. */
export interface CopiedClip {
  below: number;
  clip: ClipCopy;
}

export interface Clipboard {
  /**
   * The names of the Tracks the Clips came from, in order: from the topmost
   * Clip's Track to the bottommost's, those between included, to name the
   * Tracks a paste adds.
   */
  tracks: readonly string[];
  /** The Clips copied, in Timeline order. */
  clips: readonly CopiedClip[];
}

/** Nothing copied yet. */
export const emptyClipboard: Clipboard = { tracks: [], clips: [] };

/** What a paste sends: the Tracks it adds at the bottom, and its Clips, some perhaps on those. */
export interface Paste {
  newTracks: TrackToAdd[];
  clips: PastedClip[];
}

// Absorbs rounding when comparing times, as the server does, e.g. a Clip
// pasted right at a neighbour's end.
const tolerance = 1e-6;

/** A Clip as it is: its source, trim and name, and a Clip of Takes' Takes as they are in it. */
function copyOf(clip: Clip): ClipCopy {
  const { start, offset, length } = clip;
  const name = clip.name !== null ? { name: clip.name } : {};
  if (clip.beatId !== null) return { beatId: clip.beatId, ...name, start, offset, length };
  if (clip.soundId !== null) return { soundId: clip.soundId, ...name, start, offset, length };
  return {
    ...name,
    takes: clip.takes.map(({ id, position, nudge }) => ({ id, position, nudge })),
    activeTakeId: clip.activeTakeId!,
    start,
    offset,
    length,
  };
}

/** The Clipboard after copying the selected Clips as they are, or null with none selected, which leaves it as it was. */
export function copy(tracks: readonly Track[], selected: Selection): Clipboard | null {
  const copied = tracks.flatMap((t, trackIndex) =>
    t.clips.filter((c) => selected.has(c.id)).map((c) => ({ trackIndex, clip: copyOf(c) })),
  );
  if (copied.length === 0) return null;
  const top = copied[0].trackIndex;
  const bottom = copied[copied.length - 1].trackIndex;
  return {
    tracks: tracks.slice(top, bottom + 1).map((t) => t.name),
    clips: copied.map(({ trackIndex, clip }) => ({ below: trackIndex - top, clip })),
  };
}

/**
 * Where a paste of the Clipboard lands, at the playhead on the Chosen
 * Track: its earliest Clip starts at the playhead, its topmost Clip goes on
 * the Chosen Track, and the rest keep their places relative to those, in
 * time and in Tracks. Rows that run past the last Track go on new Tracks,
 * added at the bottom and named after the Tracks they came from. Where that
 * would land any Clip on another, the whole paste goes later, together, to
 * the first place where every Clip fits, so pasting again at the same
 * playhead lays copies end to end. Null if there's nothing to paste, or
 * nowhere to paste it.
 */
export function paste(
  clipboard: Clipboard,
  tracks: readonly Track[],
  playhead: number,
  chosenTrackId: number,
): Paste | null {
  const chosen = tracks.findIndex((t) => t.id === chosenTrackId);
  if (chosen < 0 || clipboard.clips.length === 0) return null;
  const earliest = Math.min(...clipboard.clips.map((c) => c.clip.start));
  // Each on the Track as far below the Chosen Track as it was below the
  // topmost, or past the last one, on a new one, by its index among them.
  const laid = clipboard.clips.map(({ below, clip }) => ({
    clip,
    after: clip.start - earliest,
    on: chosen + below < tracks.length ? tracks[chosen + below] : null,
    newTrack: chosen + below - tracks.length,
  }));
  // Each Clip landing on another sends the paste on to where that one
  // ends, as nowhere before it would clear it, until none does.
  let at = Math.max(playhead, 0);
  for (;;) {
    const hit = laid
      .flatMap(({ clip, after, on }) =>
        (on?.clips ?? [])
          .filter((c) => at + after < c.start + c.length - tolerance && at + after + clip.length > c.start + tolerance)
          .map((c) => c.start + c.length - after),
      )
      .at(0);
    if (hit === undefined) break;
    at = hit;
  }
  const adding = Math.max(chosen + clipboard.tracks.length - tracks.length, 0);
  return {
    newTracks: clipboard.tracks.slice(clipboard.tracks.length - adding).map((name) => ({ name })),
    clips: laid.map(({ clip, after, on, newTrack }) => {
      const placed = { ...clip, start: at + after };
      return on ? { trackId: on.id, clip: placed } : { newTrack, clip: placed };
    }),
  };
}
