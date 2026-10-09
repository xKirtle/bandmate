import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInput, samplesFrom, watchInputs } from './capture';

describe('samplesFrom', () => {
  const batch = (frame: number, ...samples: number[]) => ({ frame, samples: new Float32Array(samples) });

  it('joins batches from a frame on, dropping what came before it', () => {
    expect(Array.from(samplesFrom([batch(0, 1, 2, 3), batch(3, 4, 5)], 2))).toEqual([3, 4, 5]);
  });

  it('puts each batch at its own frame, in whatever order they come', () => {
    expect(Array.from(samplesFrom([batch(4, 5, 6), batch(2, 3, 4)], 2))).toEqual([3, 4, 5, 6]);
  });

  it('leaves silence where a batch is missing', () => {
    expect(Array.from(samplesFrom([batch(0, 1), batch(3, 4)], 0))).toEqual([1, 0, 0, 4]);
  });

  it('is empty with nothing after the frame', () => {
    expect(samplesFrom([batch(0, 1, 2)], 5).length).toBe(0);
  });
});

describe('watchInputs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A browser that opens an input and lists one device, firing no event as it does, as Firefox does.
  function browser() {
    const track = { getSettings: () => ({ channelCount: 1, deviceId: 'mic' }) };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => ({ getAudioTracks: () => [track] }),
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic', groupId: 'g', label: 'Mic' }],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  }

  it('calls back once an input opens, as Firefox only then names every input, saying nothing', async () => {
    browser();
    const changed = vi.fn();
    const stop = watchInputs(changed);
    await openInput({ deviceId: '', label: '', channel: 0 });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops calling back once stopped', async () => {
    browser();
    const changed = vi.fn();
    watchInputs(changed)();
    await openInput({ deviceId: '', label: '', channel: 0 });
    expect(changed).not.toHaveBeenCalled();
  });
});
