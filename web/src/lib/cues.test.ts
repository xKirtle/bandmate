import { describe, expect, it } from 'vitest';
import {
  canShiftCuesEarlier,
  cuesInSpan,
  currentPosition,
  everyCue,
  maxCue,
  formatCue,
  hasCues,
  lastCue,
  leadIn,
  linesByRow,
  nextLine,
  nudgeCue,
  outOfOrderCues,
  outOfOrderReason,
  parseCue,
  playLabel,
  type ChordedLine,
  type CuedSong,
} from './cues';

type Sections<L> = readonly { id: number; alternates: readonly { active: boolean; lines: readonly L[] }[] }[];

// Gives each Line of the Sections its Cue from cues, by Line id, or none.
function withCues<L extends { id: number }>(sections: Sections<L>, cues: Record<number, number> = {}) {
  return sections.map((s) => ({
    ...s,
    alternates: s.alternates.map((a) => ({ ...a, lines: a.lines.map((l) => ({ ...l, cue: cues[l.id] ?? null })) })),
  }));
}

// A Song of the Sections, all in the Arrangement in the order given, with the Cues given by Line id.
function cuedSong<L extends { id: number; text: string }>(sections: Sections<L>, cues: Record<number, number> = {}) {
  return { arrangement: sections.map((s) => s.id), sections: withCues(sections, cues) };
}

describe('parseCue', () => {
  it('reads plain seconds', () => {
    expect(parseCue('45')).toBe(45);
    expect(parseCue('45.25')).toBe(45.25);
    expect(parseCue('0')).toBe(0);
    expect(parseCue('90')).toBe(90);
  });

  it('reads minutes and seconds', () => {
    expect(parseCue('0:45')).toBe(45);
    expect(parseCue('0:45.25')).toBe(45.25);
    expect(parseCue('1:02')).toBe(62);
    expect(parseCue('12:00.5')).toBe(720.5);
  });

  it('ignores surrounding spaces', () => {
    expect(parseCue('  1:02 ')).toBe(62);
  });

  it('keeps no more than millisecond precision', () => {
    expect(parseCue('1.23456')).toBe(1.235);
  });

  it('rejects anything that is not a time', () => {
    for (const text of ['', ' ', 'abc', '1:', ':45', '1:2:3', '1:60', '1:5', '4 5', '1e3', '.', '45.']) {
      expect(parseCue(text), text).toBeNull();
    }
  });

  it('rejects negative times', () => {
    expect(parseCue('-3')).toBeNull();
    expect(parseCue('-0:03')).toBeNull();
  });
});

describe('formatCue', () => {
  it('shows minutes, seconds and tenths', () => {
    expect(formatCue(0)).toBe('0:00.0');
    expect(formatCue(45.25)).toBe('0:45.3');
    expect(formatCue(62)).toBe('1:02.0');
    expect(formatCue(720.5)).toBe('12:00.5');
  });

  it('rounds up into the next minute', () => {
    expect(formatCue(59.96)).toBe('1:00.0');
  });

  it('reads back as the time it shows', () => {
    expect(parseCue(formatCue(83.4))).toBe(83.4);
  });
});

