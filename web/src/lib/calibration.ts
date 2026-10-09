// Calibrating the Latency Offset: the full round trip from the Beat being
// played to the voice reaching the file, through this device's outputs and
// input. Clicks play, and the mic hears them, from headphones resting on it
// (hands-free), or the user taps or claps on it along with them (tap along);
// each click's hit is found in what the input captured as it's heard, those
// that don't fit are left out, and the rest averaged, until the average is
// known well enough, or enough clicks have played (see verdict), or the
// user ends it. Each Input has its
// own, kept on this device (see inputCalibrations.ts). Until an Input's
// calibrated, the latency the browser reports stands in.

/** How many hits it takes to measure: fewer and it fails. */
export const minHits = 6;

// Before the first click, to get ready, in seconds.
const readyTime = 1.5;
/** Between clicks, in seconds. */
export const clickEvery = 0.75;

/** When click i plays, from 0, in seconds from when capture starts. */
export function clickTime(i: number): number {
  return readyTime + i * clickEvery;
}

/** When each of count clicks plays, in seconds from when capture starts. */
export function clickTimes(count: number): number[] {
  return Array.from({ length: count }, (_, i) => clickTime(i));
}

/** What measuring found: the average delay, in seconds, or a failure; with how many hits it counted. */
export type Measurement = { ok: true; offset: number; hits: number } | { ok: false; hits: number };

/**
 * What a calibration reads so far: how many clicks have played, heard or
 * not; each tap; the average of those that count, and how many do; how
 * widely they spread, as their standard deviation; and how precisely their
 * average is known, as its standard error. In seconds; spread and precision
 * are null from fewer than 2.
 */
export interface Reading {
  clicks: number;
  taps: readonly Tap[];
  average: number | null;
  counted: number;
  spread: number | null;
  precision: number | null;
}

/** A reading of no taps yet. */
export const noReading: Reading = { clicks: 0, taps: [], average: null, counted: 0, spread: null, precision: null };

/** A click's hit: its delay after the click, in seconds, and whether it's near enough the others to count. */
export interface Tap {
  delay: number;
  counted: boolean;
}

// How early before its click a hit can be, and how late after it, in seconds.
const earliest = 0.05;
const latest = 0.4;
// How close together two hits can be: closer, and it's one hit ringing on.
const refractory = 0.1;
// How far a hit can be from the others' median and still count, in seconds:
// wide enough for a hand's taps, which typically spread 20 to 25 ms.
const agreement = 0.05;
// The quietest a hit can be, and how far above the input's hiss, and how
// near a typical hit's level, it must reach. Typical is the median of the
// loudest moment around each click, so one loud bump can't drown the rest.
const quietest = 0.01;
const aboveHiss = 10;
const ofTypical = 0.25;

/**
 * Measures the delay from each click to the hit it was heard as, in a
 * recording at sampleRate whose clicks were played at the times given, in
 * seconds from its start. Each click counts the first hit just before or
 * after it; hits between clicks are stray, and ones far from the rest are
 * dropped. Fails with fewer than minHits left. Never less than no delay.
 */
export function measureOffset(samples: Float32Array, sampleRate: number, times: readonly number[]): Measurement {
  return summarise(readTaps(samples, sampleRate, times));
}

/** What each click's hit reads, in click order; a click with none has no Tap. */
function readTaps(samples: Float32Array, sampleRate: number, times: readonly number[]): Reading {
  const windows = times.map((click, i) => ({
    click,
    from: click - earliest,
    until: Math.min(click + latest, (times[i + 1] ?? Infinity) - earliest),
  }));
  const typical = median(windows.map(({ from, until }) => peak(samples, from * sampleRate, until * sampleRate)));
  const onsets = findOnsets(samples, sampleRate, typical);
  const delays: number[] = [];
  for (const { click, from, until } of windows) {
    const hit = onsets.find((at) => at >= from && at < until);
    if (hit !== undefined) delays.push(hit - click);
  }
  return readingOf(delays, times.length);
}

/**
 * What taps heard with these delays read, in seconds, in order, after a
 * number of clicks, by default one for each: those near enough their median
 * count, and their average is never less than no delay.
 */
