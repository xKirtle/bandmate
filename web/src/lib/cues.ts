// Cues link an Occurrence to a time on the Timeline (ADR 0005). This works
// out which one playback is in, and reads and writes the times as typed.

/** What a Cue is worked out from: an Occurrence's id and its Cue, in seconds, if any. */
export interface Cued {
  id: number;
  cue: number | null;
}

/**
 * The Occurrence playback is in at time t: the one whose Cue is the latest
 * at or before t, wherever it is in the Arrangement. Null before the first
 * Cue. Of two cued at the same time, the later one in the Arrangement.
 */
export function currentOccurrence(arrangement: readonly Cued[], t: number): number | null {
  let current: Cued | null = null;
  for (const o of arrangement) {
    if (o.cue !== null && o.cue <= t && (current === null || o.cue >= current.cue!)) current = o;
  }
  return current?.id ?? null;
}

// Seconds ("45", "45.25"), or minutes and two-digit seconds ("1:02", "0:45.25").
const timeText = /^(?:(\d+):([0-5]\d(?:\.\d+)?)|(\d+(?:\.\d+)?))$/;

/**
 * Reads a time as typed, like 45, 0:45, 0:45.25 or 1:02, into seconds to the
 * millisecond, as Cues are kept. Null if it isn't a time, or is negative.
 */
export function parseCue(text: string): number | null {
  const match = timeText.exec(text.trim());
  if (!match) return null;
  const [, minutes, seconds, plain] = match;
  const total = plain !== undefined ? Number(plain) : Number(minutes) * 60 + Number(seconds);
  return Math.round(total * 1000) / 1000;
}

/** Shows a time in seconds as m:ss.s, which parseCue reads back. */
export function formatCue(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}
