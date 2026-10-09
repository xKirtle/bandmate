import { describe, expect, it } from 'vitest';
import { clickTime } from './calibration';
import { armAngle, beatAt, markAngle, markFade } from './metronome';

describe('beatAt', () => {
  it('counts clicks heard since the first, as heard: whole as each is heard, below 0 before it', () => {
    // Clicks scheduled from context time 10.
    expect(beatAt(10 + clickTime(0), 10)).toBeCloseTo(0, 6);
    expect(beatAt(10 + clickTime(3), 10)).toBeCloseTo(3, 6);
    expect(beatAt(10 + (clickTime(1) + clickTime(2)) / 2, 10)).toBeCloseTo(1.5, 6);
    expect(beatAt(10, 10)).toBeLessThan(0);
  });
});

describe('armAngle', () => {
  it('is upright as each click is heard, and swings to one side then the other between them', () => {
    expect(armAngle(0)).toBeCloseTo(0, 6);
    expect(armAngle(4)).toBeCloseTo(0, 6);
    expect(armAngle(0.5)).toBeGreaterThan(30);
    expect(armAngle(1.5)).toBeLessThan(-30);
  });
});

describe('markAngle', () => {
  it('places a tap by its delay from the average, later to the right, ±60 ms spanning the arc', () => {
    expect(markAngle(0.025, 0.025)).toBe(0);
    expect(markAngle(0.055, 0.025)).toBeCloseTo(19, 6);
    expect(markAngle(0.01, 0.025)).toBeCloseTo(-9.5, 6);
    expect(markAngle(0.085, 0.025)).toBeCloseTo(38, 6);
  });

  it('keeps a tap far off at the end of the arc', () => {
    expect(markAngle(0.4, 0.025)).toBe(markAngle(0.2, 0.025));
    expect(markAngle(-0.2, 0.025)).toBe(-markAngle(0.2, 0.025));
  });
});

describe('markFade', () => {
  it('shows a tap fully as it is heard, fading out over a few seconds', () => {
    expect(markFade(0)).toBe(1);
    expect(markFade(2)).toBeCloseTo(0.5, 6);
    expect(markFade(4)).toBe(0);
    expect(markFade(10)).toBe(0);
  });
});
