import type { Clip, Timeline, Track } from './api';
import { addedClips } from './history';
import { tolerance } from './trackPlacement';

// A Split cuts Clips in two at the playhead: the Selection's Clips it
// crosses, or with none selected, the Chosen Track's Clip under it. A Clip
// the playhead is on the edge of isn't split. The server cuts them, and
// refuses a Clip the time doesn't cross by the same reckoning. The right
// halves become the Selection, so the next action is on what's after the
// playhead: Delete trims it off, and a drag moves it.

/**
 * Whether a time on the Timeline crosses a Clip, rather than being on its
 * edge, within the server's tolerance, or outside it.
 */
function crosses(clip: Clip, at: number): boolean {
  return at - clip.start > tolerance && clip.start + clip.length - at > tolerance;
}

/**
 * The ids of the Clips a Split at `at` cuts, in Timeline order: the
 * selected ones it crosses, or with none selected, the Chosen Track's Clip
 * under it. Empty when there's nothing to split.
 */
export function splitTargets(
  tracks: readonly Track[],
  selected: ReadonlySet<number>,
  chosen: number | null,
  at: number,
): number[] {
  const among =
    selected.size > 0
      ? tracks.flatMap((t) => t.clips.filter((c) => selected.has(c.id)))
      : (tracks.find((t) => t.id === chosen)?.clips ?? []);
  return among.filter((c) => crosses(c, at)).map((c) => c.id);
}

/**
 * The ids of the right halves a Split made, in Timeline order, from the
 * Timeline before and after it. Each Clip cut keeps its id as the left
 * half, and its right half is a new Clip.
 */
export function rightHalves(before: Timeline, after: Timeline): number[] {
  return addedClips(before, after);
}

/**
 * The id of the right half a Split cut from a Clip, from the Timeline
 * before and after it: the new Clip starting where the Clip, now its left
 * half, ends. Null if the Split left it whole.
 */
export function rightHalfOf(before: Timeline, after: Timeline, clipId: number): number | null {
  const track = after.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!track) return null;
  const left = track.clips.find((c) => c.id === clipId)!;
  const cut = left.start + left.length;
  const rights = new Set(rightHalves(before, after));
  return track.clips.find((c) => rights.has(c.id) && Math.abs(c.start - cut) <= tolerance)?.id ?? null;
}
