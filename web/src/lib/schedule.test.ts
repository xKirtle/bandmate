import { describe, expect, it } from 'vitest';
import type { Clip, Timeline } from './api';
import { clipSources, heard, playing } from './clipSource';
import { positionAt, repeats, schedule, timelineEnd } from './schedule';

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

describe('schedule at a Tempo', () => {
  // The trimmed Clip slowed to 50%: 20 seconds of the Timeline play the
  // same 10 seconds of its Beat, from 2s in.
  const slowed = { ...trimmed, length: 20, tempo: 0.5 };

  it("plays a slowed Clip's audio over twice as long on the Timeline", () => {
    expect(schedule([slowed], 0)).toEqual([{ clip: slowed, delay: 5, from: 2, duration: 20 }]);
  });

  it('starts a slowed Clip under way from half as far into its source', () => {
    expect(schedule([slowed], 9)).toEqual([{ clip: slowed, delay: 0, from: 4, duration: 16 }]);
  });

  it('at 100% plays as recorded', () => {
    expect(schedule([{ ...trimmed, tempo: 1 }], 8.5)).toEqual([
      { clip: { ...trimmed, tempo: 1 }, delay: 0, from: 5.5, duration: 6.5 },
    ]);
  });
});

describe('timelineEnd', () => {
  // A Verse whose inactive Alternate has Line 50 and active one Line 60.
  // Its Lines have the Cues given, by Line id.
  const cued = (cues: Record<number, number> = {}) => ({
    arrangement: [9],
    sections: [
      {
        id: 9,
        alternates: [
          { active: false, lines: [{ id: 50, text: 'Old', cue: cues[50] ?? null }] },
          { active: true, lines: [{ id: 60, text: 'New', cue: cues[60] ?? null }] },
        ],
      },
    ],
  });
  const uncued = cued();

  it('is where the last Clip ends', () => {
    expect(timelineEnd([next, trimmed], uncued)).toBe(19);
  });

  it('is the latest Cue without Clips', () => {
    expect(timelineEnd([], cued({ 60: 12 }))).toBe(12);
  });

  it('is the latest Cue when that is past the last Clip', () => {
    expect(timelineEnd([next, trimmed], cued({ 60: 25.5 }))).toBe(25.5);
  });

  it('is still where the last Clip ends with Cues before it', () => {
    expect(timelineEnd([next, trimmed], cued({ 60: 12 }))).toBe(19);
  });

  it('ignores dormant Cues', () => {
    expect(timelineEnd([next, trimmed], cued({ 50: 40 }))).toBe(19);
    expect(timelineEnd([], cued({ 50: 40 }))).toBe(0);
  });

  it('is 0:00 without Clips or Cues', () => {
    expect(timelineEnd([], uncued)).toBe(0);
  });
});

describe('schedule with a Loop', () => {
  // A Loop over 0:08 to 0:16: the second half of the trimmed Clip and the
  // first second of the next.
  const loop = { start: 8, end: 16 };

  it('starting before the Loop, plays into it, then repeats it from its start', () => {
    expect(schedule([trimmed, next], 0, loop, { from: 0, to: 20 })).toEqual([
      // To the Loop's end.
      { clip: trimmed, delay: 5, from: 2, duration: 10 },
      { clip: next, delay: 15, from: 0, duration: 1 },
      // Its first repeat, from 0:16 on.
      { clip: trimmed, delay: 16, from: 5, duration: 7 },
      { clip: next, delay: 23, from: 0, duration: 1 },
    ]);
  });

  it('only schedules the repeats that start within the window asked for', () => {
    // Repeats start 8, 16, 24, 32… seconds after playing from 0:08.
    expect(schedule([trimmed, next], 8, loop, { from: 10, to: 24 })).toEqual([
      { clip: trimmed, delay: 16, from: 5, duration: 7 },
      { clip: next, delay: 23, from: 0, duration: 1 },
    ]);
    expect(schedule([trimmed, next], 8, loop, { from: 10, to: 16 })).toEqual([]);
  });

  it('starting inside the Loop, plays to its end before repeating it', () => {
    expect(schedule([trimmed, next], 12, loop, { from: 0, to: 5 })).toEqual([
      { clip: trimmed, delay: 0, from: 9, duration: 3 },
      { clip: next, delay: 3, from: 0, duration: 1 },
      { clip: trimmed, delay: 4, from: 5, duration: 7 },
      { clip: next, delay: 11, from: 0, duration: 1 },
    ]);
  });

  it('starting past the Loop, plays straight on to the end, never going back to it', () => {
    expect(schedule([trimmed, next], 16, loop, { from: 0, to: 100 })).toEqual([
      { clip: next, delay: 0, from: 1, duration: 3 },
    ]);
  });

  it('refuses to schedule its endless repeats all at once', () => {
    expect(() => schedule([trimmed], 0, loop)).toThrow(RangeError);
  });

  it('repeats silence where the Loop holds no Clip', () => {
    expect(schedule([next], 0, { start: 2, end: 4 }, { from: 0, to: 60 })).toEqual([]);
  });
});

