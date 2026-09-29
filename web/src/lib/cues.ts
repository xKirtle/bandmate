// Cues link a Line within an Occurrence to a time on the Timeline (ADR
// 0005). An Occurrence has no Cue of its own: it starts where its first Line
// is cued (ADR 0009). This works out where playback is and which Cues are
// out of order, and reads and writes the times as typed.

/** What the current position is worked out from: an Occurrence and its Line Cues. */
export interface CuedOccurrence {
  id: number;
  sectionId: number;
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

/** Where playback is in the Lyric Sheet: one Line within an Occurrence. */
export interface Position {
  occurrence: number;
  line: number;
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

/**
 * Where playback is at time t: the Line whose Cue is the latest at or
 * before t, wherever it is in the Arrangement, and current until the next
 * Cue. Only Lines of the active Alternate count; the others' Cues are
 * dormant. Null before the first Cue. Of two cued at the same time, the
 * later on the sheet. Given, a Line being retaken in Sync mode has its Cue
 * ignored, so it only becomes current once it's cued again.
 */
export function currentPosition(song: CuedSong, t: number, retaking: NextLine | null = null): Position | null {
  const linesOf = activeLines(song);
  let latest: (Position & { at: number }) | null = null;
  for (const o of song.arrangement) {
    const retaken = retaking?.occurrence === o.id ? retaking.line : null;
    for (const l of linesOf(o)) {
      const at = l.id === retaken ? undefined : o.lineCues[l.id];
      if (at === undefined || at > t) continue;
      if (latest === null || at >= latest.at) latest = { at, occurrence: o.id, line: l.id };
    }
  }
  return latest && { occurrence: latest.occurrence, line: latest.line };
}

/** Whether any Line of an active Alternate has a Cue. Dormant Cues don't count. */
export function hasCues(song: CuedSong): boolean {
  return lastCue(song) !== null;
}

/**
 * The latest Cue in effect, in seconds: one on a Line of an active
 * Alternate. Dormant Cues don't count. Null without any.
 */
export function lastCue(song: CuedSong): number | null {
  const linesOf = activeLines(song);
  let last: number | null = null;
  for (const o of song.arrangement) {
    for (const l of linesOf(o)) {
      const cue = o.lineCues[l.id];
      if (cue !== undefined && (last === null || cue > last)) last = cue;
    }
  }
  return last;
}

/** A Cue and the Line within an Occurrence it links. */
export type FoundCue = Position & { cue: number };

/** Why a Cue is out of order: the cued Lines either side it's out of order with. */
export interface OutOfOrder {
  /** The nearest cued Line above, when this Cue is earlier than it. */
  earlierThan: FoundCue | null;
  /** The nearest cued Line below, when this Cue is later than it. */
  laterThan: FoundCue | null;
}

/** A Cue out of order, and why. */
export type OutOfOrderCue = FoundCue & OutOfOrder;

/**
 * The Cues out of order, in the order down the sheet: each is compared with
 * the nearest cued Line above and below it, down the whole Arrangement,
 * skipping Lines without a Cue. Both Cues of a pair out of order are
 * marked, as it can't be known which is wrong. Equal times are in order.
 * Only Cues in effect count, Chord Lines' included; dormant ones are neither
 * marked nor compared, nor are blank Lines', which the gutter doesn't show.
 */
export function outOfOrderCues(song: CuedSong): OutOfOrderCue[] {
  const linesOf = activeLines(song);
  const cued: OutOfOrderCue[] = song.arrangement.flatMap((o) =>
    linesOf(o)
      .filter((l) => !isBlank(l) && o.lineCues[l.id] !== undefined)
      .map((l) => ({ occurrence: o.id, line: l.id, cue: o.lineCues[l.id], earlierThan: null, laterThan: null })),
  );
  for (let i = 1; i < cued.length; i++) {
    const [above, below] = [cued[i - 1], cued[i]];
    if (above.cue <= below.cue) continue;
    above.laterThan = { occurrence: below.occurrence, line: below.line, cue: below.cue };
    below.earlierThan = { occurrence: above.occurrence, line: above.line, cue: above.cue };
  }
  return cued.filter((c) => c.earlierThan || c.laterThan);
}

/**
 * Says why a Cue is out of order, e.g. "Later than Line 6 of Chorus (0:55.0)",
 * naming the Lines with name.
 */
export function outOfOrderReason({ earlierThan, laterThan }: OutOfOrder, name: (p: Position) => string): string {
  const reasons: string[] = [];
  if (earlierThan) reasons.push(`earlier than ${name(earlierThan)} (${formatCue(earlierThan.cue)})`);
  if (laterThan) reasons.push(`later than ${name(laterThan)} (${formatCue(laterThan.cue)})`);
  const text = reasons.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The Cues from start up to end, in seconds, as shifting that span moves
 * them: each Occurrence's Lines' by id, dormant ones included, since
 * they're Timeline times too and should keep in step for when their
 * Alternate is switched back.
 */
export function cuesInSpan(song: CuedSong, start: number, end: number): FoundCue[] {
  return song.arrangement.flatMap((o) =>
    Object.keys(o.lineCues)
      .map(Number)
      .sort((a, b) => a - b)
      .filter((line) => o.lineCues[line] >= start && o.lineCues[line] < end)
      .map((line) => ({ occurrence: o.id, line, cue: o.lineCues[line] })),
  );
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
export type NextLine = Position;

/**
 * The Line Sync mode cues next, in the order down the sheet: a Line picked
 * by clicking it, or else the one after the Line just cued, cued or not, so
 * a run of Lines can be retaken. With neither, or after the last Line, it's
 * the first Line without a Cue, or the first of the Arrangement once every
 * Line is cued; the Line just cued counts as cued, its Cue perhaps not saved
 * yet. It never depends on where playback is. Only Lines with words are cued:
 * never blank ones, nor Chord Lines. Null only without any such Line.
 */
export function nextLine(
  song: CuedSong<ChordedLine>,
  { cued = null, picked = null }: { cued?: NextLine | null; picked?: NextLine | null },
): NextLine | null {
  const linesOf = activeLines(song);
  const sheet = song.arrangement.flatMap((o) =>
    linesOf(o)
      .filter((l) => !isBlank(l) && !l.chordLine)
      .map((l) => ({ occurrence: o.id, line: l.id, hasCue: o.lineCues[l.id] !== undefined })),
  );
  const at = (p: NextLine | null) =>
    p === null ? -1 : sheet.findIndex((q) => q.occurrence === p.occurrence && q.line === p.line);
  const pickedAt = at(picked);
  const cuedAt = at(cued);
  const next =
    sheet[pickedAt] ??
    (cuedAt >= 0 ? sheet[cuedAt + 1] : undefined) ??
    sheet.find((p, i) => !p.hasCue && i !== cuedAt) ??
    sheet[0];
  return next ? { occurrence: next.occurrence, line: next.line } : null;
}

/**
 * Where playing from a Cue starts, in seconds: a second before it, to lead
 * into it, but never before 0:00.
 */
export function leadIn(cue: number): number {
  return Math.max(0, Math.round((cue - 1) * 1000) / 1000);
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