describe('currentPosition', () => {
  // Sections in order, with the active Alternate's Lines given.
  function sheet(sections: { id: number; lineCues?: Record<number, number>; lines?: string[] }[]): CuedSong {
    let lineId = 100;
    const cues = Object.assign({}, ...sections.map((s) => s.lineCues ?? {}));
    return cuedSong(
      sections.map((s) => ({
        id: s.id,
        alternates: [{ active: true, lines: (s.lines ?? []).map((text) => ({ id: lineId++, text })) }],
      })),
      cues,
    );
  }

  // A Verse whose Lines (100–103) are sung at 10, 14 and 18, with a blank
  // Line between; then a Chorus (104) at 0:30; then an Outro (105) uncued.
  const song = sheet([
    { id: 1, lines: ['One', 'Two', '', 'Three'], lineCues: { 100: 10, 101: 14, 103: 18 } },
    { id: 2, lines: ['Hook'], lineCues: { 104: 30 } },
    { id: 3, lines: ['Fade'] },
  ]);

  it('is nothing before the first Line Cue', () => {
    expect(currentPosition(song, 0)).toBeNull();
    expect(currentPosition(song, 9.999)).toBeNull();
  });

  it('is the Line whose Cue has most recently passed', () => {
    expect(currentPosition(song, 10)).toEqual({ section: 1, line: 100 });
    expect(currentPosition(song, 14.5)).toEqual({ section: 1, line: 101 });
    expect(currentPosition(song, 30)).toEqual({ section: 2, line: 104 });
  });

  it('keeps a Line current until the next Cue', () => {
    expect(currentPosition(song, 17.99)).toEqual({ section: 1, line: 101 });
    expect(currentPosition(song, 29)).toEqual({ section: 1, line: 103 });
    expect(currentPosition(song, 400)).toEqual({ section: 2, line: 104 });
  });

  it('is only ever a Line, never a whole Section', () => {
    for (const t of [10, 20, 31, 400]) expect(currentPosition(song, t)?.line).not.toBeNull();
  });

  it('follows time rather than the Arrangement', () => {
    const outOfOrder = sheet([
      { id: 1, lines: ['A'], lineCues: { 100: 40 } },
      { id: 2, lines: ['B'], lineCues: { 101: 5 } },
      { id: 3, lines: ['C'], lineCues: { 102: 20 } },
    ]);
    expect(currentPosition(outOfOrder, 6)?.section).toBe(2);
    expect(currentPosition(outOfOrder, 25)?.section).toBe(3);
    expect(currentPosition(outOfOrder, 45)?.section).toBe(1);
  });

  it('is nothing without any Cues', () => {
    expect(currentPosition(sheet([{ id: 1, lines: ['One'] }]), 12)).toBeNull();
    expect(currentPosition(sheet([]), 12)).toBeNull();
  });

  it('picks the later Line of two cued at the same time', () => {
    const tied = sheet([
      { id: 1, lines: ['A'], lineCues: { 100: 5 } },
      { id: 2, lines: ['B'], lineCues: { 101: 5 } },
    ]);
    expect(currentPosition(tied, 6)).toEqual({ section: 2, line: 101 });
  });

  describe('ignoring a Line being retaken', () => {
    // A Verse whose Lines (100–102) are sung at 10, 14 and 18.
    const song = sheet([{ id: 1, lines: ['One', 'Two', 'Three'], lineCues: { 100: 10, 101: 14, 102: 18 } }]);
    const retaking = { section: 1, line: 101 };

    it("keeps the Line before it current past its old Cue", () => {
      expect(currentPosition(song, 15, retaking)).toEqual({ section: 1, line: 100 });
    });

    it('goes on to the Line after it at that Line\'s Cue', () => {
      expect(currentPosition(song, 18, retaking)).toEqual({ section: 1, line: 102 });
    });

    it('is nothing before the first Cue left', () => {
      expect(currentPosition(song, 12, { section: 1, line: 100 })).toBeNull();
    });

    it("ignores only that Line's Cue", () => {
      expect(currentPosition(song, 15, { section: 1, line: 100 })).toEqual({ section: 1, line: 101 });
    });
  });

  describe('with dormant Line Cues', () => {
    // A Verse whose inactive Alternate A (Lines 50–51) was cued at 12 and
    // 16; its active Alternate B (Lines 60–61) has only 60 cued, at 20.
    const song = cuedSong(
      [
        {
          id: 9,
          alternates: [
            {
              active: false,
              lines: [
                { id: 50, text: 'Old one' },
                { id: 51, text: 'Old two' },
              ],
            },
            {
              active: true,
              lines: [
                { id: 60, text: 'New one' },
                { id: 61, text: 'New two' },
              ],
            },
          ],
        },
      ],
      { 50: 12, 51: 16, 60: 20 },
    );

    it('ignores them, keeping the active Line current', () => {
      expect(currentPosition(song, 21)).toEqual({ section: 9, line: 60 });
    });

    it('is nothing when only dormant Cues are past', () => {
      expect(currentPosition(song, 17)).toBeNull();
    });
  });
});

describe('hasCues', () => {
  const sections = [
    {
      id: 9,
      alternates: [
        { active: false, lines: [{ id: 50, text: 'Old' }] },
        { active: true, lines: [{ id: 60, text: 'New' }] },
      ],
    },
  ];

  it('is false without any Cues', () => {
    expect(hasCues(cuedSong(sections))).toBe(false);
  });

  it('counts a Line Cue of the active Alternate', () => {
    expect(hasCues(cuedSong(sections, { 60: 3 }))).toBe(true);
  });

  it('ignores dormant Cues', () => {
    expect(hasCues(cuedSong(sections, { 50: 3 }))).toBe(false);
  });
});

