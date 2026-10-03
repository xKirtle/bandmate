import { describe, expect, it } from 'vitest';
import type { Clip, Take } from './api';
import {
  clampMove,
  clampTrimEnd,
  clampTrimStart,
  minClipLength,
  draggedNudge,
  moveSelection,
  nudged,
} from './clipEdit';

// On a Track: a Clip at 0:10-0:20 and one at 0:40-0:50, with a 30s gap
// between them.
const left = { start: 10, offset: 0, length: 10 };
const right = { start: 40, offset: 0, length: 10 };
const neighbours = [left, right];

describe('clampMove', () => {
  it('goes where it is dragged when that is clear', () => {
    expect(clampMove(neighbours, 5, 25)).toBe(25);
    expect(clampMove(neighbours, 5, 60)).toBe(60);
  });

  it('stops at a neighbour it is dragged into', () => {
    expect(clampMove(neighbours, 5, 37)).toBe(35);
    expect(clampMove(neighbours, 5, 19)).toBe(20);
  });

  it('lands on the side of a neighbour nearest to where it is dropped', () => {
    expect(clampMove(neighbours, 5, 42)).toBe(35);
    expect(clampMove(neighbours, 5, 46)).toBe(50);
  });

  it('skips a gap too small for it', () => {
    // 30s long: too long for the gap, so it goes before or after both.
    expect(clampMove(neighbours, 30, 15)).toBe(50);
    expect(clampMove([right], 50, 10)).toBe(50);
  });

  it('never starts before 0:00', () => {
    expect(clampMove(neighbours, 5, -3)).toBe(0);
    expect(clampMove(neighbours, 8, 3)).toBe(2);
    // No room before the first neighbour at all.
    expect(clampMove(neighbours, 12, 1)).toBe(20);
  });

  it('goes anywhere on an empty Track', () => {
    expect(clampMove([], 5, 12.5)).toBe(12.5);
  });
});

describe('moveSelection', () => {
  /** A Timeline's Tracks, with ids 100, 101 and so on, holding Clips placed at these spans, as [id, start, end]. */
  const placed = (...lanes: [id: number, start: number, end: number][][]) =>
    lanes.map((clips, i) => ({
      id: 100 + i,
      clips: clips.map(([id, start, end]) => ({ id, start, length: end - start })),
    }));
  const selected = (...ids: number[]) => new Set(ids);
  /** Where each Clip moved lands, as "id:track@start". */
  const landed = (moves: { clipId: number; trackId: number; start: number }[]) =>
    moves.map((m) => `${m.clipId}:${m.trackId}@${m.start}`);

  // On one Track: two selected Clips, 1 at 0:10-0:20 and 2 at 0:25-0:30,
  // and 3, not selected, at 0:40-0:50. On another, 4 at 0:00-0:05.
  const oneTrack = placed(
    [
      [1, 10, 20],
      [2, 25, 30],
      [3, 40, 50],
    ],
    [[4, 0, 5]],
  );

  it('moves every selected Clip by the same amount', () => {
    expect(landed(moveSelection(oneTrack, selected(1, 2), 1, 100, 13))).toEqual(['1:100@13', '2:100@28']);
  });

  it('stops as one at a Clip outside the Selection', () => {
    // 2 would run into 3 past 10s later.
    expect(landed(moveSelection(oneTrack, selected(1, 2), 1, 100, 25))).toEqual(['1:100@20', '2:100@35']);
  });

  it('stops as one when its earliest Clip reaches 0:00', () => {
    expect(landed(moveSelection(oneTrack, selected(1, 2), 2, 100, 5))).toEqual(['1:100@0', '2:100@15']);
  });

  it('jumps an obstacle only to where every Clip fits on the far side', () => {
    // 1 on the first Track and 2 on the second, each 0:00-0:10; 3 and 4,
    // not selected, at 0:35-0:45 on the first and 0:20-0:30 on the second.
    const tracks = placed(
      [
        [1, 0, 10],
        [3, 35, 45],
      ],
      [
        [2, 0, 10],
        [4, 20, 30],
      ],
    );
    // 2 fits before 4 up to 10s later, or after it from 30s; 1 before 3 up
    // to 25s, or after it from 45s: together, up to 10s or from 45s.
    expect(landed(moveSelection(tracks, selected(1, 2), 1, 100, 22))).toEqual(['1:100@10', '2:101@10']);
    expect(landed(moveSelection(tracks, selected(1, 2), 1, 100, 35))).toEqual(['1:100@45', '2:101@45']);
  });

  it('never has selected Clips block each other', () => {
    const run = placed([
      [1, 0, 10],
      [2, 10, 20],
      [3, 20, 30],
    ]);
    expect(landed(moveSelection(run, selected(1, 2, 3), 2, 100, 15))).toEqual(['1:100@5', '2:100@15', '3:100@25']);
  });

  it('takes a Selection on one Track to the Track it is dragged over, clear of the Clips there', () => {
    expect(landed(moveSelection(oneTrack, selected(1, 2), 1, 101, 2))).toEqual(['1:101@5', '2:101@20']);
  });

  it('keeps each Clip of a Selection over several Tracks on its own Track, moving them only in time', () => {
    expect(landed(moveSelection(oneTrack, selected(2, 4), 2, 101, 30))).toEqual(['2:100@30', '4:101@5']);
  });
});

