// How the Snapshots dialog names and steps through a Song's Snapshots.
import type { SnapshotSummary } from './api';

/** Which way to step through the Snapshots: down the list, or up it. */
export type SnapshotStep = 'older' | 'newer';

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
