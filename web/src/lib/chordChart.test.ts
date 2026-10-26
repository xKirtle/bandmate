import { describe, expect, it } from 'vitest';
import type { Alternate, Line, Section, Song } from './api';
import {
  chartChords,
  chartContext,
  chartKeyRange,
  chartTuning,
  chartVoicing,
  chartVoicings,
  chordsInRead,
  type ChartVoicing,
} from './chordChart';

let nextId = 1;

/** A Line with Chords at the start of each of its words, or a Chord Line with just the Chords. */
function line(chords: string[], chordLine = false): Line {
  return {
    id: nextId++,
    text: '',
    lyrics: chordLine ? '' : chords.map(() => 'la').join(' '),
    chords: chords.map((name, i) => ({ offset: chordLine ? 0 : i * 3, name })),
    chordLine,
    cue: null,
  } as Line;
}

/** An Alternate of Lines, active unless said otherwise. */
function alternate(lines: Line[], active = true): Alternate {
  return { id: nextId++, name: '', active, lines };
}

function section(...alternates: Alternate[]): Section {
  return { id: nextId++, label: '', alternates };
}

/** A Song with these Sections in its Arrangement, and those in its Scrapbook. */
function song(arrangement: Section[], scrapbook: Section[] = [], key = ''): Song {
  return {
    key,
    tuning: '',
    arrangement: arrangement.map((s) => s.id),
    scrapbook: scrapbook.map((s) => s.id),
    sections: [...scrapbook, ...arrangement],
  } as Song;
}

describe('which Chords the Chord Chart lists', () => {
  it("lists a Line's Chords in order", () => {
    expect(chartChords(song([section(alternate([line(['G', 'D', 'Em'])]))]))).toEqual(['G', 'D', 'Em']);
  });

  it('lists each Chord once, where it first appears down the Arrangement, matched by its tidied name', () => {
    const verse = section(alternate([line(['G', 'CM7']), line(['D', 'G'])]));
    const chorus = section(alternate([line(['Cmaj7', 'Em', 'CΔ7', 'D'])]));
    expect(chartChords(song([verse, chorus]))).toEqual(['G', 'CM7', 'D', 'Em']);
  });

  it("lists only the active Alternates' Chords, not the Scrapbook's", () => {
    const verse = section(alternate([line(['Bb'])], false), alternate([line(['G'])]), alternate([line(['F'])], false));
    const leftover = section(alternate([line(['Am'])]), alternate([line(['Dm'])], false));
    expect(chartChords(song([verse], [leftover]))).toEqual(['G']);
  });

  it("lists Chord Lines' Chords", () => {
    const intro = section(alternate([line(['A', 'E'], true), line(['D'])]));
    expect(chartChords(song([intro]))).toEqual(['A', 'E', 'D']);
  });

  it('lists the Chords as shown when transposed, spelled from the Song’s key', () => {
    const verse = section(alternate([line(['G', 'F#m7/C#', 'F#', 'Gb'])]));
    expect(chartChords(song([verse], [], 'G'), 2)).toEqual(['A', 'G#m7/D#', 'G#']);
  });

  it("keeps a Chord name that can't be read, once, in its place, as the Lyric Sheet shows it", () => {
    const verse = section(alternate([line(['Galt', 'G', 'Gsus2sus4', 'Galt', 'Gsus2sus4'])]));
    expect(chartChords(song([verse]), 2)).toEqual(['Aalt', 'A', 'Asus2sus4']);
  });
});

describe("reading the Song's tuning for the Chord Chart", () => {
  it('reads a blank tuning as Standard', () => {
    expect(chartTuning('')).toEqual([40, 45, 50, 55, 59, 64]);
    expect(chartTuning('  ')).toEqual([40, 45, 50, 55, 59, 64]);
  });

  it('reads a named tuning, or six notes', () => {
    expect(chartTuning('Drop D')).toEqual([38, 45, 50, 55, 59, 64]);
    expect(chartTuning('D A D G A D')).toEqual([38, 45, 50, 55, 57, 62]);
  });

  it("reads a tuning that can't be read as none, never as Standard", () => {
    expect(chartTuning('my weird tuning')).toBeNull();
    expect(chartTuning('E A D G B')).toBeNull();
  });
});

describe('what the Chord Chart draws on', () => {
  it("is the guitar in the Song's tuning, on the guitar", () => {
    expect(chartContext('guitar', '')).toEqual({ instrument: 'guitar', tuning: [40, 45, 50, 55, 59, 64] });
    expect(chartContext('guitar', 'Drop D')).toEqual({ instrument: 'guitar', tuning: [38, 45, 50, 55, 59, 64] });
  });

  it("is nothing on the guitar when the Song's tuning can't be read", () => {
    expect(chartContext('guitar', 'my weird tuning')).toBeNull();
  });

  it("is the piano on the piano, whatever the Song's tuning, even one that can't be read", () => {
    expect(chartContext('piano', '')).toEqual({ instrument: 'piano' });
    expect(chartContext('piano', 'Drop D')).toEqual({ instrument: 'piano' });
    expect(chartContext('piano', 'my weird tuning')).toEqual({ instrument: 'piano' });
  });
});

