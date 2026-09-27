import { describe, expect, it } from 'vitest';
import { defaultVolume, gain, loudness, readVolume, setLevel, storeVolume, toggleMute, volumeKey } from './volume';

/** A Storage holding some values, or one that throws like a blocked one. */
function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
  } as Storage;
}

describe('setLevel', () => {
  it('unmutes anywhere above silence', () => {
    expect(setLevel(0.3)).toEqual({ level: 0.3, muted: false });
  });

  it('counts all the way down as muted', () => {
    expect(setLevel(0)).toEqual({ level: 0, muted: true });
  });

  it('keeps the level from 0 to 1', () => {
    expect(setLevel(1.5)).toEqual({ level: 1, muted: false });
    expect(setLevel(-1)).toEqual({ level: 0, muted: true });
  });
});

describe('toggleMute', () => {
  it('mutes, keeping the level', () => {
    expect(toggleMute({ level: 0.7, muted: false })).toEqual({ level: 0.7, muted: true });
  });

  it('unmutes back to the level before', () => {
    expect(toggleMute({ level: 0.7, muted: true })).toEqual({ level: 0.7, muted: false });
  });

  it('unmutes to half from silence', () => {
    expect(toggleMute(setLevel(0))).toEqual({ level: 0.5, muted: false });
  });
});

describe('gain', () => {
  it('squares the slider position', () => {
    expect(gain(0.5)).toBe(0.25);
    expect(gain(1)).toBe(1);
    expect(gain(0)).toBe(0);
  });
});

describe('loudness', () => {
  it('follows mute and the level', () => {
    expect(loudness({ level: 0.8, muted: true })).toBe('muted');
    expect(loudness({ level: 0, muted: false })).toBe('muted');
    expect(loudness({ level: 0.3, muted: false })).toBe('low');
    expect(loudness({ level: 0.5, muted: false })).toBe('high');
  });
});

describe('readVolume and storeVolume', () => {
  it('reads back what was kept', () => {
    const s = storage();
    storeVolume(s, { level: 0.4, muted: true });
    expect(readVolume(s)).toEqual({ level: 0.4, muted: true });
  });

  it('is the default with nothing kept', () => {
    expect(readVolume(storage())).toEqual(defaultVolume);
    expect(readVolume(undefined)).toEqual(defaultVolume);
  });

  it('is the default for anything unreadable', () => {
    expect(readVolume(storage({ [volumeKey]: 'loud' }))).toEqual(defaultVolume);
    expect(readVolume(storage({ [volumeKey]: '{"level":2}' }))).toEqual(defaultVolume);
    expect(readVolume(storage({ [volumeKey]: '{"muted":true}' }))).toEqual(defaultVolume);
  });

  it('ignores blocked storage', () => {
    const s = storage({}, true);
    expect(() => storeVolume(s, { level: 0.4, muted: false })).not.toThrow();
    expect(readVolume(s)).toEqual(defaultVolume);
  });
});
