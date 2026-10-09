import { describe, expect, it } from 'vitest';
import { sourceAt, sourceLength, timelineAt, timelineLength } from './clipTime';

// A Clip at 0:05 playing its source from 2s in, for 10 seconds.
const clip = { start: 5, offset: 2, length: 10 };

describe('a Clip playing its audio as recorded', () => {
  it('plays its source from its trim when the Timeline reaches its start', () => {
    expect(sourceAt(clip, 5)).toBe(2);
    expect(timelineAt(clip, 2)).toBe(5);
  });

  it('plays a second of its source for each second of the Timeline', () => {
    expect(sourceAt(clip, 8.5)).toBe(5.5);
    expect(timelineAt(clip, 5.5)).toBe(8.5);
  });

  it('places its source before its trim, and past its end, at the same rate', () => {
    expect(timelineAt(clip, 0)).toBe(3);
    expect(sourceAt(clip, 3)).toBe(0);
    expect(timelineAt(clip, 30)).toBe(33);
  });

  it('covers as much of its source as it lasts on the Timeline', () => {
    expect(sourceLength(clip, 10)).toBe(10);
    expect(timelineLength(clip, 0.25)).toBe(0.25);
  });
});

describe('a Clip at a Tempo of 50%', () => {
  // The same Clip, slowed: 10 seconds of the Timeline play 5 of its source.
  const slowed = { ...clip, tempo: 0.5 };

  it('plays half a second of its source for each second of the Timeline', () => {
    expect(sourceAt(slowed, 9)).toBe(4);
    expect(timelineAt(slowed, 4)).toBe(9);
  });

  it('places its source before its trim at the same rate', () => {
    expect(timelineAt(slowed, 0)).toBe(1);
  });

  it('covers half as much of its source as it lasts on the Timeline', () => {
    expect(sourceLength(slowed, 10)).toBe(5);
    expect(timelineLength(slowed, 5)).toBe(10);
  });
});
