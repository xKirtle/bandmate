import { describe, expect, it } from 'vitest';
import { markSyncHintSeen, sawSyncHint, syncHintKey } from './syncHint';

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

describe('sawSyncHint', () => {
  it('is false until the hint has been seen', () => {
    expect(sawSyncHint(storage())).toBe(false);
  });

  it('is true once it has been seen', () => {
    expect(sawSyncHint(storage({ [syncHintKey]: '1' }))).toBe(true);
  });

  it('is false without storage, or when it is blocked', () => {
    expect(sawSyncHint(undefined)).toBe(false);
    expect(sawSyncHint(storage({ [syncHintKey]: '1' }, true))).toBe(false);
  });
});

describe('markSyncHintSeen', () => {
  it('remembers the hint was seen', () => {
    const s = storage();
    markSyncHintSeen(s);
    expect(sawSyncHint(s)).toBe(true);
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => markSyncHintSeen(undefined)).not.toThrow();
    expect(() => markSyncHintSeen(storage({}, true))).not.toThrow();
  });
});
