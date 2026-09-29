import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

const text = (view: DataView, at: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(at + i)));

/** The 24-bit sample at index i of a mono WAV's data, as a signed integer. */
const sample = (view: DataView, i: number) => {
  const at = 44 + i * 3;
  const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
  return value >= 1 << 23 ? value - (1 << 24) : value;
};

describe('encodeWav', () => {
  it('writes a mono 24-bit PCM header at the given rate', () => {
    const view = new DataView(encodeWav(new Float32Array(10), 48000));
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
    const view = new DataView(encodeWav(new Float32Array([0, 0.5, -0.5, 1 / (1 << 23), -1 / (1 << 23)]), 44100));
    expect([0, 1, 2, 3, 4].map((i) => sample(view, i))).toEqual([0, 1 << 22, -(1 << 22), 1, -1]);
    // 0.5 is 0x400000: its low byte first.
    expect([44 + 3, 44 + 4, 44 + 5].map((at) => view.getUint8(at))).toEqual([0x00, 0x00, 0x40]);
  });

  it('clips samples beyond ±1 to full scale', () => {
    const view = new DataView(encodeWav(new Float32Array([1, -1, 1.5, -2]), 48000));
    expect([0, 1, 2, 3].map((i) => sample(view, i))).toEqual([(1 << 23) - 1, -(1 << 23), (1 << 23) - 1, -(1 << 23)]);
  });
});
