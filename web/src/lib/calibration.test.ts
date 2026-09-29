import { describe, expect, it } from 'vitest';
import {
  appliedOffset,
  calibrationKey,
  clickTimes,
  measureOffset,
  minHits,
  readCalibration,
  skipCalibration,
  storeOffset,
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

describe('clickTimes', () => {
  it('spaces clicks evenly after a moment to get ready', () => {
    const times = clickTimes(4);
    expect(times).toHaveLength(4);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[2] - times[1]).toBeCloseTo(times[1] - times[0]);
  });
});

/** A Storage holding some values, or one that throws like a blocked one. */
function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
    removeItem: (key: string) => (blocked ? fail() : void delete values[key]),
  } as Storage;
}

describe('readCalibration', () => {
  it('is uncalibrated and not yet offered on a new device', () => {
    expect(readCalibration(storage())).toEqual({ offset: null, offered: false });
  });

  it('remembers skipping, still uncalibrated', () => {
    const s = storage();
    skipCalibration(s);
    expect(readCalibration(s)).toEqual({ offset: null, offered: true });
  });

  it('remembers the offset measured', () => {
    const s = storage();
    skipCalibration(s);
    storeOffset(s, 0.021);
    expect(readCalibration(s)).toEqual({ offset: 0.021, offered: true });
  });

  it('is uncalibrated when what is kept is unreadable', () => {
    expect(readCalibration(storage({ [calibrationKey]: '{nope' }))).toEqual({ offset: null, offered: false });
    expect(readCalibration(storage({ [calibrationKey]: '{"offset":-1,"offered":true}' }))).toEqual({
      offset: null,
      offered: true,
    });
  });

  it('is uncalibrated, and keeps nothing, when storage is blocked', () => {
    const s = storage({}, true);
    storeOffset(s, 0.02);
    skipCalibration(s);
    expect(readCalibration(s)).toEqual({ offset: null, offered: false });
    expect(readCalibration(undefined)).toEqual({ offset: null, offered: false });
  });
});

describe('appliedOffset', () => {
  it('is the calibrated offset, or else the latency the browser reports', () => {
    expect(appliedOffset({ offset: 0.031, offered: true }, 0.012)).toBe(0.031);
    expect(appliedOffset({ offset: 0, offered: true }, 0.012)).toBe(0);
    expect(appliedOffset({ offset: null, offered: true }, 0.012)).toBe(0.012);
  });
});
