import { describe, expect, it } from 'vitest';
import {
  appliedOffset,
  clickTimes,
  measureOffset,
  Measuring,
  minHits,
  offsetSummary,
  typedOffset,
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
    expect(batched.taps).toEqual(whole.taps);
    expect(whole.average).toBeCloseTo(0.03, 3);
    expect(whole.counted).toBe(12);
  });

  it('leaves taps far from the rest out of the average, keeping them in order', () => {
    const claps = heard(0.04);
    claps[1] = clicks[1] + 0.25;
    const measuring = new Measuring(rate);
    measuring.hear(recording(length, claps), 0);
    expect(measuring.taps.map((t) => t.counted)).toEqual(clicks.map((_, i) => i !== 1));
    expect(measuring.taps[1].delay).toBeCloseTo(0.25, 3);
    expect(measuring.average).toBeCloseTo(0.04, 3);
    expect(measuring.counted).toBe(11);
  });

  it('says how far the average moved over the last 10 taps, once there are 10', () => {
    const many = clickTimes(14);
    // Ten taps 40 ms late, then 62, 40, 40 and 40.
    const claps = many.map((t, i) => t + (i === 10 ? 0.062 : 0.04));
    const samples = recording(many.at(-1)! + 1, claps);
    const measuring = new Measuring(rate);
    const steady: (number | null)[] = [];
    let at = 0;
    for (let i = 0; i < many.length; i++) {
      const to = Math.ceil((many[i] + 0.4) * rate);
      measuring.hear(samples.subarray(at, to), at);
      at = to;
      steady.push(measuring.steady);
    }
    expect(steady.slice(0, 9)).toEqual(Array(9).fill(null));
    expect(steady[9]).toBeCloseTo(0, 3);
    // The average went from 40 to 42 ms, then back down to 41.5: ±1 ms.
    expect(measuring.average).toBeCloseTo(0.0415, 3);
    expect(steady[10]).toBeCloseTo(0.001, 3);
    expect(steady[13]).toBeCloseTo(0.001, 3);
  });

  it('counts only clicks with a tap towards the last 10', () => {
    const claps = heard(0.04).filter((_, i) => i % 2 === 0);
    const measuring = new Measuring(rate);
    measuring.hear(recording(length, claps), 0);
    expect(measuring.counted).toBe(6);
    expect(measuring.steady).toBeNull();
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
