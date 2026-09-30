import { describe, expect, it } from 'vitest';
import {
  clampHeight,
  defaultHeight,
  grownHeight,
  heightBounds,
  heightKey,
  readHeight,
  storeHeight,
} from './timelineHeight';

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
  it('is 40% of the window, the most the area grows to fit its Tracks', () => {
    expect(defaultHeight(1000)).toBe(400);
  });
});

describe('grownHeight', () => {
  // A 1000px window: the area grows to fit its Tracks up to 400px, and is
  // dragged up to 850px. Each Track here is 80px tall.

  it('fits the Tracks once they are known, from a height dragged one Track tall', () => {
    expect(grownHeight(80, 0, 240, 1000)).toBe(240);
  });

  it('fits the Tracks only up to 40% of the window', () => {
    expect(grownHeight(80, 0, 800, 1000)).toBe(400);
  });

  it('keeps a dragged height taller than the Tracks need to fit', () => {
    expect(grownHeight(600, 0, 240, 1000)).toBe(600);
  });

  it('grows with an added Track while every Track shows', () => {
    expect(grownHeight(160, 160, 240, 1000)).toBe(240);
  });

  it('grows with an added Track only up to 40% of the window', () => {
    expect(grownHeight(400, 400, 480, 1000)).toBe(400);
  });

  it('keeps a height taller than the Tracks, dragged when there were more, as it grows', () => {
    expect(grownHeight(320, 160, 240, 1000)).toBe(320);
  });

  it('leaves the height as it is when an added Track joins a scrolling area', () => {
    expect(grownHeight(80, 240, 320, 1000)).toBe(80);
  });

  it('leaves the height as it is when the Tracks outgrew the most it can be', () => {
    expect(grownHeight(900, 1200, 1280, 1000)).toBe(900);
  });

  it('leaves the height as it is when a Track is removed', () => {
    expect(grownHeight(240, 240, 160, 1000)).toBe(240);
  });

  it('leaves the height as it is while the Tracks are unknown, e.g. hidden', () => {
    expect(grownHeight(80, 240, 0, 1000)).toBe(80);
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
