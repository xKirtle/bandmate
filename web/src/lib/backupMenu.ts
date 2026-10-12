import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
import Download from '@lucide/svelte/icons/download';
import Lock from '@lucide/svelte/icons/lock';
import Pencil from '@lucide/svelte/icons/pencil';
import Trash2 from '@lucide/svelte/icons/trash-2';
import type { Backup } from './api';
import { restorable } from './backups';
import type { MenuAction } from './menu';

// A Backup's ⋯ in Settings' Backups tab. Wider than a phone, its Restore
// and Download are buttons beside the ⋯; on a phone they fold into it.
// A Scheduled Backup's also offers Keep, which makes it an ordinary Backup
// the schedule never deletes.

/** What each of a Backup's actions does. */
export type BackupRun = {
  /** Opens Restore, to pick what to bring back from it. */
  restore: () => void;
  /** Keeps a Scheduled Backup, making it ordinary. */
  keep: () => void;
  /** Opens Rename. */
  rename: () => void;
  /** Deletes it, after asking. */
  remove: () => void;
};

/**
 * A Backup's ⋯: Keep, for a Scheduled Backup, then Rename… and Delete…,
 * after Restore…, when it holds anything to restore, and Download (from
 * `download`) on a phone, where they aren't buttons beside it.
 */
export function backupActions(
  backup: Pick<Backup, 'songs' | 'beats' | 'scheduled'>,
  { wide, download }: { wide: boolean; download: string },
  run: BackupRun,
): MenuAction[] {
  const actions: MenuAction[] = [];
  if (!wide) {
    if (restorable(backup)) actions.push({ icon: ArchiveRestore, label: 'Restore…', run: run.restore });
    actions.push({ icon: Download, label: 'Download', download });
  }
  if (backup.scheduled) {
    actions.push({ icon: Lock, label: 'Keep', title: 'Keep it, so it’s never deleted automatically', run: run.keep });
  }
  actions.push(
    { icon: Pencil, label: 'Rename…', run: run.rename },
    { icon: Trash2, label: 'Delete…', run: run.remove },
  );
  return actions;
}
