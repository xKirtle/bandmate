import { describe as group, expect, it } from 'vitest';
import { levelsOf, mixdownEnd, mixdownName } from './mixdown';

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

group('mixdownName', () => {
  it('names the file after the Song', () => {
    expect(mixdownName('Midnight Drive')).toBe('Midnight Drive - Mixdown.wav');
  });
});
