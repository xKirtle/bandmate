// Takes are kept as mono 24-bit PCM WAV at the rate they were recorded at,
// never resampled (ADR 0003).

const bytesPerSample = 3;
const headerSize = 44;
// The largest 24-bit sample, and the smallest is one below its negative.
const fullScale = (1 << 23) - 1;

/** Encodes samples, from -1 to 1, as a mono 24-bit PCM WAV file at sampleRate. Louder ones are clipped. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  // Integer PCM, one channel.
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  const bytes = new Uint8Array(buffer, headerSize);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    // Rounded, so a quiet sample doesn't all drift towards zero.
    const value = Math.max(-fullScale - 1, Math.min(fullScale, Math.round(clipped * (fullScale + 1))));
    const at = i * bytesPerSample;
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >> 8) & 0xff;
    bytes[at + 2] = (value >> 16) & 0xff;
  }
  return buffer;
}
