import { describe, expect, it } from 'vitest';
import { clampHeight, defaultHeight, heightBounds, heightKey, readHeight, storeHeight } from './timelineHeight';

/** A Storage holding some values, or one that throws like a blocked one. */
function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
    removeItem: (key: string) => (blocked ? fail() : void delete values[key]),
  } as Storage;
}

describe('defaultHeight', () => {
  it('is 40% of the window', () => {
    expect(defaultHeight(1000)).toBe(400);
  });
});

describe('heightBounds', () => {
  it('is from one Track and the ruler to 85% of the window', () => {
    expect(heightBounds(1000, 92, 2000)).toEqual({ min: 92, max: 850 });
  });

  it('goes no taller than the Tracks need', () => {
    expect(heightBounds(1000, 92, 300)).toEqual({ min: 92, max: 300 });
  });

  it('ignores what the Tracks need until it is known', () => {
    expect(heightBounds(1000, 92, 0)).toEqual({ min: 92, max: 850 });
  });

  it('keeps one Track and the ruler in a window too short for them', () => {
    expect(heightBounds(100, 92, 2000)).toEqual({ min: 92, max: 92 });
  });
});

describe('clampHeight', () => {
  const bounds = { min: 92, max: 850 };

  it('keeps a height within the bounds', () => {
    expect(clampHeight(500, bounds)).toBe(500);
  });

  it('raises a height below the least', () => {
    expect(clampHeight(10, bounds)).toBe(92);
  });

  it('lowers a height above the most', () => {
    expect(clampHeight(2000, bounds)).toBe(850);
  });
});

describe('readHeight', () => {
  it('is the stored height', () => {
    expect(readHeight(storage({ [heightKey]: '480' }))).toBe(480);
  });

  it('is null when none is stored', () => {
    expect(readHeight(storage())).toBeNull();
  });

  it.each(['', 'tall', '-5', '0', 'Infinity'])('is null for a stored %j', (value) => {
    expect(readHeight(storage({ [heightKey]: value }))).toBeNull();
  });

  it('is null without storage, or when it is blocked', () => {
    expect(readHeight(undefined)).toBeNull();
    expect(readHeight(storage({}, true))).toBeNull();
  });
});

describe('storeHeight', () => {
  it('stores a height to be read back', () => {
    const s = storage();
    storeHeight(s, 480);
    expect(readHeight(s)).toBe(480);
  });

  it('forgets the height when set back to the default', () => {
    const s = storage({ [heightKey]: '480' });
    storeHeight(s, null);
    expect(readHeight(s)).toBeNull();
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeHeight(undefined, 480)).not.toThrow();
    expect(() => storeHeight(storage({}, true), 480)).not.toThrow();
  });
});
