// Changes to the Lyric Sheet, each named by its kind, as Lyric Sheet editing
// (see lyricSheetEditing.svelte.ts) sends them through Saves.
import { api, type Song, type SongAt } from './api';

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
  /** A Section in the Scrapbook deleted for good. */
  | { kind: 'deleteSection'; sectionId: number }
  /** A Section's Label set, or removed with "". */
  | { kind: 'setSectionLabel'; sectionId: number; label: string }
  /** A new, inactive Alternate of a Section, a copy of the active one's Lines. */
  | { kind: 'addAlternate'; sectionId: number }
  /** An Alternate named, or its name removed with "". */
  | { kind: 'renameAlternate'; alternateId: number; name: string }
  /** An Alternate made the active one of its Section. */
  | { kind: 'activateAlternate'; alternateId: number }
  /** An inactive Alternate deleted for good. */
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
  | { kind: 'replaceAlternateText'; alternateId: number; text: string };

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
  }
}
