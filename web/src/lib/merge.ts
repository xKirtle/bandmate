// A Merge: two or more selected Clips, on any Tracks, turned into one Clip
// of a new Sound, "Merged Clip", that sounds as playback of them would,
// from the earliest one's start to the latest one's end. Each plays as
// trimmed, a Clip of Takes only its active Take, nudged; where they overlap
// they play together, and a gap is silence. Their audio is rendered as a
// Mixdown's is, at its rate, lossless and never normalised, so a Merge
// that clips stays clipped.
//
// Their Tracks' mute and solo apply as in a Mixdown, so a Clip on a Track
// that isn't heard merges as silence, and each Track's volume is taken
// relative to the volume of the Track the merged Clip lands on, which
// still applies it: played there, it sounds as they did. That's the
// topmost of their Tracks with no other Clip in the way over the merged
// span, or else a new Track right below the lowest of them.
import type { MergeOnto, Timeline, Track } from './api';
import { playing, type ClipSources } from './clipSource';
import { mixdownRate, mixDown } from './mixdown';
import { trackGains } from './mixer';
import { peaks } from './peaks';
import type { PlayableClip } from './timelinePlayer';
import { encodeWav } from './wav';

// As the server's, so Clips that only touch don't overlap, give or take rounding.
const tolerance = 1e-6;

/** Why a Track's Clips merge as silence: it's muted, or other Tracks are soloed and it isn't. */
export interface SilentTrack {
  name: string;
  why: 'muted' | 'notSoloed';
}

/** What a Merge merges: Clips in Timeline order, the span they cover, in seconds, and how. */
export interface MergeTarget {
  clipIds: number[];
  start: number;
  end: number;
  /** The Track the merged Clip goes on. */
  onto: MergeOnto;
  /** Each Track holding a Clip merged, by id, top to bottom: the gain its Clips merge at. */
  gains: Map<number, number>;
  /** The Tracks holding a Clip merged whose Clips merge as silence, top to bottom. */
  silent: SilentTrack[];
}

/**
 * What merging the selected Clips would merge, or null where they can't be:
 * fewer than two, as merging one would only bake in its trim, or some gone
 * from the Timeline.
 */
export function mergeTarget(tracks: readonly Track[], selected: ReadonlySet<number>): MergeTarget | null {
  if (selected.size < 2) return null;
  const on = tracks.filter((t) => t.clips.some((c) => selected.has(c.id)));
  const clips = on.flatMap((t) => t.clips.filter((c) => selected.has(c.id)));
  if (clips.length !== selected.size) return null;
  const start = Math.min(...clips.map((c) => c.start));
  const end = Math.max(...clips.map((c) => c.start + c.length));
  // Clips touching the span's ends aren't in the way.
  const room = on.find((t) =>
    t.clips.every((c) => selected.has(c.id) || c.start >= end - tolerance || c.start + c.length <= start + tolerance),
  );
  const onto: MergeOnto = room
    ? { trackId: room.id }
    : { newTrack: { name: `Track ${tracks.length + 1}`, position: tracks.indexOf(on.at(-1)!) + 1 } };
  // As playback has them, divided by the volume they land at: a new Track's 0 dB.
  const heard = trackGains(tracks);
  const landing = 10 ** ((room?.volume ?? 0) / 20);
  const gains = new Map(on.map((t) => [t.id, heard.get(t.id)! / landing]));
  // Turned all the way down, a Track is still heard, so only mute and solo silence one.
  const silent: SilentTrack[] = on
    .filter((t) => gains.get(t.id) === 0)
    .map((t) => ({ name: t.name, why: t.muted ? 'muted' : 'notSoloed' }));
  return { clipIds: clips.map((c) => c.id), start, end, onto, gains, silent };
}

/** What a Merge says once made, naming each Track that came out silent, or null if none did. */
export function mergeWarning(silent: readonly SilentTrack[]): string | null {
  if (silent.length === 0) return null;
  const said = silent.map((t) => `${t.name} ${t.why === 'muted' ? 'is muted' : "isn't soloed"}`);
  const list = said.length === 1 ? said[0] : `${said.slice(0, -1).join(', ')} and ${said.at(-1)}`;
  return `${list}, so ${silent.length === 1 ? 'it' : 'they'} merged as silence.`;
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
 * end, each at its Track's gain in target, as a Mixdown would, loading each
 * source with load, e.g. the player's, which keeps it for playback.
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
    gains: target.gains,
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
