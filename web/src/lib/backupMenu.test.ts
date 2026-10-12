import Lock from '@lucide/svelte/icons/lock';
import { describe as group, expect, it } from 'vitest';
import { backupActions } from './backupMenu';

group('backupActions', () => {
  const ordinary = { songs: 3, beats: 1, scheduled: false };
  const scheduled = { ...ordinary, scheduled: true };
  const run = { restore: () => {}, keep: () => {}, rename: () => {}, remove: () => {} };
  const labels = (backup: typeof ordinary, wide: boolean) =>
    backupActions(backup, { wide, download: '/api/backups/7/file' }, run).map((a) => a.label);
  /** The action labelled `label` in a Backup's ⋯. */
  const action = (label: string, backup: typeof ordinary, wide: boolean, runs = run) =>
    backupActions(backup, { wide, download: '/api/backups/7/file' }, runs).find((a) => a.label === label);

  it('offers Rename… and Delete… beside Restore and Download, and Restore… and Download in ⋯ on a phone', () => {
    expect(labels(ordinary, true)).toEqual(['Rename…', 'Delete…']);
    expect(labels(ordinary, false)).toEqual(['Restore…', 'Download', 'Rename…', 'Delete…']);
  });

  it('offers Keep, with the lock, for a Scheduled Backup only', () => {
    expect(labels(scheduled, true)).toEqual(['Keep', 'Rename…', 'Delete…']);
    expect(labels(scheduled, false)).toEqual(['Restore…', 'Download', 'Keep', 'Rename…', 'Delete…']);
    expect(action('Keep', scheduled, true)).toMatchObject({
      icon: Lock,
      title: 'Keep it, so it’s never deleted automatically',
    });
  });

  it('runs Keep', () => {
    let kept = false;
    const keep = action('Keep', scheduled, true, { ...run, keep: () => (kept = true) });
    if (keep && 'run' in keep) keep.run();
    expect(kept).toBe(true);
  });

  it('offers no Restore… for a Backup holding nothing to restore', () => {
    expect(labels({ songs: 0, beats: 0, scheduled: false }, false)).toEqual(['Download', 'Rename…', 'Delete…']);
  });

  it('downloads the Backup’s file from Download', () => {
    expect(action('Download', ordinary, false)).toMatchObject({ download: '/api/backups/7/file' });
  });
});
