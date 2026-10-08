// Cues link a Line to a time on the Timeline; a Line has at most one. A
// Section has no Cue of its own: it starts where its first Line is cued (ADR
// 0009). This works out where playback is and which Cues are out of order,
// and reads and writes the times as typed.

import type { CueValue } from './api';
import type { Parsed } from './typedField.svelte';

/** A Section, as far as its Lines take Cues. */
export interface CuedSection<L extends CuedLine = CuedLine> {
  id: number;
  alternates: readonly { active: boolean; lines: readonly L[] }[];
}

/** A Line, as far as it takes a Cue. */
export interface CuedLine {
  id: number;
  text: string;
  /** In seconds; null for none. Dormant while its Alternate is inactive. */
  cue: number | null;
}

/** A Song, as far as its Cues go. */
export interface CuedSong<L extends CuedLine = CuedLine> {
  /** Ids of the Sections in the Arrangement, in order. */
  arrangement: readonly number[];
  sections: readonly CuedSection<L>[];
}

/** Where playback is in the Lyric Sheet: a Line, and the Section it's in to name it by. */
export interface Position {
  section: number;
  line: number;
}

/** Whether a Line has nothing to cue, so can't take a Cue. */
export function isBlank(line: { text: string }): boolean {
  return line.text.trim() === '';
}

/**
 * The Lines whose Cues are in effect, in the order down the sheet, each with
 * its Section: those of the active Alternate of each Section in the
 * Arrangement. The others' Cues are dormant (ADR 0007).
 */
function activeLines<L extends CuedLine>(song: CuedSong<L>): { section: number; line: L }[] {
  const sections = new Map(song.sections.map((s) => [s.id, s]));
  return song.arrangement.flatMap((id) =>
    (sections.get(id)?.alternates.find((a) => a.active)?.lines ?? []).map((line) => ({ section: id, line })),
  );
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
  let latest: (Position & { at: number }) | null = null;
  for (const { section, line } of activeLines(song)) {
    const at = line.id === retaking?.line ? null : line.cue;
    if (at === null || at > t) continue;
    if (latest === null || at >= latest.at) latest = { at, section, line: line.id };
  }
  return latest && { section: latest.section, line: latest.line };
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
  let last: number | null = null;
  for (const { line } of activeLines(song)) {
    if (line.cue !== null && (last === null || line.cue > last)) last = line.cue;
  }
  return last;
}

/** A Cue and the Line it links. */
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
  const cued: OutOfOrderCue[] = activeLines(song).flatMap(({ section, line }) =>
    isBlank(line) || line.cue === null
      ? []
      : [{ section, line: line.id, cue: line.cue, earlierThan: null, laterThan: null }],
  );
  for (let i = 1; i < cued.length; i++) {
    const [above, below] = [cued[i - 1], cued[i]];
    if (above.cue <= below.cue) continue;
    above.laterThan = { section: below.section, line: below.line, cue: below.cue };
    below.earlierThan = { section: above.section, line: above.line, cue: above.cue };
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
 * them: each Section's Lines', in every Alternate, dormant ones included,
 * since they're Timeline times too and should keep in step for when their
 * Alternate is switched back.
 */
export function cuesInSpan(song: CuedSong, start: number, end: number): FoundCue[] {
  return cuesInSpans(song, [{ start, end }]);
}

/** A stretch of the Timeline, from start up to end, in seconds. */
export interface TimeSpan {
  start: number;
  end: number;
}

/** The Cues in any of the spans, as cuesInSpan finds them, each once however many of the spans it's in. */
function cuesInSpans(song: CuedSong, spans: readonly TimeSpan[]): FoundCue[] {
  return song.sections.flatMap((s) =>
    s.alternates.flatMap((a) =>
      a.lines.flatMap((l) => {
        const cue = l.cue;
        if (cue === null || !spans.some((span) => cue >= span.start && cue < span.end)) return [];
        return [{ section: s.id, line: l.id, cue }];
      }),
    ),
  );
}

/**
 * The Cues in any of the spans moved by the seconds given, to the
 * millisecond, as Cues follow several Clips moved together: dormant ones
 * included, and each moved once, however many of the spans it's in.
 */
export function movedCues(song: CuedSong, spans: readonly TimeSpan[], by: number): CueValue[] {
  return cuesInSpans(song, spans).map((c) => ({ lineId: c.line, cue: Math.round((c.cue + by) * 1000) / 1000 }));
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

/** A Line, as Sync mode cues it, with its Section to name it by. */
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
  const sheet = activeLines(song)
    .filter(({ line }) => !isBlank(line) && !line.chordLine)
    .map(({ section, line }) => ({ section, line: line.id, hasCue: line.cue !== null }));
  const at = (p: NextLine | null) => (p === null ? -1 : sheet.findIndex((q) => q.line === p.line));
  const pickedAt = at(picked);
  const cuedAt = at(cued);
  const next =
    sheet[pickedAt] ??
    (cuedAt >= 0 ? sheet[cuedAt + 1] : undefined) ??
    sheet.find((p, i) => !p.hasCue && i !== cuedAt) ??
    sheet[0];
  return next ? { section: next.section, line: next.line } : null;
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

/**
 * A Cue's time as typed into its field, against the Cue it has: empty
 * clears it, typed as shown leaves it as it is even if it's finer than
 * tenths, and what isn't a time says how to type one.
 */
export function typedCue(typed: string, cue: number | null): Parsed<number | null> {
  const text = typed.trim();
  if (text === '') return { value: null };
  if (cue !== null && text === formatCue(cue)) return 'back';
  const at = parseCue(text);
  return at === null ? { message: 'Type a time like 45, 0:45, 0:45.25 or 1:02' } : { value: at };
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
