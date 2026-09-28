import { describe, expect, it } from 'vitest';
import { dropGap, moveTo, targetIndex } from './sectionDrag';

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
