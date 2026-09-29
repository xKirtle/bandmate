import { describe as group, expect, it } from 'vitest';
import { pastSlop } from './press';

group('pastSlop', () => {
  const from = { clientX: 100, clientY: 100 };

  it('lets a wobble be', () => {
    expect(pastSlop(from, { clientX: 104, clientY: 96 })).toBe(false);
  });

  it('tells a move along or across, either way', () => {
    expect(pastSlop(from, { clientX: 105, clientY: 100 })).toBe(true);
    expect(pastSlop(from, { clientX: 95, clientY: 100 })).toBe(true);
    expect(pastSlop(from, { clientX: 100, clientY: 94 })).toBe(true);
  });
});
