// What a Clip plays: its source's audio, how long the source is, and its
// waveform. The Timeline asks here rather than reaching for a Clip's Beat,
// so playing, drawing, trimming and undo work the same for any source. Undo
// re-places a Clip by naming its source, so that's worked out here too.
import { api, type Clip, type NewClip, type Timeline } from './api';

/** What one or more Clips play. */
export interface ClipSource {
  /** Tells sources apart, e.g. to key their peaks by. */
  key: string;
  title: string;
  /** Where its audio is fetched from. */
  audio: string;
  /** How long the whole source is, in seconds, however a Clip trims it. */
  duration: number;
  /** Fetches its waveform, which the Timeline leaves out. */
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
  return {
    of: (clip) => byKey.get(beatKey(clip.beatId))!,
    all: () => [...byKey.values()],
  };
}

/** The key of the source a Beat's Clips play. */
function beatKey(id: number): string {
  return `beat:${id}`;
}

/** What places a Clip back as it is: its source and trim, without its id. */
export function placementOf(clip: Clip): NewClip {
  return { beatId: clip.beatId, start: clip.start, offset: clip.offset, length: clip.length };
}
