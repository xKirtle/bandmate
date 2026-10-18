import { describe, expect, it } from 'vitest';
import type { Clip, Take } from './api';
import { clipBars } from './clipBars';

// A Beat 4 seconds long, a peak every hundredth of a second: 0.1 loud
// through its first second, 0.2 through its second, and so on.
const beat = [0.1, 0.2, 0.3, 0.4].flatMap((p) => new Array<number>(100).fill(p));

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 1,
  beatId: 7,
  soundId: null,
  name: null,
  gain: 0,
  tempo: 1,
  pitch: 0,
  fadeIn: 0,
  fadeOut: 0,
  takes: [],
  activeTakeId: null,
  start: 10,
  offset: 0,
  length: 4,
  ...over,
});

// A Take 3 seconds long, as loud as the Beat's first three.
const takePeaks = beat.slice(0, 300);

// A Take whose audio file starts a second into its Clip's source.
const take: Take = {
  id: 10,
  number: 1,
  size: 0,
  duration: 3,
  sampleRate: 48000,
  latencyOffset: 0,
  position: 1,
  nudge: 0,
  recordedAt: '',
};
const takes = { beatId: null, takes: [take], activeTakeId: take.id };

describe('clipBars', () => {
  it.each([
    { name: 'an untrimmed Clip, as its source sounds', over: {}, stretch: [0, 4, 4], count: 4, want: [10, 20, 30, 40] },
    { name: 'only the stretch in view', over: {}, stretch: [1, 3, 2], count: 2, want: [20, 30] },
    {
      name: 'a Clip trimmed at the start',
      over: { offset: 1, length: 3 },
      stretch: [0, 3, 3],
      count: 3,
      want: [20, 30, 40],
    },
    { name: 'a Clip trimmed at the end', over: { length: 2 }, stretch: [0, 2, 2], count: 2, want: [10, 20] },
    {
      name: 'silence past the trimmed end',
      over: { length: 2 },
      stretch: [0, 2, 4],
      count: 4,
      want: [10, 20, 2, 2],
    },
    {
      name: 'silence before an audio file that starts partway into its source',
      over: takes,
      peaks: takePeaks,
      stretch: [0, 4, 4],
      count: 4,
      want: [2, 10, 20, 30],
    },
    {
      name: 'a Fade in',
      over: { fadeIn: 2 },
      stretch: [0, 4, 4],
      count: 4,
      // Equal power, halfway across each bar: sin(22.5°) and sin(67.5°) loud.
      want: [3.83, 18.48, 30, 40],
    },
    { name: 'a Fade out', over: { fadeOut: 2 }, stretch: [0, 4, 4], count: 4, want: [10, 20, 27.72, 15.31] },
    {
      name: 'Fades longer than the Clip, shortened to meet',
      over: { fadeIn: 4, fadeOut: 4 },
      stretch: [0, 4, 4],
      count: 4,
      want: [3.83, 18.48, 27.72, 15.31],
    },
    { name: 'a Gain above 0 dB', over: { gain: 6 }, stretch: [0, 4, 4], count: 4, want: [19.95, 39.91, 59.86, 79.81] },
    { name: 'a Gain below 0 dB', over: { gain: -6 }, stretch: [0, 4, 4], count: 4, want: [5.01, 10.02, 15.04, 20.05] },
    {
      name: 'a Gain louder than full scale, no taller than the waveform',
      over: { gain: 12 },
      stretch: [0, 4, 4],
      count: 4,
      want: [39.81, 79.62, 100, 100],
    },
    {
      name: 'a quiet Clip at least 2% tall',
      over: {},
      peaks: new Array<number>(400).fill(0.005),
      stretch: [0, 4, 4],
      count: 4,
      want: [2, 2, 2, 2],
    },
    {
      name: 'a Clip sped up, playing more of its source',
      over: { tempo: 2, length: 2 },
      stretch: [0, 2, 2],
      count: 4,
      want: [10, 20, 30, 40],
    },
    {
      name: 'a Clip slowed down, playing less of its source',
      over: { tempo: 0.5 },
      stretch: [0, 4, 4],
      count: 4,
      want: [10, 10, 20, 20],
    },
    {
      name: 'a Clip flat while its peaks load, or if they failed',
      over: {},
      peaks: [],
      stretch: [0, 4, 4],
      count: 4,
      want: [2, 2, 2, 2],
    },
  ])('draws $name', ({ over, peaks = beat, stretch: [from, to, drawn], count, want }) => {
    const c = clip(over);
    const heights = clipBars(c, c, { from, to, drawn }, count, peaks).map((b) => b.height);
    expect(heights).toHaveLength(want.length);
    heights.forEach((h, i) => expect(h).toBeCloseTo(want[i], 2));
  });

  it('draws a Clip where it is placed, as while a trim is dragged', () => {
    const c = clip();
    const at = { start: 11, offset: 1, length: 2, tempo: 1 };
    expect(clipBars(c, at, { from: 0, to: 2, drawn: 2 }, 2, beat).map((b) => b.height)).toEqual([20, 30]);
  });

  it('marks where a Take clipped, but not a Beat, often mastered loud', () => {
    const loud = [1, 0.5].flatMap((p) => new Array<number>(100).fill(p));
    const stretch = { from: 0, to: 2, drawn: 2 };
    const takeClip = clip({ ...takes, takes: [{ ...take, position: 0 }], length: 2 });
    expect(clipBars(takeClip, takeClip, stretch, 2, loud).map((b) => b.clipped)).toEqual([true, false]);
    const beatClip = clip({ length: 2 });
    expect(clipBars(beatClip, beatClip, stretch, 2, loud).map((b) => b.clipped)).toEqual([false, false]);
  });
});
