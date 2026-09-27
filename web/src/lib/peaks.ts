// Waveform peaks: decoded audio reduced to how loud each short stretch is,
// enough to draw a waveform without the audio. The browser computes them on
// upload and the server keeps them with the file.

/** How many peaks describe each second of audio. */
export const peaksPerSecond = 100;

/**
 * Reduces decoded audio to one peak per 1/perSecond of a second: the loudest
 * sample in that stretch, across all channels, from 0 to 1. Clipped samples
 * count as 1, and peaks are rounded to 3 decimals to keep uploads small.
 */
export function peaks(channels: Float32Array[], sampleRate: number, perSecond = peaksPerSecond): number[] {
  const length = channels[0]?.length ?? 0;
  const stretch = sampleRate / perSecond;
  const count = Math.ceil(length / stretch);
  const result: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * stretch);
    const end = Math.min(length, Math.floor((i + 1) * stretch));
    let loudest = 0;
    for (const samples of channels) {
      for (let s = start; s < end; s++) {
        const v = Math.abs(samples[s]);
        if (v > loudest) loudest = v;
      }
    }
    result[i] = Math.round(Math.min(loudest, 1) * 1000) / 1000;
  }
  return result;
}
