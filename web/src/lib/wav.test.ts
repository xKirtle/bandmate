import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

const text = (view: DataView, at: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(at + i)));

/** The 24-bit sample at index i of a WAV's interleaved data, as a signed integer. */
const sample = (view: DataView, i: number) => {
  const at = 44 + i * 3;
  const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
  return value >= 1 << 23 ? value - (1 << 24) : value;
};

describe('encodeWav', () => {
  it('writes a mono 24-bit PCM header at the given rate', () => {
    const view = new DataView(encodeWav([new Float32Array(10)], 48000));
    expect(view.byteLength).toBe(44 + 30);
    expect(text(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 30);
    expect(text(view, 8, 8)).toBe('WAVEfmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(48000 * 3);
    expect(view.getUint16(32, true)).toBe(3);
    expect(view.getUint16(34, true)).toBe(24);
    expect(text(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(30);
  });

  it('packs each sample into 3 little-endian bytes', () => {
    const view = new DataView(encodeWav([new Float32Array([0, 0.5, -0.5, 1 / (1 << 23), -1 / (1 << 23)])], 44100));
    expect([0, 1, 2, 3, 4].map((i) => sample(view, i))).toEqual([0, 1 << 22, -(1 << 22), 1, -1]);
    // 0.5 is 0x400000: its low byte first.
    expect([44 + 3, 44 + 4, 44 + 5].map((at) => view.getUint8(at))).toEqual([0x00, 0x00, 0x40]);
  });

  it('clips samples beyond ±1 to full scale', () => {
    const view = new DataView(encodeWav([new Float32Array([1, -1, 1.5, -2])], 48000));
    expect([0, 1, 2, 3].map((i) => sample(view, i))).toEqual([(1 << 23) - 1, -(1 << 23), (1 << 23) - 1, -(1 << 23)]);
  });

  it('writes a stereo header, and interleaves the channels frame by frame', () => {
    const left = new Float32Array([0.5, 0, -1 / (1 << 23)]);
    const right = new Float32Array([-0.5, 1 / (1 << 23), 0]);
    const view = new DataView(encodeWav([left, right], 48000));
    expect(view.byteLength).toBe(44 + 18);
    expect(view.getUint32(4, true)).toBe(36 + 18);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    // Each frame is both channels' samples: 6 bytes, 6 × 48000 a second.
    expect(view.getUint32(28, true)).toBe(48000 * 6);
    expect(view.getUint16(32, true)).toBe(6);
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(18);
    expect([0, 1, 2, 3, 4, 5].map((i) => sample(view, i))).toEqual([1 << 22, -(1 << 22), 0, 1, -1, 0]);
  });

  it('writes a stereo 16-bit PCM header when asked for 16 bits', () => {
    const view = new DataView(encodeWav([new Float32Array(3), new Float32Array(3)], 48000, 16));
    expect(view.byteLength).toBe(44 + 12);
    expect(view.getUint32(4, true)).toBe(36 + 12);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    // Each frame is both channels' 2-byte samples: 4 bytes, 4 × 48000 a second.
    expect(view.getUint32(28, true)).toBe(48000 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
  });

  it('packs 16-bit samples into 2 little-endian bytes, interleaved, clipping beyond ±1', () => {
    const left = new Float32Array([0.5, 1 / (1 << 15), 1.5]);
    const right = new Float32Array([-0.5, -1, -2]);
    const view = new DataView(encodeWav([left, right], 48000, 16));
    const samples = [0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([1 << 14, -(1 << 14), 1, -(1 << 15), (1 << 15) - 1, -(1 << 15)]);
    // 0.5 is 0x4000: its low byte first.
    expect([44, 45].map((at) => view.getUint8(at))).toEqual([0x00, 0x40]);
  });
});
