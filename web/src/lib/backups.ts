// How Backups are named and sized on the Backups page.
import type { Backup } from './api';
import { formatSize } from './upload';

// Spelled out rather than left to the locale, which may shorten September
// to "Sept".
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A Backup's automatic name, from the day it was made, where it's shown,
 * and what it holds: "4 Oct 2026 · 3 Songs".
 */
export function backupName(backup: Pick<Backup, 'createdAt' | 'songs'>): string {
  const made = new Date(backup.createdAt);
  const day = `${made.getDate()} ${months[made.getMonth()]} ${made.getFullYear()}`;
  return `${day} · ${songCount(backup.songs)}`;
}

/** "1 Song", "3 Songs". */
export function songCount(n: number): string {
  return `${n} ${n === 1 ? 'Song' : 'Songs'}`;
}

/** A Backup's size: "8 KB" under a megabyte, where "0.0 MB" would say nothing, and "4.2 MB" from there. */
export function backupSize(bytes: number): string {
  return bytes < 1 << 20 ? `${Math.ceil(bytes / 1024)} KB` : formatSize(bytes);
}
