import type { Clip, Track } from './api';
import { tolerance } from './trackPlacement';

// A Split cuts Clips in two at the playhead: the Selection's Clips it
// crosses, or with none selected, the Chosen Track's Clip under it. A Clip
// the playhead is on the edge of isn't split. The server cuts them, and
// refuses a Clip the time doesn't cross by the same reckoning.

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