describe('the Voicing the Chord Chart draws for a Chord', () => {
  const guitar = { instrument: 'guitar', tuning: [40, 45, 50, 55, 59, 64] } as const;
  const piano = { instrument: 'piano' } as const;
  const fretsOf = (drawn: ChartVoicing) => drawn.kind === 'voicing' && 'frets' in drawn.voicing && drawn.voicing.frets;
  const keysOf = (drawn: ChartVoicing) => drawn.kind === 'voicing' && 'keys' in drawn.voicing && drawn.voicing.keys;

  it('draws the top-ranked Voicing for the tuning, on the guitar', () => {
    expect(fretsOf(chartVoicing('C', guitar))).toEqual([null, 3, 2, 0, 1, 0]);
  });

  it('draws the preferred Voicing, read by its tidied name', () => {
    const drawn = chartVoicing('CMaj7', { ...guitar, preferred: { Cmaj7: [null, 3, 5, 4, 5, 3] } });
    expect(fretsOf(drawn)).toEqual([null, 3, 5, 4, 5, 3]);
  });

  it('draws root position on the piano, round middle C', () => {
    expect(keysOf(chartVoicing('C', piano))).toEqual([60, 64, 67]);
  });

  it('draws the preferred inversion on the piano', () => {
    expect(keysOf(chartVoicing('C', { ...piano, preferred: { C: 2 } }))).toEqual([55, 60, 64]);
  });

  it("says a Chord can't be read rather than drawing one, on either Instrument", () => {
    expect(chartVoicing('Galt', guitar)).toEqual({ kind: 'unreadable-chord' });
    expect(chartVoicing('Galt', piano)).toEqual({ kind: 'unreadable-chord' });
  });

  it("says the tuning can't be read rather than drawing for Standard", () => {
    expect(chartVoicing('C', null)).toEqual({ kind: 'unreadable-tuning' });
  });
});

describe('the keys every piano card in the Chord Chart draws', () => {
  /** The piano Voicing the Chart draws for a Chord, preferring an inversion. */
  const drawn = (name: string, inversion = 0) => {
    const found = chartVoicing(name, { instrument: 'piano', preferred: { [name]: inversion } });
    if (found.kind !== 'voicing' || !('keys' in found.voicing)) throw new Error(`no piano Voicing of ${name}`);
    return found.voicing;
  };

  it('are the whole octave just covering the keys pressed', () => {
    // C: C4 E4 G4.
    expect(chartKeyRange([drawn('C')])).toEqual({ lowest: 60, highest: 72 });
  });

  it('take in a top key on a C without another octave', () => {
    // C's first inversion: E4 G4 C5.
    expect(chartKeyRange([drawn('C', 1)])).toEqual({ lowest: 60, highest: 72 });
  });

  it("are the same for every card, covering every card's keys", () => {
    // C: C4 E4 G4; G: G3 B3 D4.
    expect(chartKeyRange([drawn('C'), drawn('G')])).toEqual({ lowest: 48, highest: 72 });
  });

  it('are C3 to C5, as the Chord Finder draws, with no keys pressed', () => {
    expect(chartKeyRange([])).toEqual({ lowest: 48, highest: 72 });
  });
});

describe("the Voicings a Chord's popover steps through", () => {
  const guitar = { instrument: 'guitar', tuning: [40, 45, 50, 55, 59, 64] } as const;
  const piano = { instrument: 'piano' } as const;

  it('lists every Voicing, top-ranked first, under the name the preference is kept by', () => {
    const found = chartVoicings('CMaj7', guitar);
    expect(found.kind).toBe('voicings');
    if (found.kind !== 'voicings') return;
    expect(found.chord).toBe('Cmaj7');
    expect(found.preferred).toBe(false);
    expect(found.voicings.length).toBeGreaterThan(1);
    expect(found.voicings[0]).toMatchObject({ frets: [null, 3, 2, 0, 0, 0] });
  });

  it('puts the preferred Voicing first, and says it is preferred', () => {
    const found = chartVoicings('CMaj7', { ...guitar, preferred: { Cmaj7: [null, 3, 5, 4, 5, 3] } });
    expect(found.kind === 'voicings' && found.preferred).toBe(true);
    expect(found.kind === 'voicings' && found.voicings[0]).toMatchObject({ frets: [null, 3, 5, 4, 5, 3] });
  });

  it("lists the piano's inversions, the preferred one first", () => {
    const found = chartVoicings('C', { ...piano, preferred: { C: 1 } });
    expect(found.kind === 'voicings' && found.preferred).toBe(true);
    expect(found.kind === 'voicings' && found.voicings.map((v) => 'keys' in v && v.keys)).toEqual([
      [64, 67, 72],
      [60, 64, 67],
      [55, 60, 64],
    ]);
  });

  it("says why there's none to step through", () => {
    expect(chartVoicings('Galt', guitar)).toEqual({ kind: 'unreadable-chord' });
    expect(chartVoicings('Galt', piano)).toEqual({ kind: 'unreadable-chord' });
    expect(chartVoicings('C', null)).toEqual({ kind: 'unreadable-tuning' });
  });
});

describe('where a Song has Chords, as Read mode shows it', () => {
  it('has them shown when an active Alternate in the Arrangement has Chords', () => {
    expect(chordsInRead(song([section(alternate([line([]), line(['C'])]))]))).toBe('shown');
  });

  it('has them elsewhere when only the Scrapbook has Chords', () => {
    expect(chordsInRead(song([section(alternate([line([])]))], [section(alternate([line(['C'])]))]))).toBe('elsewhere');
  });

  it('has them elsewhere when only an inactive Alternate has Chords', () => {
    expect(chordsInRead(song([section(alternate([line([])]), alternate([line(['C'])], false))]))).toBe('elsewhere');
  });

  it('has none when no Line anywhere has a Chord', () => {
    expect(chordsInRead(song([section(alternate([line([])]))], [section(alternate([line([])]))]))).toBe('none');
  });
});
