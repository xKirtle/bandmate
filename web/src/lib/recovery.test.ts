import { describe, expect, it } from 'vitest';
import { recoveredPlacement, samplesFrom, type Unsaved } from './recovery';

// A Track with Clips at 0:00 to 0:10 and 0:20 to 0:30, the second of Takes.
const beat = { id: 1, start: 0, offset: 0, length: 10, activeTakeId: null };
const takes = { id: 2, start: 20, offset: 3, length: 10, activeTakeId: 7 };
const tracks = [
  { id: 10, clips: [beat, takes] },
  { id: 11, clips: [] },
];

// A new Take recorded at the first Track's append point, 0:30, from 0:28,
// 5 s long with a 0.1 s offset, so it ends at 0:32.9.
const recorded: Unsaved = {
  trackId: 10,
  clipId: null,
  origin: 0,
  plan: { start: 30, from: 28 },
  latencyOffset: 0.1,
};
const duration = 5;

describe('recoveredPlacement', () => {
  it('places a new Take where it would have gone, while that spot is free', () => {
    expect(recoveredPlacement(tracks, recorded, duration, 11)).toEqual({
      kind: 'record',
      trackId: 10,
      start: 30,
      captureStart: 28,
    });
  });

  it("places it in a spot that's free even if a Clip was added after it since", () => {
    const later = [{ id: 10, clips: [beat, takes, { id: 3, start: 40, offset: 0, length: 5, activeTakeId: null }] }];
    expect(recoveredPlacement(later, recorded, duration, 10)).toMatchObject({ trackId: 10, start: 30 });
  });

  it("appends it to its Track once a Clip took its spot, keeping what's captured in step", () => {
    const taken = [{ id: 10, clips: [beat, { ...takes, length: 12 }] }];
    expect(recoveredPlacement(taken, recorded, duration, 10)).toEqual({
      kind: 'record',
      trackId: 10,
      start: 32,
      captureStart: 30,
    });
  });

  it('appends it to the chosen Track once its own is gone', () => {
    const gone = [{ id: 11, clips: [{ ...beat, id: 4, start: 5 }] }];
    expect(recoveredPlacement(gone, recorded, duration, 11)).toEqual({
      kind: 'record',
      trackId: 11,
      start: 15,
      captureStart: 13,
    });
  });

  it('leaves adding a Track to the caller when there are none left', () => {
    expect(recoveredPlacement([], recorded, duration, null)).toEqual({
      kind: 'record',
      trackId: null,
      start: 0,
      captureStart: -2,
    });
  });

  // A Retake into the Clip of Takes at 0:20, whose span started at 0:17.
  const retaken: Unsaved = { trackId: 10, clipId: 2, origin: 17, plan: { start: 20, from: 18 }, latencyOffset: 0.1 };

  it('retakes into its Clip while the Clip is there', () => {
    expect(recoveredPlacement(tracks, retaken, duration, 11)).toEqual({ kind: 'retake', clipId: 2, captureStart: 18 });
  });

  it('keeps a Retake in step with its Clip once the Clip moved, even onto another Track', () => {
    const moved = [
      { id: 10, clips: [beat] },
      { id: 11, clips: [{ ...takes, start: 50, offset: 5 }] },
    ];
    expect(recoveredPlacement(moved, retaken, duration, 10)).toEqual({ kind: 'retake', clipId: 2, captureStart: 46 });
  });

  it('appends a Retake to its Track as a new Clip once its Clip is gone', () => {
    const gone = [{ id: 10, clips: [beat] }];
    expect(recoveredPlacement(gone, retaken, duration, 10)).toEqual({
      kind: 'record',
      trackId: 10,
      start: 10,
      captureStart: 8,
    });
  });

  it('appends a Retake to the chosen Track once its Clip and its Track are gone', () => {
    expect(recoveredPlacement([{ id: 11, clips: [] }], retaken, duration, 11)).toEqual({
      kind: 'record',
      trackId: 11,
      start: 0,
      captureStart: -2,
    });
  });

  it('keeps nothing that stopped during the lead-in', () => {
    expect(recoveredPlacement(tracks, recorded, 2.05, 10)).toBeNull();
    expect(recoveredPlacement(tracks, recorded, 2.2, 10)).not.toBeNull();
  });
});

describe('samplesFrom', () => {
  const batch = (frame: number, ...samples: number[]) => ({ frame, samples: new Float32Array(samples) });

  it('joins batches from a frame on, dropping what came before it', () => {
    expect(Array.from(samplesFrom([batch(0, 1, 2, 3), batch(3, 4, 5)], 2))).toEqual([3, 4, 5]);
  });

  it('puts each batch at its own frame, in whatever order they come', () => {
    expect(Array.from(samplesFrom([batch(4, 5, 6), batch(2, 3, 4)], 2))).toEqual([3, 4, 5, 6]);
  });

  it('leaves silence where a batch is missing', () => {
    expect(Array.from(samplesFrom([batch(0, 1), batch(3, 4)], 0))).toEqual([1, 0, 0, 4]);
  });

  it('is empty with nothing after the frame', () => {
    expect(samplesFrom([batch(0, 1, 2)], 5).length).toBe(0);
  });
});
