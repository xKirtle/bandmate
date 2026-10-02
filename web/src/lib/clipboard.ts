// The Clipboard: the Clips last copied from the Selection, as they were
// then, to paste elsewhere on the same Song's Timeline. It holds copies of
// what each Clip was, so later changes to the Clips copied, or deleting
// them, never change it, and a paste makes new Clips from it, so it can be
// pasted again and again. Like the Selection, it isn't an edit, and it's
// never kept: it lives in the page while the Song is open, so leaving the
// Song drops it. The system clipboard is never touched.

import type { Clip, ClipCopy, PastedClip, Track } from './api';
import type { Selection } from './selection';

/** A Clip as it was copied, and the index of the Track it was on then, from the top. */
export interface CopiedClip {
  trackIndex: number;
  clip: ClipCopy;
}

/** The Clips copied, in Timeline order. */
export type Clipboard = readonly CopiedClip[];

/** Nothing copied yet. */
export const emptyClipboard: Clipboard = [];

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
  return copied.length > 0 ? copied : null;
}

/**
 * Where a paste of the Clipboard lands, at the playhead on the Chosen
 * Track: its earliest Clip starts at the playhead, and the rest keep their
 * places relative to it. Where that would land any Clip on another, the
 * whole paste goes later, together, to the first place where every Clip
 * fits, so pasting again at the same playhead lays copies end to end.
 * Null if there's nothing to paste, or nowhere to paste it: for now, that
 * includes Clips copied from several Tracks, which don't paste yet.
 */
export function paste(
  clipboard: Clipboard,
  tracks: readonly Track[],
  playhead: number,
  chosenTrackId: number,
): PastedClip[] | null {
  const track = tracks.find((t) => t.id === chosenTrackId);
  if (!track || clipboard.length === 0 || clipboard.some((c) => c.trackIndex !== clipboard[0].trackIndex)) return null;
  const earliest = Math.min(...clipboard.map((c) => c.clip.start));
  const laid = clipboard.map(({ clip }) => ({ clip, after: clip.start - earliest }));
  // Each Clip landing on another sends the paste on to where that one
  // ends, as nowhere before it would clear it, until none does.
  let at = Math.max(playhead, 0);
  for (;;) {
    const hit = laid
      .flatMap(({ clip, after }) =>
        track.clips
          .filter((c) => at + after < c.start + c.length - tolerance && at + after + clip.length > c.start + tolerance)
          .map((c) => c.start + c.length - after),
      )
      .at(0);
    if (hit === undefined) break;
    at = hit;
  }
  return laid.map(({ clip, after }) => ({ trackId: chosenTrackId, clip: { ...clip, start: at + after } }));
}
