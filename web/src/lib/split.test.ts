import { describe, expect, it } from 'vitest';
import type { Clip, Track } from './api';
import { splitTargets } from './split';

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