describe('lastCue', () => {
  const sections = [
    {
      id: 9,
      alternates: [
        { active: false, lines: [{ id: 50, text: 'Old' }] },
        { active: true, lines: [{ id: 60, text: 'New' }] },
      ],
    },
  ];

  it('is null without any Cues', () => {
    expect(lastCue(cuedSong(sections))).toBeNull();
  });

  it('is the latest Line Cue of the active Alternate', () => {
    const song = cuedSong([...sections, { id: 10, alternates: [{ active: true, lines: [{ id: 70, text: 'Later' }] }] }], {
      60: 20,
      70: 8,
    });
    expect(lastCue(song)).toBe(20);
  });

  it('counts a Cue at 0:00', () => {
    expect(lastCue(cuedSong(sections, { 60: 0 }))).toBe(0);
  });

  it('ignores dormant Cues', () => {
    expect(lastCue(cuedSong(sections, { 60: 5, 50: 40 }))).toBe(5);
    expect(lastCue(cuedSong(sections, { 50: 40 }))).toBeNull();
  });
});

describe('cuesInSpan', () => {
  const sections = [
    {
      id: 9,
      alternates: [
        { active: false, lines: [{ id: 50, text: 'Old' }] },
        {
          active: true,
          lines: [
            { id: 60, text: 'New' },
            { id: 61, text: 'Newer' },
          ],
        },
      ],
    },
  ];
  const song = cuedSong(
    [
      ...sections,
      {
        id: 10,
        alternates: [
          {
            active: true,
            lines: [
              { id: 70, text: 'Hook' },
              { id: 71, text: 'Line' },
            ],
          },
        ],
      },
      { id: 11, alternates: [{ active: true, lines: [{ id: 80, text: 'Fade' }] }] },
    ],
    { 60: 10, 61: 14, 50: 12, 70: 20, 71: 25 },
  );

  it('finds the Line Cues from the start of the span up to its end', () => {
    expect(cuesInSpan(song, 14, 25)).toEqual([
      { section: 9, line: 61, cue: 14 },
      { section: 10, line: 70, cue: 20 },
    ]);
  });

  it('finds dormant Cues too, which move along with the rest', () => {
    expect(cuesInSpan(song, 11, 13)).toEqual([{ section: 9, line: 50, cue: 12 }]);
  });

  it('finds nothing in an empty span', () => {
    expect(cuesInSpan(song, 10, 10)).toEqual([]);
  });
});

describe('nudgeCue', () => {
  it('moves a Cue by a tenth of a second, keeping millisecond precision', () => {
    expect(nudgeCue(45.25, 1)).toBe(45.35);
    expect(nudgeCue(45.25, -1)).toBe(45.15);
    expect(nudgeCue(0.3, -1)).toBe(0.2);
  });

  it('stops at the start of the Timeline', () => {
    expect(nudgeCue(0.05, -1)).toBe(0);
    expect(nudgeCue(0, -1)).toBe(0);
  });
});

