import { describe, expect, it } from 'vitest';
import { trackDrop, tracksDropped } from './trackDrag';

/** What pressing ↑ or ↓ on the Track at `from` gives, `times` times over. */
function pressed(order: number[], from: number, by: -1 | 1, times: number): number[] {
  const next = [...order];
  for (let i = from, n = 0; n < times; i += by, n++) [next[i], next[i + by]] = [next[i + by], next[i]];
  return next;
}

// Four Tracks, 100px tall, one under the other.
const middles = [50, 150, 250, 350];

describe('trackDrop', () => {
  it('is nothing in the gaps either side of the dragged Track', () => {
    expect(trackDrop(1, 120, middles)).toBeNull();
    expect(trackDrop(1, 240, middles)).toBeNull();
  });

  it('moves a Track down into the gap below a later one', () => {
    expect(trackDrop(0, 300, middles)).toEqual({ from: 0, to: 2, gap: 3 });
  });

  it('moves a Track up into the gap above an earlier one', () => {
    expect(trackDrop(3, 20, middles)).toEqual({ from: 3, to: 0, gap: 0 });
  });

  it('moves a Track to the end past the last one, or the start above the first', () => {
    expect(trackDrop(1, 900, middles)).toEqual({ from: 1, to: 3, gap: 4 });
    expect(trackDrop(2, -50, middles)).toEqual({ from: 2, to: 0, gap: 0 });
  });
});

describe('tracksDropped', () => {
  const order = [10, 20, 30, 40];

  it('is the order that many presses of ↓ give', () => {
    expect(tracksDropped(order, { from: 0, to: 3, gap: 4 })).toEqual(pressed(order, 0, 1, 3));
    expect(tracksDropped(order, { from: 1, to: 2, gap: 3 })).toEqual(pressed(order, 1, 1, 1));
  });

  it('is the order that many presses of ↑ give', () => {
    expect(tracksDropped(order, { from: 3, to: 0, gap: 0 })).toEqual(pressed(order, 3, -1, 3));
    expect(tracksDropped(order, { from: 2, to: 1, gap: 1 })).toEqual(pressed(order, 2, -1, 1));
  });
});
