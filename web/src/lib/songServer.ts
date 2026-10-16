// The reads and writes Saves makes itself: reading the Song and its
// Timeline, the Cue changes and Timeline edits it tries again, undoes,
// redoes and takes back, the Lyric Sheet changes it's given by name, and
// setting the Tags, which it's given as a list rather than a write. Saves
// also hands it to a rarer edit's work, which imports a Sound or merges
// Clips through it. Other writes a caller brings are built against the
// Song as saved already, so they don't go through here.
//
// It's the one place a Cue change, a Lyric Sheet change or a Timeline edit
// becomes a request: the modules that make and undo them only describe
// them. The fake in songServerFake.ts makes them in memory instead, and
// songServerContract.test.ts checks it against the real server.
import { api, ApiError, type ClipMerge, type Song, type SongAt, type SoundImport, type Timeline } from './api';
import type { CueChange } from './cueChanges';
import type { Edit } from './history';
import { isLyricSheetChange, type LyricSheetChange } from './lyricSheetChanges';

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
  /** Imports an audio file as a Sound, in a new Clip after a Track's last Clip, or at 0:00, returning the Timeline it leaves. */
  importSound(at: SongAt, file: File, details: SoundImport): Promise<Timeline>;
  /** Replaces Clips with one Clip of a new Sound, "Merged Clip", from their audio rendered together, returning the Timeline it leaves. */
  mergeClips(at: SongAt, wav: Blob, merge: ClipMerge): Promise<Timeline>;
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
    importSound: api.importSound,
    mergeClips: api.mergeClips,
  };
}

/** Sends a Cue change, returning the Song it leaves. */
function sendCueChange(at: SongAt, change: CueChange): Promise<Song> {
  switch (change.kind) {
    case 'setLineCue':
      return change.cue === null ? api.clearLineCue(at, change.lineId) : api.setLineCue(at, change.lineId, change.cue);
    case 'clearSectionCues':
      return api.clearSectionCues(at, change.sectionId);
    case 'clearCues':
      return api.clearCues(at);
    case 'shiftCues':
      return api.shiftCues(at, change.start, change.end, change.by);
    case 'restoreCues':
      return api.restoreCues(at, change.cues);
  }
}

/** Sends a Lyric Sheet change through the api, returning the Song it leaves. */
function sendLyricSheetChange(at: SongAt, change: LyricSheetChange): Promise<Song> {
  switch (change.kind) {
    case 'addSection':
      return api.addSection(at, { position: change.position });
    case 'duplicateSection':
      return api.duplicateSection(at, change.sectionId, change.position);
    case 'reorderArrangement':
      return api.reorderArrangement(at, change.order);
    case 'removeFromArrangement':
      return api.removeFromArrangement(at, change.sectionId);
    case 'addToSection':
      return api.addToSection(at, change.sectionId, change.targetId);
    case 'deleteSection':
      return api.deleteSection(at, change.sectionId);
    case 'setSectionLabel':
      return api.setSectionLabel(at, change.sectionId, change.label);
    case 'addAlternate':
      return api.addAlternate(at, change.sectionId);
    case 'renameAlternate':
      return api.renameAlternate(at, change.alternateId, change.name);
    case 'activateAlternate':
      return api.activateAlternate(at, change.alternateId);
    case 'deleteAlternate':
      return api.deleteAlternate(at, change.alternateId);
    case 'moveAlternateToScrapbook':
      return api.moveAlternateToScrapbook(at, change.alternateId);
    case 'moveAlternateToArrangement':
      return api.moveAlternateToArrangement(at, change.alternateId, change.position);
    case 'addToScrapbook':
      return api.addToScrapbook(at);
    case 'addToArrangement':
      return api.addToArrangement(at, change.sectionId, change.position);
    case 'replaceAlternateText':
      return api.replaceAlternateText(at, change.alternateId, change.text);
    case 'restoreSnapshot':
      return api.restoreSnapshot(at, change.snapshotId);
    case 'putSheetBack':
      return api.putSheetBack(at, change.sheet);
  }
}

/** Sends an edit to the Song's Timeline, returning the Timeline it leaves. */
function sendEdit(at: SongAt, edit: Edit): Promise<Timeline> {
  switch (edit.kind) {
    case 'addBeat':
      return api.addBeatToTimeline(at, edit.trackId, edit.beatId);
    case 'addTrack':
      return api.addTrack(at, edit.track);
    case 'updateTrack':
      return api.updateTrack(at, edit.trackId, edit.changes);
    case 'reorderTracks':
      return api.reorderTracks(at, edit.order);
    case 'deleteTrack':
      return api.deleteTrack(at, edit.trackId);
    case 'placeClip':
      return api.placeClip(at, edit.trackId, edit.clip);
    case 'placeClips':
      return api.placeClips(at, edit.clips, edit.newTracks);
    case 'pasteClips':
      return api.pasteClips(at, edit.clips, edit.newTracks);
    case 'moveClip':
      return api.moveClip(at, edit.clipId, edit.trackId, edit.start);
    case 'moveClips':
      return api.moveClips(at, edit.moves);
    case 'trimClip':
      return api.trimClip(at, edit.clipId, edit.offset, edit.length, edit.fades);
    case 'renameClip':
      return api.renameClip(at, edit.clipId, edit.name);
    case 'setClipGain':
      return api.setClipGain(at, edit.clipId, edit.gain);
    case 'setClipFades':
      return api.setClipFades(at, edit.clipId, { fadeIn: edit.fadeIn, fadeOut: edit.fadeOut });
    case 'setClipTempos':
      return api.setClipTempos(at, edit.tempos);
    case 'setClipPitches':
      return api.setClipPitches(at, edit.pitches);
    case 'duplicateClip':
      return api.duplicateClip(at, edit.clipId);
    case 'deleteClip':
      return api.deleteClip(at, edit.clipId);
    case 'deleteClips':
      return api.deleteClips(at, edit.clipIds, edit.trackIds);
    case 'replaceClips':
      return api.replaceClips(at, edit.clipIds, edit.clips, edit.trackIds, edit.newTracks);
    case 'splitClips':
      return api.splitClips(at, edit.clipIds, edit.at);
    case 'setTakes':
      return api.setTakes(at, edit.clipId, edit.takes);
    case 'chooseTake':
      return api.chooseTake(at, edit.clipId, edit.takeId);
    case 'nudgeTake':
      return api.nudgeTake(at, edit.clipId, edit.takeId, edit.nudge);
    case 'deleteTake':
      return api.deleteTake(at, edit.clipId, edit.takeId);
    case 'clearInactiveTakes':
      return api.clearInactiveTakes(at, edit.clipId);
    case 'setLoop':
      return api.setLoop(at, edit.loop);
    case 'switchLoop':
      return api.switchLoop(at, edit.on);
    case 'clearLoop':
      return api.clearLoop(at);
  }
}

/** How long to wait before each try again, in milliseconds: a few seconds in all. */
const retryWaits = [500, 1000, 2000];

/**
 * What a save saved, trying it again quietly for a few seconds while it
 * fails on the network or the server, which may well pass. A refusal, e.g.
 * as the Song changed elsewhere, would only fail again, so it fails at once,
 * as does the last try.
 */
export async function savedRetrying<T>(
  save: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (const ms of retryWaits) {
    try {
      return await save();
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 0 || e.status >= 500))) throw e;
    }
    await wait(ms);
  }
  return save();
}
