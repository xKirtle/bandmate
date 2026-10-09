import { describe, expect, it } from 'vitest';
import { stretch } from './stretch';

const rate = 44100;

/** A pure tone, frequency Hz, lasting seconds. */
function tone(frequency: number, seconds: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) =>
    Math.sin((2 * Math.PI * frequency * i) / rate),
  );
}

/** A tone's frequency, from how often it rises through zero over its middle half. */
function frequencyOf(samples: Float32Array): number {
  const from = Math.floor(samples.length / 4);
  const to = Math.floor((samples.length * 3) / 4);
  let rises = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) rises++;
  return rises / ((to - from) / rate);
}

// Yields nothing, so a test doesn't wait on timers.
const noPause = () => Promise.resolve();

describe('stretch', () => {
  it('makes audio played slower longer, at the same pitch', async () => {
    const [left, right] = await stretch(
      { channels: [tone(440, 2), tone(220, 2)], sampleRate: rate },
      { tempo: 0.5, pitch: 0 },
      noPause,
    );

    expect(left.length).toBe(4 * rate);
    expect(right.length).toBe(4 * rate);
    expect(frequencyOf(left)).toBeCloseTo(440, -1);
    expect(frequencyOf(right)).toBeCloseTo(220, -1);
  });

  it('makes audio played faster shorter, at the same pitch', async () => {
    const [out] = await stretch({ channels: [tone(440, 3)], sampleRate: rate }, { tempo: 1.5, pitch: 0 }, noPause);

    expect(out.length).toBe(2 * rate);
    expect(frequencyOf(out)).toBeCloseTo(440, -1);
  });

  it('lasts exactly as long as the Tempo says, however the stretching rounds', async () => {
    const [out] = await stretch({ channels: [tone(440, 2)], sampleRate: rate }, { tempo: 0.92, pitch: 0 }, noPause);

    expect(out.length).toBe(Math.round((2 * rate) / 0.92));
    expect(frequencyOf(out)).toBeCloseTo(440, -1);
  });

  it('leaves audio at 100% as it is', async () => {
    const audio = tone(440, 1);

    const [out] = await stretch({ channels: [audio], sampleRate: rate }, { tempo: 1, pitch: 0 }, noPause);

    expect(out).toEqual(audio);
  });

  it('moves audio up an octave at +12 semitones, as long as it was', async () => {
    const [out] = await stretch({ channels: [tone(440, 2)], sampleRate: rate }, { tempo: 1, pitch: 12 }, noPause);

    expect(out.length).toBe(2 * rate);
    expect(frequencyOf(out)).toBeCloseTo(880, -1);
  });

  it('moves audio down by semitones, as long as it was', async () => {
    const [down2] = await stretch({ channels: [tone(440, 2)], sampleRate: rate }, { tempo: 1, pitch: -2 }, noPause);
    const [down12] = await stretch({ channels: [tone(440, 2)], sampleRate: rate }, { tempo: 1, pitch: -12 }, noPause);

    expect(down2.length).toBe(2 * rate);
    expect(frequencyOf(down2)).toBeCloseTo(440 * 2 ** (-2 / 12), -1);
    expect(down12.length).toBe(2 * rate);
    expect(frequencyOf(down12)).toBeCloseTo(220, -1);
  });

  it('changes the length by the Tempo and the frequency by the Pitch together', async () => {
    const [out] = await stretch({ channels: [tone(440, 2)], sampleRate: rate }, { tempo: 0.8, pitch: 3 }, noPause);

    expect(out.length).toBe(Math.round((2 * rate) / 0.8));
    expect(frequencyOf(out)).toBeCloseTo(440 * 2 ** (3 / 12), -1);
  });

  it('pauses as it goes, so the page carries on meanwhile', async () => {
    let pauses = 0;
    await stretch({ channels: [tone(440, 3)], sampleRate: rate }, { tempo: 0.8, pitch: 0 }, () => {
      pauses++;
      return Promise.resolve();
    });

    expect(pauses).toBeGreaterThanOrEqual(3);
  });
});
