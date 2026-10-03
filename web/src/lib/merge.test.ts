import { describe, expect, it } from 'vitest';
import type { Clip, Take, Timeline, Track } from './api';
import { clipSources } from './clipSource';
import { mergeTarget, mergeWarning, mergedClips } from './merge';

const clip = (id: number, start: number, more: Partial<Clip> = {}): Clip => ({
  id,
  beatId: 100,
  soundId: null,
  name: null,
  gain: 0,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length: 10,
  ...more,
});

const track = (id: number, clips: Clip[] = [], more: Partial<Track> = {}): Track => ({
  id,
  name: `Track ${id}`,
  volume: -6,
  muted: false,
  soloed: false,
  clips,
  ...more,
});

const take = (id: number, position: number, nudge = 0): Take => ({
  id,
  number: id,
  size: 0,
  duration: 4,
  sampleRate: 48000,
  latencyOffset: 0,
  position,
  nudge,
  recordedAt: '',
});

const timeline = (tracks: Track[]): Timeline => ({
  songId: 1,
  version: 1,
  updatedAt: '',
  tracks,
  beats: [{ id: 100, title: 'Beat', bpm: null, fileName: 'beat.mp3', size: 1, duration: 60 }],
  sounds: [{ id: 30, name: 'Hum', fileName: 'hum.m4a', size: 1, duration: 20 }],
  loop: null,
});

describe('mergeTarget', () => {
  const tracks = [track(1, [clip(5, 0), clip(6, 30, { offset: 2, length: 15 }), clip(7, 50)]), track(2, [clip(8, 4)])];

  it('merges two or more Clips on one Track onto it, from the earliest start to the latest end', () => {
    expect(mergeTarget(tracks, new Set([6, 5]))).toMatchObject({
      onto: { trackId: 1 },
      clipIds: [5, 6],
      start: 0,
      end: 45,
    });
    expect(mergeTarget(tracks, new Set([7, 6, 5]))).toMatchObject({ clipIds: [5, 6, 7], start: 0, end: 60 });
  });

  it("isn't offered for one Clip, which would only bake in its trim", () => {
    expect(mergeTarget(tracks, new Set([5]))).toBeNull();
    expect(mergeTarget(tracks, new Set())).toBeNull();
  });

  it("isn't offered for a Clip that's gone from the Timeline", () => {
    expect(mergeTarget(tracks, new Set([5, 99]))).toBeNull();
  });

  it('merges Clips on several Tracks onto the topmost of theirs, in Timeline order', () => {
    expect(mergeTarget(tracks, new Set([8, 5]))).toMatchObject({
      onto: { trackId: 1 },
      clipIds: [5, 8],
      start: 0,
      end: 14,
    });
  });

  it('tries their Tracks top to bottom for one with no other Clip in the way over their span', () => {
    // Track 1's 6, from 30 to 45, is in the way of 0 to 54; so is Track 2's
    // 10, from 52; Track 4's 12 only starts as they end.
    const crowded = [
      track(1, [clip(5, 0), clip(6, 30, { length: 15 })]),
      track(2, [clip(9, 40), clip(10, 52, { length: 2 })]),
      track(3),
      track(4, [clip(11, 50, { length: 4 }), clip(12, 54)]),
    ];
    expect(mergeTarget(crowded, new Set([5, 9, 11]))).toMatchObject({ onto: { trackId: 4 }, start: 0, end: 54 });
  });

  it('goes on a new Track right below the lowest of theirs, named like any new Track, when none of theirs has room', () => {
    // 0 to 24, where Track 1's 6 and Track 2's 7 are in the way.
    const crowded = [
      track(1, [clip(5, 0), clip(6, 15)]),
      track(2, [clip(7, 0), clip(9, 14)]),
      track(3, [clip(10, 8)]),
      track(4),
    ];
    expect(mergeTarget(crowded, new Set([5, 9]))).toMatchObject({
      onto: { newTrack: { name: 'Track 5', position: 2 } },
      start: 0,
      end: 24,
    });
  });

  it("plays each Clip at its Track's volume relative to the Track it goes on's", () => {
    const levels = [
      track(1, [clip(5, 0)], { volume: -12 }),
      track(2, [clip(8, 4)], { volume: 0 }),
      track(3, [clip(9, 8)], { volume: -18 }),
    ];
    const target = mergeTarget(levels, new Set([5, 8, 9]))!;
    expect(target.onto).toEqual({ trackId: 1 });
    expect([...target.gains.keys()]).toEqual([1, 2, 3]);
    expect(target.gains.get(1)).toBe(1);
    // 12 dB louder than Track 1, and 6 dB quieter.
    expect(target.gains.get(2)).toBeCloseTo(3.981, 3);
    expect(target.gains.get(3)).toBeCloseTo(0.501, 3);
    expect(target.silent).toEqual([]);
  });

  it('plays them on a new Track relative to its 0 dB', () => {
    // 0 to 25, where 6 and 9 are in the way.
    const levels = [
      track(1, [clip(5, 0), clip(6, 20)], { volume: -6 }),
      track(2, [clip(9, 0, { length: 5 }), clip(8, 15)], { volume: 6 }),
    ];
    const target = mergeTarget(levels, new Set([5, 8]))!;
    expect(target.onto).toEqual({ newTrack: { name: 'Track 3', position: 2 } });
    expect(target.gains.get(1)).toBeCloseTo(0.501, 3);
    expect(target.gains.get(2)).toBeCloseTo(1.995, 3);
  });

  it('silences a muted Track, and Tracks left out by a solo, naming each', () => {
    const levels = [
      track(1, [clip(5, 0)], { name: 'Beat', soloed: true }),
      track(2, [clip(8, 4)], { name: 'Lead vox', muted: true, soloed: true }),
      track(3, [clip(9, 8)], { name: 'Adlibs' }),
      track(4, [clip(10, 8)], { name: 'Pads', soloed: true }),
    ];
    const target = mergeTarget(levels, new Set([5, 8, 9]))!;
    expect(target.gains.get(1)).toBe(1);
    expect(target.gains.get(2)).toBe(0);
    expect(target.gains.get(3)).toBe(0);
    expect(target.silent).toEqual([
      { name: 'Lead vox', why: 'muted' },
      { name: 'Adlibs', why: 'notSoloed' },
    ]);
  });
});

