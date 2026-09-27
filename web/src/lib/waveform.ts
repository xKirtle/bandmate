// Drawing a waveform: an audio file's peaks reduced to as many bars as fit.

/** How wide a bar is drawn, in pixels, with its gap. */
export const barWidth = 3;

/**
 * Reduces peaks to count bars, each the loudest peak of its stretch. With
 * fewer peaks than bars, peaks are repeated.
 */
export function bars(peaks: readonly number[], count: number): number[] {
  const result: number[] = new Array(count).fill(0);
  if (peaks.length === 0) return result;
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
    let loudest = 0;
    for (let p = start; p < end; p++) loudest = Math.max(loudest, peaks[p]);
    result[i] = loudest;
  }
  return result;
}
