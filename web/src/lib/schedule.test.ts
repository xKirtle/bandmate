import { describe, expect, it } from 'vitest';
import { schedule, timelineEnd } from './schedule';

// A 10-second Clip at 0:05 playing a Beat from 2s in, and a 4-second one
// right after it playing its source from the start.
const trimmed = { id: 1, start: 5, offset: 2, length: 10 };
const next = { id: 2, start: 15, offset: 0, length: 4 };

describe('schedule', () => {
  it('plays each Clip from its trim, starting when the Timeline reaches it', () => {
    expect(schedule([trimmed, next], 0)).toEqual([
      { clip: trimmed, delay: 5, from: 2, duration: 10 },
      { clip: next, delay: 15, from: 0, duration: 4 },
    ]);
  });

  it('starts a Clip already under way partway through its source', () => {
    expect(schedule([trimmed, next], 8.5)).toEqual([
      { clip: trimmed, delay: 0, from: 5.5, duration: 6.5 },
      { clip: next, delay: 6.5, from: 0, duration: 4 },
    ]);
  });

  it('starts a Clip exactly at its start without delay', () => {
    expect(schedule([next], 15)).toEqual([{ clip: next, delay: 0, from: 0, duration: 4 }]);
  });

  it('leaves out Clips that have finished', () => {
    expect(schedule([trimmed, next], 15)).toEqual([{ clip: next, delay: 0, from: 0, duration: 4 }]);
    expect(schedule([trimmed, next], 19)).toEqual([]);
  });

  it('plays nothing on an empty Timeline', () => {
    expect(schedule([], 0)).toEqual([]);
  });
});

describe('timelineEnd', () => {
  it('is where the last Clip ends', () => {
    expect(timelineEnd([next, trimmed])).toBe(19);
  });

  it('is 0:00 without Clips', () => {
    expect(timelineEnd([])).toBe(0);
  });
});
