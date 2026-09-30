import { describe, expect, it } from 'vitest';
import { clampMove, clampTrimEnd, clampTrimStart } from './clipEdit';
import { clipTargets, guideLanes, reachAt, snap, snapEdge, snapMove } from './snapping';

describe('snap', () => {
  it('snaps an edge within reach onto a target', () => {
    // A Clip at 0:09.75-0:14.75, a target at 0:10, reach 0.5s.
    expect(snap([{ at: 10, of: 'a' }], [9.75, 14.75], 0.5)).toEqual({ edge: 0, by: 0.25, at: 10, aligned: ['a'] });
  });

  it('snaps by whichever edge is nearer a target', () => {
    // 0:10-0:15, targets at 0:09.5 and 0:15.25: the end is nearer.
    const targets = [
      { at: 9.5, of: 'before' },
      { at: 15.25, of: 'after' },
    ];
    expect(snap(targets, [10, 15], 1)).toEqual({ edge: 1, by: 0.25, at: 15.25, aligned: ['after'] });
    // Moved along a little, the start is nearer.
    expect(snap(targets, [9.75, 14.75], 1)).toEqual({ edge: 0, by: -0.25, at: 9.5, aligned: ['before'] });
  });

  it('snaps nowhere with no target in reach', () => {
    expect(snap([{ at: 10, of: 'a' }], [11, 16], 0.5)).toBeNull();
    expect(snap([], [11, 16], 0.5)).toBeNull();
  });

  it('snaps to a target exactly at the reach', () => {
    expect(snap([{ at: 10, of: 'a' }], [10.5, 15.5], 0.5)).toEqual({ edge: 0, by: -0.5, at: 10, aligned: ['a'] });
  });

  it('snaps to the closest of several targets in reach', () => {
    const targets = [
      { at: 9.5, of: 'far' },
      { at: 10.25, of: 'near' },
      { at: 10.75, of: 'farther' },
    ];
    expect(snap(targets, [10, 20], 1)).toEqual({ edge: 0, by: 0.25, at: 10.25, aligned: ['near'] });
  });

  it('gives back everything at the time it snaps to', () => {
    const targets = [
      { at: 10, of: 1 },
      { at: 12, of: 2 },
      { at: 10, of: 3 },
    ];
    expect(snap(targets, [10.25], 1)).toEqual({ edge: 0, by: -0.25, at: 10, aligned: [1, 3] });
  });

  it('counts a target a rounding hair off as at the same time', () => {
    // A Clip at 1.1 lasting 2.2 ends a hair past another's start at 3.3.
    const targets = [
      { at: 3.3, of: 1 },
      { at: 1.1 + 2.2, of: 2 },
    ];
    expect(snap(targets, [3.4], 1)?.aligned).toEqual([1, 2]);
  });
});

describe('reachAt', () => {
  it('is the same few pixels at any zoom', () => {
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
      snap: { edge: 0, by: 0.25, at: 40, aligned: [1] },
    });
    // Its end meeting the neighbour's start.
    expect(snapMove(targets, 5, 14.75, 0.5, clamp)).toEqual({
      start: 15,
      snap: { edge: 1, by: 0.25, at: 20, aligned: [0] },
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

describe('snapEdge', () => {
  // A Clip at 0:10-0:15 trimmed; targets at 0:08, 0:16 and 0:17.
  const clip = { start: 10, offset: 2, length: 5 };
  const endOf = (at: number) => {
    const c = clampTrimEnd(clip, [], 20, at);
    return c.start + c.length;
  };
  const targets = [
    { at: 8, of: 0 },
    { at: 16, of: 1 },
    { at: 17, of: 2 },
  ];

  it('snaps the edge dragged onto a target in reach', () => {
    expect(snapEdge(targets, 16.25, 0.5, endOf)).toEqual({
      at: 16,
      snap: { edge: 0, by: -0.25, at: 16, aligned: [1] },
    });
  });

  it("snaps by the edge dragged alone, however near the Clip's other edge is to a target", () => {
    // The Clip's start at 0:10 is 0.125 from 0:10.125, the end dragged 0.375 from 0:16.
    const near = [{ at: 10.125, of: 3 }, ...targets];
    expect(snapEdge(near, 16.375, 0.5, endOf)).toEqual({ at: 16, snap: { edge: 0, by: -0.375, at: 16, aligned: [1] } });
  });

  it('trims freely with no target in reach', () => {
    expect(snapEdge(targets, 19, 0.5, endOf)).toEqual({ at: 19, snap: null });
  });

  it('snaps onto a neighbour the trim stops at', () => {
    // Another Clip on the Track ends at 0:09, and the start is trimmed to 0:09.125.
    const before = [{ start: 5, offset: 0, length: 4 }];
    const startOf = (at: number) => clampTrimStart(clip, before, at).start;
    expect(snapEdge([{ at: 9, of: 0 }], 9.125, 0.5, startOf)).toEqual({
      at: 9,
      snap: { edge: 0, by: -0.125, at: 9, aligned: [0] },
    });
  });

  it('is not snapped when its limits keep it off the target', () => {
    // A neighbour ending at 0:09 stops the start there, short of 0:08.875.
    const before = [{ start: 5, offset: 0, length: 4 }];
    const startOf = (at: number) => clampTrimStart(clip, before, at).start;
    expect(snapEdge([{ at: 8.875, of: 1 }], 9.125, 0.5, startOf)).toEqual({ at: 9.125, snap: null });
    // The source's start, 2s before the Clip's, stops it at 0:08, short of 0:07.75.
    const alone = (at: number) => clampTrimStart(clip, [], at).start;
    expect(snapEdge([{ at: 7.75, of: 1 }], 8.125, 0.5, alone)).toEqual({ at: 8.125, snap: null });
    // The source's end stops the end at 0:28, short of 0:28.25.
    expect(snapEdge([{ at: 28.25, of: 1 }], 27.875, 0.5, endOf)).toEqual({ at: 27.875, snap: null });
    // 0:00 stops a start trimmed out of a Clip at 0:01 with 3s before it in its source.
    const early = { start: 1, offset: 3, length: 2 };
    const fromZero = (at: number) => clampTrimStart(early, [], at).start;
    expect(snapEdge([{ at: -0.25, of: 1 }], 0.125, 0.5, fromZero)).toEqual({ at: 0.125, snap: null });
  });

  it('snaps a trimmed end onto a target however its times round', () => {
    // A Clip at 0:02.3 ending at 0:12.1 comes out a hair off, as 2.3 + (12.1 - 2.3).
    const odd = { start: 2.3, offset: 0, length: 9 };
    const oddEnd = (at: number) => {
      const c = clampTrimEnd(odd, [], 20, at);
      return c.start + c.length;
    };
    expect(snapEdge([{ at: 12.1, of: 1 }], 12, 0.5, oddEnd).snap?.at).toBe(12.1);
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
