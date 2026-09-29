// What a Clip plays: its source's audio, how long the source is, and its
// waveform. The Timeline asks here rather than reaching for a Clip's Beat or
// Takes, so playing, drawing, trimming and undo work the same for any
// source. Undo re-places a Clip by naming its source, so that's worked out
// here too.
//
// A Clip of Takes plays its active Take. Its source is the span its Takes
// are laid out in, up to where the last of them ends: each Take starts at
// its position in it, and the span starts the Clip's offset before the Clip
// does.
import { api, type Clip, type NewClip, type Take, type Timeline } from './api';
import { peaksPerSecond } from './peaks';
import type { Placed } from './schedule';

/** What one or more Clips play. */
export interface ClipSource {
  /** Tells sources apart, e.g. to key their peaks by. */
  key: string;
  title: string;
  /** Where its audio is fetched from. */
  audio: string;
  /** How long the whole source is, in seconds, however a Clip trims it. */
  duration: number;
  /** Fetches its waveform, which the Timeline leaves out, laid out from the start of the source. */
  loadPeaks: () => Promise<number[]>;
}

/** The sources a Timeline's Clips play. */
export interface ClipSources {
  /** What a Clip of the Timeline plays. */
  of(clip: Clip): ClipSource;
  /** Every source played, each once. */
  all(): ClipSource[];
}

/** Looks up what the Clips of a Timeline play, from what it lists alongside them. */
export function clipSources(timeline: Timeline): ClipSources {
  const byKey = new Map<string, ClipSource>(
    timeline.beats.map((b) => {
      const key = beatKey(b.id);
      return [
        key,
        {
          key,
          title: b.title,
          audio: api.beatAudioUrl(b),
          duration: b.duration,
          loadPeaks: () => api.getBeat(b.id).then((full) => full.peaks ?? []),
        },
      ];
    }),
  );
  for (const clip of timeline.tracks.flatMap((t) => t.clips)) {
    const take = activeTake(clip);
    if (!take) continue;
    const key = takeKey(take.id);
    byKey.set(key, {
      key,
      title: `Take ${take.number}`,
      audio: api.takeAudioUrl(timeline.songId, take.id),
      duration: Math.max(...clip.takes.map((t) => t.position + t.duration)),
      loadPeaks: () =>
        api
          .getTake(timeline.songId, take.id)
          .then((full) => [...new Array<number>(Math.round(take.position * peaksPerSecond)).fill(0), ...(full.peaks ?? [])]),
    });
  }
  return {
    of: (clip) => byKey.get(clip.beatId !== null ? beatKey(clip.beatId) : takeKey(clip.activeTakeId!))!,
    all: () => [...byKey.values()],
  };
}

/** The key of the source a Beat's Clips play. */
function beatKey(id: number): string {
  return `beat:${id}`;
}

/** The key of the source a Take's Clip plays. */
function takeKey(id: number): string {
  return `take:${id}`;
}

/** The Take a Clip of Takes plays, or undefined for a Clip of a Beat. */
function activeTake(clip: Clip): Take | undefined {
  return clip.takes.find((t) => t.id === clip.activeTakeId);
}

/**
 * What of its audio file a Clip plays, and when: all of its window for a
 * Beat, and for a Take, only where the Take has audio within it. Null if
 * none of it does.
 */
export function heard(clip: Clip): Placed | null {
  const take = activeTake(clip);
  if (!take) return { start: clip.start, offset: clip.offset, length: clip.length };
  // Where the span starts, and the Take in it, on the Timeline.
  const origin = clip.start - clip.offset;
  const start = Math.max(clip.start, origin + take.position);
  const end = Math.min(clip.start + clip.length, origin + take.position + take.duration);
  if (end <= start) return null;
  return { start, offset: start - origin - take.position, length: end - start };
}

/** What places a Clip back as it is: its source and trim, without its id. */
export function placementOf(clip: Clip): NewClip {
  const { start, offset, length } = clip;
  if (clip.beatId !== null) return { beatId: clip.beatId, start, offset, length };
  return { takeIds: clip.takes.map((t) => t.id), activeTakeId: clip.activeTakeId!, start, offset, length };
}
