import { describe, expect, it } from 'vitest';
import { leadIn, recordingPlan, retakeLength, retakePlan } from './recording';

describe('recordingPlan', () => {
  it('puts a Take on an empty Track at 0:00, with no lead-in before it', () => {
    expect(recordingPlan([])).toEqual({ start: 0, from: 0 });
  });

  it("puts a Take where the Track's last Clip ends, leading in before it", () => {
    const clips = [
      { start: 40, offset: 0, length: 10 },
      { start: 0, offset: 3, length: 30 },
    ];
    expect(recordingPlan(clips)).toEqual({ start: 50, from: 50 - leadIn });
  });

  it('never leads in from before 0:00', () => {
    expect(recordingPlan([{ start: 0, offset: 0, length: 1.5 }])).toEqual({ start: 1.5, from: 0 });
  });
});

describe('retakePlan', () => {
  it("retakes from the Clip's start as trimmed, leading in before it", () => {
    expect(retakePlan({ start: 30, offset: 4, length: 10 })).toEqual({ start: 30, from: 30 - leadIn });
  });

  it('never leads in from before 0:00', () => {
    expect(retakePlan({ start: 1, offset: 0, length: 10 })).toEqual({ start: 1, from: 0 });
  });
});

describe('retakeLength', () => {
  // A Clip at 0:10 to 0:15, and the next on its Track at 0:20.
  const clip = { start: 10, offset: 1, length: 5 };
  const next = { start: 20, offset: 0, length: 5 };
  const clips = [next, clip, { start: 0, offset: 0, length: 8 }];

  it('grows the Clip to where the Retake ends', () => {
    expect(retakeLength(clip, clips, 18)).toBe(8);
  });

  it('never shrinks it for a shorter Retake', () => {
    expect(retakeLength(clip, clips, 12)).toBe(5);
  });

  it("stops at the next Clip's start", () => {
    expect(retakeLength(clip, clips, 26)).toBe(10);
  });

  it('counts a Clip placed right at its end, give or take rounding, as the next', () => {
    expect(retakeLength(clip, [clip, { start: 15 - 1e-9, offset: 0, length: 5 }], 26)).toBe(5);
  });

  it('grows as far as it likes when no Clip comes after it', () => {
    expect(retakeLength(clip, [clip], 60)).toBe(50);
  });
});
