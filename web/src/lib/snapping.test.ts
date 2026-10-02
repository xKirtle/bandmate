import { describe, expect, it } from 'vitest';
import { clampMove, clampTrimEnd, clampTrimStart, moveSelection } from './clipEdit';
import type { Placed } from './schedule';
import {
  clipTargets,
  guideLanes,
  loopMark,
  loopTargets,
  reachAt,
  snap,
  snapEdge,
  snapLoop,
  snapMove,
  snapSelection,
  type Aligned,
  type Target,
  editTargets,
} from './snapping';

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

describe('snapSelection', () => {
  // Selected: 1 at 0:10-0:15 and 2 at 0:20-0:22. Targets: a Clip's end at
  // 0:09 on lane 1, and the playhead at 0:23.
  const clips = [
    { id: 1, start: 10, length: 5 },
    { id: 2, start: 20, length: 2 },
  ];
  const targets: Target<Aligned>[] = [
    { at: 9, of: 1 },
    { at: 23, of: 'playhead' },
  ];
  const free = (by: number) => by;

  it("moves the Selection by whichever selected Clip's edge is nearest a target in reach", () => {
    // Moved on 0.875s, 2 ends 0.125s short of the playhead.
    expect(snapSelection(targets, clips, 0.875, 0.5, free)).toEqual({
      by: 1,
      snap: { clipId: 2, edge: 1, by: 0.125, at: 23, aligned: ['playhead'] },
    });
    // Moved back 1.25s, 1 starts 0.25s before the Clip's end at 0:09.
    expect(snapSelection(targets, clips, -1.25, 0.5, free)).toEqual({
      by: -1,
      snap: { clipId: 1, edge: 0, by: 0.25, at: 9, aligned: [1] },
    });
  });

  it('moves the Selection freely with no target in reach', () => {
    expect(snapSelection(targets, clips, 4, 0.5, free)).toEqual({ by: 4, snap: null });
  });

  it('skips Snapping with Shift held, still kept within its limits', () => {
    expect(snapSelection(targets, clips, 0.875, 0.5, free, true)).toEqual({ by: 0.875, snap: null });
    const stop = (by: number) => Math.min(by, 0.5);
    expect(snapSelection(targets, clips, 0.875, 0.5, stop, true)).toEqual({ by: 0.5, snap: null });
  });

  describe('among other Clips', () => {
    // On the first Track: 1 at 0:10-0:15 and 2 at 0:20-0:22, both selected,
    // and 3 at 0:30-0:40. On the second, 4 at 0:24-0:27. The playhead at 0:50.
    const tracks = [
      {
        id: 100,
        clips: [
          { id: 1, start: 10, length: 5 },
          { id: 2, start: 20, length: 2 },
          { id: 3, start: 30, length: 10 },
        ],
      },
      { id: 101, clips: [{ id: 4, start: 24, length: 3 }] },
    ];
    const selected = new Set([1, 2]);
    const all = editTargets(tracks, selected, 50, null);
    // How far moveSelection lets the Selection move, dragged by Clip 1.
    const clamp = (by: number) => moveSelection(tracks, selected, 1, 100, 10 + by)[0].start - 10;
    const moved = (by: number) => snapSelection(all, clips, by, 0.5, clamp);

    it("never snaps to the Selection's own Clips", () => {
      // Each selected Clip is 0.125s from where it was.
      expect(moved(0.125)).toEqual({ by: 0.125, snap: null });
    });

    it('snaps an edge of any selected Clip to a Clip outside the Selection, on any Track', () => {
      // 2 starts 0.125s before 4 on the second Track.
      expect(moved(3.875)).toEqual({ by: 4, snap: { clipId: 2, edge: 0, by: 0.125, at: 24, aligned: [1] } });
      // 2 ends 0.125s before 3, where the clamp stops it.
      expect(moved(7.875)).toEqual({ by: 8, snap: { clipId: 2, edge: 1, by: 0.125, at: 30, aligned: [0] } });
    });

    it('is not snapped when the clamp keeps the Selection off the target', () => {
      // Snapped, 2 would start on 3's start, overlapping it; the clamp stops it at 0:28.
      expect(moved(9.875)).toEqual({ by: 8, snap: null });
    });
  });
});

