// How Backups are named, sized and asked for on the Backups page.
import type { Backup, BackupContents, BackupPresent } from './api';
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

/**
 * What a Backup holds: how many Songs, whether they're all of them, how many
 * Beats, with those its Songs bring, and whether they're the Beat Library.
 */
type Contents = Pick<Backup, 'songs'> & Partial<Pick<Backup, 'allSongs' | 'beats' | 'beatLibrary'>>;

/**
 * What a Backup holds, in a few words: "3 Songs", "2 Songs + 4 Beats",
 * "Beat Library", "2 Songs + Beat Library", "Everything".
 */
export function contentsName({ songs, allSongs, beats = 0, beatLibrary }: Contents): string {
  if (beatLibrary) {
    if (allSongs) return 'Everything';
    return songs === 0 ? 'Beat Library' : `${songCount(songs)} + Beat Library`;
  }
  if (beats === 0) return songCount(songs);
  return songs === 0 ? beatCount(beats) : `${songCount(songs)} + ${beatCount(beats)}`;
}

/** What's ticked in "New Backup": Songs and which of them are picked, and the Beat Library and which Beats are. */
export interface NewBackupTicks {
  songsTicked: boolean;
  /** The Songs picked, by id, kept while Songs is unticked for when it's ticked again. */
  picked: ReadonlySet<number>;
  /** Whether the Beat Library is ticked, to pick Beats from it. */
  beatsTicked: boolean;
  /**
   * The Beats picked, by id, kept while the Beat Library is unticked. A Beat
   * a picked Song uses is picked whatever its own tick, which comes back
   * once no picked Song uses it.
   */
  pickedBeats: ReadonlySet<number>;
}

/** A Beat there is to back up, with the Songs using it. */
export interface BackupSourceBeat {
  id: number;
  songs: readonly { id: number }[];
}

/** What there is to back up: every Song, by id, and every Beat. */
export interface BackupSource {
  songIds: readonly number[];
  beats: readonly BackupSourceBeat[];
}

/**
 * A Backup "New Backup" can ask for, with its name, or what's missing
 * before one can be made, as a short hint.
 */
export type NewBackup = { contents: BackupContents; name: string } | { missing: string };

/** The Beats, by id, that the Songs picked bring: those their Clips use. */
export function beatsBrought(songs: readonly number[], beats: readonly BackupSourceBeat[]): Set<number> {
  return new Set(beats.filter((b) => b.songs.some((s) => songs.includes(s.id))).map((b) => b.id));
}

/** How many Beats the picked Songs bring, said under them: "Brings the 3 Beats they use". */
export function broughtNote(songs: number, beats: number): string {
  if (beats === 0) return 'Brings no Beats';
  return `Brings the ${beatCount(beats)} ${songs === 1 ? 'it uses' : 'they use'}`;
}

/**
 * The Backup "New Backup" asks for from what's ticked. Every Song picked is
 * all of them, and every Beat picked is the Beat Library, however they were
 * picked, so together they're Everything. A Beat the picked Songs use counts
 * as picked. A hint for what's missing names only what can be ticked.
 */
export function newBackup(ticks: NewBackupTicks, there: BackupSource): NewBackup {
  const picked = ticks.songsTicked ? there.songIds.filter((id) => ticks.picked.has(id)) : [];
  const brought = beatsBrought(picked, there.beats);
  const pickedBeats = ticks.beatsTicked
    ? there.beats.filter((b) => ticks.pickedBeats.has(b.id) || brought.has(b.id)).map((b) => b.id)
    : [];
  if (!ticks.songsTicked && !ticks.beatsTicked) {
    if (there.beats.length === 0) return { missing: 'Tick Songs.' };
    if (there.songIds.length === 0) return { missing: 'Tick the Beat Library.' };
    return { missing: 'Tick Songs or the Beat Library.' };
  }
  if (ticks.songsTicked && picked.length === 0) {
    return { missing: ticks.beatsTicked ? 'Pick a Song, or untick Songs.' : 'Pick a Song.' };
  }
  if (ticks.beatsTicked && pickedBeats.length === 0) {
    return { missing: ticks.songsTicked ? 'Pick a Beat, or untick the Beat Library.' : 'Pick a Beat.' };
  }
  const allSongs = picked.length > 0 && picked.length === there.songIds.length;
  const beatLibrary = pickedBeats.length > 0 && pickedBeats.length === there.beats.length;
  const beats = ticks.beatsTicked ? pickedBeats.length : brought.size;
  return {
    contents: {
      ...(allSongs ? { allSongs: true as const } : { songs: picked }),
      ...(beatLibrary ? { beatLibrary: true as const } : { beats: pickedBeats }),
    },
    name: contentsName({ songs: picked.length, allSongs, beats, beatLibrary }),
  };
}

/** "1 Song", "3 Songs". */
export function songCount(n: number): string {
  return `${n} ${n === 1 ? 'Song' : 'Songs'}`;
}

/** "1 Beat", "3 Beats". */
export function beatCount(n: number): string {
  return `${n} ${n === 1 ? 'Beat' : 'Beats'}`;
}

/**
 * What a Restore brought back, in a few words: "2 Songs", "1 Song and 1 Beat",
 * "14 Beats". The Beats are named when there were any, or when the Beat
 * Library was restored, even if it held none.
 */
export function restoredName(songs: number, beats: number, beatLibrary: boolean): string {
  return [songs > 0 && songCount(songs), (beats > 0 || beatLibrary) && beatCount(beats)].filter(Boolean).join(' and ');
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
    beats.length > 0 &&
      'A Beat replaced takes the Backup’s title, credit, BPM, Key and Notes in every Song using it, and keeps its audio.',
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
