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

const shown = { shown: true, pinned: false };

describe('readChordChartState', () => {
  it('is shown, unpinned, until set otherwise on this device', () => {
    expect(readChordChartState(storage())).toEqual(shown);
  });

  it('is shown, unpinned, without storage, or when it is blocked', () => {
    expect(readChordChartState(undefined)).toEqual(shown);
    expect(readChordChartState(storage({}, true))).toEqual(shown);
  });

  it('reads what the old hidden / shown / pinned choice kept as it was', () => {
    expect(readChordChartState(storage({ [chordChartStateKey]: 'hidden' }))).toEqual({ shown: false, pinned: false });
    expect(readChordChartState(storage({ [chordChartStateKey]: 'pinned' }))).toEqual({ shown: true, pinned: true });
  });

  it('is shown, unpinned, when what is kept is not a state', () => {
    expect(readChordChartState(storage({ [chordChartStateKey]: 'sideways' }))).toEqual(shown);
  });
});

describe('storeChordChartState', () => {
  it('keeps hiding and pinning apart', () => {
    const s = storage();
    for (const state of [
      { shown: false, pinned: false },
      { shown: true, pinned: true },
      { shown: false, pinned: true },
    ]) {
      storeChordChartState(s, state);
      expect(readChordChartState(s)).toEqual(state);
    }
  });

  it('forgets the choice once shown and unpinned again', () => {
    const values = { [chordChartStateKey]: 'hidden-pinned' };
    storeChordChartState(storage(values), shown);
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeChordChartState(undefined, { shown: false, pinned: false })).not.toThrow();
    expect(() => storeChordChartState(storage({}, true), { shown: false, pinned: false })).not.toThrow();
  });
});