describe('nextLine', () => {
  // Sections by id, each with its active Alternate's Lines, ids given; a
  // line starting with "[" holds only Chords. Each also has an inactive
  // Alternate with a Line numbered 900 on from its id. The Arrangement in
  // order, by Section id, with Cues by Line id.
  function sheet(
    sections: Record<number, [number, string][]>,
    order: number[],
    cues: Record<number, number> = {},
  ): CuedSong<ChordedLine> {
    const all = Object.entries(sections).map(([id, lines]) => ({
      id: Number(id),
      alternates: [
        { active: false, lines: [{ id: 900 + Number(id), text: 'Dormant', chordLine: false }] },
        { active: true, lines: lines.map(([id, text]) => ({ id, text, chordLine: text.startsWith('[') })) },
      ],
    }));
    return { arrangement: order, sections: withCues(all, cues) };
  }

  const lines: Record<number, [number, string][]> = {
    1: [
      [10, 'One'],
      [11, 'Two'],
    ],
    2: [
      [20, 'Hook'],
      [21, 'Line'],
    ],
  };
  const song = sheet(lines, [1, 2]);

  describe('with none clicked or just cued', () => {
    it('is the first Line of the Arrangement without Cues', () => {
      expect(nextLine(song, {})).toEqual({ section: 1, line: 10 });
    });

    it('is the first Line without a Cue', () => {
      const partly = sheet(lines, [1, 2], { 10: 1, 11: 2, 21: 8 });
      expect(nextLine(partly, {})).toEqual({ section: 2, line: 20 });
    });

    it('is the first Line of the Arrangement once every Line is cued', () => {
      const all = sheet(lines, [1, 2], { 10: 1, 11: 2, 20: 5, 21: 8 });
      expect(nextLine(all, {})).toEqual({ section: 1, line: 10 });
    });

    it("doesn't count a dormant Cue", () => {
      const dormant = sheet(lines, [1, 2], { 901: 1, 11: 2 });
      expect(nextLine(dormant, {})).toEqual({ section: 1, line: 10 });
    });

    it('is nothing without a Line to cue', () => {
      expect(nextLine(sheet({ 1: [[10, '[Am]']] }, [1]), {})).toBeNull();
    });
  });

  describe('after cueing a Line', () => {
    it('is the Line after it', () => {
      expect(nextLine(song, { cued: { section: 1, line: 10 } })).toEqual({ section: 1, line: 11 });
    });

    it('is the Line after it even if that one is cued', () => {
      const cued = sheet(lines, [1, 2], { 10: 1, 11: 2 });
      expect(nextLine(cued, { cued: { section: 1, line: 10 } })).toEqual({ section: 1, line: 11 });
    });

    it('goes on into the next Section after its last Line', () => {
      expect(nextLine(song, { cued: { section: 1, line: 11 } })).toEqual({ section: 2, line: 20 });
    });

    it('after the last Line, is the first Line without a Cue', () => {
      const partly = sheet(lines, [1, 2], { 10: 1 });
      expect(nextLine(partly, { cued: { section: 2, line: 21 } })).toEqual({ section: 1, line: 11 });
    });

    it("after the last Line, takes it as cued while its Cue isn't saved yet", () => {
      const unsaved = sheet(lines, [1, 2], { 10: 1, 11: 2, 20: 5 });
      expect(nextLine(unsaved, { cued: { section: 2, line: 21 } })).toEqual({ section: 1, line: 10 });
    });
  });

  it('skips blank Lines', () => {
    const spaced = sheet(
      {
        1: [
          [10, '  '],
          [11, 'One'],
          [12, ''],
          [13, 'Two'],
        ],
      },
      [1],
    );
    expect(nextLine(spaced, {})).toEqual({ section: 1, line: 11 });
    expect(nextLine(spaced, { cued: { section: 1, line: 11 } })).toEqual({ section: 1, line: 13 });
  });

  it('skips Chord Lines', () => {
    const intro = sheet(
      {
        1: [
          [10, '[Am] [G]'],
          [11, 'One'],
          [12, '[F]'],
          [13, 'Two'],
        ],
      },
      [1],
    );
    expect(nextLine(intro, {})).toEqual({ section: 1, line: 11 });
    expect(nextLine(intro, { cued: { section: 1, line: 11 } })).toEqual({ section: 1, line: 13 });
  });

  it('is a clicked Line, cued or not', () => {
    const cued = sheet(lines, [1, 2], { 10: 1, 11: 2 });
    const picked = { section: 1, line: 11 };
    expect(nextLine(cued, { picked })).toEqual(picked);
    expect(nextLine(cued, { cued: { section: 2, line: 20 }, picked })).toEqual(picked);
  });

});

describe('leadIn', () => {
  it('starts a second before a Cue', () => {
    expect(leadIn(38.5)).toBe(37.5);
    expect(leadIn(1)).toBe(0);
  });

  it('starts at 0:00 for a Cue under a second', () => {
    expect(leadIn(0.4)).toBe(0);
    expect(leadIn(0)).toBe(0);
  });
});

describe('linesByRow', () => {
  const saved = [
    { id: 1, text: 'one' },
    { id: 2, text: 'two' },
    { id: 3, text: 'three' },
  ];
  const ids = (text: string) => linesByRow(text, saved).map((l) => l?.id ?? null);

  it('matches each row to its Line while the text is as saved', () => {
    expect(ids('one\ntwo\nthree')).toEqual([1, 2, 3]);
  });

  it('keeps a Line being edited in place', () => {
    expect(ids('one\ntwo!\nthree')).toEqual([1, 2, 3]);
  });

  it('matches no Line to a row just typed, and keeps the Lines after it', () => {
    expect(ids('one\nnew\ntwo\nthree')).toEqual([1, null, 2, 3]);
    expect(ids('one\ntwo\nthree\n')).toEqual([1, 2, 3, null]);
    expect(ids('zero\none\ntwo\nthree')).toEqual([null, 1, 2, 3]);
  });

  it('keeps the Lines after one just deleted', () => {
    expect(ids('one\nthree')).toEqual([1, 3]);
  });

  it('matches rows by place where too much changed to tell', () => {
    expect(ids('a\nb')).toEqual([1, 2]);
    expect(ids('a\nb\nc\nd')).toEqual([1, 2, 3, null]);
  });

  it('gives an empty text box one row', () => {
    expect(linesByRow('', [])).toEqual([null]);
    expect(ids('')).toEqual([1]);
  });
});

