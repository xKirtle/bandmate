import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenProblem, openInput, samplesFrom, watchInputs } from './capture';

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
  // A browser that opens an input, or fails to, and lists one device, firing
  // no event as it does, as Firefox does.
  let opens = true;
  const track = { getSettings: () => ({ channelCount: 1, deviceId: 'mic' }) };
  beforeEach(() => {
    opens = true;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => {
          if (!opens) throw new DOMException('Not allowed', 'NotAllowedError');
          return { getAudioTracks: () => [track] };
        },
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic', groupId: 'g', label: 'Mic' }],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  });
  // Stops the watching each test starts, even where it fails.
  let stop = () => {};
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });
  const defaultInput = { deviceId: '', label: '', channel: 0 };

  it('calls back once an input opens, as Firefox only then names every input, without saying so', async () => {
    const changed = vi.fn();
    stop = watchInputs(changed);
    await openInput(defaultInput);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("doesn't call back when an input fails to open", async () => {
    opens = false;
    const changed = vi.fn();
    stop = watchInputs(changed);
    await expect(openInput(defaultInput)).rejects.toThrow();
    expect(changed).not.toHaveBeenCalled();
  });

  it('stops calling back once stopped', async () => {
    const changed = vi.fn();
    watchInputs(changed)();
    await openInput(defaultInput);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('why the Tuner can’t listen', () => {
  afterEach(() => vi.unstubAllGlobals());
  const defaultInput = { deviceId: '', label: '', channel: 0 };

  /** What the Tuner says where opening the Input in a browser of these mediaDevices fails. */
  async function said(mediaDevices: object | undefined): Promise<string> {
    vi.stubGlobal('navigator', { mediaDevices });
    return openInput(defaultInput).then(
      () => 'opened',
      (e) => listenProblem(e),
    );
  }
  const refusing = (name: string) => ({
    getUserMedia: () => Promise.reject(new DOMException('No', name)),
  });

  it('is the insecure site, where the browser offers no microphone', async () => {
    expect(await said(undefined)).toBe(
      'Listening needs a secure connection: open Bandmate over https or on localhost.',
    );
  });

  it('is the microphone denied, as recording says', async () => {
    expect(await said(refusing('NotAllowedError'))).toBe(
      "Bandmate isn't allowed to use the microphone. Allow it in the browser's site settings.",
    );
  });

  it('is no Input to listen on', async () => {
    expect(await said(refusing('NotFoundError'))).toBe(
      "There's no microphone or audio input to listen on. Connect one to tune.",
    );
  });

  it('is what else went wrong, as recording says', async () => {
    expect(await said(refusing('NotReadableError'))).toBe(
      "The audio input is busy or unavailable. Check it isn't in use by another app.",
    );
  });
});
