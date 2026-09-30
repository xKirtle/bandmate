// 24-bit PCM WAV files: Takes are kept as mono ones at the rate they were
// recorded at, never resampled (ADR 0003), and a Mixdown downloads as a
// stereo one.

const bytesPerSample = 3;
const headerSize = 44;
// The largest 24-bit sample, and the smallest is one below its negative.
const fullScale = (1 << 23) - 1;

/**
 * Whether a sample, from -1 to 1, is at full scale once encoded: the
 * largest or smallest 24-bit sample, which anything louder is clipped to.
 */
export function atFullScale(sample: number): boolean {
  return Math.round(sample * (fullScale + 1)) >= fullScale || sample <= -1;
}

/**
 * Encodes channels of samples, from -1 to 1, as a 24-bit PCM WAV file at
 * sampleRate: one channel for mono, two for stereo, each as long as the
 * first. Louder samples are clipped.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
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
      const clipped = Math.max(-1, Math.min(1, samples[i]));
      // Rounded, so a quiet sample doesn't all drift towards zero.
      const value = Math.max(-fullScale - 1, Math.min(fullScale, Math.round(clipped * (fullScale + 1))));
      const at = i * bytesPerFrame + c * bytesPerSample;
      bytes[at] = value & 0xff;
      bytes[at + 1] = (value >> 8) & 0xff;
      bytes[at + 2] = (value >> 16) & 0xff;
    }
  }
  return buffer;
}
