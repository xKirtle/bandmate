import { describe, expect, it } from 'vitest';
import {
  appliedOffset,
  clickTimes,
  measureOffset,
  Measuring,
  minHits,
  offsetChange,
  offsetSummary,
  readingOf,
  typedOffset,
  verdict,
} from './calibration';

const rate = 48000;

/** A buffer of seconds of quiet hiss, with a clap at each time: a short, decaying burst. */
function recording(seconds: number, claps: readonly number[], loudness = 0.8): Float32Array {
  const samples = new Float32Array(Math.round(seconds * rate));
  // A fixed seed, so every run hears the same hiss.
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < samples.length; i++) samples[i] = random() * 0.005;
  for (const at of claps) {
    const first = Math.round(at * rate);
    for (let i = 0; i < rate * 0.05 && first + i < samples.length; i++) {
      samples[first + i] += random() * loudness * Math.exp(-i / (rate * 0.008));
    }
  }
  return samples;
}

const clicks = clickTimes(12);
const heard = (delay: number, times = clicks) => times.map((t) => t + delay);
const length = clicks.at(-1)! + 1;

describe('measureOffset', () => {
  it('finds a known delay', () => {
    for (const delay of [0.004, 0.023, 0.12, 0.3]) {
      const found = measureOffset(recording(length, heard(delay)), rate, clicks);
      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.offset).toBeCloseTo(delay, 3);
        expect(found.hits).toBe(clicks.length);
      }
    }
  });

  it('averages hits a little early or late', () => {
    const jitter = [0.01, -0.01, 0.005, -0.005, 0.008, -0.008, 0, 0.002, -0.002, 0.004, -0.004, 0];
    const claps = clicks.map((t, i) => t + 0.05 + jitter[i]);
    const found = measureOffset(recording(length, claps), rate, clicks);
    expect(found.ok && found.offset).toBeCloseTo(0.05, 3);
  });

  it('drops stray hits between clicks and hits far off the rest', () => {
    const claps = heard(0.04);
    // Two claps way off the beat, and one well late of its click.
    claps.push(clicks[3] + 0.3, clicks[7] + 0.35);
    claps[5] = clicks[5] + 0.2;
    const found = measureOffset(recording(length, claps), rate, clicks);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.offset).toBeCloseTo(0.04, 3);
      expect(found.hits).toBe(clicks.length - 1);
    }
  });

  it('measures with some hits missing', () => {
    const claps = heard(0.06).filter((_, i) => i % 4 !== 1);
    const found = measureOffset(recording(length, claps), rate, clicks);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.offset).toBeCloseTo(0.06, 3);
      expect(found.hits).toBe(claps.length);
    }
  });

  it('measures quiet hits, however loud the loudest', () => {
    const quiet = recording(length, heard(0.03), 0.1);
    const found = measureOffset(quiet, rate, clicks);
    expect(found.ok && found.offset).toBeCloseTo(0.03, 3);
  });

  it('measures quiet hits past a loud bump between clicks', () => {
    const quiet = recording(length, heard(0.03), 0.1);
    const bump = recording(length, [clicks[4] + 0.5], 1);
    for (let i = 0; i < quiet.length; i++) quiet[i] += bump[i];
    const found = measureOffset(quiet, rate, clicks);
    expect(found.ok && found.offset).toBeCloseTo(0.03, 3);
  });

  it('fails with too few hits', () => {
    const claps = heard(0.05).slice(0, minHits - 1);
    expect(measureOffset(recording(length, claps), rate, clicks)).toEqual({ ok: false, hits: minHits - 1 });
  });

  it('fails with nothing heard', () => {
    expect(measureOffset(recording(length, []), rate, clicks)).toEqual({ ok: false, hits: 0 });
    expect(measureOffset(new Float32Array(rate * length), rate, clicks)).toEqual({ ok: false, hits: 0 });
  });

  it('fails when the hits disagree too much to average', () => {
    // Half right on the click, half well after it.
    const claps = clicks.map((t, i) => t + (i % 2 ? 0.02 : 0.25));
    expect(measureOffset(recording(length, claps), rate, clicks).ok).toBe(false);
  });

  it('never measures less than no delay', () => {
    const found = measureOffset(recording(length, heard(-0.015)), rate, clicks);
    expect(found.ok && found.offset).toBe(0);
  });
});

