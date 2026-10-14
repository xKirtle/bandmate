// Changes to the Lyric Sheet, each named by its kind, as Lyric Sheet editing
// (see lyricSheetEditing.svelte.ts) sends them through Saves.
import { api, type SheetCopy, type Song, type SongAt } from './api';

/** A change to the Lyric Sheet, as the intent sent to the API. */
export type LyricSheetChange =
  /** A new, empty Section in the Arrangement, at position, or at the end. */
  | { kind: 'addSection'; position?: number }
  /** A copy of a Section, Alternates and all, in the Arrangement at position, or at the end. */
  | { kind: 'duplicateSection'; sectionId: number; position?: number }
  /** The Arrangement put in the order given, of Section ids. */
  | { kind: 'reorderArrangement'; order: number[] }
  /** A Section taken out of the Arrangement, to the Scrapbook, or deleted if nothing's written in it. */
  | { kind: 'removeFromArrangement'; sectionId: number }
  /** A Section's Alternates made anew in another Section in the Arrangement, inactive; the Section added goes. */
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
  /** An inactive Alternate made anew as a Section of its own, in the Scrapbook. */
  | { kind: 'moveAlternateToScrapbook'; alternateId: number }
  /** An inactive Alternate made anew as a Section of its own, in the Arrangement at position. */
  | { kind: 'moveAlternateToArrangement'; alternateId: number; position: number }
  /** A new, empty Section in the Scrapbook. */
  | { kind: 'addToScrapbook' }
  /** A Section in the Scrapbook put back into the Arrangement, at position. */
  | { kind: 'addToArrangement'; sectionId: number; position?: number }
  /** An Alternate's Lines replaced with the lines of text. */
  | { kind: 'replaceAlternateText'; alternateId: number; text: string }
  /** The Lyric Sheet and Scrapbook made a Snapshot's, once a Snapshot of them is taken. */
  | { kind: 'restoreSnapshot'; snapshotId: number }
  /** The Lyric Sheet and Scrapbook made a copy of them as they were, as Undo and Redo put them back. */
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

/** Whether a change is to the Lyric Sheet. */
export function isLyricSheetChange(change: { kind: string }): change is LyricSheetChange {
  return lyricSheetChangeKinds.has(change.kind);
}

/** Sends a Lyric Sheet change through the api, returning the Song it leaves. */
export function sendLyricSheetChange(at: SongAt, change: LyricSheetChange): Promise<Song> {
  switch (change.kind) {
    case 'addSection':
      return api.addSection(at, { position: change.position });
    case 'duplicateSection':
      return api.duplicateSection(at, change.sectionId, change.position);
    case 'reorderArrangement':
      return api.reorderArrangement(at, change.order);
    case 'removeFromArrangement':
      return api.removeFromArrangement(at, change.sectionId);
    case 'addToSection':
      return api.addToSection(at, change.sectionId, change.targetId);
    case 'deleteSection':
      return api.deleteSection(at, change.sectionId);
    case 'setSectionLabel':
      return api.setSectionLabel(at, change.sectionId, change.label);
    case 'addAlternate':
      return api.addAlternate(at, change.sectionId);
    case 'renameAlternate':
      return api.renameAlternate(at, change.alternateId, change.name);
    case 'activateAlternate':
      return api.activateAlternate(at, change.alternateId);
    case 'deleteAlternate':
      return api.deleteAlternate(at, change.alternateId);
    case 'moveAlternateToScrapbook':
      return api.moveAlternateToScrapbook(at, change.alternateId);
    case 'moveAlternateToArrangement':
      return api.moveAlternateToArrangement(at, change.alternateId, change.position);
    case 'addToScrapbook':
      return api.addToScrapbook(at);
    case 'addToArrangement':
      return api.addToArrangement(at, change.sectionId, change.position);
    case 'replaceAlternateText':
      return api.replaceAlternateText(at, change.alternateId, change.text);
    case 'restoreSnapshot':
      return api.restoreSnapshot(at, change.snapshotId);
    case 'putSheetBack':
      return api.putSheetBack(at, change.sheet);
  }
}

/** A copy of a Song's Lyric Sheet and Scrapbook, to put back. */
export function sheetCopy(song: Pick<Song, 'arrangement' | 'scrapbook' | 'sections'>): SheetCopy {
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

type Sheet = Pick<Song, 'arrangement' | 'scrapbook' | 'sections'>;

/**
 * The Section a Lyric Sheet change, undone or redone, changed, as it left
 * the sheet, to show: one written differently or brought back, else one
 * moved between the Lyric Sheet and the Scrapbook, else the one moved
 * within either, else, for one gone, the one now where it was. Null when
 * no Section is left to show.
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

  // Only gone: the Section after it, or else before it, in the order it was in.
  const order = [...from.arrangement, ...from.scrapbook];
  const gone = order.findIndex((id) => !now.has(id));
  if (gone < 0) return null;
  return (
    order.slice(gone + 1).find((id) => now.has(id)) ??
    order
      .slice(0, gone)
      .reverse()
      .find((id) => now.has(id)) ??
    null
  );
}