describe('snapEdge', () => {
  // A Clip at 0:10-0:15, 2s into a source 20s long, trimmed; targets at 0:08, 0:16 and 0:17.
  const clip = { start: 10, offset: 2, length: 5 };
  const targets = [
    { at: 8, of: 0 },
    { at: 16, of: 1 },
    { at: 17, of: 2 },
  ];
  // Where the edge dragged ends up, trimmed to at among the neighbours given.
  const startOf =
    (trimmed: Placed, others: Placed[] = []) =>
    (at: number) =>
      clampTrimStart(trimmed, others, at).start;
  const endOf =
    (trimmed: Placed, others: Placed[] = []) =>
    (at: number) => {
      const c = clampTrimEnd(trimmed, others, 20, at);
      return c.start + c.length;
    };
  // Another Clip on the Track, ending at 0:09.
  const before = [{ start: 5, offset: 0, length: 4 }];

  it('snaps the edge dragged onto a target in reach', () => {
    expect(snapEdge(targets, 16.25, 0.5, endOf(clip))).toEqual({
      at: 16,
      snap: { edge: 0, by: -0.25, at: 16, aligned: [1] },
    });
  });

  it("snaps by the edge dragged alone, however near the Clip's other edge is to a target", () => {
    // The Clip's start at 0:10 is 0.125 from 0:10.125, the end dragged 0.375 from 0:16.
    const near = [{ at: 10.125, of: 3 }, ...targets];
    expect(snapEdge(near, 16.375, 0.5, endOf(clip))).toEqual({
      at: 16,
      snap: { edge: 0, by: -0.375, at: 16, aligned: [1] },
    });
  });

  it('trims freely with no target in reach', () => {
    expect(snapEdge(targets, 19, 0.5, endOf(clip))).toEqual({ at: 19, snap: null });
  });

  it('snaps onto a neighbour the trim stops at', () => {
    expect(snapEdge([{ at: 9, of: 0 }], 9.125, 0.5, startOf(clip, before))).toEqual({
      at: 9,
      snap: { edge: 0, by: -0.125, at: 9, aligned: [0] },
    });
  });

  it('is not snapped past a neighbour', () => {
    // The neighbour stops the start at 0:09, short of 0:08.875.
    expect(snapEdge([{ at: 8.875, of: 1 }], 9.125, 0.5, startOf(clip, before))).toEqual({ at: 9.125, snap: null });
  });

  it("is not snapped past its source's start", () => {
    // 2s into its source, the start stops at 0:08, short of 0:07.75.
    expect(snapEdge([{ at: 7.75, of: 1 }], 8.125, 0.5, startOf(clip))).toEqual({ at: 8.125, snap: null });
  });

  it("is not snapped past its source's end", () => {
    // 2s into a source 20s long, the end stops at 0:28, short of 0:28.25.
    expect(snapEdge([{ at: 28.25, of: 1 }], 27.875, 0.5, endOf(clip))).toEqual({ at: 27.875, snap: null });
  });

  it('is not snapped before 0:00', () => {
    // A Clip at 0:01 with 3s before it in its source stops at 0:00.
    const early = { start: 1, offset: 3, length: 2 };
    expect(snapEdge([{ at: -0.25, of: 1 }], 0.125, 0.5, startOf(early))).toEqual({ at: 0.125, snap: null });
  });

  it('is not snapped shorter than the shortest Clip', () => {
    // The end stops at 0:10.25, short of 0:10.125.
    expect(snapEdge([{ at: 10.125, of: 1 }], 10.375, 0.5, endOf(clip))).toEqual({ at: 10.375, snap: null });
  });

  it('snaps a trimmed end onto a target however its times round', () => {
    // A Clip at 0:02.3 ending at 0:12.1 comes out a hair off, as 2.3 + (12.1 - 2.3).
    const odd = { start: 2.3, offset: 0, length: 9 };
    expect(snapEdge([{ at: 12.1, of: 1 }], 12, 0.5, endOf(odd)).snap?.at).toBe(12.1);
  });
});

describe('guideLanes', () => {
  it('runs from the dragged lane to the furthest aligned lane, either way', () => {
    expect(guideLanes(1, [3])).toEqual({ from: 1, to: 3 });
    expect(guideLanes(3, [0, 2])).toEqual({ from: 0, to: 3 });
    expect(guideLanes(2, [0, 4])).toEqual({ from: 0, to: 4 });
    expect(guideLanes(2, [2])).toEqual({ from: 2, to: 2 });
  });

  it("runs up to the ruler for the Loop's edges, through any lanes aligned too", () => {
    expect(guideLanes(2, ['loop'])).toEqual({ from: 'ruler', to: 2 });
    expect(guideLanes(1, ['loop', 3])).toEqual({ from: 'ruler', to: 3 });
  });

  it('is no guide for the playhead alone, which already is a line', () => {
    expect(guideLanes(2, ['playhead'])).toBeNull();
  });

  it('leaves the playhead out of a guide through anything else aligned', () => {
    expect(guideLanes(0, ['playhead', 2])).toEqual({ from: 0, to: 2 });
    expect(guideLanes(1, [3, 'playhead', 'loop'])).toEqual({ from: 'ruler', to: 3 });
  });

  it('runs from the ruler to the furthest aligned lane for the Loop being dragged', () => {
    expect(guideLanes('ruler', [2])).toEqual({ from: 'ruler', to: 2 });
    expect(guideLanes('ruler', [3, 1, 'playhead'])).toEqual({ from: 'ruler', to: 3 });
    expect(guideLanes('ruler', ['playhead'])).toBeNull();
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
    expect(clipTargets(tracks, new Set([2]))).toEqual([
      { at: 0, of: 0 },
      { at: 5, of: 0 },
      { at: 4, of: 2 },
      { at: 5, of: 2 },
    ]);
  });
});