/** Where click i's window closes, in samples: once heard to there, its tap is measured. */
const heardTo = (i: number) => Math.ceil((clicks[i] + 0.4) * rate);

describe('Measuring', () => {
  it('measures each tap as it is heard, as the whole recording so far would be', () => {
    // A little early and late, a click missed, a stray between clicks, and one far off.
    const claps = clicks.map((t, i) => t + 0.05 + [0.01, -0.01, 0.005, -0.005][i % 4]).filter((_, i) => i !== 2);
    claps.push(clicks[4] + 0.6);
    claps[6] = clicks[7] + 0.3;
    const samples = recording(length, claps);
    const measuring = new Measuring(rate);
    let at = 0;
    for (let i = 0; i < clicks.length; i++) {
      // Not measured until its window has been heard.
      expect(measuring.hear(samples.subarray(at, heardTo(i) - 1), at)).toBe(false);
      at = heardTo(i) - 1;
      expect(measuring.result).toEqual(measureOffset(samples.subarray(0, at), rate, clicks.slice(0, i)));
      expect(measuring.hear(samples.subarray(at, heardTo(i)), at)).toBe(true);
      at = heardTo(i);
      expect(measuring.result).toEqual(measureOffset(samples.subarray(0, at), rate, clicks.slice(0, i + 1)));
    }
    expect(measuring.result).toMatchObject({ ok: true, hits: 10 });
  });

  it('measures the same however the samples arrive', () => {
    const samples = recording(length, heard(0.03));
    const whole = new Measuring(rate);
    whole.hear(samples, 0);
    const batched = new Measuring(rate);
    for (let at = 0; at < samples.length; at += 4096) batched.hear(samples.subarray(at, at + 4096), at);
    expect(batched.result).toEqual(whole.result);
    expect(batched.reading).toEqual(whole.reading);
    expect(whole.reading.average).toBeCloseTo(0.03, 3);
    expect(whole.reading.counted).toBe(12);
  });

  it('leaves taps far from the rest out of the average, keeping them in order', () => {
    const claps = heard(0.04);
    claps[1] = clicks[1] + 0.25;
    const measuring = new Measuring(rate);
    measuring.hear(recording(length, claps), 0);
    const { taps, average, counted } = measuring.reading;
    expect(taps.map((t) => t.counted)).toEqual(clicks.map((_, i) => i !== 1));
    expect(taps[1].delay).toBeCloseTo(0.25, 3);
    expect(average).toBeCloseTo(0.04, 3);
    expect(counted).toBe(11);
  });
});

describe('readingOf', () => {
  it('counts taps within 50 ms of the median, and leaves out ones farther', () => {
    const found = readingOf([0.1, 0.1, 0.14, 0.1, 0.04, 0.1]);
    expect(found.taps.map((t) => t.counted)).toEqual([true, true, true, true, false, true]);
    expect(found.counted).toBe(5);
    expect(found.average).toBeCloseTo(0.108, 6);
  });

  it("reports the counted taps' spread, and how precisely their average is known", () => {
    // Mean 0.1, deviations ±0.02 and 0: a sample standard deviation of 0.02.
    const found = readingOf([0.08, 0.1, 0.12, 0.3]);
    expect(found.spread).toBeCloseTo(0.02, 6);
    expect(found.precision).toBeCloseTo(0.02 / Math.sqrt(3), 6);
  });

  it('has no spread or precision from fewer than 2 counted taps', () => {
    expect(readingOf([0.1])).toMatchObject({ counted: 1, spread: null, precision: null });
    expect(readingOf([])).toMatchObject({ counted: 0, average: null, spread: null, precision: null });
  });
});

/** Loose taps: n delays, alternately deviation early and late of 100 ms. */
const loose = (n: number, deviation: number) =>
  Array.from({ length: n }, (_, i) => 0.1 + (i % 2 ? deviation : -deviation));

