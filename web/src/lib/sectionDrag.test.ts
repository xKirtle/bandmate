import { describe, expect, it } from 'vitest';
import { dropFor, dropGap, dropTarget, moveTo, targetIndex } from './sectionDrag';

/** What pressing ↑ or ↓ on the Section at `from` gives, `times` times over. */
function pressed(order: number[], from: number, by: -1 | 1, times: number): number[] {
  const next = [...order];
  for (let i = from, n = 0; n < times; i += by, n++) [next[i], next[i + by]] = [next[i + by], next[i]];
  return next;
}

describe('dropGap', () => {
  // Four Sections, 100px tall, one under the other.
  const middles = [50, 150, 250, 350];

  it('is the first gap above the first Section’s middle', () => {
    expect(dropGap(-20, middles)).toBe(0);
    expect(dropGap(49, middles)).toBe(0);
  });

  it('is the last gap below the last Section’s middle', () => {
    expect(dropGap(351, middles)).toBe(4);
    expect(dropGap(900, middles)).toBe(4);
  });

  it('is the gap between the two middles the pointer is between', () => {
    expect(dropGap(151, middles)).toBe(2);
    expect(dropGap(249, middles)).toBe(2);
  });
});

describe('targetIndex', () => {
  it('leaves a Section in place dropped just above or below itself', () => {
    expect(targetIndex(2, 2)).toBe(2);
    expect(targetIndex(2, 3)).toBe(2);
  });

  it('moves a Section to the top', () => {
    expect(targetIndex(3, 0)).toBe(0);
  });

  it('moves a Section to the bottom', () => {
    expect(targetIndex(0, 5)).toBe(4);
  });

  it('moves a Section past several others', () => {
    expect(targetIndex(1, 4)).toBe(3);
    expect(targetIndex(4, 1)).toBe(1);
  });
});

describe('moveTo', () => {
  const order = [10, 11, 12, 13, 14];

  it('changes nothing moving a Section to where it is', () => {
    expect(moveTo(order, 2, 2)).toEqual(order);
  });

  it('gives what ↑ pressed up to the first place gives', () => {
    expect(moveTo(order, 3, 0)).toEqual(pressed(order, 3, -1, 3));
    expect(moveTo(order, 3, 0)).toEqual([13, 10, 11, 12, 14]);
  });

  it('gives what ↓ pressed down to the last place gives', () => {
    expect(moveTo(order, 0, 4)).toEqual(pressed(order, 0, 1, 4));
    expect(moveTo(order, 0, 4)).toEqual([11, 12, 13, 14, 10]);
  });

  it('gives what ↑ or ↓ gives moving past several Sections', () => {
    for (let from = 0; from < order.length; from++) {
      for (let to = 0; to < order.length; to++) {
        const by = to < from ? -1 : 1;
        expect(moveTo(order, from, to)).toEqual(pressed(order, from, by, Math.abs(to - from)));
      }
    }
  });

  it('leaves the order it was given as it was', () => {
    const given = [...order];
    moveTo(given, 0, 3);
    expect(given).toEqual(order);
  });
});

describe('dropTarget', () => {
  const middles = [50, 150, 250];
  // The Arrangement, and the Scrapbook in a column to the right of it.
  const sheet = { left: 100, right: 800, top: 0, bottom: 300 };
  const scrapbook = { left: 900, right: 1200, top: 0, bottom: 400 };

  it('is the Scrapbook with the pointer over it', () => {
    expect(dropTarget({ x: 1000, y: 120 }, scrapbook, sheet, middles)).toEqual({ scrapbook: true });
    expect(dropTarget({ x: 900, y: 400 }, scrapbook, sheet, middles)).toEqual({ scrapbook: true });
  });

  it('is the gap in the Arrangement the pointer is at in its column', () => {
    expect(dropTarget({ x: 400, y: 120 }, scrapbook, sheet, middles)).toEqual({ gap: 1 });
  });

  it('is the first or last gap with the pointer above or below the Arrangement', () => {
    expect(dropTarget({ x: 400, y: -80 }, scrapbook, sheet, middles)).toEqual({ gap: 0 });
    expect(dropTarget({ x: 400, y: 900 }, scrapbook, sheet, middles)).toEqual({ gap: 3 });
  });

  it('is nowhere beside both, e.g. over the Masters below the Scrapbook', () => {
    expect(dropTarget({ x: 1000, y: 500 }, scrapbook, sheet, middles)).toBeNull();
    expect(dropTarget({ x: 20, y: 120 }, scrapbook, sheet, middles)).toBeNull();
  });

  it('is a gap without a Scrapbook to drop on', () => {
    expect(dropTarget({ x: 400, y: 120 }, null, sheet, middles)).toEqual({ gap: 1 });
  });

  it('is the only gap in an empty Arrangement', () => {
    expect(dropTarget({ x: 400, y: 120 }, scrapbook, sheet, [])).toEqual({ gap: 0 });
  });
});

describe('dropFor', () => {
  it('moves an Occurrence dropped into another gap in the Arrangement', () => {
    expect(dropFor({ occurrenceAt: 1 }, { gap: 4 })).toEqual({ reorder: { from: 1, to: 3 }, gap: 4 });
  });

  it('does nothing with an Occurrence dropped just above or below itself', () => {
    expect(dropFor({ occurrenceAt: 2 }, { gap: 2 })).toBeNull();
    expect(dropFor({ occurrenceAt: 2 }, { gap: 3 })).toBeNull();
  });

  it('moves an Occurrence dropped on the Scrapbook there', () => {
    expect(dropFor({ occurrenceAt: 2 }, { scrapbook: true })).toEqual({ toScrapbook: 2 });
  });

  it('puts a Scrapbook Section dropped into a gap back there', () => {
    expect(dropFor({ section: 7 }, { gap: 0 })).toEqual({ putBack: 7, gap: 0 });
    expect(dropFor({ section: 7 }, { gap: 3 })).toEqual({ putBack: 7, gap: 3 });
  });

  it('does nothing with a Scrapbook Section dropped on the Scrapbook', () => {
    expect(dropFor({ section: 7 }, { scrapbook: true })).toBeNull();
  });

  it('does nothing dropped nowhere', () => {
    expect(dropFor({ occurrenceAt: 2 }, null)).toBeNull();
    expect(dropFor({ section: 7 }, null)).toBeNull();
  });
});