export function readingOf(delays: readonly number[], clicks = delays.length): Reading {
  const middle = delays.length ? median(delays) : 0;
  const taps = delays.map((delay) => ({ delay, counted: Math.abs(delay - middle) <= agreement }));
  const kept = taps.filter((t) => t.counted).map((t) => t.delay);
  const counted = kept.length;
  if (counted === 0) return { ...noReading, clicks, taps };
  const mean = kept.reduce((sum, d) => sum + d, 0) / counted;
  const spread = counted < 2 ? null : Math.sqrt(kept.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (counted - 1));
  return {
    clicks,
    taps,
    average: Math.max(0, mean),
    counted,
    spread,
    precision: spread === null ? null : spread / Math.sqrt(counted),
  };
}

/** How precisely the average must be known to finish, in seconds. */
export const finishingAt = 0.004;
// The fewest counted taps it finishes from by precision; the most it counts
// before finishing anyway; and the most clicks it plays, about 30 seconds of
// them, so it ends even where the mic hears nothing.
const fewestToFinish = 10;
const mostCounted = 24;
const mostClicks = 40;

/**
 * Whether a reading is enough to keep, once minHits count; whether it's
 * finished, once its average is known to finishingAt from fewestToFinish
 * taps, or mostCounted count, or mostClicks have played, whichever is first;
 * and how near it is to finishing, from 0 to 1, by whichever is nearest.
 */
export interface Verdict {
  usable: boolean;
  finished: boolean;
  progress: number;
}

/** The verdict on a reading. */
export function verdict({ clicks, counted, average, precision }: Reading): Verdict {
  // How near the average is to precise enough, from 1 once it is; nowhere, from too few taps.
  const byPrecision =
    counted >= fewestToFinish && precision !== null ? finishingAt / Math.max(precision, finishingAt) : 0;
  const finished = byPrecision === 1 || counted >= mostCounted || clicks >= mostClicks;
  return {
    usable: counted >= minHits && average !== null,
    finished,
    progress: finished ? 1 : Math.min(1, Math.max(counted / mostCounted, clicks / mostClicks, byPrecision)),
  };
}

/** What a reading measures: its average, from minHits that count. */
function summarise({ average, counted }: Reading): Measurement {
  return counted < minHits || average === null
    ? { ok: false, hits: counted }
    : { ok: true, offset: average, hits: counted };
}

/**
 * The Latency Offset being measured while a calibration's clicks play, one
 * after another until it's ended: told the samples as they're captured, it
 * measures each click once its hit has had time to be heard, just as
 * measureOffset would the recording so far.
 */
export class Measuring {
  // The samples heard so far, from when capture started, in a buffer that
  // grows; and how many are in it.
  #samples = new Float32Array(0);
  #length = 0;
  // How many clicks have been measured.
  #clicks = 0;
  #reading = noReading;

  constructor(private sampleRate: number) {}

