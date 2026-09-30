// PCM WAV files: Takes are kept as mono 24-bit ones at the rate they were
// recorded at, never resampled (ADR 0003), and a Mixdown downloads as a
// stereo 24- or 16-bit one.

/** How many bits each sample of a WAV file takes. */
export type WavBits = 16 | 24;

const headerSize = 44;

/** The largest sample at a bit depth; the smallest is one below its negative. */
const fullScaleAt = (bits: WavBits) => 2 ** (bits - 1) - 1;

/**
 * A sample, from -1 to 1, as the integer it's encoded as at a bit depth:
 * rounded, so a quiet sample doesn't all drift towards zero, and clipped
 * to full scale.
 */
export function pcmSample(sample: number, bits: WavBits): number {
  const fullScale = fullScaleAt(bits);
  return Math.max(-fullScale - 1, Math.min(fullScale, Math.round(sample * (fullScale + 1))));
}

/**
 * Whether a sample, from -1 to 1, is at full scale once encoded at a bit
 * depth: the largest or smallest sample, which anything louder is clipped to.
 */
export function atFullScale(sample: number, bits: WavBits = 24): boolean {
  const fullScale = fullScaleAt(bits);
  return Math.round(sample * (fullScale + 1)) >= fullScale || sample <= -1;
}

/**
 * Encodes channels of samples, from -1 to 1, as a PCM WAV file at sampleRate
 * and a bit depth, 24 unless told otherwise: one channel for mono, two for
 * stereo, each as long as the first. Louder samples are clipped.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number, bits: WavBits = 24): ArrayBuffer {
  const bytesPerSample = bits / 8;
  const frames = channels[0]?.length ?? 0;
  const bytesPerFrame = channels.length * bytesPerSample;
  const dataSize = frames * bytesPerFrame;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  // Integer PCM.
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, bytesPerSample * 8, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  const bytes = new Uint8Array(buffer, headerSize);
  // Interleaved: each frame holds every channel's sample in turn.
  for (const [c, samples] of channels.entries()) {
    for (let i = 0; i < frames; i++) {
      const value = pcmSample(samples[i], bits);
      const at = i * bytesPerFrame + c * bytesPerSample;
      // Little-endian, in two's complement.
      for (let b = 0; b < bytesPerSample; b++) bytes[at + b] = (value >> (8 * b)) & 0xff;
    }
  }
  return buffer;
}
