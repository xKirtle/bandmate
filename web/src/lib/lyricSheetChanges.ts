// Changes to the Lyric Sheet, each named by its kind, as Lyric Sheet editing
// (see lyricSheetEditing.svelte.ts) sends them through Saves.
import { api, type Song, type SongAt } from './api';

/** A change to the Lyric Sheet. */
export type LyricSheetChange = { kind: 'replaceAlternateText'; alternateId: number; text: string };

const lyricSheetChangeKinds: ReadonlySet<string> = new Set<LyricSheetChange['kind']>(['replaceAlternateText']);

/** Whether a change is to the Lyric Sheet. */
export function isLyricSheetChange(change: { kind: string }): change is LyricSheetChange {
  return lyricSheetChangeKinds.has(change.kind);
}

/** Sends a Lyric Sheet change through the api, returning the Song it leaves. */
export function sendLyricSheetChange(at: SongAt, change: LyricSheetChange): Promise<Song> {
  switch (change.kind) {
    case 'replaceAlternateText':
      return api.replaceAlternateText(at, change.alternateId, change.text);
  }
}
