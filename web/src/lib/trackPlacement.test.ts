import { describe, expect, it } from 'vitest';
import { inTheWay, isFree } from './trackPlacement';

const clip = (id: number, start: number, length = 10) => ({ id, start, length });

// A Track with Clips at 0:10 to 0:20 and 0:30 to 0:40.
const clips = [clip(1, 10), clip(2, 30)];

describe('isFree', () => {
  it('is free in a gap between Clips, or on an empty Track', () => {
    expect(isFree(clips, { start: 21, end: 29 })).toBe(true);
    expect(isFree([], { start: 0, end: 100 })).toBe(true);
  });

  it('is not free over a Clip, inside one, or covering one', () => {
    expect(isFree(clips, { start: 15, end: 25 })).toBe(false);
    expect(isFree(clips, { start: 25, end: 35 })).toBe(false);
    expect(isFree(clips, { start: 12, end: 18 })).toBe(false);
    expect(isFree(clips, { start: 0, end: 50 })).toBe(false);
  });

  it("is free edge to edge, touching a neighbour's end or start", () => {
    expect(isFree(clips, { start: 20, end: 30 })).toBe(true);
    expect(isFree(clips, { start: 0, end: 10 })).toBe(true);
    expect(isFree(clips, { start: 40, end: 50 })).toBe(true);
  });

  it('is free overlapping a neighbour by just under the tolerance, at either edge, but not just over it', () => {
    expect(isFree(clips, { start: 20 - 5e-7, end: 30 + 5e-7 })).toBe(true);
    expect(isFree(clips, { start: 20 - 2e-6, end: 30 })).toBe(false);
    expect(isFree(clips, { start: 20, end: 30 + 2e-6 })).toBe(false);
  });

  it('leaves out the Clips asked, e.g. a Clip being moved or merged', () => {
    expect(isFree(clips, { start: 15, end: 25 }, new Set([1]))).toBe(true);
    expect(isFree(clips, { start: 15, end: 35 }, new Set([1]))).toBe(false);
    expect(isFree(clips, { start: 15, end: 35 }, new Set([1, 2]))).toBe(true);
  });

  it("goes by the Track's own Clips only, not another Track's", () => {
    const tracks = [{ clips }, { clips: [clip(3, 20)] }];
    expect(isFree(tracks[0].clips, { start: 20, end: 30 })).toBe(true);
    expect(isFree(tracks[1].clips, { start: 20, end: 30 })).toBe(false);
  });
});

describe('inTheWay', () => {
  it('gives back the Clips in the way of a span, but for those left out and those only touching it', () => {
    expect(inTheWay(clips, { start: 15, end: 35 })).toEqual([clip(1, 10), clip(2, 30)]);
    expect(inTheWay(clips, { start: 15, end: 35 }, new Set([2]))).toEqual([clip(1, 10)]);
    expect(inTheWay(clips, { start: 20, end: 30 })).toEqual([]);
  });
});
