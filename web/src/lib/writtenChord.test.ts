import { describe, expect, it } from 'vitest';
import { chordName, nameIt, qualities, roots, standard } from './chordFinder';
import { bracketedChordWithSongVoicing, readWrittenChord, writtenChords } from './writtenChord';

// The same cases as the server's, in internal/app/chords_test.go: the two must agree on what's a Chord.
describe('readWrittenChord', () => {
  it('reads a Chord name', () => {
    const names = [
      'A', 'B', 'C', 'D', 'E', 'F', 'G',
      'C#', 'Bb', 'F♯', 'E♭',
      'Am', 'Cmaj7', 'Dm7', 'G7', 'Esus4', 'Asus2', 'Cadd9', 'Bdim', 'Caug', 'C+',
      'Bm7b5', 'G13', 'C6', 'Dmin', 'Fm(maj7)', 'E7(#9)', 'C7alt', 'A5', 'Bø', 'C°7',
      'C6/9', 'Cmi7', 'Cma7', 'A6/9/E', 'CmMaj7', 'CMaj7',
      'D/F#', 'G/B', 'Am7/G', 'C#m/G#', 'Bb/Ab', 'CmMaj7/G',
    ]; // prettier-ignore
    for (const name of names) expect(readWrittenChord(name), name).toEqual({ name, songVoicing: null });
  });

  it('reads a Chord with its Song Voicing, written one character a fret or parted by dashes', () => {
    expect(readWrittenChord('Em:00002x')).toEqual({ name: 'Em', songVoicing: [0, 0, 0, 0, 2, null] });
    expect(readWrittenChord('Em:0-0-0-0-2-x')).toEqual({ name: 'Em', songVoicing: [0, 0, 0, 0, 2, null] });
    expect(readWrittenChord('A:x-12-14-14-13-x')).toEqual({ name: 'A', songVoicing: [null, 12, 14, 14, 13, null] });
    expect(readWrittenChord('Em:x-0-9-9-x-x')).toEqual({ name: 'Em', songVoicing: [null, 0, 9, 9, null, null] });
    expect(readWrittenChord('D/F#:2x0232')).toEqual({ name: 'D/F#', songVoicing: [2, null, 0, 2, 3, 2] });
    expect(readWrittenChord('CmMaj7:x-3-5-4-4-3')).toEqual({ name: 'CmMaj7', songVoicing: [null, 3, 5, 4, 4, 3] });
    expect(readWrittenChord('C:x3201')).toEqual({ name: 'C', songVoicing: [null, 3, 2, 0, 1] });
  });

  it('reads every Chord name the Chord Finder gives, written in a Line', () => {
    for (const root of roots)
      for (const { suffix } of qualities)
        for (const bass of ['', '/' + root]) {
          const name = chordName(root + suffix + bass)!;
          expect(readBack(`la [${name}]la`), name).toEqual([{ name, songVoicing: null }]);
        }
  });

  it("reads nothing whose name or frets can't be read", () => {
    const unread = [
      'Chorus', 'x2', 'H', 'am', 'Add', 'C/H', 'C/', '', ' Am ',
      'Em:00z', 'foo:000000', 'Em:', ':000000', 'Em:0-0-0-0-2-', 'Em:-0-0', 'Em:0--0', 'Em:00-002x',
      'Em:X00000', 'Em: 000000', 'Em:00 0000', 'Em:000000:', 'Em:x-012-0', 'Em:x-123-0',
    ]; // prettier-ignore
    for (const text of unread) expect(readWrittenChord(text), text).toBeNull();
  });

  it('reads a four-string Song Voicing one character a fret, though it may look like frets of 10 and up', () => {
    expect(readWrittenChord('Em:1012')).toEqual({ name: 'Em', songVoicing: [1, 0, 1, 2] });
  });
});

describe('writtenChords', () => {
  it("gives each Chord of a Line's text as typed between its brackets, in order, as the server finds them", () => {
    expect(writtenChords('[G]Hel[Em:00002x]lo [Em:x-0-9-9-x-x]you')).toEqual(['G', 'Em:00002x', 'Em:x-0-9-9-x-x']);
  });

  it("skips brackets that aren't Chords, and finds one inside brackets around it", () => {
    expect(writtenChords('[Chorus] [Em:00z] [[Am]la] [x2] [G')).toEqual(['Am']);
    expect(writtenChords('no chords')).toEqual([]);
  });
});

describe('bracketedChordWithSongVoicing', () => {
  it('writes a Chord with its Song Voicing in its brackets, its frets parted by dashes, x for a muted string', () => {
    expect(bracketedChordWithSongVoicing('Em', [null, 0, 9, 9, null, null])).toBe('[Em:x-0-9-9-x-x]');
    expect(bracketedChordWithSongVoicing('A', [null, 12, 14, 14, 13, null])).toBe('[A:x-12-14-14-13-x]');
    expect(bracketedChordWithSongVoicing('D/F#', [2, null, 0, 2, 3, 2])).toBe('[D/F#:2-x-0-2-3-2]');
  });

  it('reads back, pasted into a Line, as the same Chord with the same Song Voicing', () => {
    const frets = [null, 12, 14, 14, 13, null];
    expect(readBack(bracketedChordWithSongVoicing('A', frets))).toEqual([{ name: 'A', songVoicing: frets }]);
    expect(readBack(`Hel${bracketedChordWithSongVoicing('A', frets)}lo`)).toEqual([{ name: 'A', songVoicing: frets }]);
  });

  it('reads back for every Chord name the Chord Finder gives', () => {
    const frets = [0, 2, 2, 1, 0, 0];
    for (const root of roots)
      for (const { suffix } of qualities)
        for (const bass of ['', '/' + root]) {
          const name = chordName(root + suffix + bass)!;
          expect(readBack(bracketedChordWithSongVoicing(name, frets)), name).toEqual([{ name, songVoicing: frets }]);
        }
    const named = nameIt([3, 2, 0, 0, 3, 3], { tuning: standard, instrument: 'guitar' });
    expect(named.kind === 'chord' && named.readings.length).toBeTruthy();
    for (const name of named.kind === 'chord' ? named.readings : [])
      expect(readBack(bracketedChordWithSongVoicing(name, frets)), name).toEqual([{ name, songVoicing: frets }]);
  });
});

/** Each Chord in a Line of this text, as read. */
function readBack(text: string) {
  return writtenChords(text).map(readWrittenChord);
}
