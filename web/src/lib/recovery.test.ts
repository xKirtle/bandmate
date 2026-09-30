import { describe, expect, it } from 'vitest';
import { recoveredPlacement, type Unsaved } from './recovery';

// A Track with Clips at 0:00 to 0:10 and 0:20 to 0:30, the second of Takes,
// its Take recorded to start at 0:18 and nudged 0.5 s later since.
const beat = { id: 1, start: 0, offset: 0, length: 10, activeTakeId: null, takes: [] };
const take = { id: 7, position: 1.5, nudge: 0.5 };
const takes = { id: 2, start: 20, offset: 3, length: 10, activeTakeId: 7, takes: [take] };
const tracks = [
  { id: 10, clips: [beat, takes] },
  { id: 11, clips: [] },
];

// A new Take recorded where the first Track's last Clip ends, 0:30, from 0:28,
// 5 s long with a 0.1 s offset, so it ends at 0:32.9.
const recorded: Unsaved = {
  trackId: 10,
  clipId: null,
  takes: [],
  plan: { start: 30, from: 28 },
  latencyOffset: 0.1,
};
const duration = 5;

describe('recoveredPlacement', () => {
  it('places a new Take where it would have gone, while that spot is free', () => {
    expect(recoveredPlacement(tracks, recorded, duration, null)).toEqual({
      target: { trackId: 10, start: 30 },
      captureStart: 28,
    });
  });

  it("places it in a spot that's free even if a Clip was added after it since", () => {
    const later = [{ id: 10, clips: [beat, takes, { ...beat, id: 3, start: 40, length: 5 }] }];
    expect(recoveredPlacement(later, recorded, duration, null)).toMatchObject({ target: { trackId: 10, start: 30 } });
  });

  it("appends it to its Track once a Clip took its spot, keeping what's captured in step", () => {
    const taken = [{ id: 10, clips: [beat, { ...takes, length: 12 }] }];
    expect(recoveredPlacement(taken, recorded, duration, null)).toEqual({
      target: { trackId: 10, start: 32 },
      captureStart: 30,
    });
  });

  it('asks for a new Track once its own is gone, rather than using another', () => {
    const gone = [{ id: 11, clips: [] }];
    expect(recoveredPlacement(gone, recorded, duration, null)).toEqual({ target: null, captureStart: 28 });
    expect(recoveredPlacement([], recorded, duration, null)).toEqual({ target: null, captureStart: 28 });
  });

  it('puts it where it was recorded on the Track added for it once its own is gone', () => {
    const added = [
      { id: 11, clips: [{ ...beat, id: 4, start: 5 }] },
      { id: 12, clips: [] },
    ];
    expect(recoveredPlacement(added, recorded, duration, 12)).toEqual({
      target: { trackId: 12, start: 30 },
      captureStart: 28,
    });
  });

  // A Retake into the Clip of Takes at 0:20, whose Take started at 0:18.
  const retaken: Unsaved = {
    trackId: 10,
    clipId: 2,
    takes: [{ id: 7, at: 18 }],
    plan: { start: 20, from: 18 },
    latencyOffset: 0.1,
  };

  it('retakes into its Clip while the Clip is there', () => {
    expect(recoveredPlacement(tracks, retaken, duration, null)).toEqual({ target: { clipId: 2 }, captureStart: 18 });
  });

  it('keeps a Retake in step with its Clip once the Clip moved, even onto another Track', () => {
    const moved = [
      { id: 10, clips: [beat] },
      { id: 11, clips: [{ ...takes, start: 50 }] },
    ];
    expect(recoveredPlacement(moved, retaken, duration, null)).toEqual({ target: { clipId: 2 }, captureStart: 48 });
  });

  it("keeps a Retake in step with its Clip's Takes once another took the span back earlier", () => {
    // A later Retake started 1 s before the span: its Takes moved within it, not on the Timeline.
    const earlier = [{ id: 10, clips: [beat, { ...takes, offset: 4, takes: [{ ...take, position: 2.5 }] }] }];
    expect(recoveredPlacement(earlier, retaken, duration, null)).toEqual({ target: { clipId: 2 }, captureStart: 18 });
  });

  it('keeps a Retake in step with where its Clip starts once its Takes are gone', () => {
    const replaced = [
      { id: 10, clips: [beat, { ...takes, start: 22, activeTakeId: 8, takes: [{ id: 8, position: 0, nudge: 0 }] }] },
    ];
    expect(recoveredPlacement(replaced, retaken, duration, null)).toEqual({ target: { clipId: 2 }, captureStart: 20 });
  });

  it("puts a Retake where it was recorded on its Track once its Clip is gone, if that's past the last Clip", () => {
    const gone = [{ id: 10, clips: [beat] }];
    expect(recoveredPlacement(gone, retaken, duration, null)).toEqual({
      target: { trackId: 10, start: 20 },
      captureStart: 18,
    });
  });

  it("appends a Retake to its Track once its Clip is gone, if a Clip's past where it was recorded", () => {
    const gone = [{ id: 10, clips: [{ ...beat, length: 25 }] }];
    expect(recoveredPlacement(gone, retaken, duration, null)).toEqual({
      target: { trackId: 10, start: 25 },
      captureStart: 23,
    });
  });

  it('puts a Retake where it was recorded on the Track added for it once its Clip and its Track are gone', () => {
    expect(recoveredPlacement([{ id: 12, clips: [] }], retaken, duration, 12)).toEqual({
      target: { trackId: 12, start: 20 },
      captureStart: 18,
    });
  });

  it('keeps nothing that stopped during the lead-in', () => {
    expect(recoveredPlacement(tracks, recorded, 2.05, null)).toBeNull();
    expect(recoveredPlacement(tracks, recorded, 2.2, null)).not.toBeNull();
  });
});
