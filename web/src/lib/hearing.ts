// Hearing a Voicing, as its rules have it, whatever plays the notes: what a
// Hear or Arpeggiate plays, when, and from which samples (ADR 0030). One
// sound at a time: a press cuts off whatever rings, on either Instrument. An
// Instrument's samples load once, all of them, when first asked for, by a
// press or ahead of one; a press made before they arrive plays when they do,
// unless something else was pressed since. If they can't load, it's said
// the Instrument couldn't be heard, and the next press tries again.
//
// The playing itself, on Web Audio, is hear.ts's, so these rules can be
// tested without it.

import type { HeardNote, InstrumentSound } from './instrument';
import type { SampleSet } from './samples';

/** The gap between one note and the next in a strum, in seconds. */
const strumGap = 0.03;
/** The gap between one note and the next in an arpeggio, in seconds: slow enough to hear each one. */
const arpeggioGap = 0.175;

/** What a press plays: its notes, lowest first, `gap` seconds apart, from an Instrument's samples. */
export interface Played<Sample> {
  notes: readonly HeardNote[];
  gap: number;
  sound: { set: SampleSet; samples: ReadonlyMap<number, Sample> };
}

/** What hearing needs done: loading a sample, playing and cutting off, and saying when an Instrument can't be heard. */
export interface HearingDeps<Sample> {
  /** Loads one sample, ready to play. */
  loadSample(url: string): Promise<Sample>;
  /** Plays notes, each left ringing. */
  play(played: Played<Sample>): void;
  /** Cuts off whatever still rings. */
  cutOff(): void;
  /** An Instrument's samples couldn't load, for a press still waiting on them. */
  unheard(set: SampleSet): void;
  /** An Instrument's samples have loaded. */
  heard(set: SampleSet): void;
}

export interface Hearing {
  /** Loads an Instrument's samples, if they aren't loaded or loading, for its presses to play at once. */
  prepare(sound: InstrumentSound): void;
  /** Hears a Voicing once: strummed, low to high, if its Instrument is, or its notes together. */
  hear(notes: readonly HeardNote[], sound: InstrumentSound): void;
  /** Sounds each note once, lowest first, far enough apart to hear each one, each left ringing. */
  arpeggiate(notes: readonly HeardNote[], sound: InstrumentSound): void;
}

export function hearing<Sample>(deps: HearingDeps<Sample>): Hearing {
  const loading = new Map<SampleSet, Promise<ReadonlyMap<number, Sample>>>();
  const loaded = new Map<SampleSet, ReadonlyMap<number, Sample>>();
  // Counts presses, so one waiting on its samples knows whether another came since.
  let presses = 0;

  function load(set: SampleSet): Promise<ReadonlyMap<number, Sample>> {
    let found = loading.get(set);
    if (!found) {
      found = Promise.all(set.notes.map(async (note) => [note, await deps.loadSample(set.url(note))] as const)).then(
        (samples) => {
          const map = new Map(samples);
          loaded.set(set, map);
          deps.heard(set);
          return map;
        },
        (error: unknown) => {
          // Forgotten, so the next press tries again.
          loading.delete(set);
          throw error;
        },
      );
      loading.set(set, found);
    }
    return found;
  }

  function press(notes: readonly HeardNote[], sound: InstrumentSound, gap: number) {
    const pressed = ++presses;
    deps.cutOff();
    if (notes.length === 0) return;
    const { samples: set } = sound;
    const samples = loaded.get(set);
    if (samples) return deps.play({ notes, gap, sound: { set, samples } });
    load(set).then(
      (samples) => {
        if (pressed === presses) deps.play({ notes, gap, sound: { set, samples } });
      },
      () => {
        if (pressed === presses) deps.unheard(set);
      },
    );
  }

  return {
    prepare({ samples: set }) {
      load(set).catch(() => {});
    },
    hear: (notes, sound) => press(notes, sound, sound.strummed ? strumGap : 0),
    arpeggiate: (notes, sound) => press(notes, sound, arpeggioGap),
  };
}
