import { describe, expect, it } from 'vitest';
import type { SnapshotSummary } from './api';
import { snapshotGroups, snapshotReason, snapshotWhen, stepSnapshot } from './snapshots';

// A local time, as the Snapshots dialog shows them.
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 13, 18, 30);

describe('when a Snapshot was taken', () => {
  it('says the time alone for one taken today', () => {
    expect(snapshotWhen(at(2026, 10, 13, 9, 5), now)).toBe('Today, 09:05');
  });

  it('says yesterday for one taken the day before', () => {
    expect(snapshotWhen(at(2026, 10, 12, 23, 59), now)).toBe('Yesterday, 23:59');
  });

  it('says the day for one taken earlier this year', () => {
    expect(snapshotWhen(at(2026, 9, 4, 14, 0), now)).toBe('4 Sep, 14:00');
  });

  it('says the year too for one taken in another', () => {
    expect(snapshotWhen(at(2025, 12, 31, 8, 30), now)).toBe('31 Dec 2025, 08:30');
  });
});

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

  it('puts today’s first, then the daily ones for a month, then the weekly ones', () => {
    const list = [
      taken(5, at(2026, 10, 13, 9, 5)),
      taken(4, at(2026, 10, 13, 0, 10)),
      taken(3, at(2026, 10, 12, 23, 59)),
      taken(2, at(2026, 9, 13, 19, 0)),
      taken(1, at(2026, 9, 1, 12, 0)),
    ];
    expect(snapshotGroups(list, now)).toEqual([
      { name: 'Today', items: [list[0], list[1]] },
      { name: 'Daily, for a month', items: [list[2], list[3]] },
      { name: 'Weekly, before that', items: [list[4]] },
    ]);
  });

  it('leaves out a group with none', () => {
    const list = [taken(1, at(2026, 8, 1, 12, 0))];
    expect(snapshotGroups(list, now)).toEqual([{ name: 'Weekly, before that', items: list }]);
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
