// How the Snapshots dialog names and steps through a Song's Snapshots.
import type { SnapshotSummary } from './api';
import { shortMonths } from './time';

/** Which way to step through the Snapshots: down the list, or up it. */
export type SnapshotStep = 'older' | 'newer';

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * When a Snapshot was taken, to the minute, in local time: "Today, 09:05",
 * "Yesterday, 23:59", "4 Sep, 14:00", or "31 Dec 2025, 08:30" in another year.
 */
export function snapshotWhen(takenAt: string, now = new Date()): string {
  const taken = new Date(takenAt);
  const time = `${String(taken.getHours()).padStart(2, '0')}:${String(taken.getMinutes()).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(taken, now)) return `Today, ${time}`;
  if (sameDay(taken, yesterday)) return `Yesterday, ${time}`;
  const year = taken.getFullYear() === now.getFullYear() ? '' : ` ${taken.getFullYear()}`;
  return `${taken.getDate()} ${shortMonths[taken.getMonth()]}${year}, ${time}`;
}

/** Why a Snapshot was taken, where that's worth saying: not before an editing session, as most are. */
export function snapshotReason({ reason, deleted }: Pick<SnapshotSummary, 'reason' | 'deleted'>): string | null {
  // Only a Section with no Label and no words has no name.
  if (reason === 'deleting') return deleted ? `Before deleting “${deleted}”` : 'Before deleting a Section';
  return reason === 'restoring' ? 'Before restoring' : null;
}

/** A run of the Snapshots, named for how thinned it is. */
export interface SnapshotGroup {
  name: string;
  items: SnapshotSummary[];
}

const dayMs = 24 * 3600 * 1000;
/** How old a Snapshot gets before only the newest of each week is kept, as the server thins them: a day, then a month. */
const weeklyAfterMs = 31 * dayMs;

/**
 * A list of Snapshots, newest first, grouped as Bandmate thins them: today's, then those of the month before, kept one a
 * day, then older ones, kept one a week. A group with none is left out.
 */
export function snapshotGroups(list: SnapshotSummary[], now = new Date()): SnapshotGroup[] {
  const groups: SnapshotGroup[] = [];
  for (const s of list) {
    const taken = new Date(s.takenAt);
    const name = sameDay(taken, now)
      ? 'Today'
      : now.getTime() - taken.getTime() < weeklyAfterMs
        ? 'Daily, for a month'
        : 'Weekly, before that';
    const last = groups.at(-1);
    if (last?.name === name) last.items.push(s);
    else groups.push({ name, items: [s] });
  }
  return groups;
}

/** The Snapshot one older or newer than the one at index, in a list of count, newest first; at either end, it stays. */
export function stepSnapshot(index: number, to: SnapshotStep, count: number): number {
  return Math.max(0, Math.min(count - 1, index + (to === 'older' ? 1 : -1)));
}
