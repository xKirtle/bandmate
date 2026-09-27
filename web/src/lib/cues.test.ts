import { describe, expect, it } from 'vitest';
import { currentPosition, formatCue, hasCues, nudgeCue, parseCue } from './cues';

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
  // One Section per Occurrence, with the active Alternate's Lines given.
  function sheet(
    occurrences: { id: number; cue: number | null; lineCues?: Record<number, number>; lines?: string[] }[],
  ) {
    let lineId = 100;
    const arrangement = occurrences.map((o) => ({
      id: o.id,
      sectionId: o.id,
      cue: o.cue,
      lineCues: o.lineCues ?? {},
    }));
    const sections = occurrences.map((o) => ({
      id: o.id,
      alternates: [{ active: true, lines: (o.lines ?? []).map((text) => ({ id: lineId++, text })) }],
    }));
    return { arrangement, sections };
  }

  describe('with only Occurrence Cues', () => {
    // Intro (no Cue), Verse at 0:10, Chorus at 0:30, Verse 2 at 0:50.
    const song = sheet([
      { id: 1, cue: null },
      { id: 2, cue: 10 },
      { id: 3, cue: 30 },
      { id: 4, cue: 50 },
    ]);

    it('is nothing before the first Cue', () => {
      expect(currentPosition(song, 0)).toBeNull();
      expect(currentPosition(song, 9.999)).toBeNull();
    });

    it('is the whole Section whose Cue has most recently passed', () => {
      expect(currentPosition(song, 10)).toEqual({ occurrence: 2, line: null });
      expect(currentPosition(song, 29.9)).toEqual({ occurrence: 2, line: null });
      expect(currentPosition(song, 30)).toEqual({ occurrence: 3, line: null });
      expect(currentPosition(song, 400)).toEqual({ occurrence: 4, line: null });
    });

    it('follows time rather than the Arrangement', () => {
      const outOfOrder = sheet([
        { id: 1, cue: 40 },
        { id: 2, cue: 5 },
        { id: 3, cue: 20 },
      ]);
      expect(currentPosition(outOfOrder, 6)?.occurrence).toBe(2);
      expect(currentPosition(outOfOrder, 25)?.occurrence).toBe(3);
      expect(currentPosition(outOfOrder, 45)?.occurrence).toBe(1);
    });

    it('is nothing without any Cues', () => {
      expect(currentPosition(sheet([{ id: 1, cue: null }]), 12)).toBeNull();
      expect(currentPosition(sheet([]), 12)).toBeNull();
    });

    it('picks the later Occurrence of two cued at the same time', () => {
      const tied = sheet([
        { id: 1, cue: 5 },
        { id: 2, cue: 5 },
      ]);
      expect(currentPosition(tied, 6)?.occurrence).toBe(2);
    });
  });

  describe('with Line Cues', () => {
    // A Verse at 0:10 whose Lines (100–103) are sung at 10, 14 and 18, with
    // a blank Line between; then a Chorus at 0:30 with no Line Cues.
    const song = sheet([
      {
        id: 1,
        cue: 10,
        lines: ['One', 'Two', '', 'Three'],
        lineCues: { 100: 10, 101: 14, 103: 18 },
      },
      { id: 2, cue: 30, lines: ['Hook'] },
    ]);

    it('is the Line whose Cue has most recently passed', () => {
      expect(currentPosition(song, 10)).toEqual({ occurrence: 1, line: 100 });
      expect(currentPosition(song, 14.5)).toEqual({ occurrence: 1, line: 101 });
    });

    it('keeps a Line current until the next Cue', () => {
      expect(currentPosition(song, 17.99)).toEqual({ occurrence: 1, line: 101 });
      expect(currentPosition(song, 29)).toEqual({ occurrence: 1, line: 103 });
    });

    it('is the whole Section once an Occurrence Cue without Line Cues passes', () => {
      expect(currentPosition(song, 31)).toEqual({ occurrence: 2, line: null });
    });

    it('is the first Line when the Occurrence Cue passes before its Lines are cued', () => {
      const partly = sheet([{ id: 1, cue: 10, lines: ['', 'One', 'Two'], lineCues: { 102: 15 } }]);
      expect(currentPosition(partly, 12)).toEqual({ occurrence: 1, line: 101 });
      expect(currentPosition(partly, 15)).toEqual({ occurrence: 1, line: 102 });
    });

    it('is a cued Line even when its Occurrence has no Cue of its own', () => {
      const lineOnly = sheet([{ id: 1, cue: null, lines: ['One', 'Two'], lineCues: { 101: 4 } }]);
      expect(currentPosition(lineOnly, 3)).toBeNull();
      expect(currentPosition(lineOnly, 4)).toEqual({ occurrence: 1, line: 101 });
    });

    it('picks the Line over its Occurrence when both are cued at the same time', () => {
      expect(currentPosition(song, 10.5)).toEqual({ occurrence: 1, line: 100 });
    });

    it('follows time across the Line Cues of shared Sections', () => {
      // The same Section in two Occurrences, its second Line cued in each.
      const shared = {
        arrangement: [
          { id: 1, sectionId: 9, cue: 0, lineCues: { 51: 4 } },
          { id: 2, sectionId: 9, cue: 20, lineCues: { 51: 24 } },
        ],
        sections: [
          {
            id: 9,
            alternates: [
              {
                active: true,
                lines: [
                  { id: 50, text: 'A' },
                  { id: 51, text: 'B' },
                ],
              },
            ],
          },
        ],
      };
      expect(currentPosition(shared, 5)).toEqual({ occurrence: 1, line: 51 });
      expect(currentPosition(shared, 21)).toEqual({ occurrence: 2, line: 50 });
      expect(currentPosition(shared, 25)).toEqual({ occurrence: 2, line: 51 });
    });
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

describe('hasCues', () => {
  const o = (cue: number | null, lineCues: Record<number, number> = {}) => ({ id: 1, sectionId: 1, cue, lineCues });

  it('is false without any Cue', () => {
    expect(hasCues({ arrangement: [] })).toBe(false);
    expect(hasCues({ arrangement: [o(null), o(null)] })).toBe(false);
  });

  it("counts an Occurrence's Cue, and a Line's, dormant or not", () => {
    expect(hasCues({ arrangement: [o(null), o(0)] })).toBe(true);
    expect(hasCues({ arrangement: [o(null, { 7: 3 })] })).toBe(true);
  });
});
