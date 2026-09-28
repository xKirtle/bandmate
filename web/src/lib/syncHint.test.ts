import { describe, expect, it } from 'vitest';
import { hintKey, markHintSeen, sawHint } from './syncHint';

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

describe('sawHint', () => {
  it('is false until the hint has been seen', () => {
    expect(sawHint(storage())).toBe(false);
  });

  it('is true once it has been seen', () => {
    expect(sawHint(storage({ [hintKey]: '1' }))).toBe(true);
  });

  it('is false without storage, or when it is blocked', () => {
    expect(sawHint(undefined)).toBe(false);
    expect(sawHint(storage({ [hintKey]: '1' }, true))).toBe(false);
  });
});

describe('markHintSeen', () => {
  it('remembers the hint was seen', () => {
    const s = storage();
    markHintSeen(s);
    expect(sawHint(s)).toBe(true);
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => markHintSeen(undefined)).not.toThrow();
    expect(() => markHintSeen(storage({}, true))).not.toThrow();
  });
});
