// The reads and writes Saves makes itself: reading the Song and its
// Timeline, the Cue changes and Timeline edits it tries again, undoes,
// redoes and takes back, the Lyric Sheet changes it's given by name, and
// setting the Tags, which it's given as a list rather than a write. Writes a
// caller brings are built against the Song as saved already, so they don't
// go through here.
import { api, type Song, type SongAt, type Timeline } from './api';
import { sendCueChange, type CueChange } from './cueChanges';
import { sendEdit, type Edit } from './history';
import { isLyricSheetChange, sendLyricSheetChange, type LyricSheetChange } from './lyricSheetChanges';

/** One Song on the server, as Saves reads and writes it: the api, or a fake of it. */
export interface SongServer {
  getSong(): Promise<Song>;
  getTimeline(): Promise<Timeline>;
  /** Makes a Cue change, returning the Song it leaves. */
  apply(at: SongAt, change: CueChange): Promise<Song>;
  /** Makes a Lyric Sheet change, returning the Song it leaves. */
  apply(at: SongAt, change: LyricSheetChange): Promise<Song>;
  /** Makes a Timeline edit, returning the Timeline it leaves. */
  apply(at: SongAt, edit: Edit): Promise<Timeline>;
  /** Sets the Song's Tags, returning them as saved. Tagging leaves the Song's version as it was. */
  setTags(tags: string[]): Promise<string[]>;
}

/** Waits the milliseconds given, e.g. between tries of a save. */
export type Wait = (ms: number) => Promise<void>;

export const waitFor: Wait = (ms) => new Promise((done) => setTimeout(done, ms));

const cueChangeKinds: ReadonlySet<string> = new Set<CueChange['kind']>([
  'setLineCue',
  'clearSectionCues',
  'clearCues',
  'shiftCues',
  'restoreCues',
]);

/** Whether a change is to the Cues, rather than to the Timeline. */
export function isCueChange(change: CueChange | LyricSheetChange | Edit): change is CueChange {
  return cueChangeKinds.has(change.kind);
}

/** The Song of the id given, on the server, through the api. */
export function songServer(id: number): SongServer {
  return {
    getSong: () => api.getSong(id),
    getTimeline: () => api.getTimeline(id),
    apply: ((at: SongAt, change: CueChange | LyricSheetChange | Edit) => {
      if (isCueChange(change)) return sendCueChange(at, change);
      if (isLyricSheetChange(change)) return sendLyricSheetChange(at, change);
      return sendEdit(at, change);
    }) as SongServer['apply'],
    setTags: (tags) => api.setSongTags(id, tags),
  };
}
