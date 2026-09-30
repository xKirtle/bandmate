import { describe as group, expect, it } from 'vitest';
import { encodeMp3 } from './mp3';

/** Two channels of a quiet 440 Hz tone, seconds long at rate. */
function tone(seconds: number, rate: number): Float32Array[] {
  const left = Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.25,
  );
  return [left, left.map((s) => -s)];
}

/** What the first MPEG audio frame header in an MP3 says. */
async function firstFrame(mp3: Blob) {
  const bytes = new Uint8Array(await mp3.arrayBuffer());
  const at = bytes.findIndex((b, i) => b === 0xff && (bytes[i + 1] & 0xe0) === 0xe0);
  expect(at).toBeGreaterThanOrEqual(0);
  const [, b1, b2, b3] = bytes.subarray(at, at + 4);
  // MPEG-1 Layer III bitrates by index, in kbps, and sample rates in Hz.
  const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][b2 >> 4];
  const rate = [44100, 48000, 32000][(b2 >> 2) & 3];
  return { mpeg1: (b1 & 0x18) === 0x18, layer3: (b1 & 0x06) === 0x02, kbps, rate, mono: b3 >> 6 === 3 };
}

const quiet = { signal: new AbortController().signal, onProgress: () => {} };

group('encodeMp3', () => {
  it.each([320, 192, 128] as const)('encodes stereo 48 kHz at %i kbps', async (kbps) => {
    const mp3 = await encodeMp3(tone(1, 48000), 48000, kbps, quiet);
    expect(mp3.type).toBe('audio/mpeg');
    expect(await firstFrame(mp3)).toEqual({ mpeg1: true, layer3: true, kbps, rate: 48000, mono: false });
    // Constant bitrate: about a second's worth of bytes.
    expect(mp3.size).toBeGreaterThan(((kbps * 1000) / 8) * 0.9);
    expect(mp3.size).toBeLessThan(((kbps * 1000) / 8) * 1.2);
  });

  it('says how far it has got, a chunk at a time, up to all of it', async () => {
    const done: number[] = [];
    await encodeMp3(tone(3.5, 48000), 48000, 128, { ...quiet, onProgress: (d) => done.push(d) });
    expect(done.length).toBeGreaterThan(2);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.at(-1)).toBe(1);
  });

  it('stops between chunks once cancelled, rejecting with the reason', async () => {
    const cancel = new AbortController();
    const done: number[] = [];
    const encoding = encodeMp3(tone(5, 48000), 48000, 128, {
      signal: cancel.signal,
      onProgress: (d) => {
        done.push(d);
        if (done.length === 1) cancel.abort(new DOMException('Cancelled', 'AbortError'));
      },
    });
    await expect(encoding).rejects.toThrow('Cancelled');
    expect(done).toHaveLength(1);
  });
});
