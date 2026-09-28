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
export interface CuedSection<L extends CuedLine = CuedLine> {
  id: number;
  alternates: readonly { active: boolean; lines: readonly L[] }[];
}

/** A Line, as far as it takes a Cue. */
export interface CuedLine {
  id: number;
  text: string;
}

/** A Song, as far as its Cues go. */
export interface CuedSong<L extends CuedLine = CuedLine> {
  arrangement: readonly CuedOccurrence[];
  sections: readonly CuedSection<L>[];
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
 * Gives each Occurrence's Lines whose Cues are in effect: those of its
 * Section's active Alternate. The others' Cues are dormant (ADR 0007).
 */
function activeLines<L extends CuedLine>(song: CuedSong<L>): (o: CuedOccurrence) => readonly L[] {
  const sections = new Map(song.sections.map((s) => [s.id, s]));
  return (o) => sections.get(o.sectionId)?.alternates.find((a) => a.active)?.lines ?? [];
}

/** Whether any of an Occurrence's Lines has a Cue in it. */
function hasLineCue(o: CuedOccurrence, lines: readonly CuedLine[]): boolean {
  return lines.some((l) => o.lineCues[l.id] !== undefined);
}

/**
 * Where playback is at time t: the Line or Occurrence whose Cue is the
 * latest at or before t, wherever it is in the Arrangement, and current
 * until the next Cue. Only Lines of the active Alternate count; the others'
 * Cues are dormant. An Occurrence's own Cue is the whole Section while
 * none of its Lines has a Cue, and otherwise its first Line. Null before
 * the first Cue. Of two cued at the same time, the later on the sheet.
 */
export function currentPosition(song: CuedSong, t: number): Position | null {
  const linesOf = activeLines(song);
  type Latest = { at: number; o: CuedOccurrence; line: number | null; lines: readonly CuedLine[] };
  let latest: Latest | null = null;
  for (const o of song.arrangement) {
    const lines = linesOf(o);
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
  if (line !== null || !hasLineCue(o, lines)) return { occurrence: o.id, line };
  return { occurrence: o.id, line: lines.find((l) => !isBlank(l))?.id ?? null };
}

/** Whether any Occurrence has a Cue in effect: its own, or one on a Line of its active Alternate. Dormant Cues don't count. */
export function hasCues(song: CuedSong): boolean {
  const linesOf = activeLines(song);
  return song.arrangement.some((o) => o.cue !== null || hasLineCue(o, linesOf(o)));
}

/**
 * The latest Cue in effect, in seconds: an Occurrence's own, or one on a
 * Line of its active Alternate. Dormant Cues don't count. Null without any.
 */
export function lastCue(song: CuedSong): number | null {
  const linesOf = activeLines(song);
  let last: number | null = null;
  for (const o of song.arrangement) {
    for (const cue of [o.cue, ...linesOf(o).map((l) => o.lineCues[l.id])]) {
      if (cue !== null && cue !== undefined && (last === null || cue > last)) last = cue;
    }
  }
  return last;
}

/** A Cue and what it links: an Occurrence (line null), or one of its Lines. */
export type FoundCue = Position & { cue: number };

/**
 * The Cues from start up to end, in seconds, as shifting that span moves
 * them: each Occurrence's own, then its Lines' by id, dormant ones
 * included, since they're Timeline times too and should keep in step for
 * when their Alternate is switched back.
 */
export function cuesInSpan(song: CuedSong, start: number, end: number): FoundCue[] {
  const inSpan = (cue: number | null): cue is number => cue !== null && cue >= start && cue < end;
  return song.arrangement.flatMap((o) => {
    const own: FoundCue[] = inSpan(o.cue) ? [{ occurrence: o.id, line: null, cue: o.cue }] : [];
    const lines = Object.keys(o.lineCues)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((line) => (inSpan(o.lineCues[line]) ? [{ occurrence: o.id, line, cue: o.lineCues[line] }] : []));
    return [...own, ...lines];
  });
}

/**
 * The latest a Cue can be, in seconds, as the server keeps them: 24 hours
 * into the Timeline.
 */
export const maxCue = 24 * 60 * 60;

/**
 * A span that takes every Cue there is or could be, dormant ones included:
 * shifting it shifts them all. It's fixed rather than worked out from the
 * Song, so a shift queued behind another still takes the latest Cue.
 */
export const everyCue = { start: 0, end: maxCue + 1 } as const;

/**
 * Whether every Cue can shift earlier by step without any going before
 * 0:00, as the server refuses: dormant ones included, since they move too.
 * Compared in milliseconds, as Cues are kept.
 */
export function canShiftCuesEarlier(song: CuedSong, step: number): boolean {
  const all = cuesInSpan(song, everyCue.start, everyCue.end);
  if (all.length === 0) return false;
  const earliest = Math.min(...all.map((c) => c.cue));
  return Math.round(earliest * 1000) >= Math.round(step * 1000);
}

/** A Line, as far as Sync mode steps onto it: it skips Chord Lines. */
export interface ChordedLine extends CuedLine {
  chordLine: boolean;
}

/** A Line within one Occurrence, as Sync mode cues it. */
export type NextLine = Position & { line: number };

/**
 * The Line Sync mode cues next, in the order down the sheet: a Line picked
 * by clicking it, or else the one after the current Line, the first of a
 * Section highlighted as a whole, or with nothing highlighted the first of
 * the Arrangement. Each Occurrence of a shared Section is stepped through
 * on its own. Only Lines with words are cued: never blank ones, nor Chord
 * Lines. Null once there are no more.
 */
export function nextLine(
  song: CuedSong<ChordedLine>,
  { current, picked = null }: { current: Position | null; picked?: NextLine | null },
): NextLine | null {
  const linesOf = activeLines(song);
  const sheet = song.arrangement.flatMap((o, place) =>
    linesOf(o).map((l) => ({
      place,
      occurrence: o.id,
      line: l.id,
      cueable: !isBlank(l) && !l.chordLine,
    })),
  );
  const at = (p: Position) => sheet.findIndex((q) => q.occurrence === p.occurrence && q.line === p.line);
  const pickedAt = picked === null ? -1 : at(picked);
  const currentAt = current === null ? -1 : at(current);
  let from = 0;
  if (pickedAt >= 0) from = pickedAt;
  else if (currentAt >= 0) from = currentAt + 1;
  else if (current !== null) {
    // The whole Section: from its first Line, or the next Section's if it has none.
    const place = song.arrangement.findIndex((o) => o.id === current.occurrence);
    from = sheet.findIndex((p) => p.place >= place);
    if (from < 0) return null;
  }
  const next = sheet.slice(from).find((p) => p.cueable);
  return next ? { occurrence: next.occurrence, line: next.line } : null;
}

/**
 * Which saved Line each row of a text box's text is (a row being a line of
 * text as typed, not yet a Line), while typing that isn't
 * saved yet may have moved them: rows the same as the saved Lines at the
 * start and end keep them, and the rows between are matched by place, so a
 * Line typed or deleted mid-Section leaves the Lines after it where they
 * are. Null for a row with no Line yet. The save matches them for real.
 */
export function linesByRow<L extends { text: string }>(text: string, lines: readonly L[]): (L | null)[] {
  const rows = text.split('\n');
  const overlap = Math.min(rows.length, lines.length);
  let start = 0;
  while (start < overlap && rows[start] === lines[start].text) start++;
  let end = 0;
  while (end < overlap - start && rows[rows.length - 1 - end] === lines[lines.length - 1 - end].text) end++;
  return rows.map((_, i) => {
    if (i < start) return lines[i];
    if (i >= rows.length - end) return lines[lines.length - (rows.length - i)];
    return i < lines.length - end ? lines[i] : null;
  });
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

/** Names a Cue's ▶ for screen readers, e.g. "Play from Line 3 of Verse 1 at 0:38.5". */
export function playLabel(label: string, cue: number): string {
  return `Play from ${label} at ${formatCue(cue)}`;
}
