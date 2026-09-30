import { describe as group, expect, it } from 'vitest';
import {
  levelsOf,
  mixdownEnd,
  mixdownFormats,
  mixdownName,
  mixdownRanges,
  readMixdownFormat,
  storeMixdownFormat,
} from './mixdown';

const channel = (...samples: number[]) => new Float32Array(samples);

group('levelsOf', () => {
  it('finds a Mixdown with sound below full scale neither clipping nor silent', () => {
    expect(levelsOf([channel(0, 0.5, -0.99), channel(0.25, 0, 0)])).toEqual({ clips: false, silent: false });
  });

  it('finds it clipping where any sample in either channel reaches full scale', () => {
    expect(levelsOf([channel(0, 1, 0), channel(0, 0, 0)])).toEqual({ clips: true, silent: false });
    expect(levelsOf([channel(0, 0, 0), channel(0, -1, 0)])).toEqual({ clips: true, silent: false });
    expect(levelsOf([channel(0, 0, 0), channel(0, 0, 1.7)])).toEqual({ clips: true, silent: false });
  });

  it('finds it clipping where a sample only rounds to full scale in the file', () => {
    // 24-bit's largest sample is 1 − 2⁻²³: halfway to it rounds up to it.
    expect(levelsOf([channel(1 - 2 ** -24), channel(0)])).toEqual({ clips: true, silent: false });
    expect(levelsOf([channel(1 - 2 ** -22), channel(0)])).toEqual({ clips: false, silent: false });
  });

  it('finds it clipping where a sample rounds to full scale at 16 bits', () => {
    // 16-bit's largest sample is 1 − 2⁻¹⁵: halfway to it rounds up to it.
    expect(levelsOf([channel(1 - 2 ** -16), channel(0)], 16)).toEqual({ clips: true, silent: false });
    expect(levelsOf([channel(1 - 2 ** -14), channel(0)], 16)).toEqual({ clips: false, silent: false });
  });

  it('finds it silent where every sample is zero', () => {
    expect(levelsOf([channel(0, 0, 0), channel(0, 0, 0)])).toEqual({ clips: false, silent: true });
  });

  it('finds even the faintest sound not silent', () => {
    expect(levelsOf([channel(0, 0, 0), channel(0, 1e-7, 0)])).toEqual({ clips: false, silent: false });
  });
});

group('mixdownEnd', () => {
  it('ends where the last Clip ends, whichever Track it is on', () => {
    const clips = [
      { start: 0, offset: 0, length: 30 },
      { start: 12, offset: 4, length: 25.5 },
      { start: 20, offset: 0, length: 5 },
    ];
    expect(mixdownEnd(clips)).toBe(37.5);
  });

  it('is 0 without Clips', () => {
    expect(mixdownEnd([])).toBe(0);
  });
});

group('mixdownRanges', () => {
  const whole = { of: 'timeline', start: 0, end: 37.5 };

  it('offers only the whole Timeline without a Loop', () => {
    expect(mixdownRanges(37.5, null)).toEqual({ ranges: [whole], chosen: whole });
  });

  it("offers the Loop's stretch too, and chooses it while the Loop is on", () => {
    const loop = { of: 'loop', start: 32, end: 48 };
    expect(mixdownRanges(37.5, { start: 32, end: 48, on: true })).toEqual({ ranges: [whole, loop], chosen: loop });
  });

  it("still offers the Loop's stretch while it's off, choosing the whole Timeline", () => {
    const loop = { of: 'loop', start: 32, end: 48 };
    expect(mixdownRanges(37.5, { start: 32, end: 48, on: false })).toEqual({ ranges: [whole, loop], chosen: whole });
  });
});

group('mixdownName', () => {
  const [wav24, , mp3] = mixdownFormats;

  it("names the whole Timeline's file after the Song", () => {
    expect(mixdownName('Midnight Drive', { of: 'timeline', start: 0, end: 37.5 }, wav24)).toBe(
      'Midnight Drive - Mixdown.wav',
    );
  });

  it("adds the Loop's times to the file of its stretch", () => {
    expect(mixdownName('Midnight Drive', { of: 'loop', start: 32, end: 48 }, wav24)).toBe(
      'Midnight Drive - Mixdown (0m32s-0m48s).wav',
    );
    expect(mixdownName('Midnight Drive', { of: 'loop', start: 65.4, end: 130.6 }, wav24)).toBe(
      'Midnight Drive - Mixdown (1m05s-2m11s).wav',
    );
  });

  it("ends in the format's extension", () => {
    expect(mixdownName('Midnight Drive', { of: 'timeline', start: 0, end: 37.5 }, mp3)).toBe(
      'Midnight Drive - Mixdown.mp3',
    );
    expect(mixdownName('Midnight Drive', { of: 'loop', start: 32, end: 48 }, mp3)).toBe(
      'Midnight Drive - Mixdown (0m32s-0m48s).mp3',
    );
  });
});

group('mixdownFormats', () => {
  it('offers the five presets, WAV · 24-bit first', () => {
    expect(mixdownFormats.map((f) => f.label)).toEqual([
      'WAV · 24-bit',
      'WAV · 16-bit',
      'MP3 · 320 kbps',
      'MP3 · 192 kbps',
      'MP3 · 128 kbps',
    ]);
  });
});

group('readMixdownFormat and storeMixdownFormat', () => {
  /** A Storage kept in memory, as localStorage would be. */
  function memoryStorage(): Storage {
    const items = new Map<string, string>();
    return {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: (key) => items.get(key) ?? null,
      key: (i) => [...items.keys()][i] ?? null,
      removeItem: (key) => void items.delete(key),
      setItem: (key, value) => void items.set(key, value),
    };
  }

  it('picks WAV · 24-bit until a format has been picked', () => {
    expect(readMixdownFormat(memoryStorage()).label).toBe('WAV · 24-bit');
    expect(readMixdownFormat(undefined).label).toBe('WAV · 24-bit');
  });

  it('remembers the last format picked', () => {
    const storage = memoryStorage();
    storeMixdownFormat(storage, mixdownFormats[1]);
    storeMixdownFormat(storage, mixdownFormats[3]);
    expect(readMixdownFormat(storage)).toBe(mixdownFormats[3]);
  });

  it('falls back to WAV · 24-bit for a format it no longer offers', () => {
    const storage = memoryStorage();
    storeMixdownFormat(storage, mixdownFormats[4]);
    storage.setItem(storage.key(0)!, 'ogg-96');
    expect(readMixdownFormat(storage).label).toBe('WAV · 24-bit');
  });

  it("gets by where the browser won't keep anything", () => {
    const refusing = {
      ...memoryStorage(),
      setItem: () => {
        throw new DOMException('Quota exceeded');
      },
      getItem: () => {
        throw new DOMException('Denied');
      },
    };
    expect(() => storeMixdownFormat(refusing, mixdownFormats[2])).not.toThrow();
    expect(readMixdownFormat(refusing).label).toBe('WAV · 24-bit');
  });
});
