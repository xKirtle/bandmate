// Calibrating the Latency Offset: the full round trip from the Beat being
// played to the voice reaching the file, through this device's outputs and
// input. A click plays and the user taps or claps on the mic along with
// it; the hits are found in what the input captured, those that don't fit
// are dropped, and the rest averaged. The offset is kept on this device,
// like the input chosen, since it belongs to the hardware here, not to any
// Song. Until it's calibrated, the latency the browser reports stands in.

/** How many clicks a calibration plays. */
export const clickCount = 12;
/** How many hits it takes to measure: fewer and it fails. */
export const minHits = 6;

// Before the first click, to get ready, and between clicks, in seconds.
const readyTime = 1.5;
const clickEvery = 0.75;

/** When each of count clicks plays, in seconds from when capture starts. */
export function clickTimes(count = clickCount): number[] {
  return Array.from({ length: count }, (_, i) => readyTime + i * clickEvery);
}

/** What measuring found: the average delay, in seconds, or a failure; with how many hits it counted. */
export type Measurement = { ok: true; offset: number; hits: number } | { ok: false; hits: number };

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
  if (delays.length === 0) return { ok: false, hits: 0 };
  const middle = median(delays);
  const kept = delays.filter((d) => Math.abs(d - middle) <= agreement);
  if (kept.length < minHits) return { ok: false, hits: kept.length };
  const average = kept.reduce((sum, d) => sum + d, 0) / kept.length;
  return { ok: true, offset: Math.max(0, average), hits: kept.length };
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
  const levels = samples.map(Math.abs);
  const hiss = median(levels);
  const threshold = Math.max(quietest, hiss * aboveHiss, typical * ofTypical);
  const onsets: number[] = [];
  const gap = Math.round(refractory * sampleRate);
  let next = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i >= next && levels[i] >= threshold) {
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

/** The Latency Offset on this device: null until calibrated, and whether calibration was offered yet. */
export interface Calibration {
  offset: number | null;
  offered: boolean;
}

/** Where it's kept on this device. */
export const calibrationKey = 'bandmate.latency';

/** The calibration kept on this device, or none. */
export function readCalibration(storage: Storage | undefined): Calibration {
  try {
    const { offset, offered } = JSON.parse(storage?.getItem(calibrationKey) ?? 'null') ?? {};
    return {
      offset: typeof offset === 'number' && Number.isFinite(offset) && offset >= 0 ? offset : null,
      offered: offered === true,
    };
  } catch {
    return { offset: null, offered: false };
  }
}

function store(storage: Storage | undefined, calibration: Calibration) {
  try {
    storage?.setItem(calibrationKey, JSON.stringify(calibration));
  } catch {
    // Not kept, e.g. in a private window.
  }
}

/** Keeps an offset measured, in seconds, on this device. */
export function storeOffset(storage: Storage | undefined, offset: number) {
  store(storage, { offset, offered: true });
}

/** Keeps that calibration was offered and skipped, so it isn't offered again. */
export function skipCalibration(storage: Storage | undefined) {
  store(storage, { ...readCalibration(storage), offered: true });
}

/** The offset to apply to a Take: the one calibrated, or else the latency the browser reports. */
export function appliedOffset(calibration: Calibration, reported: number): number {
  return calibration.offset ?? reported;
}

/** An offset to show, in whole milliseconds: "23 ms". */
export function formatOffset(seconds: number): string {
  return `${Math.round(seconds * 1000)} ms`;
}
