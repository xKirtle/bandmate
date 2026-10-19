import { describe as group, expect, it } from 'vitest';
import type { Alternate, Section, Sheet } from './api';
import type { Drop } from './sectionDrag';
import { dropMove, sectionMove, type Landing, type SectionMove } from './sectionMoves';

function alternate(id: number, active: boolean, ...texts: string[]): Alternate {
  return {
    id,
    name: '',
    active,
    lines: texts.map((text, i) => ({ id: id * 100 + i, text, lyrics: text, chords: [], chordLine: false, cue: null })),
  };
}

function section(id: number, label: string, ...alternates: Alternate[]): Section {
  return { id, label, alternates: alternates.length > 0 ? alternates : [alternate(id * 10, true, 'Lanterns')] };
}

/**
 * Three Sections in the Arrangement and two in the Scrapbook, as the drop
 * rule's fixtures have them: the last Scrapbook Section has nothing written
 * in it, and the Bridge's second Alternate is the one dragged out.
 */
const sheet: Sheet = {
  arrangement: [1, 2, 3],
  scrapbook: [7, 8],
  sections: [
    section(1, 'Verse 1'),
    section(2, 'Chorus'),
    section(3, 'Bridge', alternate(30, true, 'Harbour'), alternate(31, false, 'Lights')),
    section(7, 'Night swim'),
    section(8, '', alternate(80, true, '', '  ')),
  ],
};

/** A Section in the Arrangement with nothing written in it: taken out, it isn't kept. */
const emptyInArrangement: Sheet = {
  arrangement: [1, 9],
  scrapbook: [],
  sections: [section(1, 'Verse 1'), section(9, 'Hook', alternate(90, true, '', ' '))],
};

group('dropMove', () => {
  // Every landing a grip can produce, from each of the three grips: a Section
  // in the Arrangement, a Section in the Scrapbook, and an inactive Alternate.
  const cases: [string, Sheet, Drop, SectionMove | null][] = [
    [
      'a Section moved within the Arrangement',
      sheet,
      { reorder: { from: 2, to: 0 }, gap: 0 },
      { change: { kind: 'reorderArrangement', order: [3, 1, 2] }, notice: null, closes: null },
    ],
    [
      'a Section dropped on the Scrapbook',
      sheet,
      { toScrapbook: 1 },
      { change: { kind: 'removeFromArrangement', sectionId: 2 }, notice: null, closes: null },
    ],
    [
      'a Section with nothing written in it dropped on the Scrapbook',
      emptyInArrangement,
      { toScrapbook: 1 },
      {
        change: { kind: 'removeFromArrangement', sectionId: 9 },
        notice: "Nothing was written in Hook, so it wasn't kept.",
        closes: null,
      },
    ],
    [
      'a Section in the Arrangement dropped onto another',
      sheet,
      { addTo: { dragged: { arrangementAt: 2 }, arrangementAt: 1 } },
      {
        change: { kind: 'addToSection', sectionId: 3, targetId: 2 },
        notice: 'Bridge added to Chorus as Alternates',
        closes: null,
      },
    ],
    [
      'a Scrapbook Section dropped onto a Section in the Arrangement',
      sheet,
      { addTo: { dragged: { section: 7 }, arrangementAt: 1 } },
      {
        change: { kind: 'addToSection', sectionId: 7, targetId: 2 },
        notice: 'Night swim added to Chorus as an Alternate',
        closes: 7,
      },
    ],
    [
      'a Scrapbook Section dropped into a gap in the Arrangement',
      sheet,
      { putBack: 7, gap: 2 },
      { change: { kind: 'addToArrangement', sectionId: 7, position: 2 }, notice: null, closes: 7 },
    ],
    [
      'an Alternate dropped into a gap in the Arrangement',
      sheet,
      { alternateToArrangement: 31, gap: 1 },
      { change: { kind: 'moveAlternateToArrangement', alternateId: 31, position: 1 }, notice: null, closes: null },
    ],
    [
      'an Alternate dropped on the Scrapbook',
      sheet,
      { alternateToScrapbook: 31 },
      { change: { kind: 'moveAlternateToScrapbook', alternateId: 31 }, notice: null, closes: null },
    ],
    ['a Section no longer in the Arrangement, dropped on the Scrapbook', sheet, { toScrapbook: 9 }, null],
    [
      'a Section dropped onto one no longer in the Arrangement',
      sheet,
      { addTo: { dragged: { section: 7 }, arrangementAt: 9 } },
      null,
    ],
  ];

  it.each(cases)('is the change, the notice and the close for %s', (_what, on, drop, expected) => {
    expect(dropMove(on, drop)).toEqual(expected);
  });
});