describe('editTargets', () => {
  const tracks = [{ clips: [{ id: 1, start: 0, length: 5 }] }, { clips: [{ id: 2, start: 10, length: 2 }] }];

  it("is other Clips' edges, the playhead and the Loop's start and end", () => {
    expect(editTargets(tracks, new Set([2]), 7, { start: 3, end: 9 })).toEqual([
      { at: 0, of: 0 },
      { at: 5, of: 0 },
      { at: 7, of: 'playhead' },
      { at: 3, of: 'loop' },
      { at: 9, of: 'loop' },
    ]);
  });

  it("is only other Clips' edges and the playhead with no Loop", () => {
    expect(editTargets(tracks, new Set([2]), 7, null)).toEqual([
      { at: 0, of: 0 },
      { at: 5, of: 0 },
      { at: 7, of: 'playhead' },
    ]);
  });
});

describe('snapping to the playhead and the Loop', () => {
  // A Clip on its own, the playhead at 0:07 and a Loop from 0:03 to 0:09.
  const all = editTargets([{ clips: [{ id: 1, start: 20, length: 2 }] }], new Set([1]), 7, { start: 3, end: 9 });
  const free = (at: number) => at;

  it('moves a Clip onto the playhead or a Loop edge', () => {
    expect(snapMove(all, 2, 7.25, 0.5, free)).toEqual({
      start: 7,
      snap: { edge: 0, by: -0.25, at: 7, aligned: ['playhead'] },
    });
    // Its end meeting the Loop's start.
    expect(snapMove(all, 2, 0.875, 0.5, free)).toEqual({
      start: 1,
      snap: { edge: 1, by: 0.125, at: 3, aligned: ['loop'] },
    });
  });

  it("trims a Clip's edge onto the playhead or a Loop edge", () => {
    expect(snapEdge(all, 6.875, 0.5, free)).toEqual({
      at: 7,
      snap: { edge: 0, by: 0.125, at: 7, aligned: ['playhead'] },
    });
    expect(snapEdge(all, 8.75, 0.5, free)).toEqual({
      at: 9,
      snap: { edge: 0, by: 0.25, at: 9, aligned: ['loop'] },
    });
  });
});

