import { describe, expect, it } from 'vitest';
import { bars } from './waveform';

describe('bars', () => {
  it('takes the loudest peak of each stretch', () => {
    expect(bars([0.1, 0.4, 0.2, 0.9, 0.3, 0.5], 3)).toEqual([0.4, 0.9, 0.5]);
  });

  it('spreads peaks that don’t divide evenly, covering every one', () => {
    // 5 peaks over 2 bars: the first bar covers 2 of them, the second 3.
    expect(bars([0.2, 0.1, 0.8, 0.3, 0.6], 2)).toEqual([0.2, 0.8]);
  });

  it('repeats peaks when there are fewer than bars', () => {
    expect(bars([0.2, 0.7], 4)).toEqual([0.2, 0.2, 0.7, 0.7]);
  });

  it('gives silence without peaks', () => {
    expect(bars([], 3)).toEqual([0, 0, 0]);
  });
});
