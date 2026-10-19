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
// them, and each kind names its method, its path and its body once, here,
// built on the api module's request primitive. The fake in songServerFake.ts
// makes them in memory instead, from a mapping of its own, and
// songServerContract.test.ts checks both against the real server: that the
// fake leaves what the server left, and that the request sent is the one
// the server was sent.
import {
  api,
  ApiError,
  audioForm,
  request,
  type ClipMerge,
  type PastedClip,
  type PlacedClip,
  type Song,
  type SongAt,
  type SoundImport,
  type Timeline,
} from './api';
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
    getSong: () => request<Song>('GET', `/songs/${id}`),
    getTimeline: () => request<Timeline>('GET', `/songs/${id}/timeline`),
    apply: ((at: SongAt, change: CueChange | LyricSheetChange | Edit) => {
      if (isCueChange(change)) return sendCueChange(at, change);
      if (isLyricSheetChange(change)) return sendLyricSheetChange(at, change);
      return sendEdit(at, change);
    }) as SongServer['apply'],
    setTags: (tags) => api.setSongTags(id, tags),
    importSound: (at, file, details) => onTimeline(at)('POST', '/sounds', audioForm(file, details)),
    mergeClips: (at, wav, merge) => onTimeline(at)('POST', '/clips/merge', audioForm(wav, merge, 'merged.wav')),
  };
}

// Each change below names its method, the rest of its path and its body,
// against one of these two: a write to the Song, which answers with the
// Song it leaves, or one to its Timeline, which answers with the Timeline.
// Both send the version the change is based on, which the server refuses
// the write against if the Song has since changed elsewhere.

/** Sends a write to the Song, under /songs/<id>, returning the Song it leaves. */
const onSheet =
  (at: SongAt) =>
  (method: string, path: string, body?: unknown): Promise<Song> =>
    request<Song>(method, `/songs/${at.id}${path}`, body, at);

/** Sends a write to the Song's Timeline, under /songs/<id>/timeline, returning the Timeline it leaves. */
const onTimeline =
  (at: SongAt) =>
  (method: string, path: string, body?: unknown): Promise<Timeline> =>
    request<Timeline>(method, `/songs/${at.id}/timeline${path}`, body, at);

/** Clips to place or paste as the API takes them: each with the Track it goes on. */
function onTracks(clips: readonly (PlacedClip | PastedClip)[]) {
  return clips.map(({ clip, ...on }) => ({ ...on, ...clip }));
}

/** Sends a Cue change, returning the Song it leaves. */
function sendCueChange(at: SongAt, change: CueChange): Promise<Song> {
  const send = onSheet(at);
  switch (change.kind) {
    case 'setLineCue':
      return change.cue === null
        ? send('DELETE', `/lines/${change.lineId}/cue`)
        : send('PUT', `/lines/${change.lineId}/cue`, { cue: change.cue });
    case 'clearSectionCues':
      return send('DELETE', `/sections/${change.sectionId}/cues`);
    case 'clearCues':
      return send('DELETE', '/cues');
    case 'shiftCues':
      return send('POST', '/cues/shift', { start: change.start, end: change.end, by: change.by });
    case 'restoreCues':
      return send('PATCH', '/cues', { cues: change.cues });
  }
}

/** Sends a Lyric Sheet change, returning the Song it leaves. */
function sendLyricSheetChange(at: SongAt, change: LyricSheetChange): Promise<Song> {
  const send = onSheet(at);
  switch (change.kind) {
    case 'addSection':
      return send('POST', '/sections', { position: change.position });
    case 'duplicateSection':
      return send('POST', `/sections/${change.sectionId}/duplicate`, { position: change.position });
    case 'reorderArrangement':
      return send('PUT', '/arrangement', { sections: change.order });
    case 'removeFromArrangement':
      return send('DELETE', `/arrangement/${change.sectionId}`);
    case 'addToSection':
      return send('POST', `/sections/${change.sectionId}/add-to-section`, { sectionId: change.targetId });
    case 'deleteSection':
      return send('DELETE', `/sections/${change.sectionId}`);
    case 'setSectionLabel':
      return send('PATCH', `/sections/${change.sectionId}`, { label: change.label });
    case 'addAlternate':
      return send('POST', `/sections/${change.sectionId}/alternates`, { name: '' });
    case 'renameAlternate':
      return send('PATCH', `/alternates/${change.alternateId}`, { name: change.name });
    case 'activateAlternate':
      return send('POST', `/alternates/${change.alternateId}/activate`);
    case 'deleteAlternate':
      return send('DELETE', `/alternates/${change.alternateId}`);
    case 'moveAlternateToScrapbook':
      return send('POST', `/alternates/${change.alternateId}/scrapbook`);
    case 'moveAlternateToArrangement':
      return send('POST', `/alternates/${change.alternateId}/arrangement`, { position: change.position });
    case 'addToScrapbook':
      return send('POST', '/scrapbook', { label: '' });
    case 'addToArrangement':
      return send('POST', '/arrangement', { sectionId: change.sectionId, position: change.position });
    case 'replaceAlternateText':
      return send('PUT', `/alternates/${change.alternateId}/text`, { text: change.text });
    case 'restoreSnapshot':
      return send('POST', `/snapshots/${change.snapshotId}/restore`);
    case 'putSheetBack':
      return send('PUT', '/sheet', change.sheet);
  }
}

