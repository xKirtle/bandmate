// Calibrating the Latency Offset: the full round trip from the Beat being
// played to the voice reaching the file, through this device's outputs and
// input. Clicks play until the user ends it, and they tap or clap on the mic
// along with them; each click's hit is found in what the input captured as
// it's heard, those that don't fit are left out, and the rest averaged. Each
// Input has its own, kept on this device (see inputCalibrations.ts). Until an
// Input's calibrated, the latency the browser reports stands in.

/** How many hits it takes to measure: fewer and it fails. */
export const minHits = 6;
/** How many taps the average must hold steady over. */
export const steadyOver = 10;

// Before the first click, to get ready, and between clicks, in seconds.
const readyTime = 1.5;
const clickEvery = 0.75;

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

/** What a calibration reads so far: each tap, the average of those that count, how many do, and how steady it is. */
export interface Reading {
  taps: readonly Tap[];
  average: number | null;
  counted: number;
  steady: number | null;
}

/** A reading of no taps yet. */
export const noReading: Reading = { taps: [], average: null, counted: 0, steady: null };

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
// How far a hit can be from the others' median and still count, in seconds.
const agreement = 0.03;
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
  return summarise(findTaps(samples, sampleRate, times));
}

/** Each click's hit, in click order, with whether it counts; a click with none has no Tap. */
function findTaps(samples: Float32Array, sampleRate: number, times: readonly number[]): Tap[] {
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
  if (delays.length === 0) return [];
  const middle = median(delays);
  return delays.map((delay) => ({ delay, counted: Math.abs(delay - middle) <= agreement }));
}

/** The average delay of the Taps that count, never less than no delay; null with none. */
function averageOf(taps: readonly Tap[]): number | null {
  const kept = taps.filter((t) => t.counted);
  if (kept.length === 0) return null;
  return Math.max(0, kept.reduce((sum, t) => sum + t.delay, 0) / kept.length);
}

/** What some Taps measure: their average, from minHits that count. */
function summarise(taps: readonly Tap[]): Measurement {
  const hits = taps.filter((t) => t.counted).length;
  const offset = averageOf(taps);
  return hits < minHits || offset === null ? { ok: false, hits } : { ok: true, offset, hits };
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
  #taps: Tap[] = [];
  // The average as each tap was heard, one for each tap, to tell how steady
  // it is. A click that finds more than one new tap at once (one a quiet
  // start hid) gives each the same average; one that finds fewer drops the
  // averages past them.
  #averages: (number | null)[] = [];

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
      this.#taps = findTaps(this.#samples.subarray(0, heard), this.sampleRate, clickTimes(this.#clicks));
      const average = averageOf(this.#taps);
      this.#averages.length = Math.min(this.#averages.length, this.#taps.length);
      while (this.#averages.length < this.#taps.length) this.#averages.push(average);
    }
    return this.#clicks > clicks;
  }

  /** How many samples it takes for click i's hit to have had time to be heard. */
  #heardTo(i: number): number {
    return Math.ceil((clickTime(i) + latest) * this.sampleRate);
  }

  /** All it reads so far, at once. */
  get reading(): Reading {
    return { taps: this.taps, average: this.average, counted: this.counted, steady: this.steady };
  }

  /** What's measured so far, as measureOffset would find it. */
  get result(): Measurement {
    return summarise(this.#taps);
  }

  /** Each hit heard so far, in order, with whether it counts. */
  get taps(): readonly Tap[] {
    return this.#taps;
  }

  /** The average delay of the taps that count, in seconds; null with none. */
  get average(): number | null {
    return averageOf(this.#taps);
  }

  /** How many taps count. */
  get counted(): number {
    return this.#taps.filter((t) => t.counted).length;
  }

  /**
   * How far the average has moved over the last steadyOver taps, in
   * seconds either side of the middle of where it's been; null until there
   * are that many, each with an average.
   */
  get steady(): number | null {
    const last = this.#averages.slice(-steadyOver);
    if (last.length < steadyOver || last.some((a) => a === null)) return null;
    const averages = last as number[];
    return (Math.max(...averages) - Math.min(...averages)) / 2;
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

/** The Latency Offset, to show at a glance: "12 ms, calibrated", or "Not calibrated". */
export function offsetSummary(offset: number | null): string {
  return offset === null ? 'Not calibrated' : `${formatOffset(offset)}, calibrated`;
}
