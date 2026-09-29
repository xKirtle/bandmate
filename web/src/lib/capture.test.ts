import { describe, expect, it } from 'vitest';
import { samplesFrom } from './capture';

describe('samplesFrom', () => {
  const batch = (frame: number, ...samples: number[]) => ({ frame, samples: new Float32Array(samples) });

  it('joins batches from a frame on, dropping what came before it', () => {
    expect(Array.from(samplesFrom([batch(0, 1, 2, 3), batch(3, 4, 5)], 2))).toEqual([3, 4, 5]);
  });

  it('puts each batch at its own frame, in whatever order they come', () => {
    expect(Array.from(samplesFrom([batch(4, 5, 6), batch(2, 3, 4)], 2))).toEqual([3, 4, 5, 6]);
  });

  it('leaves silence where a batch is missing', () => {
    expect(Array.from(samplesFrom([batch(0, 1), batch(3, 4)], 0))).toEqual([1, 0, 0, 4]);
  });

  it('is empty with nothing after the frame', () => {
    expect(samplesFrom([batch(0, 1, 2)], 5).length).toBe(0);
  });
});
