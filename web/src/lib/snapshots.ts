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

/** A run of the Snapshots, named for how thinned it is, each with its place in the whole list. */
export interface SnapshotGroup {
  name: string;
  items: { snapshot: SnapshotSummary; index: number }[];
}

const dayMs = 24 * 3600 * 1000;
/** The ages at which Bandmate thins Snapshots, as the server's KeepAllFor and KeepDailyFor: a day, then a month. */
const keepAllForMs = dayMs;
const keepDailyForMs = keepAllForMs + 30 * dayMs;

/**
 * A list of Snapshots, newest first, grouped by age as Bandmate thins them: those of the last 24 hours, all kept; then
 * those of the month before, kept one a day; then older ones, kept one a week. A group with none is left out.
 */
export function snapshotGroups(list: SnapshotSummary[], now = new Date()): SnapshotGroup[] {
  const groups: SnapshotGroup[] = [];
  list.forEach((snapshot, index) => {
    const age = now.getTime() - new Date(snapshot.takenAt).getTime();
    const name =
      age < keepAllForMs ? 'Last 24 hours' : age < keepDailyForMs ? 'Daily, for a month' : 'Weekly, before that';
    const last = groups.at(-1);
    if (last?.name === name) last.items.push({ snapshot, index });
    else groups.push({ name, items: [{ snapshot, index }] });
  });
  return groups;
}

/** The Snapshot one older or newer than the one at index, in a list of count, newest first; at either end, it stays. */
export function stepSnapshot(index: number, to: SnapshotStep, count: number): number {
  return Math.max(0, Math.min(count - 1, index + (to === 'older' ? 1 : -1)));
}
