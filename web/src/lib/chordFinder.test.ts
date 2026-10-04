import { describe, expect, it } from 'vitest';
import {
  lookUp,
  qualities,
  readTuning,
  roots,
  standard,
  tuningName,
  tuningNotes,
  tunings,
  tuningText,
} from './chordFinder';

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
function written(frets: (number | null)[]): string {
  return frets.map((f) => (f === null ? 'x' : f > 9 ? `(${f})` : String(f))).join('');
}

/** Every Voicing of a Chord, written out, best first. */
function voicingsOf(name: string, tuning = standard, capo = 0): string[] {
  const found = lookUp(name, { tuning, capo });
  return found.kind === 'chord' ? found.voicings.map((v) => written(v.frets)) : [];
}

describe('Voicings in standard tuning', () => {
  it('ranks the Voicings most players use first', () => {
    expect(voicingsOf('C')[0]).toBe('x32010');
    expect(voicingsOf('G')[0]).toBe('320003');
    expect(voicingsOf('E')[0]).toBe('022100');
    expect(voicingsOf('Am')[0]).toBe('x02210');
    expect(voicingsOf('D')[0]).toBe('xx0232');
    expect(voicingsOf('Em')[0]).toBe('022000');
    expect(voicingsOf('A7')[0]).toBe('x02020');
  });

  it('ranks the F barre first, up the neck from the open strings', () => {
    expect(voicingsOf('F')[0]).toBe('133211');
  });

  it('ranks a barre before a Voicing that mixes open strings with a reach up the neck', () => {
    expect(voicingsOf('Bm')[0]).toBe('x24432');
    expect(voicingsOf('B')[0]).toBe('x24442');
  });

  it('returns Voicings all the way up to the 12th fret, and none past it', () => {
    const all = voicingsOf('G');
    expect(all).toContain('355433');
    expect(all).toContain('x(10)(12)(12)(12)(10)');
    const found = lookUp('G', context);
    if (found.kind !== 'chord') throw new Error('G should read');
    expect(found.voicings.every((v) => v.frets.every((f) => f === null || f <= 12))).toBe(true);
    expect(found.voicings.length).toBeGreaterThan(20);
  });

  it('ranks open and low Voicings before ones up the neck', () => {
    const all = voicingsOf('G');
    expect(all.indexOf('320003')).toBeLessThan(all.indexOf('355433'));
    expect(all.indexOf('355433')).toBeLessThan(all.indexOf('x(10)(12)(12)(12)(10)'));
  });

  it('only returns Voicings with the root and the third, or the sus note, or the fifth for a 5 Chord', () => {
    // E on the 6th string, B on the 5th: no G#, so not an E.
    expect(voicingsOf('E')).not.toContain('022xxx');
    expect(voicingsOf('E5')).toContain('022xxx');
    expect(voicingsOf('Asus4')).toContain('x02230');
    expect(voicingsOf('Dsus2')[0]).toBe('xx0230');
  });

  it('may leave out the fifth of a larger Chord, but not an altered one', () => {
    // C7 with no G: C E Bb C.
    expect(voicingsOf('C7')).toContain('x3231x');
    // B dim needs its F: B D B is no B dim.
    expect(voicingsOf('Bdim')).not.toContain('x204xx');
  });

  it('never mutes a string between sounding strings', () => {
    for (const name of ['G', 'C7', 'Fmaj7', 'Bm7b5']) {
      for (const s of voicingsOf(name)) expect(s, `${name} ${s}`).toMatch(/^x*[^x]+x*$/);
    }
  });

  it('mutes at most the 6th and 5th strings under the bass, so the bass is on the 6th, 5th or 4th', () => {
    for (const name of ['C', 'Am', 'G7', 'C/G', 'Bm', 'F#m7b5', 'E5']) {
      for (const s of voicingsOf(name)) expect(s, `${name} ${s}`).not.toMatch(/^xxx/);
    }
    expect(voicingsOf('D')[0]).toBe('xx0232');
    expect(voicingsOf('C7')).toContain('x3231x');
  });

  it('keeps the stretch to four frets and the fingers to four, a barre counting as one', () => {
    for (const name of ['C', 'F', 'Bb', 'Am7', 'D9']) {
      const found = lookUp(name, context);
      if (found.kind !== 'chord') throw new Error(`${name} should read`);
      for (const v of found.voicings) {
        const fretted = v.frets.filter((f): f is number => f !== null && f > 0);
        if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
        const fingers = v.barre ? 1 + fretted.filter((f) => f > v.barre!.fret).length : fretted.length;
        expect(fingers, `${name} ${written(v.frets)}`).toBeLessThanOrEqual(4);
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
    expect(voicingsOf('G/B')[0]).toBe('x20003');
    expect(voicingsOf('D/F#')[0]).toBe('200232');
    const found = lookUp('C/G', context);
    if (found.kind !== 'chord') throw new Error('C/G should read');
    for (const v of found.voicings) {
      const lowest = v.frets.findIndex((f) => f !== null);
      expect((standard[lowest] + v.frets[lowest]!) % 12, written(v.frets)).toBe(7);
    }
  });

  it("doesn't put the same Voicing in twice", () => {
    const all = voicingsOf('Am7');
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('Voicings in the tuning and capo in use', () => {
  const dropD = readTuning('Drop D')!;

  it('finds Voicings on the strings of the tuning in use', () => {
    const d = voicingsOf('D', dropD);
    expect(d).toContain('000232');
    expect(d).toContain('xx0232');
    expect(d.slice(0, 2)).toContain('000232');
    // Standard tuning's open low E isn't a D's note.
    expect(voicingsOf('D')).not.toContain('000232');
  });

  it("follows a named tuning's every string, not just the dropped one", () => {
    expect(voicingsOf('D', readTuning('DADGAD')!)).toContain('004200');
    // Open G's open strings are a G, its root on the 5th string.
    expect(voicingsOf('G', readTuning('Open G')!)[0]).toBe('x00000');
  });

  it('counts frets from the capo, so a Chord is drawn as the shape fingered', () => {
    // Capo 2: a G is the open G shape, sounding an A.
    expect(voicingsOf('G', standard, 2)[0]).toBe('320003');
    expect(voicingsOf('C', standard, 2)[0]).toBe('x32010');
    expect(voicingsOf('D', dropD, 2)).toContain('000232');
  });

  it('reaches the 12th fret above the capo, and none past it', () => {
    const found = lookUp('G', { tuning: standard, capo: 5 });
    if (found.kind !== 'chord') throw new Error('G should read');
    expect(found.voicings.map((v) => written(v.frets))).toContain('x(10)(12)(12)(12)(10)');
    expect(found.voicings.every((v) => v.frets.every((f) => f === null || f <= 12))).toBe(true);
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

describe('reading a tuning', () => {
  it("reads every named tuning as its strings' pitches, low to high", () => {
    const expected: Record<string, number[]> = {
      Standard: [40, 45, 50, 55, 59, 64],
      'Half-step down': [39, 44, 49, 54, 58, 63],
      'Drop D': [38, 45, 50, 55, 59, 64],
      'Drop C': [36, 43, 48, 53, 57, 62],
      DADGAD: [38, 45, 50, 55, 57, 62],
      'Open G': [38, 43, 50, 55, 59, 62],
      'Open D': [38, 45, 50, 54, 57, 62],
      'Open E': [40, 47, 52, 56, 59, 64],
    };
    for (const [name, pitches] of Object.entries(expected)) expect(readTuning(name), name).toEqual(pitches);
  });

  it('reads a name in any case, spacing or common alias', () => {
    const aliases: Record<string, string[]> = {
      Standard: ['standard', 'STANDARD', 'Standard tuning', 'E standard', 'e std'],
      'Half-step down': [
        'half-step down',
        'Half step down',
        'half step',
        'Eb standard',
        'eb standard',
        'E♭ standard',
        'D# standard',
        'Eb',
        'Half-step down tuning',
      ],
      'Drop D': ['drop d', 'DROP D', '  Drop   D ', 'drop-d', 'DropD'],
      'Drop C': ['drop c'],
      DADGAD: ['dadgad', 'Dadgad'],
      'Open G': ['open g', 'OPEN G'],
      'Open D': ['open d'],
      'Open E': ['open e', 'Open E tuning'],
    };
    for (const [name, spellings] of Object.entries(aliases))
      for (const spelling of spellings) expect(readTuning(spelling), spelling).toEqual(readTuning(name));
  });

  it('reads six notes, low to high, each in the octave nearest that string in standard tuning', () => {
    expect(readTuning('C G D G B D')).toEqual([36, 43, 50, 55, 59, 62]);
    expect(readTuning('B E A D F# B')).toEqual([35, 40, 45, 50, 54, 59]);
    expect(readTuning('F A C F C F')).toEqual([41, 45, 48, 53, 60, 65]);
  });

  it('takes the lower octave when two are as near, as strings are tuned down more than up', () => {
    expect(readTuning('Bb Eb Ab Db F Bb')).toEqual([34, 39, 44, 49, 53, 58]);
  });

  it('reads six notes however they are separated, or run together', () => {
    const dropD = readTuning('Drop D');
    for (const text of ['D A D G B E', 'D,A,D,G,B,E', 'D-A-D-G-B-E', 'd a d g b e', ' D  A D G B E ', 'DADGBE'])
      expect(readTuning(text), text).toEqual(dropD);
    expect(readTuning('EbAbDbGbBbEb')).toEqual(readTuning('Half-step down'));
    expect(readTuning('D♯ G♯ C♯ F♯ A♯ D♯')).toEqual(readTuning('Half-step down'));
  });

  it("gives null for text it can't read, never a near tuning", () => {
    for (const text of [
      '',
      '   ',
      'Nashville',
      'Drop Q',
      'Open',
      'D standard',
      'E A D G B',
      'E A D G B E A',
      'EADGB',
      'H A D G B E',
      'E A D G B E (capo 2)',
      'Do Re Mi Fa Sol La',
      'eadgbe',
    ])
      expect(readTuning(text), text).toBeNull();
  });
});

describe('naming a tuning', () => {
  it('lists the named tunings in order', () => {
    expect(tunings).toEqual(['Standard', 'Half-step down', 'Drop D', 'Drop C', 'DADGAD', 'Open G', 'Open D', 'Open E']);
  });

  it('names the named tuning a text reads as, from a name, an alias or its notes', () => {
    expect(tuningName('Drop D')).toBe('Drop D');
    expect(tuningName('eb standard')).toBe('Half-step down');
    expect(tuningName('Half step down')).toBe('Half-step down');
    expect(tuningName('D A D G A D')).toBe('DADGAD');
    expect(tuningName('E A D G B E')).toBe('Standard');
  });

  it('names no tuning for six notes that are none of them, or text it can’t read', () => {
    expect(tuningName('C G D G B D')).toBeNull();
    expect(tuningName('Nashville')).toBeNull();
    expect(tuningName('')).toBeNull();
  });
});

describe('writing a tuning', () => {
  it('writes a named tuning by its name', () => {
    expect(tuningText('drop d')).toBe('Drop D');
    expect(tuningText('D A D G B E')).toBe('Drop D');
    expect(tuningText('DADGAD')).toBe('DADGAD');
  });

  it('writes other notes spaced, each with a capital and # or b', () => {
    expect(tuningText('c,g,d,g,b,d')).toBe('C G D G B D');
    expect(tuningText('CGDGBD')).toBe('C G D G B D');
    expect(tuningText('C♯ g♭ D G B D')).toBe('C# Gb D G B D');
  });

  it("writes nothing for text it can't read", () => {
    expect(tuningText('E A D G B')).toBeNull();
    expect(tuningText('Nashville')).toBeNull();
  });

  it("gives a tuning's six notes, spaced, even for a named tuning", () => {
    expect(tuningNotes('drop d')).toBe('D A D G B E');
    expect(tuningNotes('Eb standard')).toBe('Eb Ab Db Gb Bb Eb');
    expect(tuningNotes('c,g,d,g,b,d')).toBe('C G D G B D');
    expect(tuningNotes('Nashville')).toBeNull();
  });
});