describe('playLabel', () => {
  it('names what plays from where', () => {
    expect(playLabel('Line 3 of Verse 1', 38.5)).toBe('Play from Line 3 of Verse 1 at 0:38.5');
  });
});

describe('shifting every Cue', () => {
  const sections = [
    {
      id: 9,
      alternates: [
        { active: false, lines: [{ id: 50, text: 'Old' }] },
        { active: true, lines: [{ id: 60, text: 'New' }] },
      ],
    },
  ];
  // Section 9's active Line is cued at 3, and its dormant Line at 0.3; a
  // Line of Section 10 at 0:40.
  const song = cuedSong([...sections, { id: 10, alternates: [{ active: true, lines: [{ id: 70, text: 'Hook' }] }] }], {
    60: 3,
    50: 0.3,
    70: 40,
  });
  const uncued = cuedSong(sections);

  describe('everyCue', () => {
    it('takes every Cue, dormant ones included', () => {
      expect(cuesInSpan(song, everyCue.start, everyCue.end)).toHaveLength(3);
    });

    it('takes a Cue from 0:00 up to the latest a Cue can be', () => {
      const edges = cuedSong(sections, { 60: maxCue, 50: 0 });
      expect(cuesInSpan(edges, everyCue.start, everyCue.end)).toHaveLength(2);
    });
  });

  describe('canShiftCuesEarlier', () => {
    it('allows a step no bigger than the earliest Cue, dormant ones included', () => {
      expect(canShiftCuesEarlier(song, 0.1)).toBe(true);
    });

    it('allows a step that takes the earliest Cue exactly to 0:00', () => {
      expect(canShiftCuesEarlier(song, 0.3)).toBe(true);
      const tenths = cuedSong(sections, { 60: 0.7 });
      expect(canShiftCuesEarlier(tenths, 0.7)).toBe(true);
    });

    it('refuses a step that would take a dormant Cue before 0:00', () => {
      expect(canShiftCuesEarlier(song, 0.5)).toBe(false);
      expect(canShiftCuesEarlier(song, 1)).toBe(false);
    });

    it('refuses any step with a Cue at 0:00', () => {
      const atZero = cuedSong(sections, { 60: 0 });
      expect(canShiftCuesEarlier(atZero, 0.1)).toBe(false);
    });

    it('refuses without Cues, having none to shift', () => {
      expect(canShiftCuesEarlier(uncued, 0.1)).toBe(false);
    });
  });
});

