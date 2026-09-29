import { describe, expect, it } from 'vitest';
import { samplesFrom, type Batch } from './capture';
import { clipping, LiveWave, tileBars } from './liveWave';
import { peaks as peaksOf } from './peaks';

// Deterministic noise, loud enough to clip now and then.
function noise(length: number, seed: number): Float32Array {
  const samples = new Float32Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    samples[i] = (x / 2147483648) * 2.4 - 1.2;
  }
  return samples;
}

// Samples cut into batches of the sizes given, in turn, from a frame.
function batched(samples: Float32Array, frame: number, sizes: number[]): Batch[] {
  const batches: Batch[] = [];
  for (let at = 0, n = 0; at < samples.length; n++) {
    const size = sizes[n % sizes.length];
    batches.push({ frame: frame + at, samples: samples.slice(at, at + size) });
    at += size;
  }
  return batches;
}

describe('LiveWave', () => {
  it('builds the same peaks from batches as from the whole recording', () => {
    const rate = 44100;
    // The capture starts before the first frame kept, as the worklet's does.
    const batches = batched(noise(rate * 3 + 123, 1), 1000, [128, 4096, 4224, 77]);
    const first = 1500;
    const wave = new LiveWave(first, rate, 0);

    for (const b of batches) wave.add(b);

    expect(wave.peaks()).toEqual(peaksOf([samplesFrom(batches, first)], rate));
  });

  it('matches at every batch along the way, a last, unfinished peak included', () => {
    const rate = 48000;
    const batches = batched(noise(rate, 2), 0, [300, 4096]);
    const wave = new LiveWave(0, rate, 0);

    batches.forEach((b, n) => {
      wave.add(b);
      expect(wave.peaks()).toEqual(peaksOf([samplesFrom(batches.slice(0, n + 1), 0)], rate));
    });
  });

  it('spreads samples as peaksOf does when a peak is not a whole number of them', () => {
    // 150 samples a second makes stretches of 1.5 samples.
    const batches = batched(noise(1000, 3), 0, [7, 11]);
    const wave = new LiveWave(0, 150, 0);

    for (const b of batches) wave.add(b);

    expect(wave.peaks()).toEqual(peaksOf([samplesFrom(batches, 0)], 150));
  });

  it('counts a missing batch as silence', () => {
    const rate = 44100;
    const all = batched(noise(rate, 4), 0, [4096]);
    const batches = all.filter((_, n) => n !== 3);
    const wave = new LiveWave(0, rate, 0);

    for (const b of batches) wave.add(b);

    expect(wave.peaks()).toEqual(peaksOf([samplesFrom(batches, 0)], rate));
  });

  it('draws silence flat', () => {
    const wave = new LiveWave(0, 44100, 0);

    wave.add({ frame: 0, samples: new Float32Array(44100) });

    expect(new Set(wave.tiles(0.03).flat())).toEqual(new Set([0]));
  });

  it('reduces the peaks to bars, each the loudest of its stretch, skipping those before the Clip', () => {
    // 100 samples a second: a peak per sample.
    const wave = new LiveWave(0, 100, 0.02);

    wave.add({
      frame: 0,
      samples: new Float32Array([0.9, 0.9, 0.1, 0.5, 0.2, 0.3, 0.4]),
    });

    // A bar every 0.02 seconds, so every 2 peaks, the last with only one.
    expect(wave.tiles(0.02)).toEqual([[0.5, 0.3, 0.4]]);
  });

  it('groups the bars in tiles, keeping the full ones as they are as more comes', () => {
    const wave = new LiveWave(0, 100, 0);
    wave.add({ frame: 0, samples: new Float32Array(tileBars + 10).fill(0.5) });
    const before = wave.tiles(0.01);

    wave.add({ frame: tileBars + 10, samples: new Float32Array(5).fill(0.25) });
    const after = wave.tiles(0.01);

    expect(before.map((t) => t.length)).toEqual([tileBars, 10]);
    expect(after.map((t) => t.length)).toEqual([tileBars, 15]);
    expect(after[0]).toBe(before[0]);
    expect(after[1].slice(10)).toEqual([0.25, 0.25, 0.25, 0.25, 0.25]);
  });

  it('gives the same tiles while nothing new comes', () => {
    const wave = new LiveWave(0, 100, 0);
    wave.add({ frame: 0, samples: new Float32Array(20).fill(0.5) });

    expect(wave.tiles(0.01)).toBe(wave.tiles(0.01));
  });

  it('grows its last bar as its stretch fills', () => {
    const wave = new LiveWave(0, 100, 0);
    wave.add({ frame: 0, samples: new Float32Array([0.1, 0.2]) });
    expect(wave.tiles(0.04)).toEqual([[0.2]]);

    wave.add({ frame: 2, samples: new Float32Array([0.7]) });

    expect(wave.tiles(0.04)).toEqual([[0.7]]);
  });

  it('starts over at another zoom', () => {
    const wave = new LiveWave(0, 100, 0);
    wave.add({ frame: 0, samples: new Float32Array([0.1, 0.2, 0.3, 0.4]) });

    expect(wave.tiles(0.01)).toEqual([[0.1, 0.2, 0.3, 0.4]]);
    expect(wave.tiles(0.02)).toEqual([[0.2, 0.4]]);
  });
});

describe('clipping', () => {
  it('is at −0.5 dBFS, as peaks are rounded', () => {
    expect(clipping).toBe(0.944);
    expect(Math.round(10 ** (-0.5 / 20) * 1000) / 1000).toBe(clipping);
  });
});