describe('snapLoop', () => {
  // A Clip at 0:10-0:12 on the second lane, the playhead at 0:07, reach 0.5s,
  // and a shortest Loop of 0.25s.
  const targets = loopTargets([{ clips: [] }, { clips: [{ id: 1, start: 10, length: 2 }] }], 7);

  it("snaps the Loop's start, dragged, onto a Clip edge or the playhead", () => {
    // The Loop's end at 0:20.
    expect(snapLoop(targets, 'start', 20, 9.75, 0.5, 0.25)).toEqual({
      start: 10,
      end: 20,
      snap: { edge: 0, by: 0.25, at: 10, aligned: [1] },
    });
    expect(snapLoop(targets, 'start', 20, 7.25, 0.5, 0.25)).toEqual({
      start: 7,
      end: 20,
      snap: { edge: 0, by: -0.25, at: 7, aligned: ['playhead'] },
    });
  });

  it("snaps the Loop's end, dragged, onto a Clip edge", () => {
    // The Loop's start at 0:05.
    expect(snapLoop(targets, 'end', 5, 12.25, 0.5, 0.25)).toEqual({
      start: 5,
      end: 12,
      snap: { edge: 0, by: -0.25, at: 12, aligned: [1] },
    });
  });

  it('drags an edge freely with nothing in reach, down to 0:00 and the shortest Loop', () => {
    expect(snapLoop(targets, 'start', 20, 15, 0.5, 0.25)).toEqual({ start: 15, end: 20, snap: null });
    expect(snapLoop(targets, 'start', 3, -1, 0.5, 0.25)).toEqual({ start: 0, end: 3, snap: null });
    expect(snapLoop(targets, 'start', 3, 2.9, 0.5, 0.25)).toEqual({ start: 2.75, end: 3, snap: null });
    expect(snapLoop(targets, 'end', 3, 3.1, 0.5, 0.25)).toEqual({ start: 3, end: 3.25, snap: null });
  });

  it('keeps the shortest Loop over a snap that would make it shorter', () => {
    // The end at 0:10.125: the start snapping to the Clip's start at 0:10
    // would leave 0.125s, so it stops at the shortest Loop, unsnapped.
    expect(snapLoop(targets, 'start', 10.125, 9.75, 0.5, 0.25)).toEqual({ start: 9.75, end: 10.125, snap: null });
    // The start at 0:11.875, the end snapping to the Clip's end at 0:12.
    expect(snapLoop(targets, 'end', 11.875, 12.25, 0.5, 0.25)).toEqual({ start: 11.875, end: 12.25, snap: null });
    // Exactly the shortest Loop still snaps.
    expect(snapLoop(targets, 'end', 11.75, 11.875, 0.5, 0.25).snap?.at).toBe(12);
  });

  it('snaps where a new Loop is dragged to, either side of where it was marked from', () => {
    // Marked from 0:03, dragged on to near the Clip's start.
    expect(snapLoop(targets, 'new', 3, 10.25, 0.5, 0.25)).toEqual({
      start: 3,
      end: 10,
      snap: { edge: 0, by: -0.25, at: 10, aligned: [1] },
    });
    // Marked from 0:15, dragged back to near the Clip's end.
    expect(snapLoop(targets, 'new', 15, 11.75, 0.5, 0.25)).toEqual({
      start: 12,
      end: 15,
      snap: { edge: 0, by: 0.25, at: 12, aligned: [1] },
    });
  });

  it('marks a new Loop freely with nothing in reach, however short, as a stray click sets none', () => {
    expect(snapLoop(targets, 'new', 3, 5, 0.5, 0.25)).toEqual({ start: 3, end: 5, snap: null });
    expect(snapLoop(targets, 'new', 3, 2, 0.5, 0.25)).toEqual({ start: 2, end: 3, snap: null });
    expect(snapLoop(targets, 'new', 3, 3.1, 0.5, 0.25)).toEqual({ start: 3, end: 3.1, snap: null });
  });

  it("doesn't snap a new Loop to shorter than the shortest", () => {
    // Marked from the Clip's start, dragged back towards the playhead with
    // the Clip's start in reach: snapping there would make it nothing.
    expect(snapLoop(targets, 'new', 10, 9.875, 0.5, 0.25)).toEqual({ start: 9.875, end: 10, snap: null });
    // Marked from 0:11.875, the Clip's end 0.125s on.
    expect(snapLoop(targets, 'new', 11.875, 12.25, 0.5, 0.25)).toEqual({ start: 11.875, end: 12.25, snap: null });
    // Marked from 0:11.75, the Clip's end is just the shortest Loop on.
    expect(snapLoop(targets, 'new', 11.75, 12.25, 0.5, 0.25).snap?.at).toBe(12);
  });

  it('never snaps a new Loop to the other side of where it was marked from', () => {
    // Marked from 0:10.375, dragged on to 0:10.625, reach 1s: the Clip's
    // start at 0:10 is in reach, but behind it, so it stays where it's dragged.
    expect(snapLoop(targets, 'new', 10.375, 10.625, 1, 0.25)).toEqual({ start: 10.375, end: 10.625, snap: null });
  });
});

describe('loopMark', () => {
  it('snaps where a new Loop is pressed onto a target in reach', () => {
    const targets = loopTargets([{ clips: [{ id: 1, start: 10, length: 2 }] }], 7);
    expect(loopMark(targets, 9.75, 0.5)).toBe(10);
    expect(loopMark(targets, 7.25, 0.5)).toBe(7);
    expect(loopMark(targets, 4, 0.5)).toBe(4);
  });
});

describe('loopTargets', () => {
  it("is every Clip's start and end, on every Track, and the playhead", () => {
    const tracks = [{ clips: [{ id: 1, start: 0, length: 5 }] }, { clips: [{ id: 2, start: 10, length: 2 }] }];
    expect(loopTargets(tracks, 7)).toEqual([
      { at: 0, of: 0 },
      { at: 5, of: 0 },
      { at: 10, of: 1 },
      { at: 12, of: 1 },
      { at: 7, of: 'playhead' },
    ]);
  });
});
