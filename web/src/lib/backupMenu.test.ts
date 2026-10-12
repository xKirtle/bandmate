import Lock from '@lucide/svelte/icons/lock';
import { describe as group, expect, it } from 'vitest';
import { backupActions } from './backupMenu';

group('backupActions', () => {
  const ordinary = { songs: 3, beats: 1, scheduled: false };
  const scheduled = { ...ordinary, scheduled: true };
  const run = { restore: () => {}, keep: () => {}, rename: () => {}, remove: () => {} };
  const labels = (backup: typeof ordinary, wide: boolean) =>
    backupActions(backup, { wide, download: '/api/backups/7/file' }, run).map((a) => a.label);

  it('offers Rename… and Delete… beside Restore and Download, and Restore… and Download in ⋯ on a phone', () => {
    expect(labels(ordinary, true)).toEqual(['Rename…', 'Delete…']);
    expect(labels(ordinary, false)).toEqual(['Restore…', 'Download', 'Rename…', 'Delete…']);
  });

  it('offers Keep, with the lock, for a Scheduled Backup only', () => {
    expect(labels(scheduled, true)).toEqual(['Keep', 'Rename…', 'Delete…']);
    expect(labels(scheduled, false)).toEqual(['Restore…', 'Download', 'Keep', 'Rename…', 'Delete…']);
    const keep = backupActions(scheduled, { wide: true, download: '' }, run)[0];
    expect(keep.icon).toBe(Lock);
    expect(keep.title).toBe('Keep it, so it’s never deleted automatically');
  });

  it('runs Keep', () => {
    let kept = false;
    const keep = backupActions(scheduled, { wide: true, download: '' }, { ...run, keep: () => (kept = true) })[0];
    if ('run' in keep) keep.run();
    expect(kept).toBe(true);
  });

  it('offers no Restore… for a Backup holding nothing to restore', () => {
    expect(labels({ songs: 0, beats: 0, scheduled: false }, false)).toEqual(['Download', 'Rename…', 'Delete…']);
  });

  it('downloads the Backup’s file from Download', () => {
    const download = backupActions(ordinary, { wide: false, download: '/api/backups/7/file' }, run)[1];
    expect(download).toMatchObject({ label: 'Download', download: '/api/backups/7/file' });
  });
});
