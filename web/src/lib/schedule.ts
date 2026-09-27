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

/** A stretch of the Timeline that playback repeats, in seconds; start is before end. */
export interface Loop {
  start: number;
  end: number;
}

/** A span of time since playback started, in seconds, from inclusive to exclusive. */
export interface Window {
  from: number;
  to: number;
}

/** Whether playing from time t reaches the Loop, and so repeats it for ever. */
export function repeats(t: number, loop: Loop | null): boolean {
  return loop !== null && t < loop.end;
}

/**
 * The Clips to play when playback starts at time t, each from the part of
 * its source that's reached then. Clips that have finished by t are left out.
 *
 * With a Loop the playhead reaches, playback goes to the Loop's end and then
 * repeats it from its start, for ever. So only the passes through the
 * Timeline that start within a window of time after playback started are
 * scheduled, to be called again for the next window as playback goes on.
 */
export function schedule<C extends Placed>(
  clips: readonly C[],
  t: number,
  loop: Loop | null = null,
  window: Window = { from: 0, to: Infinity },
): Scheduled<C>[] {
  const result: Scheduled<C>[] = [];
  const play = (from: number, to: number, at: number) => {
    if (at < window.from || at >= window.to) return;
    for (const clip of clips) {
      const start = Math.max(clip.start, from);
      const end = Math.min(clip.start + clip.length, to);
      if (end <= start) continue;
      result.push({ clip, delay: at + start - from, from: clip.offset + start - clip.start, duration: end - start });
    }
  };
  if (!repeats(t, loop)) {
    play(t, Infinity, 0);
    return result;
  }
  const { start, end } = loop!;
  // The repeats never end, so neither would scheduling them.
  if (window.to === Infinity) throw new RangeError('Scheduling a Loop needs a window that ends.');
  play(t, end, 0);
  const length = end - start;
  // The first repeat that starts within the window, and each one after it.
  const first = end - t;
  for (let n = Math.max(0, Math.ceil((window.from - first) / length)); first + n * length < window.to; n++) {
    play(start, end, first + n * length);
  }
  return result;
}

/** The Timeline position after playing for elapsed seconds from time t, going round the Loop if it's reached. */
export function positionAt(t: number, loop: Loop | null, elapsed: number): number {
  if (!repeats(t, loop)) return t + elapsed;
  const { start, end } = loop!;
  const first = end - t;
  return elapsed < first ? t + elapsed : start + ((elapsed - first) % (end - start));
}

/** Where the last Clip ends, in seconds: 0 without Clips. */
export function timelineEnd(clips: readonly Placed[]): number {
  return clips.reduce((end, c) => Math.max(end, c.start + c.length), 0);
}
