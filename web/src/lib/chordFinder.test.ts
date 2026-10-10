import { describe, expect, it } from 'vitest';
import {
  firstVoicing,
  lookUp,
  nameIt,
  qualities,
  readTuning,
  roots,
  plucks,
  keyName,
  keys,
  standard,
  suggest,
  tuningName,
  tuningNotes,
  tunings,
  tuningText,
  type FinderContext,
  type Frets,
  type Suggestion,
} from './chordFinder';

const context = { tuning: standard };

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
function voicingsOf(name: string, tuning = standard): string[] {
  const found = lookUp(name, { tuning });
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

describe('Voicings in the tuning in use', () => {
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
});

describe('a preferred Voicing', () => {
  const lookUpG = (preferred: Record<string, (number | null)[]>) => lookUp('G', { tuning: standard, preferred });

  it('comes first, ahead of the best-ranked Voicing, the rest in their ranked order', () => {
    const ranked = voicingsOf('G');
    const found = lookUpG({ G: [3, 5, 5, 4, 3, 3] });
    if (found.kind !== 'chord') throw new Error('G should read');
    const all = found.voicings.map((v) => written(v.frets));
    expect(all[0]).toBe('355433');
    expect(all.slice(1)).toEqual(ranked.filter((v) => v !== '355433'));
    expect(found.preferred).toBe(true);
  });

  it('applies to the Chord it was preferred for, by its name as read', () => {
    const preferred = { Cmaj7: [null, 3, 5, 4, 5, 3] };
    for (const name of ['Cmaj7', 'CM7']) {
      const found = lookUp(name, { tuning: standard, preferred });
      if (found.kind !== 'chord') throw new Error(`${name} should read`);
      expect(written(found.voicings[0].frets), name).toBe('x35453');
    }
    const other = lookUpG({ C: [null, 3, 2, 0, 1, 0] });
    if (other.kind !== 'chord') throw new Error('G should read');
    expect(written(other.voicings[0].frets)).toBe('320003');
    expect(other.preferred).toBe(false);
  });

  it('leaves the ranked order as it is with no preference, or one that is no Voicing of the Chord', () => {
    for (const found of [lookUp('G', context), lookUpG({ G: [0, 0, 0, 0, 0, 0] })]) {
      if (found.kind !== 'chord') throw new Error('G should read');
      expect(found.voicings.map((v) => written(v.frets))).toEqual(voicingsOf('G'));
      expect(found.preferred).toBe(false);
    }
  });
});

describe('the Voicing a suggestion draws', () => {
  const drawn = (chord: string, ctx: FinderContext) => {
    const v = firstVoicing(chord, ctx);
    return v && written(v.frets);
  };

  it('is the preferred Voicing of the Chord in the tuning', () => {
    expect(drawn('G', { tuning: standard, preferred: { G: [3, 5, 5, 4, 3, 3] } })).toBe('355433');
  });

  it('is the best-ranked Voicing when none is preferred, or the preferred one is no Voicing of the Chord', () => {
    expect(drawn('G', context)).toBe('320003');
    expect(drawn('G', { tuning: standard, preferred: { G: [0, 0, 0, 0, 0, 0] } })).toBe('320003');
  });

  it('is none for a Chord with no Voicing up to the 12th fret in the tuning', () => {
    expect(drawn('C', { tuning: [40, 40, 40, 40, 40, 40] })).toBeNull();
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

/** Frets written as a shape, low string to high: x32010. */
function shape(written: string): Frets {
  return [...written].map((c) => (c === 'x' ? null : Number(c)));
}

/** The readings of a shape, best first, or null when no reading fits. */
function readings(written: string, ctx: FinderContext = context): string[] | null {
  const named = nameIt(shape(written), ctx);
  return named.kind === 'chord' ? named.readings : null;
}

describe('naming a shape', () => {
  it('reads x32010 as C', () => {
    expect(readings('x32010')).toEqual(['C']);
  });

  it('offers every reading of an ambiguous shape, the root in the bass first: Am7, then C6/A for x02010', () => {
    expect(readings('x02010')?.slice(0, 2)).toEqual(['Am7', 'C6/A']);
  });

  it('ranks a reading with the root in the bass before a simpler one without', () => {
    expect(readings('x32210')).toEqual(['C6', 'Am/C']);
  });

  it('gives readings Look up reads back as the same Chord', () => {
    for (const s of ['x32010', 'x02010', 'x32210', '2x0232', 'x24442', '133211']) {
      for (const name of readings(s) ?? []) expect(reads(name)).toBe(name);
    }
  });

  it('reads a slash Chord from its bass: D/F# for 2x0232', () => {
    expect(readings('2x0232')?.[0]).toBe('D/F#');
  });

  it('reads the shape on the strings of the tuning in use', () => {
    const dropD = { tuning: readTuning('Drop D')! };
    expect(readings('000232', dropD)?.[0]).toBe('D');
    expect(readings('x32010', dropD)?.[0]).toBe('C');
  });

  it('lists the notes sounding, low string to high, each once, spelled as the best reading spells them', () => {
    expect(nameIt(shape('x02010'), context)).toMatchObject({ notes: ['A', 'E', 'G', 'C'] });
    expect(nameIt(shape('x24442'), context)).toEqual({ kind: 'chord', readings: ['B'], notes: ['B', 'F#', 'D#'] });
  });

  it('spells a root sharp or flat, whichever spells its notes more simply: G#m, not Abm with a Cb', () => {
    expect(nameIt(shape('466444'), context)).toEqual({
      kind: 'chord',
      readings: ['G#m', 'B6/G#'],
      notes: ['G#', 'D#', 'B'],
    });
    expect(readings('x46654')?.[0]).toBe('C#m');
    expect(readings('x13331')?.[0]).toBe('Bb');
  });

  it('spells a note the same way in every reading of a shape', () => {
    expect(readings('x13321')).toEqual(['Bbm', 'Db6/Bb']);
  });

  it('gives none, with the notes sounding, when no reading fits, never a near miss', () => {
    expect(nameIt(shape('x344xx'), context)).toEqual({ kind: 'none', notes: ['C', 'F#', 'B'] });
  });

  it('gives none, with the notes sounding, for fewer than two different notes', () => {
    expect(nameIt(shape('x3x5xx'), context)).toEqual({ kind: 'none', notes: ['C'] });
    expect(nameIt(shape('xx0xxx'), context)).toEqual({ kind: 'none', notes: ['D'] });
    expect(nameIt(shape('xxxxxx'), context)).toEqual({ kind: 'none', notes: [] });
  });
});

/** A Key's Chords as "numeral chord", in order, or null if the Key can't be read. */
function palette(key: string): string[] | null {
  const s = suggest(key);
  return s.kind === 'key' ? s.chords.map((c) => `${c.numeral} ${c.chord}`) : null;
}

/** The pitches hearing a shape plucks, low string to high. */
const pitches = (written: string, ctx: FinderContext = context) => plucks(shape(written), ctx).map((p) => p.pitch);

/** How bright each string hearing a shape plucks sounds, low string to high. */
const brightness = (written: string) => plucks(shape(written), context).map((p) => p.brightness);

describe('what hearing a Voicing plucks', () => {
  it("is its strings' pitches in the tuning, low string to high, as MIDI note numbers", () => {
    // E major: E2 B2 E3 G#3 B3 E4.
    expect(pitches('022100')).toEqual([40, 47, 52, 56, 59, 64]);
  });

  it('skips muted strings', () => {
    // C major: C3 E3 G3 C4 E4.
    expect(pitches('x32010')).toEqual([48, 52, 55, 60, 64]);
    expect(pitches('xx0232')).toEqual([50, 57, 62, 66]);
    expect(pitches('xxxxxx')).toEqual([]);
  });

  it('follows the tuning in use', () => {
    // D5 in Drop D: D2 A2 D3.
    expect(pitches('000xxx', { tuning: readTuning('Drop D')! })).toEqual([38, 45, 50]);
  });

  it('sounds each string between dark, 0, and bright, 1', () => {
    for (const written of ['000000', '022100', '999999', 'x32010']) {
      for (const b of brightness(written)) {
        expect(b).toBeGreaterThan(0);
        expect(b).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sounds a thicker string darker, at the same fret', () => {
    const open = brightness('000000');
    for (let s = 1; s < open.length; s++) expect(open[s - 1]).toBeLessThan(open[s]);
    const fifth = brightness('555555');
    for (let s = 1; s < fifth.length; s++) expect(fifth[s - 1]).toBeLessThan(fifth[s]);
  });

  it('sounds a string darker the higher up the neck it is fretted', () => {
    const [open] = brightness('0xxxxx');
    const [third] = brightness('3xxxxx');
    const [seventh] = brightness('7xxxxx');
    expect(third).toBeLessThan(open);
    expect(seventh).toBeLessThan(third);
  });

  it('sounds the same note darker on a thicker string, higher up the neck', () => {
    // E4: the open 1st string, the 2nd at the 5th fret, the 3rd at the 9th.
    const [onFirst] = brightness('xxxxx0');
    const [onSecond] = brightness('xxxx5x');
    const [onThird] = brightness('xxx9xx');
    expect(onSecond).toBeLessThan(onFirst);
    expect(onThird).toBeLessThan(onSecond);
    // C3 in x32010, on the 5th string, is brighter than in 87555x, on the 6th at the 8th fret.
    expect(brightness('8xxxxx')[0]).toBeLessThan(brightness('x3xxxx')[0]);
  });
});

describe('suggesting from a Key', () => {
  it("gives a major Key's Chords with their Roman numerals: G", () => {
    expect(palette('G')?.slice(0, 7)).toEqual(['I G', 'ii Am', 'iii Bm', 'IV C', 'V D', 'vi Em', 'vii° F#dim']);
  });
});

/** The Chords a Key suggests of one kind, as "numeral chord". */
function kind(key: string, of: Suggestion['kind']): string[] {
  const s = suggest(key);
  return s.kind === 'key' ? s.chords.filter((c) => c.kind === of).map((c) => `${c.numeral} ${c.chord}`) : [];
}

/** The Chords suggested after one, in a Key, as "numeral chord", or null if there's no list. */
function follows(key: string, after: string): string[] | null {
  const s = suggest(key, after);
  return s.kind === 'key' && s.follows ? s.follows.map((c) => `${c.numeral} ${c.chord}`) : null;
}

describe('suggesting borrowed Chords', () => {
  it('borrows iv, bIII, bVI and bVII from the parallel minor in a major Key: Cm, Bb, Eb and F in G', () => {
    expect(kind('G', 'borrowed')).toEqual(['iv Cm', 'bIII Bb', 'bVI Eb', 'bVII F']);
  });

  it('says where each is borrowed from', () => {
    const s = suggest('G');
    const borrowed = s.kind === 'key' ? s.chords.filter((c) => c.kind === 'borrowed') : [];
    expect(borrowed.map((c) => c.reason)).toEqual(Array(4).fill('Borrowed from G minor'));
  });

  it('borrows nothing in a minor Key', () => {
    expect(kind('Em', 'borrowed')).toEqual([]);
  });
});

describe('suggesting from a minor Key', () => {
  it("gives a minor Key's own Chords, natural minor's then V from harmonic minor: Em", () => {
    expect(kind('Em', 'diatonic')).toEqual(['i Em', 'ii° F#dim', 'III G', 'iv Am', 'v Bm', 'VI C', 'VII D', 'V B7']);
  });

  it('reads a minor Key written out, as Transpose reads a Song’s key', () => {
    expect(palette('E minor')).toEqual(palette('Em'));
    expect(palette('e')).toBeNull();
  });
});

describe('suggesting secondary dominants', () => {
  it('gives the V of each of the Key’s own Chords but the tonic and the diminished one', () => {
    expect(kind('G', 'secondary')).toEqual(['V/ii E7', 'V/iii F#7', 'V/IV G7', 'V/V A7', 'V/vi B7']);
    expect(kind('Em', 'secondary')).toEqual(['V/III D7', 'V/iv E7', 'V/v F#7', 'V/VI G7', 'V/VII A7']);
  });
});

describe('suggesting what follows a Chord', () => {
  it('gives the functional moves from one of the Key’s Chords first: G → C, D, Em in G', () => {
    expect(follows('G', 'G')?.slice(0, 3)).toEqual(['IV C', 'V D', 'vi Em']);
  });

  it('then the V of each Chord it moves to, leading there', () => {
    expect(follows('G', 'G')?.slice(3)).toEqual(['V/IV G7', 'V/V A7', 'V/vi B7']);
  });

  it('resolves V to I, and offers the deceptive V to vi', () => {
    expect(follows('C', 'G')?.slice(0, 2)).toEqual(['I C', 'vi Am']);
  });

  it('resolves IV to I', () => {
    expect(follows('C', 'F')?.[0]).toBe('I C');
  });

  it('resolves a secondary dominant to the Chord it’s the V of: E7 → Am, as V of Am', () => {
    const s = suggest('C', 'E7');
    expect(s.kind === 'key' && s.follows).toEqual([
      { chord: 'Am', numeral: 'vi', reason: 'Resolves E7 as V of Am', kind: 'diatonic' },
    ]);
    expect(follows('G', 'E7')).toEqual(['ii Am']);
    expect(follows('G', 'E')).toEqual(['ii Am']);
  });

  it('reads a dominant seventh on one of the Key’s degrees as the V of the Chord a fifth below: G7 → C in G', () => {
    expect(follows('G', 'G7')).toEqual(['IV C']);
  });

  it('reads a Chord by its triad, so Am7 follows as ii in G, Gmaj7 as I and D7 as V', () => {
    expect(follows('G', 'Am7')).toEqual(follows('G', 'Am'));
    expect(follows('G', 'Gmaj7')).toEqual(follows('G', 'G'));
    expect(follows('G', 'D7')).toEqual(follows('G', 'D'));
  });

  it('follows a borrowed Chord too: bVII → I and iv → I in G', () => {
    expect(follows('G', 'F')?.[0]).toBe('I G');
    expect(follows('G', 'Cm')?.[0]).toBe('I G');
  });

  it('follows a minor Key’s Chords: B7 → Em, and the deceptive C', () => {
    expect(follows('Em', 'B7')?.slice(0, 2)).toEqual(['i Em', 'VI C']);
    expect(follows('Em', 'B')).toEqual(follows('Em', 'B7'));
  });

  it('suggests nothing after a Chord that isn’t the Key’s, and no list after a name it can’t read', () => {
    expect(follows('G', 'C#m')).toEqual([]);
    expect(follows('G', 'H7')).toBeNull();
  });
});

describe('reasons', () => {
  it('gives every suggestion a short reason', () => {
    for (const key of keys) {
      const s = suggest(key, key);
      const all = s.kind === 'key' ? [...s.chords, ...(s.follows ?? [])] : [];
      expect(all.length).toBeGreaterThan(10);
      for (const c of all) expect(c.reason).toMatch(/^.{4,40}$/);
    }
  });

  it('says why each Chord follows', () => {
    const reasons = (key: string, after: string) => {
      const s = suggest(key, after);
      return s.kind === 'key' ? s.follows?.map((c) => `${c.chord}: ${c.reason}`) : null;
    };
    expect(reasons('C', 'G')?.slice(0, 2)).toEqual(['C: Resolves home', 'Am: Deceptive: vi in place of I']);
    expect(reasons('Em', 'Em')?.slice(0, 4)).toEqual([
      'Am: Moves away from home',
      'B7: Builds tension',
      'C: Down a third',
      'D: Steps down',
    ]);
  });
});

describe('spelling suggestions', () => {
  it('spells them from the Key’s signature, as Transpose does', () => {
    expect(kind('F', 'diatonic')).toEqual(['I F', 'ii Gm', 'iii Am', 'IV Bb', 'V C', 'vi Dm', 'vii° Edim']);
    expect(kind('E', 'diatonic')).toEqual(['I E', 'ii F#m', 'iii G#m', 'IV A', 'V B', 'vi C#m', 'vii° D#dim']);
    expect(kind('Bbm', 'diatonic')).toEqual([
      'i Bbm',
      'ii° Cdim',
      'III Db',
      'iv Ebm',
      'v Fm',
      'VI Gb',
      'VII Ab',
      'V F7',
    ]);
  });

  it('spells a borrowed Chord from the parallel minor’s signature, kept flat in a flat Key', () => {
    expect(kind('D', 'borrowed')).toEqual(['iv Gm', 'bIII F', 'bVI Bb', 'bVII C']);
    expect(kind('Eb', 'borrowed')).toEqual(['iv Abm', 'bIII Gb', 'bVI B', 'bVII Db']);
  });

  it('offers Keys it reads, each named from its own signature', () => {
    expect(keys.map(keyName)).toEqual([
      ...['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((k) => k + ' major'),
      ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'].map((k) => k + ' minor'),
    ]);
  });
});

describe("Keys it can't read", () => {
  it('says so, never a guess', () => {
    expect(suggest('Do', 'C')).toEqual({ kind: 'unreadable', key: 'Do' });
    expect(suggest('')).toEqual({ kind: 'unreadable', key: '' });
  });
});
