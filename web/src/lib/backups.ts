// How Backups are named and sized on the Backups page.
import type { Backup, BackupPresent } from './api';
import { formatSize } from './upload';

// Spelled out rather than left to the locale, which may shorten September
// to "Sept".
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A Backup's name: the one of its own it was given, or else the automatic one. */
export function backupName(backup: Pick<Backup, 'createdAt' | 'name'> & Contents): string {
  return backup.name || automaticName(backup);
}

/**
 * A Backup's automatic name, from the day it was made, where it's shown,
 * and what it holds: "4 Oct 2026 · 3 Songs", "4 Oct 2026 · Everything".
 */
export function automaticName(backup: Pick<Backup, 'createdAt'> & Contents): string {
  const made = new Date(backup.createdAt);
  const day = `${made.getDate()} ${months[made.getMonth()]} ${made.getFullYear()}`;
  return `${day} · ${contentsName(backup)}`;
}

/** What a Backup holds: how many Songs, whether they're all of them, and whether the Beat Library. */
type Contents = Pick<Backup, 'songs'> & Partial<Pick<Backup, 'allSongs' | 'beatLibrary'>>;

/** What a Backup holds, in a few words: "3 Songs", "Beat Library", "2 Songs + Beat Library", "Everything". */
export function contentsName({ songs, allSongs, beatLibrary }: Contents): string {
  if (!beatLibrary) return songCount(songs);
  if (allSongs) return 'Everything';
  return songs === 0 ? 'Beat Library' : `${songCount(songs)} + Beat Library`;
}

/** "1 Song", "3 Songs". */
export function songCount(n: number): string {
  return `${n} ${n === 1 ? 'Song' : 'Songs'}`;
}

/** "1 Beat", "3 Beats". */
function beatCount(n: number): string {
  return `${n} ${n === 1 ? 'Beat' : 'Beats'}`;
}

/**
 * The confirmation a Restore asks for before replacing Songs and Beats,
 * naming each as it's called in Bandmate, since that's the one lost.
 */
export function replaceConfirmation(songs: BackupPresent[], beats: BackupPresent[]): string {
  const counts = [songs.length && songCount(songs.length), beats.length && beatCount(beats.length)].filter(Boolean);
  const one = songs.length + beats.length === 1;
  const named = [
    ...songs.map((s) => `Song: ${s.inBandmate.title}`),
    ...beats.map((b) => `Beat: ${b.inBandmate.title}`),
  ];
  const lost = [
    songs.length > 0 && 'A Song replaced loses whatever it has now that the Backup’s version doesn’t.',
    beats.length > 0 && 'A Beat replaced takes the Backup’s title and credit in every Song using it.',
  ].filter(Boolean);
  return (
    `Replace ${counts.join(' and ')} with the Backup’s ${one ? 'version' : 'versions'}?\n\n${named.join('\n')}\n\n` +
    `${lost.join(' ')} This can’t be undone.`
  );
}

/** A Backup's size: "8 KB" under a megabyte, where "0.0 MB" would say nothing, and "4.2 MB" from there. */
export function backupSize(bytes: number): string {
  return bytes < 1 << 20 ? `${Math.ceil(bytes / 1024)} KB` : formatSize(bytes);
}
