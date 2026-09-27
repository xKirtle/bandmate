import { describe, expect, it } from 'vitest';
import { clampMove, clampTrimEnd, clampTrimStart, minClipLength } from './clipEdit';

// On a Track: a Clip at 0:10-0:20 and one at 0:40-0:50, with a 30s gap
// between them.
const left = { start: 10, offset: 0, length: 10 };
const right = { start: 40, offset: 0, length: 10 };
const neighbours = [left, right];

describe('clampMove', () => {
  it('goes where it is dragged when that is clear', () => {
    expect(clampMove(neighbours, 5, 25)).toBe(25);
    expect(clampMove(neighbours, 5, 60)).toBe(60);
  });

  it('stops at a neighbour it is dragged into', () => {
    expect(clampMove(neighbours, 5, 37)).toBe(35);
    expect(clampMove(neighbours, 5, 19)).toBe(20);
  });

  it('lands on the side of a neighbour nearest to where it is dropped', () => {
    expect(clampMove(neighbours, 5, 42)).toBe(35);
    expect(clampMove(neighbours, 5, 46)).toBe(50);
  });

  it('skips a gap too small for it', () => {
    // 30s long: too long for the gap, so it goes before or after both.
    expect(clampMove(neighbours, 30, 15)).toBe(50);
    expect(clampMove([right], 50, 10)).toBe(50);
  });

  it('never starts before 0:00', () => {
    expect(clampMove(neighbours, 5, -3)).toBe(0);
    expect(clampMove(neighbours, 8, 3)).toBe(2);
    // No room before the first neighbour at all.
    expect(clampMove(neighbours, 12, 1)).toBe(20);
  });

  it('goes anywhere on an empty Track', () => {
    expect(clampMove([], 5, 12.5)).toBe(12.5);
  });
});

describe('clampTrimStart', () => {
  // 0:22-0:32 in the gap, playing 5s-15s of a 20s Beat.
  const clip = { start: 22, offset: 5, length: 10 };

  it('moves the start and the trim together, keeping the audio in place', () => {
    expect(clampTrimStart(clip, neighbours, 25)).toEqual({ start: 25, offset: 8, length: 7 });
    expect(clampTrimStart(clip, neighbours, 21)).toEqual({ start: 21, offset: 4, length: 11 });
  });

  it('stops at the start of the source', () => {
    expect(clampTrimStart(clip, [], 10)).toEqual({ start: 17, offset: 0, length: 15 });
  });

  it('stops at the neighbour before it', () => {
    expect(clampTrimStart({ ...clip, start: 25, offset: 10 }, neighbours, 12)).toEqual({ start: 20, offset: 5, length: 15 });
  });

  it('never starts before 0:00', () => {
    expect(clampTrimStart({ start: 2, offset: 5, length: 10 }, [], -1)).toEqual({ start: 0, offset: 3, length: 12 });
  });

  it('keeps some of the Clip', () => {
    expect(clampTrimStart(clip, neighbours, 40)).toEqual({ start: 32 - minClipLength, offset: 15 - minClipLength, length: minClipLength });
  });
});

describe('clampTrimEnd', () => {
  const clip = { start: 22, offset: 5, length: 10 };

  it('changes how long it plays', () => {
    expect(clampTrimEnd(clip, neighbours, 20, 30)).toEqual({ start: 22, offset: 5, length: 8 });
    expect(clampTrimEnd(clip, neighbours, 20, 35)).toEqual({ start: 22, offset: 5, length: 13 });
  });

  it('stops at the end of the source', () => {
    expect(clampTrimEnd(clip, [], 20, 60)).toEqual({ start: 22, offset: 5, length: 15 });
  });

  it('stops at the neighbour after it', () => {
    expect(clampTrimEnd(clip, neighbours, 60, 45)).toEqual({ start: 22, offset: 5, length: 18 });
  });

  it('keeps some of the Clip', () => {
    expect(clampTrimEnd(clip, neighbours, 20, 10)).toEqual({ start: 22, offset: 5, length: minClipLength });
  });
});
