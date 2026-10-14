import { describe, expect, it } from 'vitest';
import type { SnapshotSummary } from './api';
import { snapshotGroups, snapshotReason, stepSnapshot } from './snapshots';

// A local time, as the Snapshots dialog shows them.
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 13, 18, 30);

describe('why a Snapshot was taken', () => {
  it('says so for one taken before a restore', () => {
    expect(snapshotReason({ reason: 'restoring' })).toBe('Before restoring');
  });

  it('names what was deleted for one taken before a deletion', () => {
    expect(snapshotReason({ reason: 'deleting', deleted: 'Verse 3' })).toBe('Before deleting “Verse 3”');
  });

  it('says a Section was deleted for one with no name', () => {
    expect(snapshotReason({ reason: 'deleting' })).toBe('Before deleting a Section');
  });

  it('says nothing for one taken before an editing session, as most are', () => {
    expect(snapshotReason({ reason: 'editing' })).toBeNull();
  });
});

describe('grouping the Snapshots as they’re thinned', () => {
  const taken = (id: number, takenAt: string): SnapshotSummary => ({ id, takenAt, reason: 'editing', kept: false });
  // A time so many days and minutes before now, whatever the time zone's clock changes.
  const ago = (days: number, minutes = 0) =>
    new Date(now.getTime() - (days * 24 * 60 + minutes) * 60_000).toISOString();

  it('puts the last 24 hours’ first, then the daily ones for a month, then the weekly ones', () => {
    const list = [
      taken(6, ago(0, 5)),
      taken(5, ago(0, 24 * 60 - 1)),
      taken(4, ago(1)),
      taken(3, ago(31, -1)),
      taken(2, ago(31)),
      taken(1, ago(60)),
    ];
    expect(snapshotGroups(list, now)).toEqual([
      {
        name: 'Last 24 hours',
        items: [
          { snapshot: list[0], index: 0 },
          { snapshot: list[1], index: 1 },
        ],
      },
      {
        name: 'Daily, for a month',
        items: [
          { snapshot: list[2], index: 2 },
          { snapshot: list[3], index: 3 },
        ],
      },
      {
        name: 'Weekly, before that',
        items: [
          { snapshot: list[4], index: 4 },
          { snapshot: list[5], index: 5 },
        ],
      },
    ]);
  });

  it('leaves out a group with none', () => {
    const list = [taken(1, ago(70))];
    expect(snapshotGroups(list, now)).toEqual([
      { name: 'Weekly, before that', items: [{ snapshot: list[0], index: 0 }] },
    ]);
  });
});

describe('stepping through the Snapshots', () => {
  it('goes to the older one, down the list, and the newer one, up it', () => {
    expect(stepSnapshot(1, 'older', 3)).toBe(2);
    expect(stepSnapshot(1, 'newer', 3)).toBe(0);
  });

  it('stays at either end', () => {
    expect(stepSnapshot(2, 'older', 3)).toBe(2);
    expect(stepSnapshot(0, 'newer', 3)).toBe(0);
  });
});