describe('clampTrimStart', () => {
  // 0:22-0:32 in the gap, playing 5s-15s of a 20s Beat.
  const clip = { start: 22, offset: 5, length: 10 };

  it('moves the start and the trim together, keeping the audio in place', () => {
    expect(clampTrimStart(clip, neighbours, 25)).toEqual({ start: 25, offset: 8, length: 7 });
    expect(clampTrimStart(clip, neighbours, 21)).toEqual({ start: 21, offset: 4, length: 11 });
  });

  it('stops at the start of the source', () => {
    expect(clampTrimStart(clip, [], 10)).toEqual({ start: 17, offset: 0, length: 15 });
  });

  it('stops at the neighbour before it', () => {
    expect(clampTrimStart({ ...clip, start: 25, offset: 10 }, neighbours, 12)).toEqual({
      start: 20,
      offset: 5,
      length: 15,
    });
  });

  it('stops at the neighbour before it even when rounding leaves them a hair apart', () => {
    const touching = { start: 20 - 1e-12, offset: 3, length: 10 };
    expect(clampTrimStart(touching, neighbours, 12).start).toBe(20);
  });

  it('never trims to before the source, whatever the rounding', () => {
    expect(clampTrimStart({ start: 10.1, offset: 0.3, length: 5 }, [], 0).offset).toBe(0);
    expect(clampTrimStart({ start: 7.7, offset: 1.1, length: 5 }, [], 0).offset).toBe(0);
  });

  it('never starts before 0:00', () => {
    expect(clampTrimStart({ start: 2, offset: 5, length: 10 }, [], -1)).toEqual({ start: 0, offset: 3, length: 12 });
  });

  it('keeps some of the Clip', () => {
    expect(clampTrimStart(clip, neighbours, 40)).toEqual({
      start: 32 - minClipLength,
      offset: 15 - minClipLength,
      length: minClipLength,
    });
  });
});

describe('clampTrimEnd', () => {
  const clip = { start: 22, offset: 5, length: 10 };

  it('changes how long it plays', () => {
    expect(clampTrimEnd(clip, neighbours, 20, 30)).toEqual({ start: 22, offset: 5, length: 8 });
    expect(clampTrimEnd(clip, neighbours, 20, 35)).toEqual({ start: 22, offset: 5, length: 13 });
  });

  it('stops at the end of the source', () => {
    expect(clampTrimEnd(clip, [], 20, 60)).toEqual({ start: 22, offset: 5, length: 15 });
  });

  it('stops at the neighbour after it', () => {
    expect(clampTrimEnd(clip, neighbours, 60, 45)).toEqual({ start: 22, offset: 5, length: 18 });
  });

  it('stops at the neighbour after it even when rounding leaves them a hair apart', () => {
    const touching = { start: 30, offset: 0, length: 10 - 1e-12 };
    expect(clampTrimEnd(touching, neighbours, 60, 45).length).toBe(10);
  });

  it('keeps some of the Clip', () => {
    expect(clampTrimEnd(clip, neighbours, 20, 10)).toEqual({ start: 22, offset: 5, length: minClipLength });
  });
});

describe('nudging', () => {
  const take = (id: number, more: Partial<Take> = {}): Take => ({
    id,
    number: id,
    size: 1,
    duration: 8,
    sampleRate: 48000,
    latencyOffset: 0,
    position: 0.5,
    nudge: 0,
    recordedAt: '',
    ...more,
  });
  const clip: Clip = {
    id: 1,
    beatId: null,
    soundId: null,
    name: null,
    gain: 0,
    takes: [take(3), take(4, { nudge: 0.02 })],
    activeTakeId: 4,
    start: 10,
    offset: 2,
    length: 5,
  };

  it('moves only the active Take, to be the nudge from where it was recorded', () => {
    const got = nudged(clip, -0.03);
    expect(got.takes[0]).toEqual(take(3));
    expect(got.takes[1]).toEqual(take(4, { position: got.takes[1].position, nudge: -0.03 }));
    expect(got.takes[1].position).toBeCloseTo(0.45);
    expect({ start: got.start, offset: got.offset, length: got.length }).toEqual({ start: 10, offset: 2, length: 5 });
  });

  it('nudges by how far the Clip is dragged, in whole milliseconds', () => {
    expect(draggedNudge(clip, 0.1234)).toBe(0.143);
    expect(draggedNudge(clip, -0.02)).toBe(0);
  });
});