  /**
   * Hears more samples, the first of them at index at in the recording
   * (counted from when capture started); returns whether that let another
   * click be measured.
   */
  hear(samples: Float32Array, at: number): boolean {
    const end = at + samples.length;
    if (end > this.#samples.length) {
      const grown = new Float32Array(Math.max(end, this.#samples.length * 2));
      grown.set(this.#samples.subarray(0, this.#length));
      this.#samples = grown;
    }
    this.#samples.set(samples, at);
    this.#length = Math.max(this.#length, end);
    const clicks = this.#clicks;
    for (let heard = this.#heardTo(this.#clicks); heard <= this.#length; heard = this.#heardTo(this.#clicks)) {
      this.#clicks++;
      this.#reading = readTaps(this.#samples.subarray(0, heard), this.sampleRate, clickTimes(this.#clicks));
    }
    return this.#clicks > clicks;
  }

  /** How many samples it takes for click i's hit to have had time to be heard. */
  #heardTo(i: number): number {
    return Math.ceil((clickTime(i) + latest) * this.sampleRate);
  }

  /** All it reads so far. */
  get reading(): Reading {
    return this.#reading;
  }

  /** What's measured so far, as measureOffset would find it. */
  get result(): Measurement {
    return summarise(this.#reading);
  }
}

/** The loudest a stretch of samples gets, from one index until another. */
function peak(samples: Float32Array, from: number, until: number): number {
  let loudest = 0;
  for (let i = Math.max(0, Math.round(from)); i < Math.min(samples.length, until); i++) {
    loudest = Math.max(loudest, Math.abs(samples[i]));
  }
  return loudest;
}

/** When each hit starts, in seconds: where the signal first rises well above the hiss, near a typical hit's level. */
function findOnsets(samples: Float32Array, sampleRate: number, typical: number): number[] {
  const hiss = medianLevel(samples);
  const threshold = Math.max(quietest, hiss * aboveHiss, typical * ofTypical);
  const onsets: number[] = [];
  const gap = Math.round(refractory * sampleRate);
  let next = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i >= next && Math.abs(samples[i]) >= threshold) {
      onsets.push(i / sampleRate);
      next = i + gap;
    }
  }
  return onsets;
}

/** The middle of some values. */
function median(values: ArrayLike<number>): number {
  // A typed array sorts by value.
  const sorted = Float64Array.from(values).sort();
  const half = sorted.length >> 1;
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

/**
 * The middle of samples' levels, as median would find it, but without
 * copying and sorting them: measuring finds it in the whole recording so far
 * at every click, and the recording only grows.
 */
function medianLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  // A level's bits, read as a whole number, sort as the level does.
  const bits = new Uint32Array(samples.buffer, samples.byteOffset, samples.length);
  const half = samples.length >> 1;
  return samples.length % 2 ? levelAt(bits, half) : (levelAt(bits, half - 1) + levelAt(bits, half)) / 2;
}

const level = new Float32Array(1);
const levelBits = new Uint32Array(level.buffer);

/**
 * The level k from the quietest, from 0, of samples given as their bits:
 * found by counting their high 16 bits, then the low 16 of those that share
 * its high ones.
 */
function levelAt(bits: Uint32Array, k: number): number {
  const high = new Uint32Array(1 << 15);
  for (let i = 0; i < bits.length; i++) high[(bits[i] & 0x7fffffff) >>> 16]++;
  let bin = 0;
  while (k >= high[bin]) k -= high[bin++];
  const low = new Uint32Array(1 << 16);
  for (let i = 0; i < bits.length; i++) {
    const magnitude = bits[i] & 0x7fffffff;
    if (magnitude >>> 16 === bin) low[magnitude & 0xffff]++;
  }
  let at = 0;
  while (k >= low[at]) k -= low[at++];
  levelBits[0] = (bin << 16) | at;
  return level[0];
}

/** An Input's Latency Offset: null until calibrated, and whether calibration was offered for it yet. */
export interface Calibration {
  offset: number | null;
  offered: boolean;
}

/** The offset to apply to a Take: the one calibrated, or else the latency the browser reports. */
export function appliedOffset(calibration: Calibration, reported: number): number {
  return calibration.offset ?? reported;
}

/** An offset to show, in whole milliseconds: "23 ms". */
export function formatOffset(seconds: number): string {
  return `${Math.round(seconds * 1000)} ms`;
}

/** How far a new offset is from an old one, in whole milliseconds, signed: "+4 ms", "−3 ms", "±0 ms". */
export function offsetChange(offset: number, was: number): string {
  const ms = Math.round(offset * 1000) - Math.round(was * 1000);
  return ms === 0 ? '±0 ms' : `${ms > 0 ? '+' : '−'}${Math.abs(ms)} ms`;
}

/** The largest Latency Offset that can be typed, in milliseconds. */
export const maxTypedOffset = 500;

/**
 * A Latency Offset typed in whole milliseconds, in seconds; null where it
 * isn't a whole number from 0 to maxTypedOffset, so a slip of the keyboard
 * can't set something absurd.
 */
export function typedOffset(text: string): number | null {
  const typed = text.trim();
  if (!/^\d+$/.test(typed)) return null;
  const ms = Number(typed);
  return ms <= maxTypedOffset ? ms / 1000 : null;
}