describe('positionAt', () => {
  const loop = { start: 8, end: 16 };

  it('moves on with the time played', () => {
    expect(positionAt(3, null, 10)).toBe(13);
  });

  it('starting before the Loop, plays into it and goes back to its start at its end', () => {
    expect(positionAt(0, loop, 7)).toBe(7);
    expect(positionAt(0, loop, 15)).toBe(15);
    expect(positionAt(0, loop, 16)).toBe(8);
    expect(positionAt(0, loop, 21)).toBe(13);
  });

  it('starting inside the Loop, stays where it is and goes back to its start at its end', () => {
    expect(positionAt(12, loop, 0)).toBe(12);
    expect(positionAt(12, loop, 3)).toBe(15);
    expect(positionAt(12, loop, 4 + 8 * 3 + 2)).toBe(10);
  });

  it('starting at or past the end of the Loop, plays on and never goes back to it', () => {
    expect(positionAt(16, loop, 10)).toBe(26);
    expect(positionAt(30, loop, 100)).toBe(130);
  });
});

describe('repeats', () => {
  const loop = { start: 8, end: 16 };

  it('tells whether playing from a time ever reaches the Loop and repeats it', () => {
    expect(repeats(0, loop)).toBe(true);
    expect(repeats(15.9, loop)).toBe(true);
    expect(repeats(16, loop)).toBe(false);
    expect(repeats(0, null)).toBe(false);
  });
});

describe('schedule of a Take Clip', () => {
  // A Clip of Takes at 0:30 for 10s, 2s into its span, whose Take starts
  // 1s into the span (so 1s into its file at the Clip's start).
  const clip: Clip = {
    id: 1,
    beatId: null,
    soundId: null,
    name: null,
    gain: 0,
    tempo: 1,
    fadeIn: 0,
    fadeOut: 0,
    takes: [
      {
        id: 7,
        number: 1,
        size: 1,
        duration: 20,
        sampleRate: 48000,
        latencyOffset: 0,
        position: 1,
        nudge: 0,
        recordedAt: '',
      },
    ],
    activeTakeId: 7,
    start: 30,
    offset: 2,
    length: 10,
  };

  it('plays its active Take from where the Clip is in it', () => {
    const played = heard(clip)!;
    expect(schedule([played], 25)).toEqual([{ clip: played, delay: 5, from: 1, duration: 10 }]);
    expect(schedule([played], 34)).toEqual([{ clip: played, delay: 0, from: 5, duration: 6 }]);
  });

  it('plays a slowed Take, nudged in its own time, from where the Clip is in it', () => {
    // At 50%, the 10s Clip covers 5s of its span; the Take is nudged half a second later.
    const slowed: Clip = {
      ...clip,
      tempo: 0.5,
      takes: [{ ...clip.takes[0], position: 1.5, nudge: 0.5 }],
    };
    const played = heard(slowed)!;
    expect(played).toEqual({ start: 30, offset: 0.5, length: 10, tempo: 0.5 });
    expect(schedule([played], 34)).toEqual([{ clip: played, delay: 0, from: 2.5, duration: 6 }]);
  });

  it('starts a slowed Take that comes in partway through the Clip where it comes in on the Timeline', () => {
    const slowed: Clip = { ...clip, tempo: 0.5, takes: [{ ...clip.takes[0], position: 4 }] };
    // The span reaches the Take's start 2s in, 4s along the Timeline.
    expect(heard(slowed)).toEqual({ start: 34, offset: 0, length: 6, tempo: 0.5 });
  });

  it('leaves the Clip being retaken out, and schedules the rest as usual', () => {
    const beat: Clip = {
      ...clip,
      id: 2,
      beatId: 5,
      takes: [],
      activeTakeId: null,
      start: 0,
      offset: 0,
      length: 60,
    };
    const tl: Timeline = {
      songId: 1,
      version: 1,
      updatedAt: '',
      tracks: [
        { id: 1, name: 'Beat', volume: 0, muted: false, soloed: false, clips: [beat] },
        { id: 2, name: 'Vox', volume: 0, muted: false, soloed: false, clips: [clip] },
      ],
      beats: [{ id: 5, title: 'Beat', bpm: null, fileName: 'b.mp3', size: 1, duration: 60 }],
      sounds: [],
      loop: null,
    };
    const scheduled = schedule(playing(tl, clipSources(tl), clip.id), 28);
    expect(scheduled.map((s) => [s.clip.trackId, s.delay, s.from])).toEqual([[1, 0, 28]]);
  });
});