describe('mergeWarning', () => {
  it('says nothing when every Track is heard', () => {
    expect(mergeWarning([])).toBeNull();
  });

  it('names each Track that came out silent, and why', () => {
    expect(mergeWarning([{ name: 'Lead vox', why: 'muted' }])).toBe('Lead vox is muted, so it merged as silence.');
    expect(
      mergeWarning([
        { name: 'Lead vox', why: 'muted' },
        { name: 'Adlibs', why: 'notSoloed' },
        { name: 'Pads', why: 'muted' },
      ]),
    ).toBe("Lead vox is muted, Adlibs isn't soloed and Pads is muted, so they merged as silence.");
  });
});

describe('mergedClips', () => {
  it('plays only the Clips merged, each as trimmed and at its Gain, a Take Clip only its active Take with its Nudge', () => {
    // Take 41 starts 1s into its span, nudged 0.25s later; Take 42 isn't active.
    const takes = clip(6, 20, {
      beatId: null,
      takes: [take(41, 1.25, 0.25), take(42, 0)],
      activeTakeId: 41,
      offset: 0.5,
      length: 6,
    });
    const tl = timeline([
      track(1, [clip(5, 0, { offset: 3, length: 8, gain: -20 }), takes, clip(7, 40, { beatId: null, soundId: 30 })]),
      track(2, [clip(8, 0)]),
    ]);

    const got = mergedClips(tl, clipSources(tl), [5, 6, 7]);

    expect(got).toEqual([
      { start: 0, offset: 3, length: 8, source: '/api/beats/100/audio?v=beat.mp3-1-60', trackId: 1, gainFactor: 0.1 },
      // Its span starts at 19.5, so Take 41 plays from 20.75 to its end at 24.75.
      { start: 20.75, offset: 0, length: 4, source: '/api/songs/1/takes/41/audio', trackId: 1, gainFactor: 1 },
      { start: 40, offset: 0, length: 10, source: '/api/songs/1/sounds/30/audio', trackId: 1, gainFactor: 1 },
    ]);
  });
});
