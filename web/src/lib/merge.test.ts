import { describe, expect, it } from 'vitest';
import type { Clip, Take, Timeline, Track } from './api';
import { clipSources } from './clipSource';
import { mergeTarget, mergedClips } from './merge';

const clip = (id: number, start: number, more: Partial<Clip> = {}): Clip => ({
  id,
  beatId: 100,
  soundId: null,
  name: null,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length: 10,
  ...more,
});

const track = (id: number, clips: Clip[] = []): Track => ({
  id,
  name: `Track ${id}`,
  volume: -6,
  muted: false,
  soloed: false,
  clips,
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

  it('merges two or more Clips on one Track, from the earliest start to the latest end', () => {
    expect(mergeTarget(tracks, new Set([6, 5]))).toEqual({ trackId: 1, clipIds: [5, 6], start: 0, end: 45 });
    expect(mergeTarget(tracks, new Set([7, 6, 5]))).toEqual({ trackId: 1, clipIds: [5, 6, 7], start: 0, end: 60 });
  });

  it("isn't offered for one Clip, which would only bake in its trim", () => {
    expect(mergeTarget(tracks, new Set([5]))).toBeNull();
    expect(mergeTarget(tracks, new Set())).toBeNull();
  });

  it("isn't offered for Clips on several Tracks", () => {
    expect(mergeTarget(tracks, new Set([5, 8]))).toBeNull();
  });
});

describe('mergedClips', () => {
  it('plays only the Clips merged, each as trimmed, a Take Clip only its active Take with its Nudge', () => {
    // Take 41 starts 1s into its span, nudged 0.25s later; Take 42 isn't active.
    const takes = clip(6, 20, {
      beatId: null,
      takes: [take(41, 1.25, 0.25), take(42, 0)],
      activeTakeId: 41,
      offset: 0.5,
      length: 6,
    });
    const tl = timeline([
      track(1, [clip(5, 0, { offset: 3, length: 8 }), takes, clip(7, 40, { beatId: null, soundId: 30 })]),
      track(2, [clip(8, 0)]),
    ]);

    const got = mergedClips(tl, clipSources(tl), [5, 6, 7]);

    expect(got).toEqual([
      { start: 0, offset: 3, length: 8, source: '/api/beats/100/audio?v=beat.mp3-1-60', trackId: 1 },
      // Its span starts at 19.5, so Take 41 plays from 20.75 to its end at 24.75.
      { start: 20.75, offset: 0, length: 4, source: '/api/songs/1/takes/41/audio', trackId: 1 },
      { start: 40, offset: 0, length: 10, source: '/api/songs/1/sounds/30/audio', trackId: 1 },
    ]);
  });
});
