// What a Clip plays: its source's audio, how long the source is, and its
// waveform. The Timeline asks here rather than reaching for a Clip's Beat,
// Sound or Takes, so playing, drawing, trimming and undo work the same for any
// source. Undo re-places a Clip by naming its source, so that's worked out
// here too, as is what a Clip goes by until it has a name of its own.
//
// A Clip of Takes plays its active Take. Its source is the span its Takes
// are laid out in, up to where the last of them ends: each Take starts at
// its position in it, and the span starts the Clip's offset before the Clip
// does. A Take nudged earlier still reaches where it ended before, so a
// nudge never leaves its Clip playing past its source.
import { api, type Clip, type NewClip, type Take, type Timeline } from './api';
import type { Placed } from './schedule';
import type { PlayableClip } from './timelinePlayer';

/** What one or more Clips play. */
export interface ClipSource {
  /** Tells sources apart, e.g. to key their peaks by. */
  key: string;
  title: string;
  /** Where its audio is fetched from. */
  audio: string;
  /** How long the whole source is, in seconds, however a Clip trims it. */
  duration: number;
  /** Fetches its audio file's waveform, which the Timeline leaves out; see fileStart for where it's laid out. */
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
  for (const s of timeline.sounds) {
    const key = soundKey(s.id);
    byKey.set(key, {
      key,
      title: s.name,
      audio: api.soundAudioUrl(timeline.songId, s.id),
      duration: s.duration,
      loadPeaks: () => api.getSound(timeline.songId, s.id).then((full) => full.peaks ?? []),
    });
  }
  for (const clip of timeline.tracks.flatMap((t) => t.clips)) {
    const take = activeTake(clip);
    if (!take) continue;
    const key = takeKey(take.id);
    byKey.set(key, {
      key,
      title: `Take ${take.number}`,
      audio: api.takeAudioUrl(timeline.songId, take.id),
      duration: Math.max(...clip.takes.map((t) => t.position + t.duration + Math.max(0, -t.nudge))),
      loadPeaks: () => api.getTake(timeline.songId, take.id).then((full) => full.peaks ?? []),
    });
  }
  return {
    of: (clip) => byKey.get(sourceKey(clip))!,
    all: () => [...byKey.values()],
  };
}

/** The key of the source a Clip plays. */
function sourceKey(clip: Clip): string {
  if (clip.beatId !== null) return beatKey(clip.beatId);
  if (clip.soundId !== null) return soundKey(clip.soundId);
  return takeKey(clip.activeTakeId!);
}

/** The key of the source a Beat's Clips play. */
function beatKey(id: number): string {
  return `beat:${id}`;
}

/** The key of the source a Sound's Clips play. */
function soundKey(id: number): string {
  return `sound:${id}`;
}

/** The key of the source a Take's Clip plays. */
function takeKey(id: number): string {
  return `take:${id}`;
}

/** The Take a Clip of Takes plays, or undefined for a Clip of a Beat or a Sound. */
export function activeTake(clip: Clip): Take | undefined {
  return clip.takes.find((t) => t.id === clip.activeTakeId);
}

/**
 * Where in its source a Clip's audio file starts, in seconds: 0 for a Beat
 * or a Sound, and for a Take, its position in its span, which a nudge moves.
 */
export function fileStart(clip: Clip): number {
  return activeTake(clip)?.position ?? 0;
}

/**
 * What of its audio file a Clip plays, and when: all of its window for a
 * Beat or a Sound, and for a Take, only where the Take has audio within it. Null if
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

/**
 * What each Clip of a Timeline plays, from its audio, on its Track: a
 * Take's only where it has audio in its Clip. The Clip being retaken, if
 * any, is left silent, so the old Take isn't heard while singing the new.
 */
export function playing(timeline: Timeline, sources: ClipSources, silent: number | null = null): PlayableClip[] {
  return timeline.tracks.flatMap((t) =>
    t.clips.flatMap((c) => {
      const h = c.id === silent ? null : heard(c);
      return h ? [{ ...h, source: sources.of(c).audio, trackId: t.id }] : [];
    }),
  );
}

/**
 * What a Clip goes by: its own name, or until it's named, its source's (a
 * Beat's title, a Sound's name, or its active Take's number). A named Clip of Takes still
 * shows which Take it plays, e.g. "Hook idea · Take 2".
 */
export function clipTitle(clip: Clip, source: ClipSource): string {
  if (clip.name === null) return source.title;
  const take = activeTake(clip);
  return take ? `${clip.name} · Take ${take.number}` : clip.name;
}

/** What places a Clip back as it is: its source, trim and name, without its id. */
export function placementOf(clip: Clip): NewClip {
  const { start, offset, length } = clip;
  const name = clip.name !== null ? { name: clip.name } : {};
  if (clip.beatId !== null) return { beatId: clip.beatId, ...name, start, offset, length };
  if (clip.soundId !== null) return { soundId: clip.soundId, ...name, start, offset, length };
  return {
    ...name,
    takeIds: clip.takes.map((t) => t.id),
    activeTakeId: clip.activeTakeId!,
    lastTakeNumber: clip.lastTakeNumber,
    start,
    offset,
    length,
  };
}
