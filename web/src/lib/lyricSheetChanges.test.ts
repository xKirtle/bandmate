import { describe, expect, it } from 'vitest';
import type { Section, Sheet } from './api';
import { changedSection, sheetCopy } from './lyricSheetChanges';

/** The Label, and the words, of each Section the sheets below are built from. */
const labels: Record<number, string> = { 1: 'Verse', 2: 'Chorus', 3: 'Bridge', 4: 'Idea', 5: 'Outro' };

/** A Section of one Line, its Label and its words the same, with one Alternate, active. */
const section = (id: number): Section => ({
  id,
  label: labels[id],
  alternates: [
    {
      id,
      name: '',
      active: true,
      lines: [{ id: id * 10, text: labels[id], lyrics: labels[id], chords: [], chordLine: false, cue: null }],
    },
  ],
});

/** A Lyric Sheet of the Sections given, by id, in the Arrangement and in the Scrapbook. */
const sheet = (arrangement: number[], scrapbook: number[] = []): Sheet => ({
  arrangement,
  scrapbook,
  sections: [...arrangement, ...scrapbook].map(section),
});

/** The sheet with one Section changed by the change given. */
const withSection = (s: Sheet, id: number, change: (was: Section) => Section): Sheet => ({
  ...s,
  sections: s.sections.map((was) => (was.id === id ? change(was) : was)),
});

/** The sheet with a Section's words rewritten. */
const rewrite = (s: Sheet, id: number, text: string): Sheet =>
  withSection(s, id, (was) => ({
    ...was,
    alternates: was.alternates.map((a) =>
      a.active ? { ...a, lines: a.lines.map((l) => ({ ...l, text, lyrics: text })) } : a,
    ),
  }));

/** The sheet with a Section's Label set. */
const relabel = (s: Sheet, id: number, label: string): Sheet => withSection(s, id, (was) => ({ ...was, label }));

/** The sheet with a second Alternate of a Section, inactive, named as given. */
const withAlternate = (s: Sheet, id: number, name: string): Sheet =>
  withSection(s, id, (was) => ({
    ...was,
    alternates: [...was.alternates, { id: id * 100, name, active: false, lines: [] }],
  }));

/** The sheet with a Section's last Alternate made its active one. */
const activateLast = (s: Sheet, id: number): Sheet =>
  withSection(s, id, (was) => ({
    ...was,
    alternates: was.alternates.map((a, i) => ({ ...a, active: i === was.alternates.length - 1 })),
  }));

describe('changedSection', () => {
  const plain = sheet([1, 2, 3], [4]);

  const cases: { what: string; from: Sheet; to: Sheet; section: number | null }[] = [
    // Strategy 1: written differently, or brought back.
    { what: 'a Section written differently', from: plain, to: rewrite(plain, 2, 'Sing'), section: 2 },
    { what: 'a Section labelled differently', from: plain, to: relabel(plain, 2, 'Chorus 1'), section: 2 },
    {
      what: 'an Alternate renamed',
      from: withAlternate(plain, 2, 'Softer'),
      to: withAlternate(plain, 2, 'Louder'),
      section: 2,
    },
    {
      what: 'an Alternate made the active one',
      from: activateLast(withAlternate(plain, 2, 'Softer'), 2),
      to: withAlternate(plain, 2, 'Softer'),
      section: 2,
    },
    { what: 'a Section brought back to the Arrangement', from: sheet([1, 3], [4]), to: plain, section: 2 },
    { what: 'a Section brought back to the Scrapbook', from: sheet([1, 2, 3]), to: plain, section: 4 },

    // Strategy 2: crossed between the Lyric Sheet and the Scrapbook, its own
    // words untouched. Undoing a move each way.
    { what: 'a Section taken out of the Arrangement', from: sheet([1, 3], [4, 2]), to: plain, section: 2 },
    { what: 'a Section put back into the Arrangement', from: sheet([1, 2, 3, 4]), to: plain, section: 4 },

    // Strategy 3: moved within the Arrangement or within the Scrapbook.
    { what: 'a Section moved within the Arrangement', from: sheet([2, 3, 1], [4]), to: plain, section: 1 },
    {
      what: 'a Section moved within the Scrapbook',
      from: sheet([1, 2, 3], [5, 4]),
      to: sheet([1, 2, 3], [4, 5]),
      section: 4,
    },
    // No one Section taken out makes the two orders the same, so this falls
    // to the walk for the first place they differ.
    {
      what: 'the Arrangement reordered by more than one move',
      from: sheet([3, 2, 1], [4]),
      to: plain,
      section: 1,
    },

    // Strategy 4: only gone.
    { what: 'a Section gone, the one after it left', from: plain, to: sheet([1, 3], [4]), section: 3 },
    { what: 'the last Section gone, the one before it left', from: plain, to: sheet([1, 2], [4]), section: 2 },
    { what: 'a Section gone from the Scrapbook', from: sheet([1], [4, 5]), to: sheet([1], [5]), section: 5 },

    { what: 'nothing changed', from: plain, to: plain, section: null },
  ];

  it.each(cases)('shows the Section for $what', ({ from, to, section: shown }) => {
    expect(changedSection(from, to)).toBe(shown);
  });

  it('shows the first changed Section in Arrangement order when a put-back changes more than one', () => {
    const from = sheet([3, 1, 2], [4]);
    const to = rewrite(rewrite(from, 1, 'Sing'), 3, 'Hum');
    expect(changedSection(from, to)).toBe(3);
  });

  it('shows a changed Section in the Arrangement before one in the Scrapbook', () => {
    const from = sheet([2, 3], [1]);
    const to = rewrite(rewrite(from, 1, 'Sing'), 3, 'Hum');
    expect(changedSection(from, to)).toBe(3);
  });

  it("shows none for a Section gone from a list with nothing else in it, not the other list's", () => {
    expect(changedSection(sheet([1], [4]), sheet([], [4]))).toBeNull();
  });
});

describe('sheetCopy', () => {
  it('keeps the Arrangement, the Scrapbook and what is written, with every id', () => {
    const s = sheet([1], [4]);
    expect(sheetCopy(rewrite(s, 1, 'Hel[Am]lo'))).toEqual({
      arrangement: [1],
      scrapbook: [4],
      sections: [
        {
          id: 1,
          label: 'Verse',
          alternates: [{ id: 1, name: '', active: true, lines: [{ id: 10, text: 'Hel[Am]lo', cue: null }] }],
        },
        {
          id: 4,
          label: 'Idea',
          alternates: [{ id: 4, name: '', active: true, lines: [{ id: 40, text: 'Idea', cue: null }] }],
        },
      ],
    });
  });
});
