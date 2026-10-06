import { describe, expect, it } from 'vitest';
import { fitTags } from './tagLine';

// Badges 4px apart, and a "+N" badge 24px wide.
const line = (widths: number[], room: number) => fitTags({ widths, room, gap: 4, moreWidth: 24 });

describe('fitTags', () => {
  it('shows every Tag when they all fit', () => {
    expect(line([40, 40, 40], 128)).toBe(3);
  });

  it('shows as many as fit beside the "+N" badge when they don\'t', () => {
    // Two Tags and "+1" take 40 + 4 + 40 + 4 + 24.
    expect(line([40, 40, 40], 127)).toBe(2);
    expect(line([40, 40, 40], 112)).toBe(2);
    expect(line([40, 40, 40], 111)).toBe(1);
  });

  it('always shows the first Tag, to be cut short, however little room there is', () => {
    expect(line([200, 40], 100)).toBe(1);
    expect(line([200], 100)).toBe(1);
    expect(line([40, 40], 0)).toBe(1);
  });

  it('shows none of no Tags', () => {
    expect(line([], 100)).toBe(0);
  });
});
