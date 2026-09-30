import { describe, expect, it } from 'vitest';
import { clampMove } from './clipEdit';
import { clipTargets, guideLanes, reachAt, snap, snapMove, snapPixels } from './snapping';

describe('snap', () => {
  it('snaps an edge within reach onto a target', () => {
    // A Clip at 0:09.75-0:14.75, a target at 0:10, reach 0.5s.
    expect(snap([{ at: 10, of: 'a' }], [9.75, 14.75], 0.5)).toEqual({ edge: 0, by: 0.25, at: 10, to: ['a'] });
  });

  it('snaps by whichever edge is nearer a target', () => {
    // 0:10-0:15, targets at 0:09.5 and 0:15.25: the end is nearer.
    const targets = [
      { at: 9.5, of: 'before' },
      { at: 15.25, of: 'after' },
    ];
    expect(snap(targets, [10, 15], 1)).toEqual({ edge: 1, by: 0.25, at: 15.25, to: ['after'] });
    // Moved along a little, the start is nearer.
    expect(snap(targets, [9.75, 14.75], 1)).toEqual({ edge: 0, by: -0.25, at: 9.5, to: ['before'] });
  });

  it('snaps nowhere with no target in reach', () => {
    expect(snap([{ at: 10, of: 'a' }], [11, 16], 0.5)).toBeNull();
    expect(snap([], [11, 16], 0.5)).toBeNull();
  });

  it('snaps to a target exactly at the reach', () => {
    expect(snap([{ at: 10, of: 'a' }], [10.5, 15.5], 0.5)).toEqual({ edge: 0, by: -0.5, at: 10, to: ['a'] });
  });

  it('snaps to the closest of several targets in reach', () => {
    const targets = [
      { at: 9.5, of: 'far' },
      { at: 10.25, of: 'near' },
      { at: 10.75, of: 'farther' },
    ];
    expect(snap(targets, [10, 20], 1)).toEqual({ edge: 0, by: 0.25, at: 10.25, to: ['near'] });
  });

  it('gives back everything at the time it snaps to', () => {
    const targets = [
      { at: 10, of: 1 },
      { at: 12, of: 2 },
      { at: 10, of: 3 },
    ];
    expect(snap(targets, [10.25], 1)).toEqual({ edge: 0, by: -0.25, at: 10, to: [1, 3] });
  });
});

describe('reachAt', () => {
  it('is the same few pixels at any zoom', () => {
    expect(snapPixels).toBe(8);
    expect(reachAt(8)).toBe(1);
    expect(reachAt(80)).toBe(0.1);
  });
});

describe('snapMove', () => {
  // On the Track moved onto: a Clip at 0:20-0:30. Elsewhere: one starting at 0:40.
  const others = [{ start: 20, offset: 0, length: 10 }];
  const clamp = (start: number) => clampMove(others, 5, start);
  const targets = [
    { at: 20, of: 0 },
    { at: 30, of: 0 },
    { at: 40, of: 1 },
  ];

  it('moves the Clip onto a target in reach', () => {
    expect(snapMove(targets, 5, 39.75, 0.5, clamp)).toEqual({
      start: 40,
      snap: { edge: 0, by: 0.25, at: 40, to: [1] },
    });
    // Its end meeting the neighbour's start.
    expect(snapMove(targets, 5, 14.75, 0.5, clamp)).toEqual({
      start: 15,
      snap: { edge: 1, by: 0.25, at: 20, to: [0] },
    });
  });

  it('puts its snapped edge exactly on the target', () => {
    // Worked out as 7.31 + (8.52 - 8.48), the start would be a hair off 7.35.
    expect(snapMove([{ at: 8.52, of: 0 }], 1.17, 7.31, 0.5, (s) => s).start).toBe(7.35);
  });

  it('moves the Clip freely with no target in reach', () => {
    expect(snapMove(targets, 5, 50, 0.5, clamp)).toEqual({ start: 50, snap: null });
  });

  it('is not snapped when its limits keep it off the target', () => {
    // Snapped on to 0:20, it would overlap the neighbour, which stops it at 0:15.
    expect(snapMove(targets, 5, 19.75, 0.5, clamp)).toEqual({ start: 15, snap: null });
    // Its end snapped to a Clip ending at 0:04.5, it would start before 0:00.
    const early = [{ at: 4.5, of: 1 }];
    expect(snapMove(early, 5, 0.25, 1, clamp)).toEqual({ start: 0.25, snap: null });
  });
});

describe('guideLanes', () => {
  it('runs from the dragged lane to the furthest aligned lane, either way', () => {
    expect(guideLanes(1, [3])).toEqual({ from: 1, to: 3 });
    expect(guideLanes(3, [0, 2])).toEqual({ from: 0, to: 3 });
    expect(guideLanes(2, [0, 4])).toEqual({ from: 0, to: 4 });
    expect(guideLanes(2, [2])).toEqual({ from: 2, to: 2 });
  });
});

describe('clipTargets', () => {
  it("is every other Clip's start and end, with its lane", () => {
    const tracks = [
      {
        clips: [
          { id: 1, start: 0, length: 5 },
          { id: 2, start: 10, length: 2 },
        ],
      },
      { clips: [] },
      { clips: [{ id: 3, start: 4, length: 1 }] },
    ];
    expect(clipTargets(tracks, 2)).toEqual([
      { at: 0, of: 0 },
      { at: 5, of: 0 },
      { at: 4, of: 2 },
      { at: 5, of: 2 },
    ]);
  });
});
