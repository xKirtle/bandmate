import { describe, expect, it } from 'vitest';
import type { Clip, Timeline, Track } from './api';
import { rightHalfOf, rightHalves, splitTargets } from './split';

const clip = (id: number, start: number, length = 10): Clip => ({
  id,
  beatId: 100,
  soundId: null,
  name: null,
  gain: 0,
  fadeIn: 0,
  fadeOut: 0,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length,
});

const track = (id: number, clips: Clip[]): Track => ({
  id,
  name: `Track ${id}`,
  volume: 0,
  muted: false,
  soloed: false,
  clips,
});

// Track 1 has Clips at 0:00 to 0:10 and 0:10 to 0:20, Track 2 one at 0:05
// to 0:15, and Track 3 none.
const tracks = [track(1, [clip(1, 0), clip(2, 10)]), track(2, [clip(3, 5)]), track(3, [])];

describe('splitTargets', () => {
  it("splits the Selection's Clips the playhead crosses, in Timeline order", () => {
    expect(splitTargets(tracks, new Set([3, 1, 2]), 1, 7)).toEqual([1, 3]);
    expect(splitTargets(tracks, new Set([2, 3]), 1, 12)).toEqual([2, 3]);
  });

  it("splits nothing when the playhead crosses none of the Selection's Clips, even if it crosses another", () => {
    expect(splitTargets(tracks, new Set([2]), 1, 7)).toEqual([]);
  });

  it("splits the Chosen Track's Clip under the playhead when nothing is selected", () => {
    expect(splitTargets(tracks, new Set(), 1, 7)).toEqual([1]);
    expect(splitTargets(tracks, new Set(), 2, 7)).toEqual([3]);
    expect(splitTargets(tracks, new Set(), 3, 7)).toEqual([]);
    expect(splitTargets(tracks, new Set(), 2, 16)).toEqual([]);
    expect(splitTargets(tracks, new Set(), null, 7)).toEqual([]);
  });

  it('never splits a Clip the playhead is on the edge of', () => {
    expect(splitTargets(tracks, new Set(), 1, 10)).toEqual([]);
    expect(splitTargets(tracks, new Set(), 1, 0)).toEqual([]);
    expect(splitTargets(tracks, new Set([1, 2, 3]), 1, 15)).toEqual([2]);
  });
});

const timeline = (tracks: Track[]): Timeline => ({
  songId: 1,
  version: 1,
  updatedAt: '',
  tracks,
  beats: [],
  sounds: [],
  loop: null,
});

describe('rightHalves', () => {
  it('is the right half of each Clip a Split cut, in Timeline order, never the left halves it kept', () => {
    // Split at 0:07: Clip 1 into 1 and 4, Clip 3 into 3 and 5.
    const after = timeline([
      track(1, [clip(1, 0, 7), clip(4, 7, 3), clip(2, 10)]),
      track(2, [clip(3, 5, 2), clip(5, 7, 8)]),
      track(3, []),
    ]);
    expect(rightHalves(timeline(tracks), after)).toEqual([4, 5]);
  });

  it('is the one right half when a Split cut one Clip', () => {
    // Split at 0:12: Clip 2 into 2 and 4.
    const after = timeline([
      track(1, [clip(1, 0), clip(2, 10, 2), clip(4, 12, 8)]),
      track(2, [clip(3, 5)]),
      track(3, []),
    ]);
    expect(rightHalves(timeline(tracks), after)).toEqual([4]);
  });
});

describe('rightHalfOf', () => {
  // Split at 0:07: Clip 1 into 1 and 5, Clip 3 into 3 and 4, the new ids
  // not in the order of the Clips they came from.
  const after = timeline([
    track(1, [clip(1, 0, 7), clip(5, 7, 3), clip(2, 10)]),
    track(2, [clip(3, 5, 2), clip(4, 7, 8)]),
    track(3, []),
  ]);

  it('is the right half a Split cut from a Clip, which stayed as its left half', () => {
    expect(rightHalfOf(timeline(tracks), after, 1)).toBe(5);
    expect(rightHalfOf(timeline(tracks), after, 3)).toBe(4);
  });

  it('is null for a Clip the Split left whole', () => {
    expect(rightHalfOf(timeline(tracks), after, 2)).toBeNull();
    expect(rightHalfOf(timeline(tracks), after, 9)).toBeNull();
  });
});
