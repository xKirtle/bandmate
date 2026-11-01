import { describe, expect, it } from 'vitest';
import type { Clip, Take, Track } from './api';
import type { ClipSource, ClipSources } from './clipSource';
import { clipsAbove, onFader } from './trackClipping';

// A Beat 4 seconds long, a peak every hundredth of a second: 0.1 loud
// through its first second, 0.2 through its second, and so on.
const beat = [0.1, 0.2, 0.25, 0.5].flatMap((p) => new Array<number>(100).fill(p));

const source: ClipSource = {
  key: 'beat',
  title: 'Beat',
  audio: '',
  duration: 4,
  loadPeaks: async () => beat,
};
const sources: ClipSources = { of: () => source, all: () => [source] };

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 1,
  beatId: 7,
  soundId: null,
  name: null,
  gain: 0,
  tempo: 1,
  pitch: 0,
  nudge: 0,
  fadeIn: 0,
  fadeOut: 0,
  takes: [],
  activeTakeId: null,
  start: 0,
  offset: 0,
  length: 4,
  ...over,
});

const track = (...clips: Clip[]): Track => ({ id: 1, name: 'Beat', volume: 0, muted: false, soloed: false, clips });

const above = (t: Track, peaks: readonly number[] = beat) => clipsAbove(t, sources, () => peaks);

describe('clipsAbove', () => {
  it('is how far the loudest peak is under full scale', () => {
    expect(above(track(clip()))).toBeCloseTo(6.02, 2);
  });

  it('is 0 dB for audio at full scale, which only clips turned up', () => {
    expect(above(track(clip()), [1, 0.5])).toBe(0);
  });

  it('follows the Clip’s Gain', () => {
    expect(above(track(clip({ gain: 6 })))).toBeCloseTo(0.02, 2);
    expect(above(track(clip({ gain: -6 })))).toBeCloseTo(12.02, 2);
  });

  it('only counts what the Clip plays, trimmed', () => {
    expect(above(track(clip({ length: 3 })))).toBeCloseTo(12.04, 2);
    expect(above(track(clip({ offset: 1, length: 1 })))).toBeCloseTo(13.98, 2);
  });

  it('counts what a Clip plays at its Tempo', () => {
    // Twice as fast, a 2 second Clip plays all 4 seconds of the Beat.
    expect(above(track(clip({ tempo: 2, length: 2 })))).toBeCloseTo(6.02, 2);
    // Half as fast, it plays only the first.
    expect(above(track(clip({ tempo: 0.5, length: 2 })))).toBeCloseTo(20, 2);
  });

  it('follows the audio a Nudge moves out of the window', () => {
    // A second later, the Clip's 3 second window reaches 2 seconds of the Beat.
    expect(above(track(clip({ nudge: 1, length: 3 })))).toBeCloseTo(13.98, 2);
    // A second earlier, its 2 second window plays from a second in.
    expect(above(track(clip({ nudge: -1, length: 2 })))).toBeCloseTo(12.04, 2);
    expect(above(track(clip({ nudge: 10 })))).toBeNull();
  });

  it('counts its Fades', () => {
    // Fading out over the whole of the loudest second, at half way through it
    // the Beat is already quieter than the second before.
    expect(above(track(clip({ fadeOut: 1 })))).toBeGreaterThan(6.02);
  });

  it('plays a Take from where it sits in its Clip’s source', () => {
    const take: Take = {
      id: 10,
      number: 1,
      size: 0,
      duration: 4,
      sampleRate: 48000,
      latencyOffset: 0,
      position: 1,
      recordedAt: '',
    };
    const c = clip({ beatId: null, takes: [take], activeTakeId: take.id, length: 2 });
    // The Clip reaches a second into the Take.
    expect(above(track(c))).toBeCloseTo(20, 2);
  });

  it('goes by the Track’s loudest Clip', () => {
    expect(above(track(clip({ length: 1 }), clip({ start: 5, gain: 6 })))).toBeCloseTo(0.02, 2);
  });

  it('has nothing to go by without Clips or peaks', () => {
    expect(above(track())).toBeNull();
    expect(above(track(clip()), [])).toBeNull();
    expect(above(track(clip()), [0, 0])).toBeNull();
  });
});

describe('onFader', () => {
  it.each([
    [null, false],
    [-36.1, false],
    [-36, true],
    [0, true],
    [24, true],
    [24.1, false],
  ])('%s: %s', (volume, want) => {
    expect(onFader(volume)).toBe(want);
  });
});
