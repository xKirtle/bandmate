// What the Timeline plays from a given time: which Clip plays which part of
// its source, and when. Plain arithmetic, so playback only has to follow it.

/** Where a Clip sits on the Timeline and which part of its source it plays, in seconds. */
export interface Placed {
  start: number;
  offset: number;
  length: number;
}

/** One Clip to play, from the moment playback starts. */
export interface Scheduled<C extends Placed> {
  clip: C;
  /** Seconds from the start of playback until the Clip starts sounding. */
  delay: number;
  /** Where in its source the Clip starts playing, in seconds. */
  from: number;
  /** How long it plays, in seconds. */
  duration: number;
}

/**
 * The Clips to play when playback starts at time t, each from the part of
 * its source that's reached then. Clips that have finished by t are left out.
 */
export function schedule<C extends Placed>(clips: readonly C[], t: number): Scheduled<C>[] {
  const result: Scheduled<C>[] = [];
  for (const clip of clips) {
    const end = clip.start + clip.length;
    if (end <= t) continue;
    const into = Math.max(0, t - clip.start);
    result.push({ clip, delay: Math.max(0, clip.start - t), from: clip.offset + into, duration: clip.length - into });
  }
  return result;
}

/** Where the last Clip ends, in seconds: 0 without Clips. */
export function timelineEnd(clips: readonly Placed[]): number {
  return clips.reduce((end, c) => Math.max(end, c.start + c.length), 0);
}
