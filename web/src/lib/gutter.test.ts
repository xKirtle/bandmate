import { describe, expect, it } from 'vitest';
import { rowAt } from './gutter';

describe('rowAt', () => {
  const rows = [
    { top: 10, bottom: 30 },
    { top: 30, bottom: 50 },
    { top: 50, bottom: 90 },
  ];

  it('finds the row a height is in', () => {
    expect(rowAt(rows, 10)).toBe(0);
    expect(rowAt(rows, 45)).toBe(1);
    expect(rowAt(rows, 89.5)).toBe(2);
  });

  it('puts a height on the border between two rows in the lower one', () => {
    expect(rowAt(rows, 30)).toBe(1);
  });

  it('answers null above or below the rows', () => {
    expect(rowAt(rows, 9)).toBeNull();
    expect(rowAt(rows, 90)).toBeNull();
    expect(rowAt([], 20)).toBeNull();
  });
});
