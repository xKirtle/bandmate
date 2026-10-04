import { describe, expect, it } from 'vitest';
import { lookUp, qualities, roots, standard } from './chordFinder';

const context = { tuning: standard, capo: 0 };

/** The Chord's notes, or null if the name can't be read. */
function notes(name: string): string[] | null {
  const found = lookUp(name, context);
  return found.kind === 'chord' ? found.notes : null;
}

/** The name a spelling reads as, or null if it can't be read. */
function reads(name: string): string | null {
  const found = lookUp(name, context);
  return found.kind === 'chord' ? found.name : null;
}

describe('looking up a Chord name', () => {
  it("lists a major Chord's notes", () => {
    expect(notes('G')).toEqual(['G', 'B', 'D']);
  });
});

describe('reading every quality', () => {
  it("lists each quality's notes, root first", () => {
    const expected: Record<string, string> = {
      C: 'C E G',
      Cm: 'C Eb G',
      C5: 'C G',
      C6: 'C E G A',
      Cm6: 'C Eb G A',
      C7: 'C E G Bb',
      Cmaj7: 'C E G B',
      Cm7: 'C Eb G Bb',
      CmMaj7: 'C Eb G B',
      Cdim: 'C Eb Gb',
      Cdim7: 'C Eb Gb A',
      Cm7b5: 'C Eb Gb Bb',
      Caug: 'C E G#',
      Csus2: 'C D G',
      Csus4: 'C F G',
      C7sus4: 'C F G Bb',
      Cadd9: 'C E G D',
      Cmadd9: 'C Eb G D',
      C9: 'C E G Bb D',
      Cmaj9: 'C E G B D',
      Cm9: 'C Eb G Bb D',
      C11: 'C E G Bb D F',
      C13: 'C E G Bb D A',
      C7b9: 'C E G Bb Db',
      'C7#9': 'C E G Bb D#',
    };
    for (const [name, list] of Object.entries(expected)) expect(notes(name), name).toEqual(list.split(' '));
  });

  it('spells notes from the root, so each letter follows its degree', () => {
    expect(notes('F#')).toEqual(['F#', 'A#', 'C#']);
    expect(notes('Eb')).toEqual(['Eb', 'G', 'Bb']);
    expect(notes('Bbm7')).toEqual(['Bb', 'Db', 'F', 'Ab']);
    expect(notes('Db')).toEqual(['Db', 'F', 'Ab']);
  });

  it('reads every root the picker offers, C to B with sharps and flats', () => {
    expect(roots).toEqual([
      'C',
      'C#',
      'Db',
      'D',
      'D#',
      'Eb',
      'E',
      'F',
      'F#',
      'Gb',
      'G',
      'G#',
      'Ab',
      'A',
      'A#',
      'Bb',
      'B',
    ]);
    for (const root of roots) expect(reads(root + 'm7')).toBe(root + 'm7');
  });

  it('offers every quality in the known set, in order, each read back by its own name', () => {
    expect(qualities.map((q) => q.label)).toEqual(
      'major m 5 6 m6 7 maj7 m7 mMaj7 dim dim7 m7b5 aug sus2 sus4 7sus4 add9 madd9 9 maj9 m9 11 13 7b9 7#9'.split(' '),
    );
    for (const q of qualities) expect(reads('A' + q.suffix)).toBe('A' + q.suffix);
  });
});

describe('spelling variants', () => {
  it('reads a major seventh written maj7, M7 or Δ7', () => {
    for (const name of ['Cmaj7', 'CM7', 'CΔ7', 'CΔ', 'CMaj7']) expect(reads(name), name).toBe('Cmaj7');
  });

  it('reads minor written m, min or -', () => {
    for (const name of ['Cm', 'Cmin', 'C-']) expect(reads(name), name).toBe('Cm');
    for (const name of ['Cm7', 'Cmin7', 'C-7']) expect(reads(name), name).toBe('Cm7');
    for (const name of ['CmMaj7', 'CmM7', 'Cminmaj7', 'C-Δ7', 'Cm(maj7)']) expect(reads(name), name).toBe('CmMaj7');
  });

  it('reads the other common spellings', () => {
    expect(reads('C°')).toBe('Cdim');
    expect(reads('C°7')).toBe('Cdim7');
    expect(reads('Cø')).toBe('Cm7b5');
    expect(reads('Cm7(b5)')).toBe('Cm7b5');
    expect(reads('Cm7♭5')).toBe('Cm7b5');
    expect(reads('C+')).toBe('Caug');
    expect(reads('Csus')).toBe('Csus4');
    expect(reads('C7sus')).toBe('C7sus4');
    expect(reads('C7(#9)')).toBe('C7#9');
    expect(reads('Cmaj')).toBe('C');
  });

  it('reads a sharp or flat root in ASCII or as a symbol', () => {
    expect(reads('F♯m')).toBe('F#m');
    expect(reads('E♭7')).toBe('Eb7');
  });

  it('gives the root, quality and bass it read, as the pickers write them', () => {
    expect(lookUp('C-7/B♭', context)).toMatchObject({ root: 'C', quality: 'm7', bass: 'Bb' });
    expect(lookUp('F♯', context)).toMatchObject({ root: 'F#', quality: '', bass: null });
  });

  it('ignores spaces around the name', () => {
    expect(reads('  Am7 ')).toBe('Am7');
  });
});