describe('outOfOrderCues', () => {
  // Sections in order, with the active Alternate's Lines given; a dormant
  // Alternate's Lines are numbered from 900.
  function sheet(sections: { id: number; lineCues?: Record<number, number>; lines?: string[] }[]): CuedSong {
    let lineId = 100;
    const cues = Object.assign({}, ...sections.map((s) => s.lineCues ?? {}));
    return cuedSong(
      sections.map((s) => ({
        id: s.id,
        alternates: [
          { active: true, lines: (s.lines ?? []).map((text) => ({ id: lineId++, text })) },
          { active: false, lines: [{ id: 900 + s.id, text: 'Dormant' }] },
        ],
      })),
      cues,
    );
  }

  // The Cues out of order, by "section:line", each with why.
  function marked(song: CuedSong) {
    return new Map(
      outOfOrderCues(song).map(({ section, line, earlierThan, laterThan }) => [
        `${section}:${line}`,
        { earlierThan, laterThan },
      ]),
    );
  }

  it('marks both Cues of a pair out of order, each naming the other', () => {
    // Lines 4, 5 and 6 of a Chorus at 0:50, 1:00 and 0:55.
    const song = sheet([{ id: 1, lines: ['1', '2', '3', '4', '5', '6'], lineCues: { 103: 50, 104: 60, 105: 55 } }]);
    const marks = marked(song);
    expect([...marks.keys()].sort()).toEqual(['1:104', '1:105']);
    expect(marks.get('1:104')).toEqual({ earlierThan: null, laterThan: { section: 1, line: 105, cue: 55 } });
    expect(marks.get('1:105')).toEqual({ earlierThan: { section: 1, line: 104, cue: 60 }, laterThan: null });
  });

  it('runs down the whole Arrangement, across Sections', () => {
    // The Verse's last Line is cued after the Chorus's first.
    const song = sheet([
      { id: 1, lines: ['One', 'Two'], lineCues: { 100: 10, 101: 40 } },
      { id: 2, lines: ['Hook', 'Line'], lineCues: { 102: 30, 103: 50 } },
    ]);
    const marks = marked(song);
    expect([...marks.keys()].sort()).toEqual(['1:101', '2:102']);
    expect(marks.get('1:101')?.laterThan).toEqual({ section: 2, line: 102, cue: 30 });
    expect(marks.get('2:102')?.earlierThan).toEqual({ section: 1, line: 101, cue: 40 });
  });

  it('compares each Cue with the nearest cued Line either side, skipping uncued ones', () => {
    const song = sheet([
      { id: 1, lines: ['One', 'Two'], lineCues: { 100: 20 } },
      { id: 2, lines: ['Three', 'Four'], lineCues: { 103: 10 } },
    ]);
    expect([...marked(song).keys()].sort()).toEqual(['1:100', '2:103']);
  });

  it('takes Cues at the same time as in order', () => {
    const song = sheet([{ id: 1, lines: ['One', 'Two', 'Three'], lineCues: { 100: 10, 101: 10, 102: 10 } }]);
    expect(marked(song).size).toBe(0);
  });

  it('never marks or compares dormant Cues', () => {
    // The dormant Line's Cue sits between two in order, far from both.
    const song = sheet([
      { id: 1, lines: ['One'], lineCues: { 100: 10, 901: 99 } },
      { id: 2, lines: ['Two'], lineCues: { 101: 20, 902: 1 } },
    ]);
    expect(marked(song).size).toBe(0);
  });

  it("checks a Chord Line's Cue like any other", () => {
    const song: CuedSong<ChordedLine> = cuedSong(
      [
        {
          id: 1,
          alternates: [
            {
              active: true,
              lines: [
                { id: 1, text: '[Am] [G]', chordLine: true },
                { id: 2, text: 'Hello', chordLine: false },
              ],
            },
          ],
        },
      ],
      { 1: 10, 2: 5 },
    );
    expect([...marked(song).keys()].sort()).toEqual(['1:1', '1:2']);
  });

  it('clears both marks once either Cue of the pair is fixed', () => {
    const lines = ['1', '2', '3'];
    expect(marked(sheet([{ id: 1, lines, lineCues: { 100: 50, 101: 60, 102: 55 } }])).size).toBe(2);
    expect(marked(sheet([{ id: 1, lines, lineCues: { 100: 50, 101: 52, 102: 55 } }])).size).toBe(0);
    expect(marked(sheet([{ id: 1, lines, lineCues: { 100: 50, 101: 60, 102: 65 } }])).size).toBe(0);
  });

  it('can mark a Cue out of order with the Lines either side', () => {
    const song = sheet([{ id: 1, lines: ['1', '2', '3'], lineCues: { 100: 50, 101: 10, 102: 5 } }]);
    const marks = marked(song);
    expect(marks.get('1:101')).toEqual({
      earlierThan: { section: 1, line: 100, cue: 50 },
      laterThan: { section: 1, line: 102, cue: 5 },
    });
  });
});

describe('outOfOrderReason', () => {
  const name = (p: { line: number }) => `Line ${p.line} of Chorus`;

  it('says which Line the Cue is later or earlier than, and its time', () => {
    expect(outOfOrderReason({ earlierThan: null, laterThan: { section: 1, line: 6, cue: 55 } }, name)).toBe(
      'Later than Line 6 of Chorus (0:55.0)',
    );
    expect(outOfOrderReason({ earlierThan: { section: 1, line: 5, cue: 60 }, laterThan: null }, name)).toBe(
      'Earlier than Line 5 of Chorus (1:00.0)',
    );
  });

  it('gives both reasons when the Cue is out of order either side', () => {
    const reason = outOfOrderReason(
      { earlierThan: { section: 1, line: 1, cue: 50 }, laterThan: { section: 1, line: 3, cue: 5 } },
      name,
    );
    expect(reason).toBe('Earlier than Line 1 of Chorus (0:50.0); later than Line 3 of Chorus (0:05.0)');
  });
});
