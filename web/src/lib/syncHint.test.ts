import { describe, expect, it } from 'vitest';
import { storage } from './storageFake';
import { markSyncHintSeen, sawSyncHint, syncHintKey } from './syncHint';

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