/** Sends an edit to the Song's Timeline, returning the Timeline it leaves. */
function sendEdit(at: SongAt, edit: Edit): Promise<Timeline> {
  const send = onTimeline(at);
  switch (edit.kind) {
    case 'addBeat':
      return send('POST', '/beats', { trackId: edit.trackId, beatId: edit.beatId });
    case 'addTrack':
      return send('POST', '/tracks', edit.track);
    case 'updateTrack':
      return send('PATCH', `/tracks/${edit.trackId}`, edit.changes);
    case 'reorderTracks':
      return send('PUT', '/tracks', { tracks: edit.order });
    case 'deleteTrack':
      return send('DELETE', `/tracks/${edit.trackId}`);
    case 'placeClip':
      return send('POST', '/clips', { trackId: edit.trackId, ...edit.clip });
    case 'placeClips':
      return send('POST', '/clips/place', { newTracks: edit.newTracks ?? [], clips: onTracks(edit.clips) });
    case 'pasteClips':
      return send('POST', '/clips/paste', { newTracks: edit.newTracks, clips: onTracks(edit.clips) });
    case 'moveClip':
      return send('POST', `/clips/${edit.clipId}/move`, { trackId: edit.trackId, start: edit.start });
    case 'moveClips':
      return send('POST', '/clips/move', { clips: edit.moves });
    case 'trimClip':
      return send('POST', `/clips/${edit.clipId}/trim`, { offset: edit.offset, length: edit.length, ...edit.fades });
    case 'renameClip':
      return send('PUT', `/clips/${edit.clipId}/name`, { name: edit.name });
    case 'setClipGain':
      return send('PUT', `/clips/${edit.clipId}/gain`, { gain: edit.gain });
    case 'setClipFades':
      return send('PUT', `/clips/${edit.clipId}/fades`, { fadeIn: edit.fadeIn, fadeOut: edit.fadeOut });
    case 'setClipTempos':
      return send('POST', '/clips/tempo', { clips: edit.tempos });
    case 'setClipPitches':
      return send('POST', '/clips/pitch', { clips: edit.pitches });
    case 'duplicateClip':
      return send('POST', `/clips/${edit.clipId}/duplicate`);
    case 'deleteClip':
      return send('DELETE', `/clips/${edit.clipId}`);
    case 'deleteClips':
      return send('POST', '/clips/delete', { clipIds: edit.clipIds, trackIds: edit.trackIds ?? [] });
    case 'replaceClips':
      return send('POST', '/clips/replace', {
        clipIds: edit.clipIds,
        trackIds: edit.trackIds ?? [],
        newTracks: edit.newTracks ?? [],
        clips: onTracks(edit.clips),
      });
    case 'splitClips':
      return send('POST', '/clips/split', { clipIds: edit.clipIds, at: edit.at });
    case 'setTakes':
      return send('PUT', `/clips/${edit.clipId}/takes`, edit.takes);
    case 'chooseTake':
      return send('PUT', `/clips/${edit.clipId}/active-take`, { takeId: edit.takeId });
    case 'nudgeTake':
      return send('PUT', `/clips/${edit.clipId}/takes/${edit.takeId}/nudge`, { nudge: edit.nudge });
    case 'deleteTake':
      return send('DELETE', `/clips/${edit.clipId}/takes/${edit.takeId}`);
    case 'clearInactiveTakes':
      return send('DELETE', `/clips/${edit.clipId}/inactive-takes`);
    case 'setLoop':
      return send('PUT', '/loop', edit.loop);
    case 'switchLoop':
      return send('PATCH', '/loop', { on: edit.on });
    case 'clearLoop':
      return send('DELETE', '/loop');
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
