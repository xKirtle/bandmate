// A Merge: two or more selected Clips on one Track turned into one Clip of
// a new Sound, "Merged Clip", that sounds as playback of them would, from
// the earliest one's start to the latest one's end. Each plays as trimmed,
// a Clip of Takes only its active Take, nudged; where they overlap they
// play together, and a gap is silence. Their audio is rendered as a
// Mixdown's is, at its rate, lossless and never normalised, so a Merge
// that clips stays clipped. Their Track's volume, mute and solo aren't
// rendered in: the merged Clip lands on that Track, which still applies
// them.
import type { Timeline, Track } from './api';
import { playing, type ClipSources } from './clipSource';
import { mixdownRate, mixDown } from './mixdown';
import { peaks } from './peaks';
import type { PlayableClip } from './timelinePlayer';
import { encodeWav } from './wav';

/** What a Merge merges: Clips on one Track, in Timeline order, and the span they cover, in seconds. */
export interface MergeTarget {
  trackId: number;
  clipIds: number[];
  start: number;
  end: number;
}

/**
 * What merging the selected Clips would merge, or null where they can't be:
 * fewer than two, as merging one would only bake in its trim, or Clips on
 * several Tracks.
 */
export function mergeTarget(tracks: readonly Track[], selected: ReadonlySet<number>): MergeTarget | null {
  if (selected.size < 2) return null;
  const on = tracks.filter((t) => t.clips.some((c) => selected.has(c.id)));
  if (on.length !== 1) return null;
  const clips = on[0].clips.filter((c) => selected.has(c.id));
  // Some gone from the Timeline can't be merged.
  if (clips.length !== selected.size) return null;
  return {
    trackId: on[0].id,
    clipIds: clips.map((c) => c.id),
    start: Math.min(...clips.map((c) => c.start)),
    end: Math.max(...clips.map((c) => c.start + c.length)),
  };
}

/** What the Clips merged play, as playback would play them. */
export function mergedClips(timeline: Timeline, sources: ClipSources, clipIds: readonly number[]): PlayableClip[] {
  const merged = new Set(clipIds);
  const tracks = timeline.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => merged.has(c.id)) }));
  return playing({ ...timeline, tracks }, sources);
}

/** A Merge's audio, rendered: a 24-bit WAV and its waveform. */
export interface MergedAudio {
  wav: Blob;
  peaks: number[];
}

/**
 * Renders the audio of the Clips a Merge merges, from target's start to its
 * end, as a Mixdown would, loading each source with load, e.g. the
 * player's, which keeps it for playback.
 */
export async function renderMerge(
  clips: readonly PlayableClip[],
  target: MergeTarget,
  load: (source: string) => Promise<AudioBuffer>,
): Promise<MergedAudio> {
  const audio = await mixDown({
    clips,
    start: target.start,
    end: target.end,
    // Each plays as is: the Track the merged Clip lands on applies its levels.
    gains: new Map(),
    load,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  const channels = [audio.getChannelData(0), audio.getChannelData(1)];
  return {
    wav: new Blob([encodeWav(channels, mixdownRate, 24)], { type: 'audio/wav' }),
    peaks: peaks(channels, mixdownRate),
  };
}