group('sectionMove', () => {
  // The menu choices that do the same thing as a grip, by their landing.
  const cases: [string, Sheet, Landing, SectionMove | null][] = [
    [
      '↑ or ↓ on a Section in the Arrangement',
      sheet,
      { within: { from: 0, to: 1 } },
      { change: { kind: 'reorderArrangement', order: [2, 1, 3] }, notice: null, closes: null },
    ],
    [
      '"Move to the Scrapbook" on a Section in the Arrangement',
      sheet,
      { outOfArrangement: 2 },
      { change: { kind: 'removeFromArrangement', sectionId: 2 }, notice: null, closes: null },
    ],
    [
      '"Delete this Section" on one with nothing written in it',
      emptyInArrangement,
      { outOfArrangement: 9 },
      {
        change: { kind: 'removeFromArrangement', sectionId: 9 },
        notice: "Nothing was written in Hook, so it wasn't kept.",
        closes: null,
      },
    ],
    [
      '"Add as an Alternate of…" on a Section in the Arrangement',
      sheet,
      { ontoSection: { sectionId: 1, targetId: 2 } },
      {
        change: { kind: 'addToSection', sectionId: 1, targetId: 2 },
        notice: 'Verse 1 added to Chorus as an Alternate',
        closes: null,
      },
    ],
    [
      '"Add as an Alternate of…" on a Section in the Scrapbook',
      sheet,
      { ontoSection: { sectionId: 8, targetId: 2 } },
      {
        change: { kind: 'addToSection', sectionId: 8, targetId: 2 },
        notice: 'Section without a Label added to Chorus as an Alternate',
        closes: 8,
      },
    ],
    [
      '"Put back into the Lyric Sheet…" at a place',
      sheet,
      { intoArrangement: { sectionId: 7, position: 0 } },
      { change: { kind: 'addToArrangement', sectionId: 7, position: 0 }, notice: null, closes: 7 },
    ],
    [
      '"Put back into the Lyric Sheet…" with no place, which is the end',
      sheet,
      { intoArrangement: { sectionId: 7 } },
      { change: { kind: 'addToArrangement', sectionId: 7, position: undefined }, notice: null, closes: 7 },
    ],
    [
      '"Move to the Lyric Sheet…" on an inactive Alternate',
      sheet,
      { alternateIntoArrangement: { alternateId: 31, position: 3 } },
      { change: { kind: 'moveAlternateToArrangement', alternateId: 31, position: 3 }, notice: null, closes: null },
    ],
    [
      '"Move to the Scrapbook" on an inactive Alternate',
      sheet,
      { alternateIntoScrapbook: 31 },
      { change: { kind: 'moveAlternateToScrapbook', alternateId: 31 }, notice: null, closes: null },
    ],
    ['a Section no longer there taken out of the Arrangement', sheet, { outOfArrangement: 9 }, null],
    ['a Section no longer there put back', sheet, { intoArrangement: { sectionId: 9 } }, null],
    ['a Section added to one no longer there', sheet, { ontoSection: { sectionId: 7, targetId: 9 } }, null],
  ];

  it.each(cases)('is the change, the notice and the close for %s', (_what, on, landing, expected) => {
    expect(sectionMove(on, landing)).toEqual(expected);
  });
});
