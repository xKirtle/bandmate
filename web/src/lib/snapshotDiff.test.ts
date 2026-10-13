import { describe, expect, it } from 'vitest';
import type { Line, Section } from './api';
import { compareSheets, type SectionRow, type Sheet } from './snapshotDiff';

const line = (id: number, text: string, cue: number | null = null): Line => ({
  id,
  text,
  lyrics: text,
  chords: [],
  chordLine: false,
  cue,
});

const section = (id: number, label: string, lines: Line[], inactive: Line[] = []): Section => ({
  id,
  label,
  alternates: [
    { id: id * 100, name: '', active: true, lines },
    ...(inactive.length > 0 ? [{ id: id * 100 + 1, name: 'B', active: false, lines: inactive }] : []),
  ],
});

const sheet = (arrangement: Section[], scrapbook: Section[] = []): Sheet => ({
  arrangement: arrangement.map((s) => s.id),
  scrapbook: scrapbook.map((s) => s.id),
  sections: [...arrangement, ...scrapbook],
});

/** Each row as [then's Line, now's Line, whether it differs], by text, '' for a side it isn't on. */
const rows = (s: SectionRow) => s.lines.map((r) => [r.then?.text ?? '', r.now?.text ?? '', r.differs]);
/** Each Section row as [then's Label, now's Label], '' for a side it isn't on. */
const sides = (list: SectionRow[]) => list.map((s) => [s.then?.label ?? '', s.now?.label ?? '']);

const verse = section(1, 'Verse', [line(10, 'One'), line(11, 'Two'), line(12, 'Three')]);

describe('compareSheets', () => {
  it('lines up a Song that is the same, nothing differing', () => {
    const { arrangement, scrapbook } = compareSheets(sheet([verse]), sheet([verse]));
    expect(sides(arrangement)).toEqual([['Verse', 'Verse']]);
    expect(rows(arrangement[0])).toEqual([
      ['One', 'One', false],
      ['Two', 'Two', false],
      ['Three', 'Three', false],
    ]);
    expect(arrangement[0].labelDiffers).toBe(false);
    expect(scrapbook).toEqual([]);
  });

  it('marks a Line whose text changed, on the same row', () => {
    const now = section(1, 'Verse', [line(10, 'One'), line(11, 'Tw[G]o'), line(12, 'Three')]);
    expect(rows(compareSheets(sheet([verse]), sheet([now])).arrangement[0])).toEqual([
      ['One', 'One', false],
      ['Two', 'Tw[G]o', true],
      ['Three', 'Three', false],
    ]);
  });

  it("doesn't count a Line whose Cue alone changed", () => {
    const now = section(1, 'Verse', [line(10, 'One', 4.5), line(11, 'Two'), line(12, 'Three')]);
    expect(rows(compareSheets(sheet([verse]), sheet([now])).arrangement[0])[0]).toEqual(['One', 'One', false]);
  });

  it('shows a Line only in the Snapshot on its side alone, where it was', () => {
    const now = section(1, 'Verse', [line(10, 'One'), line(12, 'Three')]);
    expect(rows(compareSheets(sheet([verse]), sheet([now])).arrangement[0])).toEqual([
      ['One', 'One', false],
      ['Two', '', true],
      ['Three', 'Three', false],
    ]);
  });

  it('shows a Line only now on its side alone, where it is', () => {
    const now = section(1, 'Verse', [
      line(13, 'Zero'),
      line(10, 'One'),
      line(11, 'Two'),
      line(12, 'Three'),
      line(14, 'Four'),
    ]);
    expect(rows(compareSheets(sheet([verse]), sheet([now])).arrangement[0])).toEqual([
      ['', 'Zero', true],
      ['One', 'One', false],
      ['Two', 'Two', false],
      ['Three', 'Three', false],
      ['', 'Four', true],
    ]);
  });

  it('matches Lines by id, not by text', () => {
    const now = section(1, 'Verse', [line(10, 'One'), line(15, 'Two'), line(12, 'Three')]);
    expect(rows(compareSheets(sheet([verse]), sheet([now])).arrangement[0])).toEqual([
      ['One', 'One', false],
      ['Two', '', true],
      ['', 'Two', true],
      ['Three', 'Three', false],
    ]);
  });

  it('shows a Line that moved on each side where it is, as differing', () => {
    const now = section(1, 'Verse', [line(10, 'One'), line(12, 'Three'), line(11, 'Two')]);
    const lined = rows(compareSheets(sheet([verse]), sheet([now])).arrangement[0]);
    expect(lined.filter(([, , differs]) => !differs)).toHaveLength(2);
    expect(lined.filter(([then]) => then).map(([then]) => then)).toEqual(['One', 'Two', 'Three']);
    expect(lined.filter(([, now]) => now).map(([, now]) => now)).toEqual(['One', 'Three', 'Two']);
  });

  it("compares the active Alternates' Lines, so switching Alternates changes every Line", () => {
    const now: Section = {
      ...verse,
      alternates: [
        { ...verse.alternates[0], active: false },
        { id: 101, name: 'B', active: true, lines: [line(16, 'Uno')] },
      ],
    };
    expect(rows(compareSheets(sheet([verse]), sheet([now])).arrangement[0])).toEqual([
      ['One', '', true],
      ['Two', '', true],
      ['Three', '', true],
      ['', 'Uno', true],
    ]);
  });

  it('marks a Label that changed', () => {
    const now = { ...verse, label: 'Verse 1' };
    const [row] = compareSheets(sheet([verse]), sheet([now])).arrangement;
    expect(sides([row])).toEqual([['Verse', 'Verse 1']]);
    expect(row.labelDiffers).toBe(true);
  });

  it('shows a Section only in the Snapshot on its side alone, every Line differing', () => {
    const chorus = section(2, 'Chorus', [line(20, 'La')]);
    const { arrangement } = compareSheets(sheet([verse, chorus]), sheet([verse]));
    expect(sides(arrangement)).toEqual([
      ['Verse', 'Verse'],
      ['Chorus', ''],
    ]);
    expect(rows(arrangement[1])).toEqual([['La', '', true]]);
  });

  it('shows a Section only now on its side alone, where it is', () => {
    const intro = section(3, 'Intro', [line(30, 'Hey')]);
    const { arrangement } = compareSheets(sheet([verse]), sheet([intro, verse]));
    expect(sides(arrangement)).toEqual([
      ['', 'Intro'],
      ['Verse', 'Verse'],
    ]);
    expect(rows(arrangement[0])).toEqual([['', 'Hey', true]]);
  });

  it('compares the Scrapbook too, and a Section moved out of the Lyric Sheet into it is on each side where it is', () => {
    const idea = section(4, 'Idea', [line(40, 'Maybe')]);
    const { arrangement, scrapbook } = compareSheets(sheet([verse], [idea]), sheet([], [verse, idea]));
    expect(sides(arrangement)).toEqual([['Verse', '']]);
    expect(sides(scrapbook)).toEqual([
      ['', 'Verse'],
      ['Idea', 'Idea'],
    ]);
    expect(rows(scrapbook[1])).toEqual([['Maybe', 'Maybe', false]]);
  });
});
