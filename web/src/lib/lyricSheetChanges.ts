// Changes to the Lyric Sheet, each named by its kind, as Lyric Sheet editing
// (see lyricSheetEditing.svelte.ts) sends them through Saves.
import type { Sheet, SheetCopy, Song } from './api';

/** A change to the Lyric Sheet, as the intent sent to the API. */
export type LyricSheetChange =
  /** A new, empty Section in the Arrangement, at position, or at the end. */
  | { kind: 'addSection'; position?: number }
  /**
   * A copy of a Section, Alternates and all, in the Arrangement at position,
   * or at the end: independent of it, the same Alternate active, and none of
   * its Cues.
   */
  | { kind: 'duplicateSection'; sectionId: number; position?: number }
  /** The Arrangement put in the order given, of Section ids. */
  | { kind: 'reorderArrangement'; order: number[] }
  /**
   * A Section taken out of the Arrangement, with its Cues, to the end of the
   * Scrapbook, or deleted if nothing's written in it.
   */
  | { kind: 'removeFromArrangement'; sectionId: number }
  /**
   * A Section's Alternates made anew in another Section in the Arrangement,
   * inactive, an unnamed one taking its Label as its name, their Lines' Cues
   * coming along dormant; the Section added goes from wherever it was. Adding
   * one to itself is refused.
   */
  | { kind: 'addToSection'; sectionId: number; targetId: number }
  /** A Section in the Scrapbook deleted, after a Snapshot of the sheet as it was. */
  | { kind: 'deleteSection'; sectionId: number }
  /** A Section's Label set, or removed with "". */
  | { kind: 'setSectionLabel'; sectionId: number; label: string }
  /** A new, inactive Alternate of a Section, a copy of the active one's Lines. */
  | { kind: 'addAlternate'; sectionId: number }
  /** An Alternate named, or its name removed with "". */
  | { kind: 'renameAlternate'; alternateId: number; name: string }
  /** An Alternate made the active one of its Section. */
  | { kind: 'activateAlternate'; alternateId: number }
  /** An inactive Alternate deleted, after a Snapshot of the sheet as it was. */
  | { kind: 'deleteAlternate'; alternateId: number }
  /** An inactive Alternate made anew as a Section of its own, with its Cues, in the Scrapbook. */
  | { kind: 'moveAlternateToScrapbook'; alternateId: number }
  /**
   * An inactive Alternate made anew as a Section of its own, in the
   * Arrangement at position, labelled as moving it to the Scrapbook does,
   * with its Cues, now live.
   */
  | { kind: 'moveAlternateToArrangement'; alternateId: number; position: number }
  /** A new, empty Section in the Scrapbook. */
  | { kind: 'addToScrapbook' }
  /**
   * A Section in the Scrapbook put back into the Arrangement, at position, or
   * at the end. One already in the Arrangement is refused: it appears there at
   * most once, so Duplicate it instead.
   */
  | { kind: 'addToArrangement'; sectionId: number; position?: number }
  /** An Alternate's Lines replaced with the lines of text. */
  | { kind: 'replaceAlternateText'; alternateId: number; text: string }
  /**
   * The Lyric Sheet and Scrapbook made a Snapshot's, once a Snapshot of them
   * is taken. Lines still there keep their Cues as they are; Lines brought
   * back get the Cues they had.
   */
  | { kind: 'restoreSnapshot'; snapshotId: number }
  /**
   * The Lyric Sheet and Scrapbook made a copy of them as they were, as Undo
   * and Redo put them back, taking no Snapshot of its own. Rows still there
   * keep their ids, and Lines their Cues as they are; rows brought back get
   * their ids and Cues back.
   */
  | { kind: 'putSheetBack'; sheet: SheetCopy };

const lyricSheetChangeKinds: ReadonlySet<string> = new Set<LyricSheetChange['kind']>([
  'addSection',
  'duplicateSection',
  'reorderArrangement',
  'removeFromArrangement',
  'addToSection',
  'deleteSection',
  'setSectionLabel',
  'addAlternate',
  'renameAlternate',
  'activateAlternate',
  'deleteAlternate',
  'moveAlternateToScrapbook',
  'moveAlternateToArrangement',
  'addToScrapbook',
  'addToArrangement',
  'replaceAlternateText',
  'restoreSnapshot',
  'putSheetBack',
]);

/**
 * One visit to a text field in the Lyric Sheet, from going into it to
 * leaving it: the changes it saves are kept to undo as one step.
 */
export type FieldVisit = symbol;

/** A new visit to a text field. */
export const newFieldVisit = (): FieldVisit => Symbol('visit');

/** Whether a change is to the Lyric Sheet. */
export function isLyricSheetChange(change: { kind: string }): change is LyricSheetChange {
  return lyricSheetChangeKinds.has(change.kind);
}

/** A copy of a Song's Lyric Sheet and Scrapbook, to put back. */
export function sheetCopy(song: Sheet): SheetCopy {
  return {
    arrangement: [...song.arrangement],
    scrapbook: [...song.scrapbook],
    sections: song.sections.map((s) => ({
      id: s.id,
      label: s.label,
      alternates: s.alternates.map((a) => ({
        id: a.id,
        name: a.name,
        active: a.active,
        lines: a.lines.map((l) => ({ id: l.id, text: l.text, cue: l.cue })),
      })),
    })),
  };
}

/**
 * The Section a Lyric Sheet change, undone or redone, changed, as it left
 * the sheet, to show: one written differently or brought back, else one
 * moved between the Lyric Sheet and the Scrapbook, else the one moved
 * within either, else, for one gone, the one now where it was, in the
 * Lyric Sheet or the Scrapbook as it was. Null when none is left there.
 */
export function changedSection(from: Sheet, to: Sheet): number | null {
  const written = (sheet: Sheet) =>
    new Map(sheet.sections.map((s) => [s.id, JSON.stringify(sheetCopy({ ...sheet, sections: [s] }).sections[0])]));
  const was = written(from);
  const shown = [...to.arrangement, ...to.scrapbook];
  const now = written(to);
  const rewritten = shown.find((id) => was.get(id) !== now.get(id));
  if (rewritten !== undefined) return rewritten;

  const inScrapbook = (sheet: Sheet, id: number) => sheet.scrapbook.includes(id);
  const crossed = shown.find((id) => inScrapbook(from, id) !== inScrapbook(to, id));
  if (crossed !== undefined) return crossed;

  for (const list of ['arrangement', 'scrapbook'] as const) {
    const before = from[list].filter((id) => now.has(id));
    const after = to[list];
    if (before.join() === after.join()) continue;
    const without = (order: number[], id: number) => order.filter((other) => other !== id).join();
    return after.find((id) => without(before, id) === without(after, id)) ?? after.find((id, i) => before[i] !== id)!;
  }

  // Only gone: the Section after it, or else before it, where it was.
  for (const order of [from.arrangement, from.scrapbook]) {
    const gone = order.findIndex((id) => !now.has(id));
    if (gone < 0) continue;
    const after = order.slice(gone + 1).find((id) => now.has(id));
    return (
      after ??
      order
        .slice(0, gone)
        .reverse()
        .find((id) => now.has(id)) ??
      null
    );
  }
  return null;
}
