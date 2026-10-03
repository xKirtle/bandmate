import { describe, expect, it } from 'vitest';
import {
  draggedFade,
  fadeCurves,
  fadeGainAt,
  fadeName,
  fitFades,
  formatFade,
  grabbedFade,
  shapedPeak,
} from './clipFade';

// A 10-second Clip at 0:20, rising over 2 seconds and falling over 4.
const placed = { start: 20, end: 30, fadeIn: 2, fadeOut: 4 };

describe('fadeGainAt', () => {
  it('rises from silence at the Clip’s start, and falls to silence at its end', () => {
    expect(fadeGainAt(placed, 20)).toBe(0);
    expect(fadeGainAt(placed, 22)).toBe(1);
    expect(fadeGainAt(placed, 25)).toBe(1);
    expect(fadeGainAt(placed, 26)).toBe(1);
    expect(fadeGainAt(placed, 30)).toBeCloseTo(0, 10);
  });

  it('sounds even, at equal power: halfway through a Fade it’s at half power, not half amplitude', () => {
    expect(fadeGainAt(placed, 21)).toBeCloseTo(Math.SQRT1_2, 10);
    expect(fadeGainAt(placed, 28)).toBeCloseTo(Math.SQRT1_2, 10);
    // A third of the way in, sin(30°).
    expect(fadeGainAt({ start: 0, end: 10, fadeIn: 3, fadeOut: 0 }, 1)).toBeCloseTo(0.5, 10);
  });

  it('leaves a Clip with no Fades as it is', () => {
    const none = { start: 0, end: 10, fadeIn: 0, fadeOut: 0 };
    expect(fadeGainAt(none, 0)).toBe(1);
    expect(fadeGainAt(none, 10)).toBe(1);
  });
});

describe('fitFades', () => {
  it('keeps Fades that fit the Clip', () => {
    expect(fitFades({ fadeIn: 2, fadeOut: 3 }, 10)).toEqual({ fadeIn: 2, fadeOut: 3 });
    expect(fitFades({ fadeIn: 4, fadeOut: 6 }, 10)).toEqual({ fadeIn: 4, fadeOut: 6 });
  });

  it('shortens each by the same share for a Clip too short for both, so they meet', () => {
    expect(fitFades({ fadeIn: 2, fadeOut: 6 }, 4)).toEqual({ fadeIn: 1, fadeOut: 3 });
  });
});

describe('draggedFade', () => {
  // The dot rests 0.25 seconds in from the edge while there's no Fade.
  it('is as long as the dot is dragged in from the Clip’s edge', () => {
    expect(draggedFade(3, 0, 10, 0.25)).toBe(3);
  });

  it('is removed with the dot dragged back to where it rests, or past the edge', () => {
    expect(draggedFade(0.25, 0, 10, 0.25)).toBe(0);
    expect(draggedFade(0.1, 0, 10, 0.25)).toBe(0);
    expect(draggedFade(-2, 0, 10, 0.25)).toBe(0);
  });

  it('stops at the other Fade, so the two never overlap', () => {
    expect(draggedFade(9, 4, 10, 0.25)).toBe(6);
    expect(draggedFade(12, 0, 10, 0.25)).toBe(10);
  });
});

describe('fadeCurves', () => {
  it('is a steady gain where no Fade is played', () => {
    expect(fadeCurves(placed, 23, 2)).toEqual({ initial: 1, curves: [] });
    expect(fadeCurves({ start: 0, end: 10, fadeIn: 0, fadeOut: 0 }, 0, 10)).toEqual({ initial: 1, curves: [] });
  });

  it('follows each Fade played, from when it starts, as a curve', () => {
    const { initial, curves } = fadeCurves(placed, 20, 10);
    expect(initial).toBe(0);
    expect(curves.map(({ at, duration }) => [at, duration])).toEqual([
      [0, 2],
      [6, 4],
    ]);
    const [rise, fall] = curves.map((c) => [...c.values]);
    expect(rise[0]).toBe(0);
    expect(rise.at(-1)).toBe(1);
    expect(rise[Math.floor(rise.length / 2)]).toBeGreaterThan(0.6);
    expect(fall[0]).toBe(1);
    expect(fall.at(-1)).toBeCloseTo(0, 6);
  });

  it('picks a Fade up partway, as playback starting in it, or a Loop’s repeat ending in it, hears it', () => {
    const { initial, curves } = fadeCurves(placed, 21, 7);
    expect(initial).toBeCloseTo(Math.SQRT1_2, 6);
    expect(curves.map(({ at, duration }) => [at, duration])).toEqual([
      [0, 1],
      [5, 2],
    ]);
    expect(curves[1].values.at(-1)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('never has two curves overlap, even where the Fades meet', () => {
    const met = { start: 0.1, end: 0.4, fadeIn: 0.2, fadeOut: 0.1 };
    const [rise, fall] = fadeCurves(met, 0.1, 0.3).curves;
    expect(fall.at).toBeGreaterThanOrEqual(rise.at + rise.duration);
  });
});

describe('shapedPeak', () => {
  it('draws a waveform peak as the Fades make it sound', () => {
    const clip = { fadeIn: 2, fadeOut: 4 };
    expect(shapedPeak(0.8, clip, 10, 0)).toBe(0);
    expect(shapedPeak(0.8, clip, 10, 1)).toBeCloseTo(0.8 * Math.SQRT1_2, 10);
    expect(shapedPeak(0.8, clip, 10, 5)).toBe(0.8);
  });
});

describe('grabbedFade', () => {
  it('grabs the dot pressed', () => {
    expect(grabbedFade('fadeIn', 100, 100, 300, 12)).toBe('fadeIn');
    expect(grabbedFade('fadeOut', 300, 100, 300, 12)).toBe('fadeOut');
  });

  it('grabs whichever of two dots sitting together the pointer is on the side of, so both can be moved', () => {
    expect(grabbedFade('fadeOut', 198, 200, 202, 12)).toBe('fadeIn');
    expect(grabbedFade('fadeOut', 203, 200, 202, 12)).toBe('fadeOut');
    expect(grabbedFade('fadeIn', 202, 200, 202, 12)).toBe('fadeOut');
  });
});

describe('fadeName', () => {
  it('names each Fade', () => {
    expect(fadeName('fadeIn')).toBe('Fade in');
    expect(fadeName('fadeOut')).toBe('Fade out');
  });
});

describe('formatFade', () => {
  it('says how long a Fade is, to the hundredth of a second', () => {
    expect(formatFade(1.5)).toBe('1.5 s');
    expect(formatFade(0.123)).toBe('0.12 s');
    expect(formatFade(12)).toBe('12 s');
  });
});