describe('slash basses', () => {
  it("reads a bass that is one of the Chord's notes", () => {
    expect(lookUp('G/B', context)).toMatchObject({ kind: 'chord', name: 'G/B', notes: ['G', 'B', 'D'] });
  });

  it("adds a bass that isn't one of the Chord's notes to its notes", () => {
    expect(notes('D/F#')).toEqual(['D', 'F#', 'A']);
    expect(lookUp('C/Bb', context)).toMatchObject({ name: 'C/Bb', notes: ['C', 'E', 'G', 'Bb'] });
    expect(notes('Am7/G')).toEqual(['A', 'C', 'E', 'G']);
  });

  it('reads a slash bass on any quality', () => {
    expect(reads('Fmaj7/E')).toBe('Fmaj7/E');
    expect(reads('Bbm/D♭')).toBe('Bbm/Db');
  });
});

/** A Voicing written low string to high, x for muted, a fret above 9 in brackets: x32010. */
function shape(frets: (number | null)[]): string {
  return frets.map((f) => (f === null ? 'x' : f > 9 ? `(${f})` : String(f))).join('');
}

/** Every Voicing of a Chord, written as shapes, best first. */
function shapes(name: string, tuning = standard, capo = 0): string[] {
  const found = lookUp(name, { tuning, capo });
  return found.kind === 'chord' ? found.voicings.map((v) => shape(v.frets)) : [];
}

describe('Voicings in standard tuning', () => {
  it('ranks the shapes most players use first', () => {
    expect(shapes('C')[0]).toBe('x32010');
    expect(shapes('G')[0]).toBe('320003');
    expect(shapes('E')[0]).toBe('022100');
    expect(shapes('Am')[0]).toBe('x02210');
    expect(shapes('D')[0]).toBe('xx0232');
    expect(shapes('Em')[0]).toBe('022000');
    expect(shapes('A7')[0]).toBe('x02020');
  });

  it('ranks the F barre first, up the neck from the open strings', () => {
    expect(shapes('F')[0]).toBe('133211');
  });

  it('returns Voicings all the way up to the 12th fret, and none past it', () => {
    const all = shapes('G');
    expect(all).toContain('355433');
    expect(all).toContain('x(10)(12)(12)(12)(10)');
    const found = lookUp('G', context);
    if (found.kind !== 'chord') throw new Error('G should read');
    expect(found.voicings.every((v) => v.frets.every((f) => f === null || f <= 12))).toBe(true);
    expect(found.voicings.length).toBeGreaterThan(20);
  });

  it('ranks open and low Voicings before ones up the neck', () => {
    const all = shapes('G');
    expect(all.indexOf('320003')).toBeLessThan(all.indexOf('355433'));
    expect(all.indexOf('355433')).toBeLessThan(all.indexOf('x(10)(12)(12)(12)(10)'));
  });

  it('only returns shapes with the root and the third, or the sus note, or the fifth for a 5 Chord', () => {
    // E on the 6th string, B on the 5th: no G#, so not an E.
    expect(shapes('E')).not.toContain('022xxx');
    expect(shapes('E5')).toContain('022xxx');
    expect(shapes('Asus4')).toContain('x02230');
    expect(shapes('Dsus2')[0]).toBe('xx0230');
  });

  it('may leave out the fifth of a larger Chord, but not an altered one', () => {
    // C7 with no G: C E Bb C.
    expect(shapes('C7')).toContain('x3231x');
    // B dim needs its F: B D B is no B dim.
    expect(shapes('Bdim')).not.toContain('x204xx');
  });

  it('never mutes a string between sounding strings', () => {
    for (const name of ['G', 'C7', 'Fmaj7', 'Bm7b5']) {
      for (const s of shapes(name)) expect(s, `${name} ${s}`).toMatch(/^x*[^x]+x*$/);
    }
  });

  it('keeps the stretch to four frets and the fingers to four, a barre counting as one', () => {
    for (const name of ['C', 'F', 'Bb', 'Am7', 'D9']) {
      const found = lookUp(name, context);
      if (found.kind !== 'chord') throw new Error(`${name} should read`);
      for (const v of found.voicings) {
        const fretted = v.frets.filter((f): f is number => f !== null && f > 0);
        if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
        const fingers = v.barre ? 1 + fretted.filter((f) => f > v.barre!.fret).length : fretted.length;
        expect(fingers, `${name} ${shape(v.frets)}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('draws the barre a Voicing needs, across the strings it covers', () => {
    const found = lookUp('F', context);
    if (found.kind !== 'chord') throw new Error('F should read');
    expect(found.voicings[0].barre).toEqual({ fret: 1, from: 0, to: 5 });
    const c = lookUp('C', context);
    if (c.kind !== 'chord') throw new Error('C should read');
    expect(c.voicings[0].barre).toBeUndefined();
  });

  it("puts a slash Chord's bass lowest", () => {
    expect(shapes('G/B')[0]).toBe('x20003');
    expect(shapes('D/F#')[0]).toBe('200232');
    const found = lookUp('C/G', context);
    if (found.kind !== 'chord') throw new Error('C/G should read');
    for (const v of found.voicings) {
      const lowest = v.frets.findIndex((f) => f !== null);
      expect((standard[lowest] + v.frets[lowest]!) % 12, shape(v.frets)).toBe(7);
    }
  });

  it("doesn't put the same Voicing in twice", () => {
    const all = shapes('Am7');
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("names it can't read", () => {
  it('says so, never guessing at a near name', () => {
    for (const name of [
      '',
      'H7',
      'am',
      'Cmaj13',
      'C7b5',
      'Cmadd11',
      'Cm7b9',
      'Csus3',
      'C/',
      'C/H',
      'C/Bbb',
      'N.C.',
      'Cx',
    ]) {
      expect(lookUp(name, context), name).toEqual({ kind: 'unreadable', name });
    }
  });

  it('reads roots the way Transpose does, so solfège names stay unread', () => {
    for (const name of ['Do', 'Dom7', 'Fa#m', 'Sol']) expect(reads(name), name).toBeNull();
    expect(reads('Dm7')).toBe('Dm7');
    expect(reads('Fadd9')).toBe('Fadd9');
  });
});
