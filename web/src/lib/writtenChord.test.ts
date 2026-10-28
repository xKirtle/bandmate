import { describe, expect, it } from 'vitest';
import { readWrittenChord } from './writtenChord';

// The same cases as the server's, in internal/app/chords_test.go: the two must agree on what's a Chord.
describe('readWrittenChord', () => {
  it('reads a Chord name', () => {
    for (const name of ['A', 'C#', 'Bb', 'F♯', 'Am', 'Cmaj7', 'Bm7b5', 'Fm(maj7)', 'E7(#9)', 'C6/9', 'A6/9/E', 'D/F#'])
      expect(readWrittenChord(name)).toEqual({ name, songVoicing: null });
  });

  it('reads a Chord with its Song Voicing, written one character a fret or parted by dashes', () => {
    expect(readWrittenChord('Em:00002x')).toEqual({ name: 'Em', songVoicing: [0, 0, 0, 0, 2, null] });
    expect(readWrittenChord('Em:0-0-0-0-2-x')).toEqual({ name: 'Em', songVoicing: [0, 0, 0, 0, 2, null] });
    expect(readWrittenChord('A:x-12-14-14-13-x')).toEqual({ name: 'A', songVoicing: [null, 12, 14, 14, 13, null] });
    expect(readWrittenChord('Em:x-0-9-9-x-x')).toEqual({ name: 'Em', songVoicing: [null, 0, 9, 9, null, null] });
    expect(readWrittenChord('D/F#:2x0232')).toEqual({ name: 'D/F#', songVoicing: [2, null, 0, 2, 3, 2] });
    expect(readWrittenChord('C:x3201')).toEqual({ name: 'C', songVoicing: [null, 3, 2, 0, 1] });
  });

  it("reads nothing whose name or frets can't be read", () => {
    const unread = [
      'Chorus', 'x2', 'H', 'am', 'Add', 'C/H', 'C/', '', ' Am ',
      'Em:00z', 'foo:000000', 'Em:', ':000000', 'Em:0-0-0-0-2-', 'Em:-0-0', 'Em:0--0', 'Em:00-002x',
      'Em:X00000', 'Em: 000000', 'Em:00 0000', 'Em:000000:', 'Em:x-012-0', 'Em:x-123-0',
    ]; // prettier-ignore
    for (const text of unread) expect(readWrittenChord(text), text).toBeNull();
  });
});
