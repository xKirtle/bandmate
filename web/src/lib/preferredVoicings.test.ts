import { describe, expect, it } from 'vitest';
import { readTuning, standard } from './chordFinder';
import { preferredVoicingsKey, readPreferredVoicings, storePreferredVoicing } from './preferredVoicings';

/** A Storage holding some values, or one that throws like a blocked one. */
function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
    removeItem: (key: string) => (blocked ? fail() : void delete values[key]),
  } as Storage;
}

const dropD = readTuning('Drop D')!;
const barreG = [3, 5, 5, 4, 3, 3];
const openC = [null, 3, 2, 0, 1, 0];

describe('readPreferredVoicings', () => {
  it('is none until one is preferred on this device', () => {
    expect(readPreferredVoicings(storage(), standard)).toEqual({});
  });

  it('is none without storage, or when it is blocked', () => {
    expect(readPreferredVoicings(undefined, standard)).toEqual({});
    expect(readPreferredVoicings(storage({}, true), standard)).toEqual({});
  });
});

describe('storePreferredVoicing', () => {
  it('keeps a preferred Voicing for its Chord, to read back after a reload', () => {
    const s = storage();
    storePreferredVoicing(s, standard, 'G', barreG);
    storePreferredVoicing(s, standard, 'C', openC);
    expect(readPreferredVoicings(s, standard)).toEqual({ G: barreG, C: openC });
  });

  it('keeps one Voicing per Chord, the last one preferred', () => {
    const s = storage();
    storePreferredVoicing(s, standard, 'G', barreG);
    storePreferredVoicing(s, standard, 'G', [3, 2, 0, 0, 3, 3]);
    expect(readPreferredVoicings(s, standard)).toEqual({ G: [3, 2, 0, 0, 3, 3] });
  });

  it('keeps preferences per tuning, so one in standard tuning does not apply in Drop D', () => {
    const s = storage();
    storePreferredVoicing(s, standard, 'G', barreG);
    expect(readPreferredVoicings(s, dropD)).toEqual({});
    storePreferredVoicing(s, dropD, 'D', [0, 0, 0, 2, 3, 2]);
    expect(readPreferredVoicings(s, standard)).toEqual({ G: barreG });
    expect(readPreferredVoicings(s, dropD)).toEqual({ D: [0, 0, 0, 2, 3, 2] });
  });

  it('keeps a tuning by its pitches, however its text was written', () => {
    const s = storage();
    storePreferredVoicing(s, readTuning('Drop D')!, 'D', [0, 0, 0, 2, 3, 2]);
    expect(readPreferredVoicings(s, readTuning('D A D G B E')!)).toEqual({ D: [0, 0, 0, 2, 3, 2] });
  });

  it('clears a preference, and forgets the tuning once none is left', () => {
    const values: Record<string, string> = {};
    storePreferredVoicing(storage(values), standard, 'G', barreG);
    storePreferredVoicing(storage(values), standard, 'C', openC);
    storePreferredVoicing(storage(values), standard, 'G', null);
    expect(readPreferredVoicings(storage(values), standard)).toEqual({ C: openC });
    storePreferredVoicing(storage(values), standard, 'C', null);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storePreferredVoicing(undefined, standard, 'G', barreG)).not.toThrow();
    expect(() => storePreferredVoicing(storage({}, true), standard, 'G', barreG)).not.toThrow();
  });
});

describe('kept preferences that have gone wrong', () => {
  it('reads text that is not a set of preferences as none', () => {
    for (const kept of ['{', '[]', 'null', '"G"', '42']) {
      const values = { [preferredVoicingsKey(standard)]: kept };
      expect(readPreferredVoicings(storage(values), standard), kept).toEqual({});
    }
  });

  it('drops a Voicing that is not a fret or muted for each string, keeping the rest', () => {
    const kept = {
      G: barreG,
      C: openC,
      D: [null, null, 0, 2, 3],
      E: [0, 2, 2, 1, 0, -1],
      F: [1, 3, 3, 2, 1, 1.5],
      A: 'x02220',
    };
    const values = { [preferredVoicingsKey(standard)]: JSON.stringify(kept) };
    expect(readPreferredVoicings(storage(values), standard)).toEqual({ G: barreG, C: openC });
  });
});
