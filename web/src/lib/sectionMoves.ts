// Moving a Section out of where it is, and moving one of a Section's
// Alternates out as a Section of its own: from where it lands to what is done
// about it. One place answers for every way a move is made: the grip, whose
// drop the drop rule works out (see sectionDrag.ts), and the menu choices and
// ↑ and ↓ that do the same things from the keyboard.
//
// Given the sheet as it is and a landing, it gives the change to make (see
// lyricSheetChanges.ts), what to say about it once it's saved, and the Section
// whose editor isn't there any more. The Lyric Sheet, the Scrapbook and a
// Section's editor keep only the grip and apply what comes back: none of them
// works out a Section id, a place or a notice of its own. ADR 0010 holds, so a
// Section moved is never shared, and ADR 0024, so each landing is one named
// change.
import type { Section, Sheet } from './api';
import type { LyricSheetChange } from './lyricSheetChanges';
import { moveTo, type Drop } from './sectionDrag';
import { addedNotice, describe, isEmpty } from './sections';

/**
 * Where a Section, or one of a Section's Alternates, is being moved to, by
 * the ids and places the Lyric Sheet shows.
 */
export type Landing =
  /** A Section in the Arrangement moved to another place in it, both by their places. */
  | { within: { from: number; to: number } }
  /** A Section taken out of the Arrangement, by its id: it goes to the Scrapbook, or is deleted with nothing written in it. */
  | { outOfArrangement: number }
  /** A Section in the Scrapbook put back into the Arrangement, at position, or at the end. */
  | { intoArrangement: { sectionId: number; position?: number } }
  /** A Section's Alternates added to the Alternates of another Section in the Arrangement, inactive. */
  | { ontoSection: { sectionId: number; targetId: number } }
  /** An inactive Alternate made a Section of its own, in the Arrangement at position. */
  | { alternateIntoArrangement: { alternateId: number; position: number } }
  /** An inactive Alternate made a Section of its own, at the end of the Scrapbook. */
  | { alternateIntoScrapbook: number };

/** What a landing comes to. */
export type SectionMove = {
  /** The change to make. */
  change: LyricSheetChange;
  /** What to say about it once it's saved, or null with nothing to say. */
  notice: string | null;
  /**
   * The Section whose editor in the Scrapbook closes once it's saved, because
   * the Section isn't in the Scrapbook any more; null when none leaves it.
   */
  closes: number | null;
};

/**
 * What a landing comes to on a sheet; null when there's nothing to do, e.g.
 * for a Section that isn't there any more.
 */
export function sectionMove(sheet: Sheet, landing: Landing): SectionMove | null {
  if ('within' in landing) {
    const { from, to } = landing.within;
    return plain({ kind: 'reorderArrangement', order: moveTo(sheet.arrangement, from, to) });
  }
  if ('outOfArrangement' in landing) {
    const sectionId = landing.outOfArrangement;
    const section = sectionById(sheet, sectionId);
    if (!section) return null;
    // Nothing written in it, it isn't kept in the Scrapbook but deleted,
    // which is said wherever it was taken out from (see the GLOSSARY).
    const gone = isEmpty(section) ? `Nothing was written in ${describe(section)}, so it wasn't kept.` : null;
    return { change: { kind: 'removeFromArrangement', sectionId }, notice: gone, closes: null };
  }
  if ('intoArrangement' in landing) {
    const { sectionId, position } = landing.intoArrangement;
    if (!sectionById(sheet, sectionId)) return null;
    return {
      change: { kind: 'addToArrangement', sectionId, position },
      notice: null,
      closes: leavesScrapbook(sheet, sectionId),
    };
  }
  if ('ontoSection' in landing) {
    const { sectionId, targetId } = landing.ontoSection;
    const added = sectionById(sheet, sectionId);
    const to = sectionById(sheet, targetId);
    if (!added || !to) return null;
    return {
      change: { kind: 'addToSection', sectionId, targetId },
      notice: addedNotice(added, to),
      closes: leavesScrapbook(sheet, sectionId),
    };
  }
  if ('alternateIntoArrangement' in landing) {
    const { alternateId, position } = landing.alternateIntoArrangement;
    return plain({ kind: 'moveAlternateToArrangement', alternateId, position });
  }
  return plain({ kind: 'moveAlternateToScrapbook', alternateId: landing.alternateIntoScrapbook });
}

/** What a drop comes to on a sheet; null when there's nothing to do. */
export function dropMove(sheet: Sheet, drop: Drop): SectionMove | null {
  const landing = landingFor(sheet, drop);
  return landing && sectionMove(sheet, landing);
}

/** The landing a drop makes on a sheet, in the ids the changes go by; null when it does nothing. */
function landingFor(sheet: Sheet, drop: Drop): Landing | null {
  if ('reorder' in drop) return { within: drop.reorder };
  if ('toScrapbook' in drop) {
    const sectionId = sheet.arrangement[drop.toScrapbook];
    return sectionId === undefined ? null : { outOfArrangement: sectionId };
  }
  if ('putBack' in drop) return { intoArrangement: { sectionId: drop.putBack, position: drop.gap } };
  if ('addTo' in drop) {
    const { dragged, arrangementAt } = drop.addTo;
    const sectionId = 'section' in dragged ? dragged.section : sheet.arrangement[dragged.arrangementAt];
    const targetId = sheet.arrangement[arrangementAt];
    if (sectionId === undefined || targetId === undefined) return null;
    return { ontoSection: { sectionId, targetId } };
  }
  if ('alternateToArrangement' in drop) {
    return { alternateIntoArrangement: { alternateId: drop.alternateToArrangement, position: drop.gap } };
  }
  return { alternateIntoScrapbook: drop.alternateToScrapbook };
}

/** A change with nothing to say about it and no editor to close. */
function plain(change: LyricSheetChange): SectionMove {
  return { change, notice: null, closes: null };
}

function sectionById(sheet: Sheet, id: number): Section | undefined {
  return sheet.sections.find((s) => s.id === id);
}

/** The Section, if it's in the Scrapbook, so its editor there closes as it leaves; else null. */
function leavesScrapbook(sheet: Sheet, sectionId: number): number | null {
  return sheet.scrapbook.includes(sectionId) ? sectionId : null;
}
