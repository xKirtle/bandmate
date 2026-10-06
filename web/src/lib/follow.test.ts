import { describe, expect, it } from 'vitest';
import { topLine } from './follow';

describe('topLine', () => {
  // The Lines' edges, from the top of the window: 40px tall each, the first starting at 100.
  const lines = [100, 140, 180, 220].map((top) => ({ top, bottom: top + 40 }));

  it('is the first Line, while the view is above the Lines', () => {
    expect(topLine(lines, 0)).toBe(0);
  });

  it('is the first Line at least half showing', () => {
    expect(topLine(lines, 180)).toBe(2);
    expect(topLine(lines, 200)).toBe(2);
    expect(topLine(lines, 201)).toBe(3);
  });

  it('is none once every Line is more than half above the view, or there are none', () => {
    expect(topLine(lines, 241)).toBe(-1);
    expect(topLine([], 0)).toBe(-1);
  });
});
