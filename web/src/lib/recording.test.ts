import { describe, expect, it } from 'vitest';
import { leadIn, recordingPlan } from './recording';

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
