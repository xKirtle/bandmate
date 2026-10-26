import { describe, expect, it } from 'vitest';
import { finderInstrument, firstVoicing, heardVoicing, lookUp, nameIt, readTuning, standard } from './chordFinder';
import { readPreferredVoicings, storePreferredVoicing } from './preferredVoicings';
import { storage } from './storageFake';

// The Chord Finder's context names the Instrument it plays on (ADR 0012):
// only the guitar so far, in a tuning.

const guitarIn = (tuning: readonly number[]) => ({ instrument: 'guitar' as const, tuning });

describe('a context naming the guitar', () => {
  it('looks up the Voicings the guitar has in its tuning', () => {
    const found = lookUp('C', guitarIn(standard));
    expect(found.kind === 'chord' && found.voicings[0].frets).toEqual([null, 3, 2, 0, 1, 0]);
    const d = lookUp('D', guitarIn(readTuning('Drop D')!));
    expect(d.kind === 'chord' && d.voicings[0].frets).toEqual([0, 0, 0, 2, 3, 2]);
  });

  it('names a shape placed on the guitar', () => {
    expect(nameIt([null, 0, 2, 2, 1, 0], guitarIn(standard))).toEqual({
      kind: 'chord',
      readings: ['Am', 'C6/A'],
      notes: ['A', 'E', 'C'],
    });
  });

  it("draws a suggestion's preferred Voicing", () => {
    const preferred = { G: [3, 5, 5, 4, 3, 3] };
    expect(firstVoicing('G', { ...guitarIn(standard), preferred })?.frets).toEqual([3, 5, 5, 4, 3, 3]);
  });
});

describe('hearing a Voicing', () => {
  it("plays its strings' MIDI note numbers on the Instrument, low to high, muted strings skipped", () => {
    // C major in standard tuning: C3 E3 G3 C4 E4.
    const c = firstVoicing('C', guitarIn(standard))!;
    expect(heardVoicing(c, guitarIn(standard)).map((n) => n.midi)).toEqual([48, 52, 55, 60, 64]);
  });
});

describe("an Instrument's preferred Voicings", () => {
  const barreG = [3, 5, 5, 4, 3, 3];

  it("keeps the guitar's where a device has kept them since before the Finder had Instruments", () => {
    const values: Record<string, string> = {};
    storePreferredVoicing(storage(values), finderInstrument(guitarIn(standard)), 'G', barreG);
    expect(values).toEqual({ 'bandmate.preferredVoicings.guitar.40-45-50-55-59-64': JSON.stringify({ G: barreG }) });
  });

  it('reads back one kept by its tuning alone, as the Chord Chart keeps one', () => {
    const s = storage();
    storePreferredVoicing(s, standard, 'G', barreG);
    expect(readPreferredVoicings(s, finderInstrument(guitarIn(standard)))).toEqual({ G: barreG });
  });

  it('leaves out one that is no longer a Voicing the Instrument can keep', () => {
    const values = { 'bandmate.preferredVoicings.guitar.40-45-50-55-59-64': JSON.stringify({ G: [3, 2, 0], C: [0] }) };
    expect(readPreferredVoicings(storage(values), finderInstrument(guitarIn(standard)))).toEqual({});
  });
});
