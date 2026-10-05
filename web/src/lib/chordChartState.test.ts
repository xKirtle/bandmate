import { describe, expect, it } from 'vitest';
import { chordChartStateKey, readChordChartState, storeChordChartState } from './chordChartState';

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

describe('readChordChartState', () => {
  it('is shown until set otherwise on this device', () => {
    expect(readChordChartState(storage())).toBe('shown');
  });

  it('is shown without storage, or when it is blocked', () => {
    expect(readChordChartState(undefined)).toBe('shown');
    expect(readChordChartState(storage({}, true))).toBe('shown');
  });

  it('is hidden or pinned once set so', () => {
    expect(readChordChartState(storage({ [chordChartStateKey]: 'hidden' }))).toBe('hidden');
    expect(readChordChartState(storage({ [chordChartStateKey]: 'pinned' }))).toBe('pinned');
  });

  it('is shown when what is kept is not a state', () => {
    expect(readChordChartState(storage({ [chordChartStateKey]: 'sideways' }))).toBe('shown');
  });
});

describe('storeChordChartState', () => {
  it('keeps hiding and pinning', () => {
    const s = storage();
    storeChordChartState(s, 'hidden');
    expect(readChordChartState(s)).toBe('hidden');
    storeChordChartState(s, 'pinned');
    expect(readChordChartState(s)).toBe('pinned');
  });

  it('forgets the choice once shown again', () => {
    const values = { [chordChartStateKey]: 'pinned' };
    storeChordChartState(storage(values), 'shown');
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeChordChartState(undefined, 'hidden')).not.toThrow();
    expect(() => storeChordChartState(storage({}, true), 'hidden')).not.toThrow();
  });
});
