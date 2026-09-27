import { describe, expect, it } from 'vitest';
import { peaks } from './peaks';

describe('peaks', () => {
  it('takes the loudest sample of each stretch, whichever its sign', () => {
    // 4 samples a second, 2 peaks a second: each peak covers 2 samples.
    const samples = new Float32Array([0.1, -0.5, 0.25, 0.2, -1, 0]);

    expect(peaks([samples], 4, 2)).toEqual([0.5, 0.25, 1]);
  });

  it('takes the loudest channel', () => {
    const left = new Float32Array([0.1, 0.2, 0.9, 0]);
    const right = new Float32Array([-0.7, 0, 0.1, 0.3]);

    expect(peaks([left, right], 4, 2)).toEqual([0.7, 0.9]);
  });

  it('gives a last, shorter stretch its own peak', () => {
    const samples = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.3]);

    expect(peaks([samples], 4, 2)).toEqual([0.5, 0.5, 0.3]);
  });

  it('spreads samples evenly when a stretch is not a whole number of them', () => {
    // 3 samples a second, 2 peaks a second: stretches of 1.5 samples, so
    // samples 0 | 1-2 | 3 | 4-5.
    const samples = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);

    expect(peaks([samples], 3, 2)).toEqual([0.1, 0.3, 0.4, 0.6]);
  });

  it('computes 100 peaks a second by default', () => {
    const second = new Float32Array(44100).fill(0.5);

    const result = peaks([second], 44100);

    expect(result).toHaveLength(100);
    expect(new Set(result)).toEqual(new Set([0.5]));
  });

  it('caps clipped samples at 1 and rounds to 3 decimals, to keep uploads small', () => {
    const samples = new Float32Array([1.7, -0.12345, 0.9999, 0.5]);

    expect(peaks([samples], 4, 4)).toEqual([1, 0.123, 1, 0.5]);
  });

  it('has no peaks for no audio', () => {
    expect(peaks([new Float32Array(0)], 44100)).toEqual([]);
    expect(peaks([], 44100)).toEqual([]);
  });
});
