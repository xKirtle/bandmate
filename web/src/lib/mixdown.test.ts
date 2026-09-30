import { describe as group, expect, it } from 'vitest';
import { levelsOf, mixdownEnd, mixdownName, mixdownRanges } from './mixdown';

const channel = (...samples: number[]) => new Float32Array(samples);

group('levelsOf', () => {
  it('finds a Mixdown with sound below full scale neither clipping nor silent', () => {
    expect(levelsOf([channel(0, 0.5, -0.99), channel(0.25, 0, 0)])).toEqual({ clips: false, silent: false });
  });

  it('finds it clipping where any sample in either channel reaches full scale', () => {
    expect(levelsOf([channel(0, 1, 0), channel(0, 0, 0)])).toEqual({ clips: true, silent: false });
    expect(levelsOf([channel(0, 0, 0), channel(0, -1, 0)])).toEqual({ clips: true, silent: false });
    expect(levelsOf([channel(0, 0, 0), channel(0, 0, 1.7)])).toEqual({ clips: true, silent: false });
  });

  it('finds it clipping where a sample only rounds to full scale in the file', () => {
    // 24-bit's largest sample is 1 − 2⁻²³: halfway to it rounds up to it.
    expect(levelsOf([channel(1 - 2 ** -24), channel(0)])).toEqual({ clips: true, silent: false });
    expect(levelsOf([channel(1 - 2 ** -22), channel(0)])).toEqual({ clips: false, silent: false });
  });

  it('finds it silent where every sample is zero', () => {
    expect(levelsOf([channel(0, 0, 0), channel(0, 0, 0)])).toEqual({ clips: false, silent: true });
  });

  it('finds even the faintest sound not silent', () => {
    expect(levelsOf([channel(0, 0, 0), channel(0, 1e-7, 0)])).toEqual({ clips: false, silent: false });
  });
});

group('mixdownEnd', () => {
  it('ends where the last Clip ends, whichever Track it is on', () => {
    const clips = [
      { start: 0, offset: 0, length: 30 },
      { start: 12, offset: 4, length: 25.5 },
      { start: 20, offset: 0, length: 5 },
    ];
    expect(mixdownEnd(clips)).toBe(37.5);
  });

  it('is 0 without Clips', () => {
    expect(mixdownEnd([])).toBe(0);
  });
});

group('mixdownRanges', () => {
  const whole = { of: 'timeline', start: 0, end: 37.5 };

  it('offers only the whole Timeline without a Loop', () => {
    expect(mixdownRanges(37.5, null)).toEqual({ ranges: [whole], chosen: whole });
  });

  it("offers the Loop's stretch too, and chooses it while the Loop is on", () => {
    const loop = { of: 'loop', start: 32, end: 48 };
    expect(mixdownRanges(37.5, { start: 32, end: 48, on: true })).toEqual({ ranges: [whole, loop], chosen: loop });
  });

  it("still offers the Loop's stretch while it's off, choosing the whole Timeline", () => {
    const loop = { of: 'loop', start: 32, end: 48 };
    expect(mixdownRanges(37.5, { start: 32, end: 48, on: false })).toEqual({ ranges: [whole, loop], chosen: whole });
  });
});

group('mixdownName', () => {
  it("names the whole Timeline's file after the Song", () => {
    expect(mixdownName('Midnight Drive', { of: 'timeline', start: 0, end: 37.5 })).toBe('Midnight Drive - Mixdown.wav');
  });

  it("adds the Loop's times to the file of its stretch", () => {
    expect(mixdownName('Midnight Drive', { of: 'loop', start: 32, end: 48 })).toBe(
      'Midnight Drive - Mixdown (0m32s-0m48s).wav',
    );
    expect(mixdownName('Midnight Drive', { of: 'loop', start: 65.4, end: 130.6 })).toBe(
      'Midnight Drive - Mixdown (1m05s-2m11s).wav',
    );
  });
});