describe('verdict', () => {
  it('finishes loose taps once their average is known to ±4 ms, from at least 10', () => {
    // Spread about ±11 ms: good to ±4 ms by 8 taps, but not finished before 10.
    expect(verdict(readingOf(loose(9, 0.01)))).toMatchObject({ usable: true, finished: false });
    expect(verdict(readingOf(loose(10, 0.01)))).toMatchObject({ usable: true, finished: true, progress: 1 });
    // Spread about ±20 ms: good to ±4 ms only once 25 taps count, so the cap of 24 finishes first.
    expect(verdict(readingOf(loose(16, 0.02)))).toMatchObject({ finished: false });
  });

  it('finishes taps spread ±15 ms by precision, before the cap', () => {
    // Over 14 taps, good to about ±4.2 ms; over 16, about ±3.9 ms.
    expect(verdict(readingOf(loose(14, 0.015))).finished).toBe(false);
    expect(verdict(readingOf(loose(16, 0.015))).finished).toBe(true);
  });

  it('is usable, but not finished, from 6 counted taps however exact', () => {
    expect(verdict(readingOf(loose(5, 0)))).toMatchObject({ usable: false, finished: false });
    expect(verdict(readingOf(loose(6, 0)))).toMatchObject({ usable: true, finished: false });
    expect(verdict(readingOf(loose(9, 0)))).toMatchObject({ usable: true, finished: false });
  });

  it('finishes at 24 counted taps, however loose', () => {
    // Spread about ±24 ms: good to only about ±5 ms by then.
    expect(verdict(readingOf(loose(23, 0.024))).finished).toBe(false);
    expect(verdict(readingOf(loose(24, 0.024)))).toMatchObject({ finished: true, progress: 1 });
  });

  it('finishes at 40 taps heard, though fewer count and their average is not yet precise', () => {
    // Half the taps 180 or 220 ms late, and half far off them, at 0 or 400 ms.
    const scattered = (n: number) => Array.from({ length: n }, (_, i) => [0, 0.18, 0.22, 0.4][i % 4]);
    expect(verdict(readingOf(scattered(39)))).toMatchObject({ usable: true, finished: false });
    expect(verdict(readingOf(scattered(40)))).toMatchObject({ finished: true, progress: 1 });
    expect(readingOf(scattered(40)).counted).toBe(20);
  });

  it('shows how near it is to finishing, by whichever bound is nearest', () => {
    expect(verdict(readingOf([])).progress).toBe(0);
    expect(verdict(readingOf(loose(12, 0.04))).progress).toBeCloseTo(0.5, 6);
    expect(verdict(readingOf(loose(20, 0.04))).progress).toBeCloseTo(20 / 24, 6);
  });
});

describe('clickTimes', () => {
  it('spaces clicks evenly after a moment to get ready', () => {
    const times = clickTimes(4);
    expect(times).toHaveLength(4);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[2] - times[1]).toBeCloseTo(times[1] - times[0]);
  });
});

describe('appliedOffset', () => {
  it('is the calibrated offset, or else the latency the browser reports', () => {
    expect(appliedOffset({ offset: 0.031, offered: true }, 0.012)).toBe(0.031);
    expect(appliedOffset({ offset: 0, offered: true }, 0.012)).toBe(0);
    expect(appliedOffset({ offset: null, offered: true }, 0.012)).toBe(0.012);
  });
});

describe('offsetSummary', () => {
  it('is the offset calibrated, in whole milliseconds', () => {
    expect(offsetSummary(0.0123)).toBe('12 ms, calibrated');
    expect(offsetSummary(0)).toBe('0 ms, calibrated');
  });

  it('says so until calibrated', () => {
    expect(offsetSummary(null)).toBe('Not calibrated');
  });
});

describe('offsetChange', () => {
  it('is how far a new offset is from the old one, in whole milliseconds, signed', () => {
    expect(offsetChange(0.025, 0.021)).toBe('+4 ms');
    expect(offsetChange(0.018, 0.0214)).toBe('−3 ms');
    expect(offsetChange(0.0251, 0.025)).toBe('±0 ms');
  });
});

describe('typedOffset', () => {
  it('is a whole number of milliseconds typed, in seconds', () => {
    expect(typedOffset('14')).toBe(0.014);
    expect(typedOffset(' 0 ')).toBe(0);
    expect(typedOffset('500')).toBe(0.5);
  });

  it('refuses what is outside 0 to 500 ms, or not a whole number of them', () => {
    for (const text of ['501', '-1', '12.5', '', 'abc', '1e2']) expect(typedOffset(text)).toBeNull();
  });
});
