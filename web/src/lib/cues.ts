// Cues link an Occurrence, or one Line within it, to a time on the Timeline
// (ADR 0005). This works out where playback is, and reads and writes the
// times as typed.

/** What the current position is worked out from: an Occurrence and its Cues. */
export interface CuedOccurrence {
  id: number;
  sectionId: number;
  /** In seconds, if it has a Cue. */
  cue: number | null;
  /** Line ids to their Cues in this Occurrence, in seconds, dormant ones included. */
  lineCues: Readonly<Record<number, number>>;
}

/** A Section, as far as its Lines take Cues. */
export interface CuedSection {
  id: number;
  alternates: readonly { active: boolean; lines: readonly { id: number; text: string }[] }[];
}

/** Where playback is in the Lyric Sheet: an Occurrence, and one of its Lines or null for the whole Section. */
export interface Position {
  occurrence: number;
  line: number | null;
}

/** Whether a Line has nothing to cue, so can't take a Cue. */
export function isBlank(line: { text: string }): boolean {
  return line.text.trim() === '';
}

/**
 * Where playback is at time t: the Line or Occurrence whose Cue is the
 * latest at or before t, wherever it is in the Arrangement, and current
 * until the next Cue. Only Lines of the active Alternate count; the others'
 * Cues are dormant. An Occurrence's own Cue is the whole Section while
 * none of its Lines has a Cue, and otherwise its first Line. Null before
 * the first Cue. Of two cued at the same time, the later on the sheet.
 */
export function currentPosition(
  song: { arrangement: readonly CuedOccurrence[]; sections: readonly CuedSection[] },
  t: number,
): Position | null {
  const sections = new Map(song.sections.map((s) => [s.id, s]));
  type Latest = { at: number; o: CuedOccurrence; line: number | null; lines: readonly { id: number; text: string }[] };
  let latest: Latest | null = null;
  for (const o of song.arrangement) {
    const lines = sections.get(o.sectionId)?.alternates.find((a) => a.active)?.lines ?? [];
    const cues: [number | null | undefined, number | null][] = [
      [o.cue, null],
      ...lines.map((l) => [o.lineCues[l.id], l.id] as [number | undefined, number]),
    ];
    for (const [at, line] of cues) {
      if (at === null || at === undefined || at > t) continue;
      if (latest === null || at >= latest.at) latest = { at, o, line, lines };
    }
  }
  if (latest === null) return null;
  const { o, line, lines } = latest;
  if (line !== null || !lines.some((l) => o.lineCues[l.id] !== undefined)) return { occurrence: o.id, line };
  return { occurrence: o.id, line: lines.find((l) => !isBlank(l))?.id ?? null };
}

/** Moves a Cue a tenth of a second later (1) or earlier (-1), no earlier than 0. */
export function nudgeCue(cue: number, by: 1 | -1): number {
  return Math.max(0, Math.round(cue * 1000 + by * 100) / 1000);
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
