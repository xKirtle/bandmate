// A Snapshot set beside the Song as it is now, Then | Now: what restoring it
// would change. Sections and Lines are matched by id, and lined up row by
// row, each side in its own order. A Line differs as a whole: its text,
// Chords included, changed, or it's on one side only. Cues don't count.
import type { Line, Section, Snapshot } from './api';
import { activeAlternate } from './sections';

/** A Lyric Sheet and Scrapbook: a Snapshot's, or the Song's as saved. */
export type Sheet = Snapshot['sheet'];

/** One row of a Section's Lines: a Line on either side or both, and whether it differs. */
export interface LineRow {
  then?: Line;
  now?: Line;
  differs: boolean;
}

/** A side of the comparison: the Snapshot's, or the Song's now. */
export type Side = 'then' | 'now';

/** One row of Sections: a Section on either side or both, its active Alternate's Lines lined up. */
export interface SectionRow {
  then?: Section;
  now?: Section;
  /** The side it's on alone, if it's on one side only. */
  only?: Side;
  /** On both sides, with a Label that changed. */
  labelDiffers: boolean;
  lines: LineRow[];
}

/** The Lyric Sheet's or the Scrapbook's Sections, lined up. */
export interface Part {
  rows: SectionRow[];
  /** The sides with no Sections in it. */
  emptyOn: Side[];
}

/** The Lyric Sheet, then the Scrapbook. */
export interface Comparison {
  arrangement: Part;
  scrapbook: Part;
}

/** A Snapshot's sheet beside the Song's now, the Lyric Sheet with the Lyric Sheet, the Scrapbook with the Scrapbook. */
export function compareSheets(then: Sheet, now: Sheet): Comparison {
  return {
    arrangement: compareList(sectionsOf(then, then.arrangement), sectionsOf(now, now.arrangement)),
    scrapbook: compareList(sectionsOf(then, then.scrapbook), sectionsOf(now, now.scrapbook)),
  };
}

function sectionsOf(sheet: Sheet, ids: number[]): Section[] {
  const byId = new Map(sheet.sections.map((s) => [s.id, s]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

const linesOf = (section: Section | undefined) => activeAlternate(section)?.lines ?? [];

function compareList(then: Section[], now: Section[]): Part {
  const rows = lineUp(then, now).map(([t, n]) => ({
    then: t,
    now: n,
    only: !n ? ('then' as const) : !t ? ('now' as const) : undefined,
    labelDiffers: !!t && !!n && t.label !== n.label,
    lines: lineUp(linesOf(t), linesOf(n)).map(([tl, nl]) => ({
      then: tl,
      now: nl,
      differs: !tl || !nl || tl.text !== nl.text,
    })),
  }));
  const emptyOn: Side[] = [];
  if (then.length === 0) emptyOn.push('then');
  if (now.length === 0) emptyOn.push('now');
  return { rows, emptyOn };
}

/**
 * Two lists lined up by id, each in its own order: the most items on both sides stay paired, and the rest are on one
 * side alone, where they are, those only on the first side before those only on the second.
 */
function lineUp<T extends { id: number }>(a: T[], b: T[]): [T | undefined, T | undefined][] {
  // The longest common run of ids, read from the ends: longest[i][j] is how
  // many of a[i:] and b[j:] can pair.
  const longest = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i][j] = a[i].id === b[j].id ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1]);
    }
  }
  const rows: [T | undefined, T | undefined][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].id === b[j].id) rows.push([a[i++], b[j++]]);
    else if (j === b.length || (i < a.length && longest[i + 1][j] >= longest[i][j + 1])) rows.push([a[i++], undefined]);
    else rows.push([undefined, b[j++]]);
  }
  return rows;
}
